const http = require('node:http');
const port = Number(process.env.FIXTURE_PORT || 19112);
const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview test fixture</title>
<style>body{margin:0;padding:24px;font:18px system-ui;background:#f1f5f9;color:#17324a}h1{font-size:clamp(20px,4vw,40px)}
button,input{padding:12px;border:1px solid #708999;border-radius:8px}button{background:#176579;color:white;cursor:pointer}
main{max-width:900px;margin:auto}.items{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:20px}
.items div{padding:20px;background:white;border-radius:10px}</style></head><body><main><h1>Live responsive preview</h1>
<p id="viewport"></p><p id="location"></p><button id="counter">Clicks: 0</button>
<label> Test input <input placeholder="Type here"></label><div class="items"><div>First card</div><div>Second card</div><div>Third card</div></div>
</main><script>let clicks=0;document.querySelector('#counter').onclick=()=>{document.querySelector('#counter').textContent='Clicks: '+(++clicks)};
function update(){document.querySelector('#viewport').textContent='Viewport: '+innerWidth+' × '+innerHeight}
addEventListener('resize',update);update();document.querySelector('#location').textContent=location.pathname;</script></body></html>`;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(fixture);
}).listen(port, '127.0.0.1', () => console.log(`Preview fixture: http://127.0.0.1:${port}/`));
