'use strict';
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');

const MAX_BODY = 32 * 1024;
function isToolingResponse(response) {
  return (response.status === 403 && /^(missing or invalid authentication code|Cannot connect directly to the VM service)/i.test(response.body.trim()))
    || (response.status === 404 && /Only WebSocket connections are supported/i.test(response.body)
      && titleFrom(response.body) === '404 Not Found')
    || (response.status === 503 && /^Microsoft-HTTPAPI\//i.test(response.headers.server || '')
      && titleFrom(response.body) === 'Service Unavailable'
      && /HTTP Error 503\. The service is unavailable\./i.test(response.body));
}

function readWindowsListeners() {
  const script = `$ErrorActionPreference = 'Stop'
    $processMap = @{}
    Get-Process | ForEach-Object { $processMap[$_.Id] = $_.ProcessName }
    $listeners = @(Get-NetTCPConnection -State Listen | ForEach-Object {
      [pscustomobject]@{ address = $_.LocalAddress; port = $_.LocalPort; pid = $_.OwningProcess; processName = $processMap[[int]$_.OwningProcess] }
    })
    ConvertTo-Json -InputObject $listeners -Compress`;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    execFile(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
        if (error) { reject(new Error('Running-server discovery failed. Try Scan or Refresh servers again.')); return; }
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new Error('Could not read running-server details.')); }
      });
  });
}

function localAddresses() {
  const addresses = new Set(['127.0.0.1', '::1']);
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) addresses.add(entry.address);
  }
  return addresses;
}

function titleFrom(body) {
  const match = body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/<[^>]*>/g, '').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim().slice(0, 160) || null : null;
}

function urlFor(protocol, hostname, port) {
  return `${protocol}//${net.isIP(hostname) === 6 ? `[${hostname}]` : hostname}:${port}/`;
}

