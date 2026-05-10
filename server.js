const http = require('http');
const fs = require('fs');
const path = require('path');

const host = '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '9090', 10);
const rootDir = path.resolve(__dirname);

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
  const requestedPath = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(requestedPath.pathname);

  if (pathname === '/health') {
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(rootDir, `.${safePath}`);
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
    });

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => respondServerError(response));
    stream.pipe(response);
  });
});

server.listen(port, host, () => {
  console.log(`Device Preview Lab running at http://${host}:${port}`);
});

function respondNotFound(response) {
  response.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end('Not found');
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
