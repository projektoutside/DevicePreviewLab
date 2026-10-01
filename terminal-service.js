'use strict';

const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { WebSocketServer, WebSocket } = require('ws');

const MAX_SESSIONS = 12;
const MAX_HISTORY = 256 * 1024;
const MAX_BACKLOG = 2 * 1024 * 1024;

function createTerminalService(server, scanServers, root) {
  const sessions = new Map();
  const token = randomBytes(32).toString('hex');
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 32768 });
  let picker = null;
  let disposed = false;
  let sessionNumber = 0;

  // A strict Host check also prevents DNS rebinding to this local command endpoint.
  function trusted(request) {
    const authority = `127.0.0.1:${server.address()?.port}`;
    return request.headers.host === authority &&
      (!request.headers.origin || request.headers.origin === `http://${authority}`) &&
      !['cross-site', 'same-site'].includes(request.headers['sec-fetch-site']);
  }

  function authenticated(value) {
    return typeof value === 'string' && Buffer.byteLength(value) === token.length &&
      timingSafeEqual(Buffer.from(value), Buffer.from(token));
  }

  function describe(session) {
    return { id: session.id, name: session.name, cwd: session.cwd,
      pid: session.pty.pid, status: session.status, exitCode: session.exitCode ?? null };
  }

  function send(socket, message) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > MAX_BACKLOG) { socket.close(1013, 'Reconnect to resume output'); return; }
    if (message.type === 'output') {
      const pending = socket.pending.get(message.id) || [];
      pending.push({ seq: message.seq, bytes: Buffer.byteLength(message.data) });
      socket.pending.set(message.id, pending);
      if (pending.reduce((sum, entry) => sum + entry.bytes, 0) > 512 * 1024) {
        socket.close(1013, 'Output consumer is too slow'); return;
      }
    }
    socket.send(JSON.stringify(message));
  }

  function broadcast(message) {
    for (const socket of sockets.clients) {
      if (socket.authorized && (message.type !== 'output' || socket.subscriptions.has(message.id))) send(socket, message);
    }
  }

  function publishSessions() {
    broadcast({ type: 'sessions', sessions: [...sessions.values()].map(describe) });
  }

  async function createSession(cwd) {
    if (disposed) throw new Error('Terminal service is stopping.');
    if (sessions.size >= MAX_SESSIONS) throw new Error('Close a terminal before opening another (limit: 12).');
    if (typeof cwd !== 'string' || cwd.length > 4096 || !path.isAbsolute(cwd)) throw new Error('Choose an absolute folder path.');
    const resolved = await fs.promises.realpath(cwd);
    if (!(await fs.promises.stat(resolved)).isDirectory()) throw new Error('Choose a folder, not a file.');
    // Recheck after filesystem awaits; concurrent requests must respect the limit.
    if (disposed || sessions.size >= MAX_SESSIONS) throw new Error('No terminal slots are available.');
    const shell = process.platform === 'win32'
      ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : '/bin/bash';
    const pty = require('node-pty').spawn(shell, process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : [], {
      name: 'xterm-256color', cols: 100, rows: 30, cwd: resolved, env: { ...process.env, TERM: 'xterm-256color' },
    });
    const session = { id: randomUUID(), name: `${path.basename(resolved) || resolved} #${++sessionNumber}`,
      cwd: resolved, pty, status: 'running', history: [], bytes: 0, seq: 0 };
    sessions.set(session.id, session);
    pty.onData(data => {
      const entry = { type: 'output', id: session.id, seq: ++session.seq, data };
      session.history.push(entry);
      session.bytes += Buffer.byteLength(data);
      while (session.bytes > MAX_HISTORY && session.history.length > 1) {
        session.bytes -= Buffer.byteLength(session.history.shift().data);
      }
      broadcast(entry);
    });
    pty.onExit(({ exitCode }) => {
      session.status = 'exited'; session.exitCode = exitCode;
      if (sessions.has(session.id)) publishSessions();
    });
    publishSessions();
    return describe(session);
  }

  function closeSession(id) {
    const session = sessions.get(id);
    if (!session) throw new Error('This terminal has already closed.');
    sessions.delete(id);
    for (const socket of sockets.clients) { socket.pending.delete(id); socket.subscriptions.delete(id); }
    if (session.status === 'running') session.pty.kill();
    publishSessions();
  }

  async function chooseFolder() {
    if (picker) throw new Error('The folder picker is already open.');
    const helper = path.join(root, 'Select-DevicePreviewFolder.exe');
    if (!fs.existsSync(helper)) throw new Error('Build the folder picker with Build-DevicePreviewLabLauncher.ps1 first.');
    const logDirectory = path.join(root, '.logs');
    await fs.promises.mkdir(logDirectory, { recursive: true });
    if (picker || disposed) throw new Error('The folder picker is unavailable.');
    const resultPath = path.join(logDirectory, `folder-choice-${randomUUID()}.txt`);
    try {
      const selected = await new Promise((resolve, reject) => {
        picker = execFile(helper, [resultPath], { windowsHide: true, timeout: 300000 }, error => {
          picker = null;
          if (error?.code === 1) resolve(false);
          else if (error) reject(new Error('The folder picker could not complete.'));
          else resolve(true);
        });
      });
      if (!selected) return null;
      return (await fs.promises.readFile(resultPath, 'utf8')).replace(/^\uFEFF/, '').trim();
    } finally {
      await fs.promises.unlink(resultPath).catch(() => {});
    }
  }

  function json(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(body));
  }

  async function readBody(request) {
    if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('Expected JSON.');
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) throw new Error('Request is too large.');
    }
    return JSON.parse(body || '{}');
  }

  async function handle(request, response, pathname) {
    if (!trusted(request)) { json(response, 403, { error: 'Only the local app can access terminals.' }); return; }
    if (pathname === '/api/terminal/bootstrap' && request.method === 'GET') {
      json(response, 200, { token, defaultFolder: root, sessions: [...sessions.values()].map(describe) }); return;
    }
    if (!authenticated(request.headers['x-terminal-token'])) { json(response, 403, { error: 'Terminal authorization required.' }); return; }
    try {
      if (pathname === '/api/terminal/servers' && request.method === 'GET') {
        json(response, 200, { servers: await scanServers() });
      } else if (pathname === '/api/terminal/sessions' && request.method === 'POST') {
        json(response, 201, { session: await createSession((await readBody(request)).cwd) });
      } else if (pathname === '/api/terminal/choose-folder' && request.method === 'POST') {
        const cwd = await chooseFolder();
        json(response, cwd ? 201 : 200, { session: cwd ? await createSession(cwd) : null });
      } else if (pathname === '/api/terminal/close' && request.method === 'POST') {
        closeSession((await readBody(request)).id);
        json(response, 200, { ok: true });
      } else json(response, 405, { error: 'Unsupported terminal operation.' });
    } catch (error) {
      json(response, 400, { error: error.message });
    }
  }

  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/api/terminal/socket' || !trusted(request)) { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws));
  });

  sockets.on('connection', socket => {
    socket.subscriptions = new Set();
    socket.pending = new Map();
    const authTimer = setTimeout(() => socket.close(1008, 'Authorization required'), 5000);
    socket.alive = true;
    socket.on('pong', () => { socket.alive = true; });
    socket.on('error', () => {});
    socket.once('close', () => clearTimeout(authTimer));
    socket.on('message', data => {
      try {
        const message = JSON.parse(data.toString());
        if (!socket.authorized) {
          if (message.type !== 'hello' || !authenticated(message.token)) throw new Error('Unauthorized');
          socket.authorized = true; clearTimeout(authTimer);
          send(socket, { type: 'sessions', sessions: [...sessions.values()].map(describe) });
          return;
        }
        const session = sessions.get(message.id);
        if (!session) return;
        if (message.type === 'replay') {
          const after = Number.isSafeInteger(message.after) ? message.after : 0;
          if (session.history[0]?.seq > after + 1) send(socket, { type: 'gap', id: session.id });
          for (const entry of session.history) if (entry.seq > after) send(socket, entry);
          socket.subscriptions.add(session.id);
        } else if (message.type === 'ack' && Number.isSafeInteger(message.seq)) {
          socket.pending.set(session.id, (socket.pending.get(session.id) || []).filter(entry => entry.seq > message.seq));
        } else if (session.status === 'running' && message.type === 'input' && typeof message.data === 'string' && message.data.length <= 16384) {
          session.pty.write(message.data);
        } else if (session.status === 'running' && message.type === 'resize' &&
          Number.isInteger(message.cols) && Number.isInteger(message.rows) &&
          message.cols >= 2 && message.cols <= 500 && message.rows >= 2 && message.rows <= 300) {
          session.pty.resize(message.cols, message.rows);
        }
      } catch { socket.close(1008, 'Invalid terminal message'); }
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!socket.alive) { socket.terminate(); continue; }
      socket.alive = false; socket.ping();
    }
  }, 30000);
  heartbeat.unref();

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(heartbeat);
    picker?.kill();
    for (const session of [...sessions.values()]) {
      try { closeSession(session.id); } catch { /* The PTY may have just exited. */ }
    }
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
  }
  return { handle, dispose };
}

module.exports = { createTerminalService };