// Read a bounded prefix without following redirects or carrying cookies/credentials.
function requestPrefix(url, timeout, headers = {}) {
  return new Promise(resolve => {
    let done = false; let request;
    const finish = result => {
      if (done) return;
      done = true; clearTimeout(timer); request?.destroy(); resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeout);
    try {
      const transport = url.protocol === 'https:' ? https : http;
      request = transport.get(url, { agent: false, headers: { 'Accept-Encoding': 'identity', ...headers },
        // Discovery checks local development certificates only; browser trust is unchanged.
        ...(url.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
      }, response => {
        const chunks = []; let bytes = 0;
        const certificateTrusted = url.protocol !== 'https:' || response.socket?.authorized === true;
        const complete = () => finish({ status: response.statusCode, headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'), certificateTrusted });
        response.on('data', chunk => {
          const remaining = MAX_BODY - bytes;
          chunks.push(chunk.subarray(0, remaining)); bytes += Math.min(remaining, chunk.length);
          if (bytes >= MAX_BODY) complete();
        });
        response.on('end', complete);
        response.on('error', () => finish(null));
        response.on('aborted', () => finish(null));
      });
      request.on('error', () => finish(null));
    } catch { finish(null); }
  });
}

function isDebuggerVersion(response) {
  if (!response || response.status !== 200) return false;
  try {
    const version = JSON.parse(response.body);
    return typeof version.Browser === 'string' && typeof version['Protocol-Version'] === 'string'
      && (typeof version.webSocketDebuggerUrl === 'string' || typeof version['V8-Version'] === 'string');
  } catch { return false; }
}

async function probe(listener, allowedAddresses, timeout) {
  for (const protocol of ['http:', 'https:']) {
    const original = new URL(urlFor(protocol, listener.host, listener.port));
    let target = original;
    let response = await requestPrefix(target, timeout);
    if (!response) continue;
    if (response.status === 400 && /plain HTTP request was sent to HTTPS port/i.test(response.body)) continue;
    let displayUrl = original.href;
    // Some development servers require localhost in their Host header.
    if ([400, 421].includes(response.status) && /^127\./.test(listener.host)) {
      const localhost = await requestPrefix(original, timeout, { Host: `localhost:${listener.port}` });
      if (localhost && ![400, 421].includes(localhost.status)) {
        response = localhost; displayUrl = urlFor(protocol, 'localhost', listener.port);
      }
    }
    let previewLab = false;
    for (let redirects = 0; redirects < 4; redirects++) {
      previewLab ||= response.headers['x-device-preview-lab'] === '1';
      if (response.status < 300 || response.status >= 400 || !response.headers.location) break;
      let next;
      try { next = new URL(response.headers.location, target); } catch { break; }
      const nextHost = next.hostname.replace(/^\[|\]$/g, '');
      if (!['http:', 'https:'].includes(next.protocol) || next.username || next.password
        || !(allowedAddresses.has(nextHost) || nextHost === 'localhost' || (net.isIP(nextHost) === 4 && /^127\./.test(nextHost)))) break;
      const redirected = await requestPrefix(next, timeout);
      if (!redirected) break;
      target = next; response = redirected;
    }
    const title = titleFrom(response.body);
    if (previewLab || response.headers['x-device-preview-lab'] === '1'
      || title === 'Device Preview Lab' || isToolingResponse(response)) return null;
    const debuggerVersion = await requestPrefix(new URL('/json/version', original), timeout);
    if (isDebuggerVersion(debuggerVersion)) return null;
    if (/^dart(vm|aotruntime)$/i.test(listener.processName || '')) {
      const vmResponse = await requestPrefix(new URL('/getVM', original), timeout);
      if (vmResponse?.status === 200) {
        try {
          const payload = JSON.parse(vmResponse.body);
          const vm = payload.result || payload;
          if (vm.type === 'VM' && Array.isArray(vm.isolates) && typeof vm.version === 'string') return null;
        } catch {}
      }
    }
    // Auth-protected, API-only, missing-root and temporarily failing apps remain discoverable.
    const fingerprint = title || createHash('sha256').update(response.body).digest('hex');
    return { host: new URL(displayUrl).hostname.replace(/^\[|\]$/g, ''), port: listener.port, url: displayUrl,
      title, status: response.status, protocol: protocol.slice(0, -1), certificateTrusted: response.certificateTrusted,
      pid: listener.pid, processName: listener.processName || 'Server', fingerprint };
  }
  return null;
}

function createLocalServerDiscovery({ ownPid, ownPort, fallbackPorts = [], getListeners, addresses, timeout = 2000 } = {}) {
  let pending = null;
  const listeners = getListeners || (process.platform === 'win32' ? readWindowsListeners : async () =>
    fallbackPorts.flatMap(port => ['127.0.0.1', '::1'].map(address => ({ address, port }))));
  async function discover() {
    const inventory = await listeners();
    if (!Array.isArray(inventory)) throw new Error('Invalid running-server inventory.');
    const allowedAddresses = addresses || localAddresses();
    const candidates = new Map();
    for (const listener of inventory) {
      if (!Number.isInteger(listener.port) || listener.port < 1 || listener.port > 65535
        || (ownPid && listener.pid === ownPid) || (listener.pid !== undefined && listener.pid < 1)) continue;
      const hosts = listener.address === '0.0.0.0' ? ['127.0.0.1'] : listener.address === '::' ? ['::1'] : [listener.address];
      for (const host of hosts) {
        if (host?.includes('%') || !net.isIP(host) || !(allowedAddresses.has(host) || /^127\./.test(host))) continue;
        if (listener.port === ownPort?.() && host === '127.0.0.1') continue;
        candidates.set(`${host}:${listener.port}`, { ...listener, host });
      }
    }
    const jobs = [...candidates.values()]; const results = []; let next = 0;
    // Scan every listener without an arbitrary port-list cutoff, at bounded concurrency.
    await Promise.all(Array.from({ length: Math.min(24, jobs.length) }, async () => {
      while (next < jobs.length) {
        const candidate = jobs[next++];
        const found = await probe(candidate, allowedAddresses, timeout);
        if (found) results.push(found);
      }
    }));
    const unique = new Map();
    results.sort((a, b) => Number(b.host === '127.0.0.1') - Number(a.host === '127.0.0.1') || a.host.localeCompare(b.host));
    for (const result of results) {
      const key = `${result.pid ?? ''}:${result.port}:${result.protocol}:${result.status}:${result.fingerprint}`;
      if (!unique.has(key)) {
        const entry = { ...result }; delete entry.fingerprint;
        unique.set(key, entry);
      }
    }
    return [...unique.values()].sort((a, b) => a.port - b.port || a.url.localeCompare(b.url));
  }
  return () => {
    if (pending) return pending;
    pending = discover().finally(() => { pending = null; });
    return pending;
  };
}

module.exports = { createLocalServerDiscovery };
