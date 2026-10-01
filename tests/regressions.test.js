const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

function appContext(storage = { getItem: () => null, setItem() {} }) {
  const context = vm.createContext({
    URL, URLSearchParams, crypto: require('node:crypto').webcrypto, localStorage: storage,
    document: { querySelector: () => null }, ResizeObserver: class {},
    window: { location: { search: '' } },
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  vm.runInContext(source.replace(/^bootstrap\(\);$/m, ''), context);
  return expression => vm.runInContext(expression, context);
}

test('workspace remains usable when browser storage is unavailable', () => {
  const run = appContext({ getItem() { throw new Error('Storage denied'); }, setItem() { throw new Error('Storage denied'); } });
  run('loadWorkspace()');
  assert.equal(run('getActiveTab().targetUrl'), 'http://127.0.0.1:8080');
  assert.equal(run('state.tabs.length'), 1);
});

test('corrupt workspace IDs and geometry cannot break restored boards', () => {
  const saved = JSON.stringify({ tabs: [
    { id: 'duplicate', boardTiles: [
      { id: 'tile', url: 'http://localhost:3000', width: 'bad', x: 'bad' },
      { id: 'tile', url: 'http://localhost:3000', height: 'bad' },
    ], zoomPercent: 'bad' },
    { id: 'duplicate' }, null,
  ] });
  const run = appContext({ getItem: key => key.endsWith('workspace.v2') ? saved : null, setItem() {} });
  run('loadWorkspace()');
  assert.equal(run('new Set(state.tabs.map(tab => tab.id)).size'), 3);
  assert.equal(run('new Set(state.tabs[0].boardTiles.map(tile => tile.id)).size'), 2);
  assert.equal(run('state.tabs[0].boardTiles.every(tile => [tile.x, tile.y, tile.width, tile.height].every(Number.isFinite))'), true);
  assert.equal(run('state.tabs[0].zoomPercent'), 100);
});

test('fresh navigation preserves query and hash while rejecting unsafe URL schemes', () => {
  const run = appContext();
  const url = new URL(run('createFreshPreviewUrl("http://localhost:3000/a?x=1#details")'));
  assert.equal(url.searchParams.get('x'), '1');
  assert.equal(url.hash, '#details');
  assert.notEqual(url.toString(), run('createFreshPreviewUrl("http://localhost:3000/a?x=1#details")'));
  assert.equal(run('normalizeUrl("javascript:alert(1)")'), null);
});

async function startServer(t, port = '0') {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port) }, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  let output = '';
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 5000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
  });
  return origin;
}

function request(origin, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(`${origin}${pathname}`, { method }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(6000, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

test('malformed URLs return 400 and the server stays healthy', async t => {
  const origin = await startServer(t);
  for (const pathname of ['/%ZZ', '/%E0%A4%A']) {
    assert.equal((await request(origin, pathname)).status, 400);
    assert.equal((await request(origin, '/health')).status, 200);
  }
});

test('server serves app assets but never project files, logs, or Git metadata', async t => {
  const origin = await startServer(t);
  for (const pathname of ['/', '/app.js', '/styles.css']) {
    const result = await request(origin, pathname);
    assert.equal(result.status, 200);
    assert.equal(result.headers['cache-control'], 'no-store');
  }
  for (const pathname of ['/.git/config', '/server.js', '/README.md', '/Start-DevicePreviewLab.ps1', '/.logs/device-preview-lab-launcher.log', '/%2e%2e%5cserver.js']) {
    assert.equal((await request(origin, pathname)).status, 404, pathname);
  }
  assert.equal((await request(origin, '/', 'POST')).status, 405);
  const head = await request(origin, '/app.js', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
});

test('local scanning identifies HTTP servers, excludes raw TCP services, and handles concurrent requests', async t => {
  const web = http.createServer((req, res) => res.end('fixture'));
  const raw = net.createServer(socket => { socket.on('error', () => {}); socket.resume(); socket.end('not an HTTP server'); });
  // Use only free common scan ports; never replace existing local servers.
  const fixtures = [];
  for (const fixture of [web, raw]) {
    let selected;
    for (let port = 3000; port <= 3010; port++) {
      try {
        await new Promise((resolve, reject) => {
          fixture.once('error', reject);
          fixture.listen(port, '127.0.0.1', () => { fixture.removeListener('error', reject); resolve(); });
        });
        selected = port;
        break;
      } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
    }
    if (!selected) { t.skip('No free fixture ports in scan range'); return; }
    fixtures.push(selected);
    t.after(() => new Promise(resolve => fixture.close(resolve)));
  }
  let previewPort;
  for (let port = 3000; port <= 3010; port++) {
    const reservation = net.createServer();
    try {
      await new Promise((resolve, reject) => {
        reservation.once('error', reject);
        reservation.listen(port, '127.0.0.1', resolve);
      });
      await new Promise(resolve => reservation.close(resolve));
      previewPort = port;
      break;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  if (!previewPort) { t.skip('No free preview port in scan range'); return; }
  const origin = await startServer(t, previewPort);
  const scans = await Promise.all(Array.from({ length: 4 }, () => request(origin, '/api/local-servers')));
  for (const scan of scans) {
    assert.equal(scan.status, 200);
    const entries = JSON.parse(scan.body).servers;
    const ports = entries.map(entry => entry.port);
    assert.ok(ports.includes(fixtures[0]), 'HTTP fixture is detected');
    assert.ok(!ports.includes(fixtures[1]), 'Non-HTTP service is excluded');
    assert.ok(!ports.includes(previewPort), 'Preview Lab cannot recursively detect itself');
    assert.equal(new Set(entries.map(entry => entry.url)).size, entries.length, 'Repeated host URLs are deduplicated');
    assert.equal(entries.filter(entry => entry.port === fixtures[0]).length, 1, 'The IPv4 fixture cannot have duplicate aliases');
  }
});
