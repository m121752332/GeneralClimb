import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEST_KEY, formatBest, parseLocalBest, readLocalBest } from '../assets/scripts/core/LocalBest.ts';

test('no record or invalid record', () => {
    for (const text of [null, '', '{bad', 'null', '{"maxFloor":0}', '{"maxFloor":103}', '{"maxFloor":4.5}']) {
        assert.equal(formatBest(parseLocalBest(text)), '最佳紀錄：尚無紀錄', String(text));
    }
});

test('highest floor', () => {
    assert.equal(formatBest(parseLocalBest('{"maxFloor":47}')), '最佳紀錄：47F');
});

test('cleared run shows clear time', () => {
    assert.equal(formatBest(parseLocalBest('{"maxFloor":102,"bestClearMs":754000}')), '最佳紀錄：登頂 12:34');
    assert.equal(formatBest(parseLocalBest('{"maxFloor":102}')), '最佳紀錄：登頂');
});

test('readLocalBest tolerates throwing or missing storage', () => {
    assert.equal(readLocalBest({ getItem() { throw new Error('blocked'); }, setItem() {} }), null);
    assert.equal(readLocalBest(null), null);
    assert.deepEqual(
        readLocalBest({ getItem: (k) => (k === BEST_KEY ? '{"maxFloor":8}' : null), setItem() {} }),
        { maxFloor: 8, bestClearMs: null },
    );
});
