import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseLevelConfig } from '../assets/scripts/config/LevelConfig.ts';
import { effectiveSpeed, nextSpeed, speedText } from '../assets/scripts/core/ClimbSpeed.ts';

const raw = JSON.parse(readFileSync(new URL('../assets/resources/config/levels.json', import.meta.url), 'utf8'));
const SPEEDS = [1, 1.5, 2, 3, 5];

test('levels.json offers x1, x1.5, x2, x3, x5 to developers', () => {
    assert.deepEqual(parseLevelConfig(raw).dev.climbSpeeds, SPEEDS);
});

test('players always climb at x1; developers get their pick', () => {
    assert.equal(effectiveSpeed(false, SPEEDS, 5), 1);
    assert.equal(effectiveSpeed(true, SPEEDS, 5), 5);
    assert.equal(effectiveSpeed(true, SPEEDS, 4), 1, 'a saved speed no longer offered falls back to x1');
});

test('speed cycles in order and wraps', () => {
    assert.deepEqual([1, 1.5, 2, 3, 5].map((s) => nextSpeed(SPEEDS, s)), [1.5, 2, 3, 5, 1]);
    assert.equal(nextSpeed(SPEEDS, 7), 1);
    assert.equal(speedText(1.5), '×1.5');
});

test('dev.climbSpeeds must start at 1 and increase', () => {
    for (const bad of [[], [2, 3], [1, 3, 2], [1, -1], 'x']) {
        const r = structuredClone(raw);
        r.dev.climbSpeeds = bad;
        assert.throws(() => parseLevelConfig(r), /dev\.climbSpeeds/);
    }
});
