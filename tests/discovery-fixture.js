'use strict';
// Explicit browser fixture; all ports are allocated by the OS and owned by this process.
const http = require('node:http');
const servers = [];
async function open(title, host = '127.0.0.1', port = 0, status = 200, debug = false) {
  const server = http.createServer((request, response) => {
    if (debug && request.url === '/json/version') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ Browser: 'Chrome/fixture', 'Protocol-Version': '1.3', 'V8-Version': 'fixture' }));
      return;
    }
    response.writeHead(status, { 'Content-Type': 'text/html' });
    response.end(`<!doctype html><title>${title}</title><h1>${title}</h1><p>Read-only discovery fixture</p>`);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  servers.push(server); return server.address().port;
}
async function main() {
  const ipv4 = await open('Discovery IPv4 fixture');
  await open('Discovery IPv6 fixture', '::1', ipv4);
  const protectedPort = await open('Discovery protected fixture', '127.0.0.1', 0, 403);
  const debuggerPort = await open('Discovery debugger fixture', '127.0.0.1', 0, 200, true);
  console.log(JSON.stringify({ ipv4, protectedPort, debuggerPort }));
}
const close = () => { for (const server of servers) { server.closeAllConnections(); server.close(); } };
process.once('SIGINT', close); process.once('SIGTERM', close);
main().catch(error => { console.error(error.message); close(); process.exitCode = 1; });
