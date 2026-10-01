const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('node:child_process');
const { createTerminalService } = require('./terminal-service');

const host = '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '9090', 10);
const rootDir = path.resolve(__dirname);
const publicFiles = new Map([
  ...['/index.html', '/app.js', '/styles.css', '/terminal-hall.js'].map(file => [file, `.${file}`]),
  ['/vendor/xterm.js', 'node_modules/@xterm/xterm/lib/xterm.js'],
  ['/vendor/xterm.css', 'node_modules/@xterm/xterm/css/xterm.css'],
  ['/vendor/addon-fit.js', 'node_modules/@xterm/addon-fit/lib/addon-fit.js'],
]);
let pendingScan = null;
let pendingTerminalScan = null;

const LOCAL_SCAN_HOSTS = ['127.0.0.1', 'localhost'];
const LOCAL_SCAN_PORTS = [
  3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010,
  4000, 4001, 4200, 4321, 4444,
  5000, 5001, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180,
  5500, 5501, 6006,
  7000, 7001, 7100, 7153, 7190,
  8000, 8001, 8002, 8003, 8004, 8080, 8081, 8082, 8083, 8084, 8090, 8091, 8100, 8111, 8123, 8200, 8288,
  8383, 8443, 8488, 8500, 8551, 8600, 8647, 8787, 8888, 8889, 8890,
  9000, 9001, 9002, 9021, 9090, 9091, 9100, 9200, 9229, 9299, 9323, 9411, 9499, 9876, 9877, 9999,
];
const LOCAL_SCAN_TIMEOUT_MS = 450;

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((request, response) => {
  response.setHeader('X-Device-Preview-Lab', '1');
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
  } catch {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Bad request');
    return;
  }

  if (pathname.startsWith('/api/terminal/')) {
    terminalService.handle(request, response, pathname).catch(() => respondServerError(response));
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }

  if (pathname === '/health') {
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === '/api/local-servers') {
    handleLocalServers(request, response);
    return;
  }

  const safePath = pathname === '/' ? '/index.html' : pathname;
  if (!publicFiles.has(safePath)) {
    respondNotFound(response);
    return;
  }
  const filePath = path.resolve(rootDir, publicFiles.get(safePath));
  const relativePath = path.relative(rootDir, filePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    respondNotFound(response);
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      respondNotFound(response);
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType =
      contentTypes[extension] ?? 'application/octet-stream';

    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "frame-ancestors 'self'",
      'X-Content-Type-Options': 'nosniff',
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => respondServerError(response));
    stream.pipe(response);
  });
});

const terminalService = createTerminalService(server, discoverTerminalServers, rootDir);
server.once('close', () => terminalService.dispose());
process.once('exit', () => terminalService.dispose());
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    terminalService.dispose();
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}

server.listen(port, host, () => {
  console.log(`Device Preview Lab running at http://${host}:${server.address().port}`);
});

function respondNotFound(response) {
  response.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end('Not found');
}

function handleLocalServers(request, response) {
  if (request.method !== 'GET') {
    response.writeHead(405, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  if (!pendingScan) {
    pendingScan = scanLocalServers().finally(() => { pendingScan = null; });
  }
  pendingScan
    .then((servers) => {
      sendLocalServers(response, servers);
    })
    .catch(() => {
      sendLocalServers(response, []);
    });
}

function sendLocalServers(response, servers) {
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify({ ok: true, scannedAt: new Date().toISOString(), servers }));
}

async function scanLocalServers() {
  const probes = [];
  LOCAL_SCAN_PORTS.forEach((scanPort) => {
    if (scanPort === server.address().port) {
      return;
    }
    LOCAL_SCAN_HOSTS.forEach((scanHost) => {
      probes.push(probeLocalPort(scanHost, scanPort));
    });
  });

  const settled = await Promise.all(probes);
  const byPort = new Map();
  settled.forEach((result) => {
    if (!result) {
      return;
    }
    const existing = byPort.get(result.port);
    if (!existing || (existing.host === 'localhost' && result.host === '127.0.0.1')) {
      byPort.set(result.port, result);
    }
  });

  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

function probeLocalPort(scanHost, scanPort) {
  return new Promise((resolve) => {
    let settled = false;
    let probe;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      probe.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), LOCAL_SCAN_TIMEOUT_MS);
    probe = http.request({ hostname: scanHost, port: scanPort, path: '/', method: 'HEAD', agent: false }, (response) => {
      response.on('error', () => {});
      response.resume();
      finish({
        host: scanHost,
        port: scanPort,
        url: `http://${scanHost}:${scanPort}/`,
        title: null,
        previewLab: response.headers['x-device-preview-lab'] === '1',
      });
    });
    probe.once('error', () => finish(null));
    probe.end();
  });
}

