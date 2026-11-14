import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    EMPTY_PROGRESS, PROGRESS_KEY, afterFall, afterLevelCleared, afterSummit, formatRound, parseProgress,
    readProgress, unlockedIndex, unsyncedSummits, updateProgress,
} from '../assets/scripts/core/Progress.ts';

function memory(): { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

test('missing or broken data starts fresh', () => {
    for (const text of [null, '', '{bad', 'null', '[]', '{"unlocked":-1,"rounds":1.5}']) {
        const p = parseProgress(text);
        assert.equal(p.unlocked, 0, String(text));
        assert.equal(p.rounds, 0, String(text));
    }
    assert.deepEqual(readProgress({ getItem() { throw new Error('blocked'); }, setItem() {} }), { ...EMPTY_PROGRESS });
});

test('clearing a level opens the next one and never closes anything', () => {
    let p = { ...EMPTY_PROGRESS };
    p = afterLevelCleared(p, 0, 14);
    p = afterLevelCleared(p, 1, 14);
    p = afterLevelCleared(p, 2, 14);
    assert.equal(p.unlocked, 3);
    assert.equal(afterLevelCleared(p, 0, 14).unlocked, 3);
    assert.equal(afterLevelCleared(p, 13, 14).unlocked, 13);
    assert.equal(unlockedIndex({ ...p, unlocked: 99 }, 14), 13);
});

test('progress survives a reload (same storage)', () => {
    const s = memory();
    updateProgress(s, (p) => afterLevelCleared(p, 2, 14));
    assert.equal(readProgress(s).unlocked, 3);
    assert.ok(s.data.has(PROGRESS_KEY));
});

test('summit resets the unlocks and counts the round', () => {
    const s = memory();
    updateProgress(s, (p) => ({ ...p, unlocked: 13 }));
    const now = new Date('2026-11-14T04:00:00Z');
    const p = updateProgress(s, (q) => afterSummit(q, now));
    assert.equal(p.unlocked, 0);
    assert.equal(p.rounds, 1);
    assert.equal(p.summits, 1);
    assert.equal(p.lastSummitAt, now.toISOString());
    assert.equal(formatRound(p), '第 2 周目 · 已登頂 1 次');
    assert.equal(formatRound(EMPTY_PROGRESS), '第 1 周目');
});

test('unsynced summits for the later cloud total', () => {
    const p = parseProgress('{"summits":3,"syncedSummits":1}');
    assert.equal(unsyncedSummits(p), 2);
    assert.equal(parseProgress('{"summits":1,"syncedSummits":5}').syncedSummits, 1);
});

test('a fall locks everything again but keeps rounds and summits', () => {
    const p = afterFall({ ...EMPTY_PROGRESS, unlocked: 5, rounds: 2, summits: 2 });
    assert.equal(p.unlocked, 0);
    assert.equal(p.rounds, 2);
    assert.equal(p.summits, 2);
});
