'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createLocalServerDiscovery } = require('../local-server-discovery');

async function listen(t, server, host = '127.0.0.1', port = 0) {
  const connections = new Set();
  server.on('connection', socket => {
    connections.add(socket); socket.on('error', () => {}); socket.on('close', () => connections.delete(socket));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  t.after(async () => { for (const socket of connections) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return { address: host, port: server.address().port, pid: process.pid, processName: 'dartvm' };
}

function scanner(entries, options = {}) {
  return createLocalServerDiscovery({ getListeners: async () => entries, timeout: 300, ...options });
}

test('discovery filters debugger protocols while preserving a website in the same Dart process', async t => {
  const specs = [
    { status: 200, body: '<title>Nikhom &amp; Co</title><h1>Real application</h1>', keep: true },
    { status: 403, body: 'missing or invalid authentication code', keep: false },
    { status: 403, body: 'Cannot connect directly to the VM service as a Dart Development Service (DDS) instance has taken control', keep: false },
    { status: 404, body: '<title>404 Not Found</title><p>Only WebSocket connections are supported.</p>', keep: false },
    { status: 200, body: '<title>Debugging documentation</title><p>missing or invalid authentication code</p>', keep: true },
    { status: 200, body: '', debug: true, keep: false },
    { status: 200, body: '<title>Dart service</title>', vm: true, keep: false },
    { status: 503, body: '<title>Service Unavailable</title><p>HTTP Error 503. The service is unavailable.</p>', kernel: true, keep: false },
    { status: 503, body: '<title>Application maintenance</title><p>Try again later</p>', kernel: true, keep: true },
  ];
  const entries = [];
  for (const spec of specs) entries.push(await listen(t, http.createServer((req, res) => {
    if (spec.kernel) res.setHeader('Server', 'Microsoft-HTTPAPI/2.0');
    if (req.url === '/json/version' && spec.debug) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ Browser: 'Chrome/fixture', 'Protocol-Version': '1.3', 'V8-Version': 'fixture' }));
    } else if (req.url === '/getVM' && spec.vm) {
      res.end(JSON.stringify({ jsonrpc: '2.0', result: { type: 'VM', version: 'fixture', isolates: [] } }));
    } else { res.writeHead(spec.status); res.end(spec.body); }
  })));
  const found = await scanner(entries)();
  assert.deepEqual(found.map(entry => entry.port).sort(), entries.filter((_, i) => specs[i].keep).map(entry => entry.port).sort());
  assert.equal(found.find(entry => entry.port === entries[0].port).title, 'Nikhom & Co');
});

test('protected, API-only, missing-root and failing hosts remain discoverable; local redirects supply titles', async t => {
  const entries = [];
  for (const status of [200, 401, 403, 404, 500]) entries.push(await listen(t, http.createServer((_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ fixtureStatus: status }));
  })));
  const redirected = await listen(t, http.createServer((req, res) => {
    if (req.url === '/') { res.writeHead(302, { Location: '/app' }); res.end(); }
    else { res.end('<title>Redirected application</title>'); }
  }));
  entries.push(redirected);
  const external = await listen(t, http.createServer((_req, res) => {
    res.writeHead(302, { Location: 'http://127.not-a-local-host.invalid/private' }); res.end('External sign-in');
  }));
  entries.push(external);
  const localhostOnly = await listen(t, http.createServer((req, res) => {
    if (req.headers.host.startsWith('localhost:')) res.end('<title>Localhost host binding</title>');
    else { res.writeHead(400); res.end('Invalid Host header'); }
  }));
  entries.push(localhostOnly);
  const httpSys = await listen(t, http.createServer((_req, res) => res.end('<title>HTTP.sys application</title>')));
  entries.push({ ...httpSys, pid: 4, processName: 'System' });
  const found = await scanner(entries)();
  assert.equal(found.length, entries.length);
  assert.equal(found.find(entry => entry.port === redirected.port).title, 'Redirected application');
  assert.equal(found.find(entry => entry.port === external.port).status, 302, 'External redirects must not be fetched');
  assert.equal(found.find(entry => entry.port === localhostOnly.port).host, 'localhost');
});