function discoverTerminalServers() {
  if (!pendingTerminalScan) {
    pendingTerminalScan = discoverRunningServers().finally(() => { pendingTerminalScan = null; });
  }
  return pendingTerminalScan;
}

async function discoverRunningServers() {
  if (process.platform !== 'win32') return scanLocalServers();
  const script = `$ErrorActionPreference = 'Stop'
    $processMap = @{}
    Get-Process | ForEach-Object { $processMap[$_.Id] = $_.ProcessName }
    $listeners = @(Get-NetTCPConnection -State Listen | Where-Object {
      $_.LocalAddress -in @('0.0.0.0', '::', '127.0.0.1', '::1')
    } | ForEach-Object {
      [pscustomobject]@{ port = $_.LocalPort; pid = $_.OwningProcess; processName = $processMap[[int]$_.OwningProcess] }
    })
    ConvertTo-Json -InputObject $listeners -Compress`;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const listeners = await new Promise((resolve, reject) => {
    execFile(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 15000, maxBuffer: 512 * 1024 }, (error, stdout) => {
        if (error) { reject(new Error('Running-server discovery failed. Try Refresh servers.')); return; }
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Could not read running-server details.')); }
      });
  });
  const byPort = new Map();
  for (const listener of listeners) {
    if (listener.port !== server.address().port && listener.pid > 4) byPort.set(listener.port, listener);
  }
  // Probe a bounded number in batches to avoid flooding the local network stack.
  const candidates = [...byPort.values()].slice(0, 512);
  const found = [];
  for (let index = 0; index < candidates.length; index += 32) {
    const batch = await Promise.all(candidates.slice(index, index + 32).map(async listener => {
      const result = await probeLocalPort('127.0.0.1', listener.port);
      if (!result || result.previewLab) return null;
      if (listener.processName === 'node' && await isLegacyPreviewLab(result.url)) return null;
      return { ...result, pid: listener.pid, processName: listener.processName || 'Server' };
    }));
    found.push(...batch.filter(Boolean));
  }
  return found.sort((a, b) => a.port - b.port);
}

function isLegacyPreviewLab(url) {
  return new Promise(resolve => {
    let finished = false;
    let prefix = '';
    const finish = result => {
      if (finished) return;
      finished = true; clearTimeout(timer); request.destroy(); resolve(result);
    };
    const request = http.get(url, { agent: false }, response => {
      response.on('error', () => finish(false));
      response.on('data', data => {
        prefix += data.toString('utf8').slice(0, 4096 - prefix.length);
        if (/<title>\s*Device Preview Lab\s*<\/title>/i.test(prefix)) finish(true);
        else if (prefix.length >= 4096) finish(false);
      });
      response.on('end', () => finish(false));
    });
    const timer = setTimeout(() => finish(false), LOCAL_SCAN_TIMEOUT_MS);
    request.on('error', () => finish(false));
  });
}

function respondServerError(response) {
  if (response.headersSent) {
    response.end();
    return;
  }

  response.writeHead(500, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end('Server error');
}
