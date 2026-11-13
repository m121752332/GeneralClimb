// Builds Web Mobile with the Cocos Creator CLI. Close the editor for this project first.
// Override the editor path with the COCOS_CREATOR environment variable.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = fileURLToPath(new URL('./build-web-mobile.json', import.meta.url));
const exe = process.env.COCOS_CREATOR ?? 'C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe';
const SUCCESS = 36; // Cocos Creator 3.x CLI exit code for a successful build

if (!existsSync(exe)) {
    console.error(`Cocos Creator not found at ${exe}. Set COCOS_CREATOR to CocosCreator.exe.`);
    process.exit(1);
}

const result = spawnSync(exe, ['--project', root, '--build', `configPath=${config}`], { stdio: 'inherit' });
if (result.status !== SUCCESS) {
    console.error(`Build failed: exit code ${result.status} (expected ${SUCCESS}). See temp/builder/log.`);
    process.exit(1);
}
console.log('Build OK: build/web-mobile');
