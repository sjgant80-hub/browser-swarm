// serve.mjs: a static server for previewing the page on this machine (127.0.0.1 only)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.md': 'text/plain; charset=utf-8' };
const root = process.cwd(), port = Number(process.env.PORT || 8817);
createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\])+/, '');
  const file = join(root, p === '' || p.endsWith('/') || p.endsWith('\') ? join(p, 'index.html') : p);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try { const b = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(b); }
  catch { res.writeHead(404).end('not found'); }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
