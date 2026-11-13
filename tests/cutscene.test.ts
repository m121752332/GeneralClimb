import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    INTRO_SEC, INTRO_ZOOM, PUSH_FAR_K, PUSH_IN_SEC, PUSH_LOOK_UP, PUSH_RISE, ease, introFrame, pushInPose,
} from '../assets/scripts/core/Cutscene.ts';

test('GDD §7 durations: opening 3 s, start-game push-in 2 s', () => {
    assert.equal(INTRO_SEC, 3);
    assert.equal(PUSH_IN_SEC, 2);
});

test('ease is clamped smoothstep', () => {
    assert.equal(ease(-1), 0);
    assert.equal(ease(0), 0);
    assert.equal(ease(0.5), 0.5);
    assert.equal(ease(1), 1);
    assert.equal(ease(2), 1);
});

test('opening zooms in, stays opaque, then fades out and ends at INTRO_SEC', () => {
    const a = introFrame(0);
    assert.equal(a.scale, 1);
    assert.equal(a.opacity, 1);
    assert.equal(a.done, false);
    assert.equal(introFrame(1.5).opacity, 1);
    assert.ok(introFrame(1.5).scale > 1 && introFrame(1.5).scale < 1 + INTRO_ZOOM);
    assert.ok(introFrame(2.9).opacity < 1);
    const end = introFrame(INTRO_SEC);
    assert.equal(end.done, true);
    assert.equal(end.opacity, 0);
    assert.ok(Math.abs(end.scale - (1 + INTRO_ZOOM)) < 1e-9);
});

test('push-in starts wide and high, and lands exactly on the climb view', () => {
    const end = { x: 0, y: 5, z: 30, lookY: 4 };
    const start = pushInPose(end, 0);
    assert.ok(Math.abs(start.z - 30 * PUSH_FAR_K) < 1e-9);
    assert.equal(start.y, 5 + PUSH_RISE);
    assert.equal(start.lookY, 4 + PUSH_LOOK_UP);
    assert.deepEqual(pushInPose(end, PUSH_IN_SEC), end);
    assert.deepEqual(pushInPose(end, PUSH_IN_SEC + 1), end);
    // Distance from the tower axis never grows while pushing in.
    let prev = Infinity;
    for (let t = 0; t <= PUSH_IN_SEC; t += 0.1) {
        const p = pushInPose(end, t);
        const r = Math.hypot(p.x, p.z);
        assert.ok(r <= prev + 1e-9);
        prev = r;
    }
});

test('push-in stays clear of the city blocks (from 60 out, up to 20 wide; within 100 at most 22 tall)', () => {
    // Widest climb view at the base: about 38 from the axis (half 9.6 × 2.6 + 13), camera about 6 up.
    const end = { x: 0, y: 6, z: 38, lookY: 5 };
    for (let t = 0; t <= PUSH_IN_SEC; t += 0.02) {
        const p = pushInPose(end, t);
        const r = Math.hypot(p.x, p.z);
        // Anywhere a near block could be (its nearest face is 50 out), stay above its roof.
        if (r > 50) assert.ok(p.y > 22 + 2, `t=${t.toFixed(2)} r=${r.toFixed(1)} y=${p.y.toFixed(1)}`);
        // Never reach the taller blocks further out.
        assert.ok(r < 90);
    }
});
