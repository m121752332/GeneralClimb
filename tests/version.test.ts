import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { APP_VERSION } from '../assets/scripts/core/Version.ts';

test('APP_VERSION matches package.json version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    assert.equal(APP_VERSION, pkg.version);
    assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
});
