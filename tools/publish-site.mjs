// Replaces site/ with the latest Web Mobile build. Pushing site/ to master deploys it to GitHub Pages.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const from = fileURLToPath(new URL('build/web-mobile', root));
const to = fileURLToPath(new URL('site', root));

if (!existsSync(`${from}/index.html`)) {
    console.error(`No build found at ${from}. Run "npm run build:web" first.`);
    process.exit(1);
}
rmSync(to, { recursive: true, force: true });
// .runtime-bridge is build bookkeeping written by the editor, not part of the game.
cpSync(from, to, { recursive: true, filter: (src) => !src.endsWith('.runtime-bridge') });
console.log(`copied ${from} -> ${to}`);
