'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const WebSocket = require('ws');

async function fixture(t) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '0' }, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let origin;
  t.after(async () => {
    // Even a failed assertion must stop this fixture's terminals before its server.
    try {
      if (origin && child.exitCode === null) {
        const state = await (await fetch(`${origin}/api/terminal/bootstrap`, { signal: AbortSignal.timeout(1000) })).json();
        for (const session of state.sessions) {
          await fetch(`${origin}/api/terminal/close`, { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': state.token },
            body: JSON.stringify({ id: session.id }), signal: AbortSignal.timeout(2000) });
        }
        const deadline = Date.now() + 5000;
        while (state.sessions.some(session => {
          try { process.kill(session.pid, 0); return true; } catch { return false; }
        }) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      }
    } finally { if (child.exitCode === null) child.kill(); }
  });
  origin = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    child.stdout.on('data', data => {
      output += data;
      const found = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (found) { clearTimeout(timeout); resolve(found[0]); }
    });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited (${code})`)); });
  });
  const bootstrap = await (await fetch(`${origin}/api/terminal/bootstrap`)).json();
  const api = async (operation, body, headers = {}) => {
    const response = await fetch(`${origin}/api/terminal/${operation}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': bootstrap.token, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { origin, token: bootstrap.token, api };
}

async function connect(origin, token, t) {
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/api/terminal/socket`, { origin });
  const messages = [];
  socket.on('message', data => messages.push(JSON.parse(data.toString())));
  socket.on('error', () => {});
  t.after(() => socket.terminate());
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'hello', token }));
  const wait = async predicate => {
    const until = Date.now() + 15000;
    while (!predicate(messages)) {
      if (Date.now() > until) throw new Error('Terminal output timed out');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return messages;
  };
  await wait(all => all.some(message => message.type === 'sessions'));
  return { socket, messages, wait, send: message => socket.send(JSON.stringify(message)) };
}

test('terminal endpoints reject foreign origins, forged hosts, missing tokens, and invalid folders', async t => {
  const { api, origin } = await fixture(t);
  assert.equal((await api('sessions', { cwd: process.cwd() }, { 'X-Terminal-Token': '' })).status, 403);
  assert.equal((await api('sessions', { cwd: process.cwd() }, { 'X-Terminal-Token': 'é'.repeat(64) })).status, 403);
  assert.equal((await api('bootstrap', undefined, { Origin: 'https://foreign.example' })).status, 403);
  const forgedHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(`${origin}/api/terminal/bootstrap`, { headers: { Host: 'foreign.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    request.on('error', reject);
  });
  assert.equal(forgedHostStatus, 403);
  assert.equal((await api('sessions', { cwd: process.cwd() }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await api('sessions', { cwd: '.' })).status, 400);
  assert.equal((await api('sessions', { cwd: __filename })).status, 400);
  assert.equal((await fetch(`${origin}/health`)).status, 200);
  for (const asset of ['/terminal-hall.js', '/vendor/xterm.js', '/vendor/xterm.css', '/vendor/addon-fit.js']) {
    assert.equal((await fetch(origin + asset)).status, 200);
  }
  assert.equal((await fetch(`${origin}/node_modules/ws/package.json`)).status, 404);
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/api/terminal/socket`, { origin: 'https://foreign.example' });
  socket.on('error', () => {});
  await new Promise(resolve => socket.once('close', resolve));
  assert.notEqual(socket.readyState, WebSocket.OPEN);
});

