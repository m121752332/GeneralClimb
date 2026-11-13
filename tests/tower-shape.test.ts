import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    LIFT, ROW_H, angleDelta, halfAt, ringDelta, roofY, rowY, surfacePoint, towerSections,
} from '../assets/scripts/climb/TowerShape.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('sections: base 1-26F, eight 8-floor segments, top 91-101F, stacked without gaps', () => {
    const s = towerSections(12);
    assert.equal(s.length, 10);
    assert.deepEqual([s[0].floorFrom, s[0].floorTo, s[0].kind], [1, 26, 'base']);
    assert.deepEqual([s[1].floorFrom, s[1].floorTo], [27, 34]);
    assert.deepEqual([s[8].floorFrom, s[8].floorTo], [83, 90]);
    assert.deepEqual([s[9].floorFrom, s[9].floorTo, s[9].kind], [91, 101, 'top']);
    assert.equal(s[0].y0, 0);
    for (let i = 1; i < s.length; i++) close(s[i].y0, s[i - 1].y1);
    close(roofY(12), s[9].y1);
    close(rowY(12), LIFT + 12 * ROW_H);
});

test('silhouette: base narrows upward, every segment flares outward', () => {
    const s = towerSections(12);
    assert.ok(s[0].half1 < s[0].half0);
    for (const seg of s.filter((x) => x.kind === 'segment')) {
        assert.ok(seg.half1 > seg.half0);
        assert.ok(halfAt(s, seg.y1 - 0.01) > halfAt(s, seg.y0 + 0.01));
        // The next section starts narrower again: a ledge.
        assert.ok(halfAt(s, seg.y1 + 0.01) < halfAt(s, seg.y1 - 0.01));
    }
});

test('surface: face 0 faces +Z, moving right goes to +X, corners are continuous', () => {
    const cols = 11;
    const mid = surfacePoint(5.5, 6, cols, 4);
    close(mid.x, 0);
    close(mid.z, 6);
    close(mid.yaw, 0);
    const right = surfacePoint(10, 6, cols, 4);
    assert.ok(right.x > 0);
    // Corner between face 0 and face 1: same point and halfway yaw either way.
    const a = surfacePoint(cols - 1e-9, 6, cols, 4);
    const b = surfacePoint(cols, 6, cols, 4);
    close(a.x, b.x, 1e-6);
    close(a.z, b.z, 1e-6);
    close(a.yaw, Math.PI / 4, 1e-6);
    close(b.yaw, Math.PI / 4, 1e-6);
    // Face 1 middle looks along +X; wraps after the last face.
    const f1 = surfacePoint(cols * 1.5, 6, cols, 4);
    close(f1.x, 6);
    close(f1.z, 0, 1e-9);
    const wrapped = surfacePoint(4 * cols + 5.5, 6, cols, 4);
    close(wrapped.z, 6);
});

test('ring and angle deltas take the short way round', () => {
    assert.equal(ringDelta(0, 43, 44, 4), -1);
    assert.equal(ringDelta(43, 0, 44, 4), 1);
    assert.equal(ringDelta(0, 10, 11, 1), 10);
    close(angleDelta(0.1, 2 * Math.PI - 0.1), -0.2, 1e-9);
    close(angleDelta(3, -3), 2 * Math.PI - 6, 1e-9);
});

test('crown and spire: stepped crown on the roof, ladder levels stacked to the summit', async () => {
    const m = await import('../assets/scripts/climb/TowerShape.ts');
    const roof = m.roofY(12);
    close(m.crownTopY(12), roof + 6);
    close(m.summitY(12, 48), roof + 6 + 2 * 48 * m.ROW_H);
    assert.equal(m.spireHalfAt(12, 48, roof - 0.1), null);
    assert.equal(m.spireHalfAt(12, 48, roof + 0.1), 3.7);
    close(m.spireHalfAt(12, 48, m.crownTopY(12)) as number, 1.0);
    assert.ok((m.spireHalfAt(12, 48, m.summitY(12, 48) + 3) as number) < 0.45);
    const lower = { floorFrom: null, floors: 'spire-lower' };
    const upper = { floorFrom: null, floors: 'spire-upper' };
    close(m.levelBaseY(lower, 12, 48), m.crownTopY(12));
    close(m.levelBaseY(upper, 12, 48), m.crownTopY(12) + 48 * m.ROW_H);
    close(m.levelBaseY({ floorFrom: 27, floors: '27-34F' }, 12, 48), m.rowY(26 * 12));
});
