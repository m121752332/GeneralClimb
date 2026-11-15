import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REAL_TIME_FACTOR, formatRealDuration, toRealMs } from '../assets/scripts/core/RealTime.ts';

test('1 game minute is 9 real minutes', () => {
    assert.equal(REAL_TIME_FACTOR, 9);
    assert.equal(toRealMs(60_000), 540_000);
    assert.equal(toRealMs(630_000), 5_670_000);
});

test('hours and minutes, minutes truncated', () => {
    // game 10m30s → 94.5 real minutes
    assert.equal(formatRealDuration(630_000, 'zh-TW'), '1小時34分');
    assert.equal(formatRealDuration(630_000, 'en'), '1h 34m');
    // game 7m → 63 real minutes
    assert.equal(formatRealDuration(420_000, 'zh-TW'), '1小時3分');
    assert.equal(formatRealDuration(420_000, 'en'), '1h 3m');
    // game 5m → 45 real minutes: no hours
    assert.equal(formatRealDuration(300_000, 'zh-TW'), '45分');
    assert.equal(formatRealDuration(300_000, 'en'), '45m');
    assert.equal(formatRealDuration(800_000, 'zh-TW'), '2小時0分', 'whole hours keep the minutes');
    assert.equal(formatRealDuration(6_666, 'zh-TW'), '0分', 'just under a real minute');
    assert.equal(formatRealDuration(6_667, 'zh-TW'), '1分');
});

test('with seconds', () => {
    assert.equal(formatRealDuration(630_000, 'zh-TW', { withSeconds: true }), '1小時34分30秒');
    assert.equal(formatRealDuration(630_000, 'en', { withSeconds: true }), '1h 34m 30s');
    assert.equal(formatRealDuration(300_000, 'zh-TW', { withSeconds: true }), '45分0秒');
    assert.equal(formatRealDuration(5_000, 'en', { withSeconds: true }), '0m 45s');
});

test('zero, negative and non-numbers show zero', () => {
    for (const ms of [0, -1, -630_000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        assert.equal(toRealMs(ms), 0, String(ms));
        assert.equal(formatRealDuration(ms, 'zh-TW'), '0分', String(ms));
        assert.equal(formatRealDuration(ms, 'en', { withSeconds: true }), '0m 0s', String(ms));
    }
});
