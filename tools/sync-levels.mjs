// Copies the seed config/levels.json into the Cocos project. The game copy is the one that ships.
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const from = fileURLToPath(new URL('config/levels.json', root));
const to = fileURLToPath(new URL('assets/resources/config/levels.json', root));
copyFileSync(from, to);
console.log(`copied ${from} -> ${to}`);
