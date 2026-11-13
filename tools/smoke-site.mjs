// Smoke test for the committed Web Mobile build: serves site/ (or the folder given as the
// first argument), opens it in headless Chromium and waits for the Boot scene to report
// that levels.json loaded. Exits non-zero on page errors, failed requests or a timeout.
// Usage: node tools/smoke-site.mjs [folder]   (needs the playwright package and its Chromium)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const folder = process.argv[2] ?? 'site';
const port = Number(process.env.PORT ?? 8102);
const TIMEOUT_MS = 30_000;

const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), folder, String(port)], {
    stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
    server.stdout.once('data', resolve);
    server.once('exit', (code) => reject(new Error(`serve.mjs exited with code ${code}`)));
});

const problems = [];
// SwiftShader gives headless Chromium a software WebGL context on runners without a GPU.
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console error: ${m.text()}`); });
    page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });

    await page.goto(`http://localhost:${port}/`);
    // Boot.ts sets its status label to "... levels.json vN OK ..." on success, "... 載入失敗 ..." on failure.
    const handle = await page.waitForFunction(() => {
        const scene = globalThis.cc?.director?.getScene();
        if (!scene || scene.name !== 'Boot') return null;
        const text = scene.getComponentsInChildren(globalThis.cc.Label).map((l) => l.string).join('\n');
        return /OK|失敗/.test(text) ? text : null;
    }, null, { timeout: TIMEOUT_MS });
    const status = await handle.jsonValue();
    console.log(`Boot status:\n${status}`);
    if (!/levels\.json v\d+ OK/.test(status)) problems.push('Boot scene did not load levels.json');
} catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
} finally {
    await browser.close();
    server.kill();
}

if (problems.length) {
    console.error(`Smoke test failed:\n- ${problems.join('\n- ')}`);
    process.exit(1);
}
console.log('Smoke test OK');
