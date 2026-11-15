import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseLevelConfig } from '../assets/scripts/config/LevelConfig.ts';
import { EMPTY_PROGRESS, afterFullRun, afterSummit, parseProgress } from '../assets/scripts/core/Progress.ts';
import {
    bestRunToUpload, fasterRun, formatRounds, formatRunTime, parseRunMs, rankTimes, runMsFromSec,
} from '../assets/scripts/core/RunTime.ts';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('run times format as 分/秒/毫秒 and m / s', () => {
    assert.equal(formatRunTime(632_456, 'zh-TW'), '10分32秒456');
    assert.equal(formatRunTime(632_456, 'en'), '10m 32.456s');
    assert.equal(formatRunTime(65_007, 'zh-TW'), '1分05秒007');
    assert.equal(formatRunTime(65_007, 'en'), '1m 05.007s');
    assert.equal(formatRunTime(0, 'zh-TW'), '0分00秒000');
    assert.equal(formatRunTime(59_999.6, 'zh-TW'), '1分00秒000', 'rounds to whole ms first');
    assert.equal(formatRunTime(75 * 60_000, 'en'), '75m 00.000s', 'no hours');
    assert.equal(formatRunTime(-5, 'zh-TW'), '0分00秒000');
});

test('rounds: 10周目, 1 round / N rounds', () => {
    assert.equal(formatRounds(10, 'zh-TW'), '10周目');
    assert.equal(formatRounds(1, 'zh-TW'), '1周目');
    assert.equal(formatRounds(1, 'en'), '1 round');
    assert.equal(formatRounds(10, 'en'), '10 rounds');
    assert.equal(formatRounds(0, 'en'), '0 rounds');
});

test('climbSec becomes whole ms', () => {
    assert.equal(runMsFromSec(632.4564), 632_456);
    assert.equal(runMsFromSec(632.4566), 632_457);
});

test('stored run times are parsed defensively', () => {
    assert.equal(parseRunMs(500_000), 500_000);
    for (const v of [null, undefined, 0, -1, 1.5, '500000', NaN, Infinity]) assert.equal(parseRunMs(v), null, String(v));
});

test('the faster run wins', () => {
    assert.equal(fasterRun(null, null), null);
    assert.equal(fasterRun(null, 5), 5);
    assert.equal(fasterRun(5, null), 5);
    assert.equal(fasterRun(7, 5), 5);
});

test('only a faster local time at or above the rules limit is uploaded', () => {
    const MIN = 420;
    assert.equal(bestRunToUpload(null, null, MIN), null);
    assert.equal(bestRunToUpload(500_000, null, MIN), 500_000, 'first time');
    assert.equal(bestRunToUpload(500_000, 600_000, MIN), 500_000, 'faster');
    assert.equal(bestRunToUpload(600_000, 500_000, MIN), null, 'slower');
    assert.equal(bestRunToUpload(500_000, 500_000, MIN), null, 'same');
    assert.equal(bestRunToUpload(419_999, null, MIN), null, 'below the limit would be refused');
    assert.equal(bestRunToUpload(420_000, null, MIN), 420_000);
});

test('time ranking: fastest first, equal times share a rank', () => {
    const rows = rankTimes([
        { uid: 'a', name: 'A', bestRunMs: 700_000 },
        { uid: 'b', name: 'B', bestRunMs: 500_000 },
        { uid: 'c', name: 'C', bestRunMs: 700_000 },
        { uid: 'd', name: 'D', bestRunMs: 900_000 },
        { uid: 'e', name: 'E', bestRunMs: 0 },
    ]);
    assert.deepEqual(rows.map((r) => [r.uid, r.rank]), [['b', 1], ['a', 2], ['c', 2], ['d', 4]]);
});

test('local progress keeps the fastest full run', () => {
    let p = { ...EMPTY_PROGRESS };
    assert.equal(p.bestRunMs, null);
    p = afterFullRun(afterSummit(p, new Date(0)), 600_000);
    assert.equal(p.bestRunMs, 600_000);
    assert.equal(afterFullRun(p, 700_000), p, 'slower keeps the old object');
    assert.equal(afterFullRun(p, 550_000).bestRunMs, 550_000);
    assert.equal(afterFullRun(p, 1.5), p);
    assert.equal(parseProgress(JSON.stringify(p)).bestRunMs, 600_000);
    assert.equal(parseProgress('{"bestRunMs":-3}').bestRunMs, null);
    assert.equal(parseProgress('{"summits":2}').bestRunMs, null, 'old saves have no time');
});

test('cloud.minRunSec matches firestore.rules and is below the fastest possible run', () => {
    const raw = JSON.parse(read('../assets/resources/config/levels.json'));
    const cfg = parseLevelConfig(raw);
    const rules = read('../config/firestore.rules');
    const m = /d\.bestRunMs >= (\d+)/.exec(rules);
    assert.ok(m, 'rules have the bestRunMs lower limit');
    assert.equal(Number(m[1]), cfg.cloud.minRunSec * 1000);
    const steps = cfg.levels.reduce((n, l) => n + l.rows, 0);
    const fastestSec = steps * cfg.player.cellSec;
    assert.ok(cfg.cloud.minRunSec < fastestSec, `minRunSec ${cfg.cloud.minRunSec} < ${fastestSec.toFixed(1)} s (${steps} rows × cellSec)`);
    assert.equal(steps, 1308, 'the rules comment uses 1308 rows; update it with the levels');
});
