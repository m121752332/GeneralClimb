import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
    CLOCK_MARGIN_MS, DEFAULT_NAME, cloudName, formatSyncAgo, parseSummitDoc, planSummitSync, playerTag, rankRows,
    summitsAllowed,
} from '../assets/scripts/core/CloudSummit.ts';
import { EMPTY_PROGRESS, markSynced } from '../assets/scripts/core/Progress.ts';

const MIN = 300;
const local = (summits: number, syncedSummits = 0) => ({ ...EMPTY_PROGRESS, summits, syncedSummits });

test('names are trimmed to 12 characters and never empty', () => {
    assert.equal(cloudName('  Tiger   Lee '), 'Tiger Lee');
    assert.equal(cloudName('一二三四五六七八九十甲乙丙丁'), '一二三四五六七八九十甲乙');
    assert.equal(Array.from(cloudName('😀'.repeat(20))).length, 12);
    assert.equal(cloudName(''), DEFAULT_NAME);
    assert.equal(cloudName(null), DEFAULT_NAME);
    assert.equal(cloudName('\u0000\t '), DEFAULT_NAME);
});

test('the first upload is one summit, later ones wait minSummitSec each', () => {
    assert.equal(summitsAllowed(null, 0, MIN), 1);
    const cloud = { name: 'A', count: 3, updatedAtMs: 1_000_000 };
    assert.equal(summitsAllowed(cloud, 1_000_000 + MIN * 1000, MIN), 0, 'clock margin');
    assert.equal(summitsAllowed(cloud, 1_000_000 + MIN * 1000 + CLOCK_MARGIN_MS, MIN), 1);
    assert.equal(summitsAllowed(cloud, 1_000_000 + 3 * MIN * 1000 + CLOCK_MARGIN_MS, MIN), 3);
    assert.equal(summitsAllowed(cloud, 0, MIN), 0, 'clock behind the server');
});

test('sync adds only unsynced summits, as many as the rules allow', () => {
    assert.deepEqual(planSummitSync(local(0), null, 'A', 0, MIN), { add: 0, write: null });
    assert.deepEqual(planSummitSync(local(5), null, 'A', 0, MIN), { add: 1, write: { count: 1, name: 'A', rename: false } });
    const cloud = { name: 'A', count: 1, updatedAtMs: 0 };
    const later = 10 * MIN * 1000 + CLOCK_MARGIN_MS;
    assert.deepEqual(planSummitSync(local(5, 1), cloud, 'A', later, MIN), { add: 4, write: { count: 5, name: 'A', rename: false } });
    assert.deepEqual(planSummitSync(local(5, 5), cloud, 'A', later, MIN), { add: 0, write: null });
    assert.deepEqual(planSummitSync(local(5, 5), cloud, 'B', later, MIN), { add: 0, write: { count: 1, name: 'B', rename: true } });
});

test('markSynced never passes the local total', () => {
    assert.equal(markSynced(local(3, 1), 1).syncedSummits, 2);
    assert.equal(markSynced(local(3, 1), 9).syncedSummits, 3);
    const p = local(3, 1);
    assert.equal(markSynced(p, 0), p);
});

test('Firestore data is parsed defensively', () => {
    assert.equal(parseSummitDoc(null, 1), null);
    assert.equal(parseSummitDoc({ count: 1.5 }, 1), null);
    assert.equal(parseSummitDoc({ count: -1 }, 1), null);
    assert.deepEqual(parseSummitDoc({ count: 2 }, null), { name: DEFAULT_NAME, count: 2, updatedAtMs: 0 });
});

test('leaderboard: most summits first, ties share a rank, earlier wins the tie', () => {
    const rows = rankRows([
        { uid: 'a', name: 'A', count: 2, updatedAtMs: 50 },
        { uid: 'b', name: 'B', count: 5, updatedAtMs: 10 },
        { uid: 'c', name: 'C', count: 2, updatedAtMs: 20 },
        { uid: 'd', name: 'D', count: 0, updatedAtMs: 0 },
        { uid: 'e', name: 'E', count: 1, updatedAtMs: 0 },
    ]);
    assert.deepEqual(rows.map((r) => [r.uid, r.rank]), [['b', 1], ['c', 2], ['a', 2], ['e', 4]]);
});

test('player tag is six stable digits', () => {
    assert.match(playerTag('abc'), /^\d{6}$/);
    assert.equal(playerTag('abc'), playerTag('abc'));
    assert.notEqual(playerTag('abc'), playerTag('abd'));
});

test('sync age text', () => {
    assert.equal(formatSyncAgo(null, 0), '尚未同步');
    assert.equal(formatSyncAgo(0, 59_000), '已同步・剛剛');
    assert.equal(formatSyncAgo(0, 60_000), '已同步・1 分鐘前');
    assert.equal(formatSyncAgo(0, 2 * 3_600_000), '已同步・2 小時前');
    assert.equal(formatSyncAgo(0, 3 * 86_400_000), '已同步・3 天前');
});

test('firestore.rules uses levels.json cloud.minSummitSec', () => {
    const cfg = JSON.parse(readFileSync(new URL('../assets/resources/config/levels.json', import.meta.url), 'utf8'));
    const rules = readFileSync(new URL('../config/firestore.rules', import.meta.url), 'utf8');
    const m = rules.match(/resource\.data\.count\) \* (\d+), 's'\)/);
    assert.ok(m, 'summit rate limit not found in firestore.rules');
    assert.equal(Number(m[1]), cfg.cloud.minSummitSec);
});
