/**
 * Stellarator local server (zero dependencies, Node ≥ 18): serves ./public.
 *
 *   node server.js            → http://localhost:8080
 *
 * The game is plain HTML/JS, but browsers refuse to load ES modules and the physics
 * Web Worker from file:// URLs, so it needs to be served over http. Any static server
 * works; this one just saves installing anything. Scores stay in the browser.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  const type = MIME[extname(file)];
  // Stay inside public/ and skip dotfiles.
  if (!file.startsWith(ROOT) || file.includes(`${sep}.`) || !type) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, () => {
  console.log(`Stellarator running at http://localhost:${PORT}`);
});
