'use strict';
// Run explicitly on Windows after building the launcher; opens only task-owned app windows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function wait(predicate, label, timeout = 20000) {
  const until = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() >= until) throw new Error(`Timed out: ${label}`);
    await delay(100);
  }
}

async function check(mode) {
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const logPath = path.join(root, '.logs', 'device-preview-lab-launcher.log');
  const previousLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').length : 0;
  const launcher = spawn(path.join(root, 'Start-DevicePreviewLab.exe'), ['-Port', String(port)], { cwd: root, windowsHide: true });
  launcher.on('error', () => {});
  let socket;
  const exited = once(launcher, 'exit');
  try {
    const origin = `http://127.0.0.1:${port}`;
    await wait(async () => {
      try { return (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; }
    }, 'native app startup');
    let browserPid;
    await wait(() => {
      const current = fs.readFileSync(logPath, 'utf8').slice(previousLog);
      const line = current.split(/\r?\n/).find(entry => entry.includes(`PreviewUrl=${origin}/`));
      browserPid = line?.match(/BrowserPid=(\d+)/)?.[1];
      return !!browserPid;
    }, 'owned browser window');
    const bootstrap = await (await fetch(`${origin}/api/terminal/bootstrap`)).json();
    assert.equal(path.resolve(bootstrap.defaultFolder), root);
    const response = await fetch(`${origin}/api/terminal/sessions`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': bootstrap.token }, body: JSON.stringify({ cwd: root }) });
    assert.equal(response.status, 201);
    const { session } = await response.json();
    socket = new WebSocket(`${origin.replace('http:', 'ws:')}/api/terminal/socket`, { origin });
    socket.on('error', () => {});
    let output = ''; let sent = false;
    socket.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.type === 'sessions' && !sent) {
        sent = true;
        socket.send(JSON.stringify({ type: 'replay', id: session.id, after: 0 }));
        socket.send(JSON.stringify({ type: 'input', id: session.id,
          data: 'node -e "console.log(\'WORKSTATION_CHILD=\'+process.pid);setInterval(()=>{},1000)"\r' }));
      }
      if (message.type === 'output') output += message.data;
    });
    await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'hello', token: bootstrap.token }));
    await wait(() => /WORKSTATION_CHILD=(\d+)/.test(output), 'server launched inside terminal');
    const terminalChildPid = Number(output.match(/WORKSTATION_CHILD=(\d+)/)[1]);
    assert.ok(alive(session.pid) && alive(terminalChildPid));
    if (mode === 'browser-exit') process.kill(Number(browserPid));
    else launcher.kill();
    await wait(() => launcher.exitCode !== null || launcher.signalCode !== null, 'launcher shutdown');
    const [exitCode] = await exited;
    if (mode === 'browser-exit') assert.equal(exitCode, 0);
    await wait(() => !alive(session.pid) && !alive(terminalChildPid) && !alive(Number(browserPid)), 'owned process cleanup');
    await assert.rejects(fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) }));
    console.log(`PASS: ${mode}; native app, hidden supervisor, browser, terminal shell, command child, and server stopped`);
  } finally {
    socket?.terminate();
    if (launcher.exitCode === null && launcher.signalCode === null) { launcher.kill(); await exited; }
  }
}

(async () => {
  if (process.platform !== 'win32') throw new Error('This check requires Windows.');
  await check('browser-exit');
  await check('forced-launcher-exit');
})().catch(error => { console.error(error); process.exitCode = 1; });
