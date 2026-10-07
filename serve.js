// Tiny local preview server: `npm run serve`, then open http://localhost:8080
const http = require('http'), fs = require('fs'), path = require('path');
const DIST = path.join(__dirname, 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404, { 'Content-Type': TYPES['.html'] }); return res.end(fs.readFileSync(path.join(DIST, '404.html'))); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(process.env.PORT || 8080, () => console.log('Preview at http://localhost:' + (process.env.PORT || 8080)));