test('real PTY preserves folder, output, reconnect history, resizing, shell exit, and explicit close', { timeout: 45000 }, async t => {
  const { origin, token, api } = await fixture(t);
  const logRoot = path.resolve(__dirname, '..', '.logs');
  fs.mkdirSync(logRoot, { recursive: true });
  const folder = fs.mkdtempSync(path.join(logRoot, 'terminal fixture '));
  t.after(() => {
    assert.ok(path.resolve(folder).startsWith(logRoot + path.sep));
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const created = await api('sessions', { cwd: folder });
  assert.equal(created.status, 201);
  const session = created.body.session;
  t.after(async () => { await api('close', { id: session.id }).catch(() => {}); });
  assert.equal(session.cwd.toLowerCase(), fs.realpathSync(folder).toLowerCase());
  const first = await connect(origin, token, t);
  first.send({ type: 'replay', id: session.id, after: 0 });
  first.send({ type: 'resize', id: session.id, cols: 110, rows: 35 });
  const command = process.platform === 'win32' ? "Write-Output ('DPL_' + 'PTY_OK'); (Get-Location).Path\r" : "printf 'DPL_%s\\n' PTY_OK; pwd\r";
  first.send({ type: 'input', id: session.id, data: command });
  await first.wait(all => all.filter(message => message.type === 'output').map(message => message.data).join('').includes('DPL_PTY_OK'));
  const output = first.messages.filter(message => message.type === 'output').map(message => message.data).join('');
  assert.ok(output.includes(folder));
  first.socket.terminate();
  const second = await connect(origin, token, t);
  second.send({ type: 'replay', id: session.id, after: 0 });
  await second.wait(all => all.filter(message => message.type === 'output').map(message => message.data).join('').includes('DPL_PTY_OK'));
  second.send({ type: 'input', id: session.id,
    data: 'node -e "console.log(\'CTRL_C_CHILD=\'+process.pid);setInterval(()=>{},1000)"\r' });
  await second.wait(all => /CTRL_C_CHILD=(\d+)/.test(all.filter(message => message.id === session.id && message.type === 'output').map(message => message.data).join('')));
  const interruptPid = Number(second.messages.filter(message => message.id === session.id && message.type === 'output').map(message => message.data).join('').match(/CTRL_C_CHILD=(\d+)/)[1]);
  second.send({ type: 'input', id: session.id, data: '\x03' });
  await second.wait(() => { try { process.kill(interruptPid, 0); return false; } catch { return true; } });
  assert.equal((await api('bootstrap')).body.sessions.find(item => item.id === session.id).status, 'running', 'Ctrl+C must interrupt the command while keeping PowerShell usable');
  second.send({ type: 'input', id: session.id, data: 'exit\r' });
  await second.wait(all => all.some(message => message.type === 'sessions' && message.sessions.some(item => item.id === session.id && item.status === 'exited')));
  assert.equal((await api('close', { id: session.id })).status, 200);
  assert.equal((await api('close', { id: session.id })).status, 400);
  const another = (await api('sessions', { cwd: folder })).body.session;
  t.after(async () => { await api('close', { id: another.id }).catch(() => {}); });
  second.send({ type: 'replay', id: another.id, after: 0 });
  second.send({ type: 'input', id: another.id, data: 'node -e "const server=require(\'http\').createServer((q,r)=>r.end(\'terminal-fixture\')); server.listen(0,\'127.0.0.1\',()=>console.log(\'DPL_CHILD=\'+process.pid+\':\'+server.address().port));"\r' });
  const childPattern = /DPL_CHILD=(\d+):(\d+)/;
  await second.wait(all => childPattern.test(all.filter(message => message.id === another.id && message.type === 'output').map(message => message.data).join('')));
  const childMatch = second.messages.filter(message => message.id === another.id && message.type === 'output').map(message => message.data).join('').match(childPattern);
  const childPid = Number(childMatch[1]);
  const childPort = Number(childMatch[2]);
  assert.equal(await (await fetch(`http://127.0.0.1:${childPort}`)).text(), 'terminal-fixture');
  const discovered = await api('servers');
  assert.equal(discovered.status, 200);
  assert.ok(discovered.body.servers.some(server => server.port === childPort), 'Discover servers on arbitrary listening ports');
  assert.ok(!discovered.body.servers.some(server => server.port === Number(new URL(origin).port)), 'Exclude the Lab itself');
  assert.equal((await api('close', { id: another.id })).status, 200);
  const until = Date.now() + 7000;
  let exists = true;
  while (exists && Date.now() < until) {
    try { process.kill(another.pid, 0); } catch { exists = false; }
    if (exists) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(exists, false, 'Closing a managed terminal must stop its shell');
  let childExists = true;
  while (childExists && Date.now() < until) {
    try { process.kill(childPid, 0); } catch { childExists = false; }
    if (childExists) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(childExists, false, 'Closing a terminal must also stop the server started inside it');
});
