import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashRng, npcMood, planCrowd, ringDistance, type NpcSpot } from '../assets/scripts/climb/CrowdPlan.ts';

const T = { secondChance: 0.5, minGap: 2, reactFloors: 2, waveCols: 3 };
const wide = { cols: 11, faces: 4, ring: 44, rows: 8 * 12 };
const localCol = (c: number): number => c % 11;
const safeOnly = (c: number): boolean => localCol(c) >= 1 && localCol(c) <= 9;

test('same level always gets the same crowd', () => {
    assert.deepEqual(planCrowd(wide, 12, 1, T, safeOnly), planCrowd(wide, 12, 1, T, safeOnly));
    assert.notDeepEqual(planCrowd(wide, 12, 1, T, safeOnly), planCrowd(wide, 12, 2, T, safeOnly));
});

test('one or two NPCs on every floor, only in clear columns, spaced apart', () => {
    const spots = planCrowd(wide, 12, 3, T, safeOnly);
    for (let f = 0; f < 8; f++) {
        const on = spots.filter((s) => s.floor === f);
        assert.ok(on.length >= 1 && on.length <= 2, `floor ${f}`);
        if (on.length === 2) assert.ok(ringDistance(on[0].col, on[1].col, 44, 4) >= T.minGap);
    }
    for (const s of spots) assert.ok(safeOnly(s.col), `col ${s.col}`);
});

test('a column blocked anywhere on a floor is never used on that floor', () => {
    const blocked = (c: number, r: number): boolean => safeOnly(c) && !(c === 5 && r === 13);
    const spots = planCrowd(wide, 12, 4, T, blocked);
    assert.ok(!spots.some((s) => s.col === 5 && s.floor === 1));
});

test('no crowd on the ladder', () => {
    assert.deepEqual(planCrowd({ cols: 1, faces: 1, ring: 1, rows: 48 }, 12, 13, T, () => true), []);
});

test('ring distance wraps round four faces', () => {
    assert.equal(ringDistance(0, 43, 44, 4), 1);
    assert.equal(ringDistance(0, 43, 44, 1), 43);
});

test('hash rng is in [0, 1)', () => {
    const r = hashRng(7);
    for (let i = 0; i < 1000; i++) {
        const v = r();
        assert.ok(v >= 0 && v < 1);
    }
});

test('second NPC chance 0 gives exactly one per floor', () => {
    const spots = planCrowd(wide, 12, 5, { ...T, secondChance: 0 }, safeOnly);
    assert.equal(spots.length, 8);
});

test('moods follow the climber', () => {
    const tourist: NpcSpot = { col: 10, floor: 2, kind: 'tourist', palette: 0, phase: 0 };
    const staff: NpcSpot = { ...tourist, kind: 'staff' };
    const near = { col: 11, floor: 2.5, alarmed: false };
    assert.equal(npcMood(staff, near, 44, 4, T), 'wave');
    assert.equal(npcMood(tourist, near, 44, 4, T), 'photo');
    assert.equal(npcMood(staff, { ...near, alarmed: true }, 44, 4, T), 'worried');
    assert.equal(npcMood(staff, { ...near, floor: 7 }, 44, 4, T), 'idle');
    assert.equal(npcMood(staff, { ...near, col: 30 }, 44, 4, T), 'idle');
});
