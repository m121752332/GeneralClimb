import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ICON_DIR, ICON_FILES, NO_SCROLL_STYLE, injectIconLinks } from '../tools/site-icons.mjs';

const html = '<html><head>\n  <title>x</title>\n</head><body></body></html>';

test('injectIconLinks adds every icon link inside <head>', () => {
    const out = injectIconLinks(html);
    const head = out.slice(0, out.indexOf('</head>'));
    for (const name of ICON_FILES) assert.ok(head.includes(`href="${name}"`), name);
});

test('injectIconLinks is idempotent', () => {
    const once = injectIconLinks(html);
    assert.equal(injectIconLinks(once), once);
});

test('injectIconLinks rejects html without </head>', () => {
    assert.throws(() => injectIconLinks('<body></body>'));
});

test('icon files exist in the build template and in site/', () => {
    for (const name of ICON_FILES) {
        assert.ok(existsSync(`${ICON_DIR}/${name}`), `build-templates/web-mobile/${name}`);
        assert.ok(existsSync(new URL(`../site/${name}`, import.meta.url)), `site/${name}`);
    }
});

test('committed site/index.html links the icons and hides page scrollbars', () => {
    const index = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
    assert.equal(injectIconLinks(index), index);
    assert.ok(index.includes(NO_SCROLL_STYLE));
});

test('injectIconLinks adds the no-scrollbar style', () => {
    assert.ok(injectIconLinks(html).includes(NO_SCROLL_STYLE));
});
