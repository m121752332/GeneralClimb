import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseLevelConfig } from '../assets/scripts/config/LevelConfig.ts';
import { normalizeCheat, parseCheat } from '../assets/scripts/core/CheatCodes.ts';
import { levelAccess } from '../assets/scripts/core/LevelAccess.ts';

test('RUNGM turns dev mode on: trimmed, any case, optional brackets', () => {
    for (const input of ['RUNGM', 'rungm', '  RunGm  ', '[RUNGM]', ' [ rungm ] ', '【RUNGM】', '(RunGM)']) {
        assert.equal(parseCheat(input), 'devModeOn', input);
    }
});

test('STOPGM turns dev mode off with the same rules', () => {
    for (const input of ['STOPGM', 'stopgm', ' StopGM ', '[STOPGM]', '[stopgm]', '【StopGM】']) {
        assert.equal(parseCheat(input), 'devModeOff', input);
    }
});

test('anything else is unknown, blank input is empty', () => {
    for (const input of ['RUN GM', 'RUNGMX', '[RUNGM', 'GM', '[[RUNGM]]', 'STOP']) {
        assert.equal(parseCheat(input), 'unknown', input);
    }
    for (const input of ['', '   ', '[]', '[ ]']) {
        assert.equal(parseCheat(input), 'empty', JSON.stringify(input));
    }
    assert.equal(normalizeCheat(' [rungm] '), 'RUNGM');
});

test('level access: only level 1 without dev mode; dev mode opens floor levels but not the spire', () => {
    const levels = parseLevelConfig(JSON.parse(readFileSync(new URL('../assets/resources/config/levels.json', import.meta.url), 'utf8'))).levels;
    const normal = levels.map((l, i) => levelAccess(l, i, false));
    assert.deepEqual(normal, ['open', ...Array(13).fill('locked')]);
    const dev = levels.map((l, i) => levelAccess(l, i, true));
    assert.deepEqual(dev, [...Array(12).fill('open'), 'spire', 'spire']);
});