test('IPv6-only applications and different hosts sharing one port are preserved; repeated listeners are deduplicated', async t => {
  const ipv6 = await listen(t, http.createServer((_req, res) => res.end('<title>IPv6 application</title>')), '::1');
  const ipv4 = await listen(t, http.createServer((_req, res) => res.end('<title>IPv4 application</title>')), '127.0.0.1', ipv6.port);
  const found = await scanner([ipv6, ipv4, ipv4])();
  assert.equal(found.length, 2);
  assert.ok(found.some(entry => entry.url === `http://[::1]:${ipv6.port}/`));
  assert.ok(found.some(entry => entry.url === `http://127.0.0.1:${ipv4.port}/`));
});

test('wildcard IPv4/IPv6 aliases collapse into one web app and nonlocal addresses are never probed', async t => {
  const entry = await listen(t, http.createServer((_req, res) => res.end('<title>Dual-stack application</title>')), '::');
  const found = await scanner([entry, { ...entry, address: '0.0.0.0' }, { ...entry, address: '203.0.113.1' }])();
  assert.equal(found.length, 1);
  assert.equal(found[0].host, '127.0.0.1');
});

test('raw TCP services, stalled responses, own process and other Lab instances are excluded', async t => {
  const raw = await listen(t, net.createServer(socket => socket.end('not HTTP')));
  const stalled = await listen(t, net.createServer(socket => socket.resume()));
  const markedLab = await listen(t, http.createServer((_req, res) => { res.setHeader('X-Device-Preview-Lab', '1'); res.end('Lab'); }));
  const legacyLab = await listen(t, http.createServer((_req, res) => res.end('<title>Device Preview Lab</title>')));
  const own = { address: '127.0.0.1', port: 9999, pid: 900001 };
  const found = await scanner([raw, stalled, markedLab, legacyLab, own], { ownPid: 900001 })();
  assert.deepEqual(found, []);
});

test('large/streaming pages are bounded and interrupted without exposing their response bodies', async t => {
  const entry = await listen(t, http.createServer((req, res) => {
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    res.write('<title>Streaming app</title>');
    const interval = setInterval(() => res.write('x'.repeat(8192)), 1);
    res.on('close', () => clearInterval(interval));
  }));
  const found = await scanner([entry])();
  assert.equal(found[0].title, 'Streaming app');
  assert.equal('body' in found[0], false);
  assert.equal('fingerprint' in found[0], false);
});

test('concurrent scans share inventory and a failed scan can recover', async t => {
  const entry = await listen(t, http.createServer((_req, res) => res.end('fixture')));
  let calls = 0;
  const scan = scanner([], { getListeners: async () => {
    calls++; if (calls === 1) throw new Error('Inventory unavailable'); return [entry];
  } });
  await assert.rejects(scan(), /Inventory unavailable/);
  const found = await Promise.all([scan(), scan(), scan()]);
  assert.equal(calls, 2);
  assert.ok(found.every(list => list[0].port === entry.port));
});

test('local HTTPS development hosts are detected without changing browser or global TLS trust', async t => {
  const logRoot = path.resolve(__dirname, '..', '.logs'); fs.mkdirSync(logRoot, { recursive: true });
  const fixtureRoot = fs.mkdtempSync(path.join(logRoot, 'discovery-tls-'));
  t.after(() => { assert.ok(fixtureRoot.startsWith(logRoot + path.sep)); fs.rmSync(fixtureRoot, { recursive: true, force: true }); });
  const keyPath = path.join(fixtureRoot, 'key.pem'); const certPath = path.join(fixtureRoot, 'cert.pem');
  const configPath = path.join(fixtureRoot, 'openssl.cnf');
  fs.writeFileSync(configPath, '[req]\ndistinguished_name=dn\n[dn]\n');
  const originalTrust = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const generated = spawnSync('openssl', ['req', '-config', configPath, '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-keyout', keyPath, '-out', certPath], { windowsHide: true, stdio: 'ignore' });
  if (generated.error?.code === 'ENOENT') { t.skip('OpenSSL is needed to generate the temporary HTTPS test certificate'); return; }
  assert.equal(generated.status, 0, 'Temporary test certificate generation must succeed');
  const entry = await listen(t, https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
    (_req, res) => res.end('<title>HTTPS application</title>')));
  const found = await scanner([entry])();
  assert.equal(found[0].protocol, 'https');
  assert.equal(found[0].url, `https://127.0.0.1:${entry.port}/`);
  assert.equal(found[0].certificateTrusted, false);
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, originalTrust);
});
