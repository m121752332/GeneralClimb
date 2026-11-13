import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseLevelConfig } from '../assets/scripts/config/LevelConfig.ts';
import { type BootSnapshot, describeWeather, runStages } from '../assets/scripts/core/BootStages.ts';

const levels = (): any => JSON.parse(readFileSync(new URL('../assets/resources/config/levels.json', import.meta.url), 'utf8'));

test('runs stages in order and ends at 100% with every stage done', async () => {
    const order: string[] = [];
    const snaps: BootSnapshot[] = [];
    const result = await runStages([
        { title: 'a', run: async () => { order.push('a'); return 'A ok'; } },
        { title: 'b', run: async (ctx) => { order.push('b'); ctx.report(0.5); ctx.report(1); } },
    ], (s) => snaps.push(s));

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(order, ['a', 'b']);
    const last = snaps[snaps.length - 1];
    assert.equal(last.progress, 1);
    assert.equal(last.current, 2);
    assert.deepEqual(last.stages.map((s) => s.state), ['done', 'done']);
    assert.equal(last.stages[0].detail, 'A ok');
    // Progress never goes backwards.
    for (let i = 1; i < snaps.length; i++) assert.ok(snaps[i].progress >= snaps[i - 1].progress);
    // Mid-stage progress feeds the bar: half of stage b = 75% overall.
    assert.ok(snaps.some((s) => s.progress === 0.75));
});

test('stops at the first failure and leaves later stages waiting', async () => {
    let ranThird = false;
    let last!: BootSnapshot;
    const result = await runStages([
        { title: 'a', run: async () => {} },
        { title: 'b', run: async () => { throw new Error('boom'); } },
        { title: 'c', run: async () => { ranThird = true; } },
    ], (s) => { last = s; });

    assert.equal(result.ok, false);
    assert.equal(result.failedIndex, 1);
    assert.equal(ranThird, false);
    assert.deepEqual(last.stages.map((s) => s.state), ['done', 'failed', 'waiting']);
    assert.equal(last.stages[1].detail, 'boom');
});

test('waits out the minimum display time per stage', async () => {
    let clock = 0;
    const waits: number[] = [];
    await runStages([
        { title: 'fast', run: async () => { clock += 50; } },
        { title: 'slow', run: async () => { clock += 400; } },
    ], () => {}, {
        minStageMs: 250,
        now: () => clock,
        delay: async (ms) => { waits.push(ms); clock += ms; },
    });
    assert.deepEqual(waits, [200]);
});

test('describeWeather summarizes the shipped levels.json', () => {
    assert.equal(describeWeather(parseLevelConfig(levels())), '風／雨／鷹 OK，強風 0%–70%');
});

test('describeWeather rejects an event longer than its interval', () => {
    const cfg = parseLevelConfig(levels());
    cfg.events.eagle.durationSec = [3, 900];
    assert.throws(() => describeWeather(cfg), /events\.eagle/);
});
