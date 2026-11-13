import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LevelConfigError, parseLevelConfig } from '../assets/scripts/config/LevelConfig.ts';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const seedText = read('../config/levels.json');
const gameText = read('../assets/resources/config/levels.json');
const fresh = (): any => JSON.parse(gameText);

function issuesOf(mutate: (cfg: any) => void): string[] {
    const cfg = fresh();
    mutate(cfg);
    try {
        parseLevelConfig(cfg);
    } catch (e) {
        assert.ok(e instanceof LevelConfigError);
        return e.issues;
    }
    assert.fail('expected parseLevelConfig to throw');
}

test('game levels.json matches the seed copy in config/', () => {
    assert.deepEqual(JSON.parse(gameText), JSON.parse(seedText));
});

test('shipped levels.json is valid and has 14 levels', () => {
    const cfg = parseLevelConfig(fresh());
    assert.equal(cfg.levels.length, 14);
});

test('derives floors and rows per level', () => {
    const cfg = parseLevelConfig(fresh());
    const l1 = cfg.levels[0];
    assert.deepEqual([l1.floorFrom, l1.floorTo, l1.rows], [1, 8, 96]);
    const l12 = cfg.levels[11];
    assert.deepEqual([l12.floorFrom, l12.floorTo, l12.rows], [91, 101, 132]);
    const l13 = cfg.levels[12];
    assert.deepEqual([l13.floorFrom, l13.floorTo, l13.rows], [null, null, cfg.player.ladderRows]);
});

test('does not mutate its input', () => {
    const input = fresh();
    parseLevelConfig(input);
    assert.deepEqual(input, fresh());
});

test('rejects non-object input', () => {
    assert.throws(() => parseLevelConfig(null), LevelConfigError);
    assert.throws(() => parseLevelConfig([]), LevelConfigError);
});

test('rejects unsupported version', () => {
    assert.match(issuesOf((c) => { c.version = 2; })[0], /\$\.version/);
});

test('rejects a width whose cols do not add up', () => {
    const issues = issuesOf((c) => { c.widths.wide.cols = 10; });
    assert.equal(issues.length, 1);
    assert.match(issues[0], /\$\.widths\.wide: cols must equal safe \+ 2 \* danger/);
});

test('rejects a level that references an unknown width', () => {
    assert.match(issuesOf((c) => { c.levels[2].width = 'huge'; })[0], /\$\.levels\[2\]\.width: unknown width "huge"/);
});

test('rejects windChance outside 0..1', () => {
    assert.match(issuesOf((c) => { c.levels[5].windChance = 1.4; })[0], /\$\.levels\[5\]\.windChance/);
});

test('rejects a gap between floor ranges', () => {
    assert.match(issuesOf((c) => { c.levels[1].floors = '10-17F'; })[0], /\$\.levels\[1\]\.floors: must start at 9F/);
});

test('rejects wrong level count and non-consecutive ids', () => {
    const issues = issuesOf((c) => { c.levels.splice(3, 1); });
    assert.ok(issues.some((m) => /must have 14 levels, got 13/.test(m)));
    assert.ok(issues.some((m) => /\$\.levels\[3\]\.id: must be 4/.test(m)));
});

test('rejects risk thresholds out of order', () => {
    assert.match(issuesOf((c) => { c.risk.tense = 80; })[0], /tense < crisis < max/);
});

test('rejects a reversed duration range', () => {
    assert.match(issuesOf((c) => { c.events.wind.durationSec = [20, 10]; })[0], /\$\.events\.wind\.durationSec: min 20 is greater than max 10/);
});

test('rejects an unknown practice demo event', () => {
    assert.match(issuesOf((c) => { c.practice.demoEvents = ['wind', 'snow']; })[0], /\$\.practice\.demoEvents\[1\]/);
});

test('reports every problem at once', () => {
    const issues = issuesOf((c) => {
        c.player.cellSec = 0;
        c.risk.calmGripPerSec = 5;
        delete c.events.eagle.spotSec;
    });
    assert.equal(issues.length, 3);
});
