// Serves build/web-mobile (or the folder given as the first argument) for local checks.
// Usage: node tools/serve.mjs [folder] [port]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)), process.argv[2] ?? 'build/web-mobile');
const port = Number(process.env.PORT ?? process.argv[3] ?? 8101);
const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
    '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.ttf': 'font/ttf', '.bin': 'application/octet-stream',
};

createServer((req, res) => {
    // URL parsing already collapses ".." segments; join + startsWith below guards the rest.
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(root, rel));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file.startsWith(root) || !existsSync(file)) {
        res.writeHead(404).end('Not found');
        return;
    }
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving ${root} at http://localhost:${port}`));
