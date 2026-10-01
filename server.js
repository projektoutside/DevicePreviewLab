const http = require('http');
const fs = require('fs');
const path = require('path');
const { createLocalServerDiscovery } = require('./local-server-discovery');
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

const discoverLocalServers = createLocalServerDiscovery({ ownPid: process.pid,
  ownPort: () => server.address()?.port, fallbackPorts: LOCAL_SCAN_PORTS });
const terminalService = createTerminalService(server, discoverLocalServers, rootDir);
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

  discoverLocalServers()
    .then((servers) => {
      sendLocalServers(response, servers);
    })
    .catch(() => {
      response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ok: false, error: 'Local server discovery is unavailable. Try Scan again.' }));
    });
}

function sendLocalServers(response, servers) {
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify({ ok: true, scannedAt: new Date().toISOString(), servers }));
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
