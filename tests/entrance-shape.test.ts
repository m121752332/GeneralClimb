import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    CANOPY_HALF, CANOPY_LOW, CANOPY_OUT, CANOPY_TOP, DOOR_HALF, PORTAL_HALF, PORTAL_TOP,
    canopyClearance, canopyFront, canopyLow, entranceCovers, faceU,
} from '../assets/scripts/climb/EntranceShape.ts';

test('canopy outline: full depth in the middle, curving back to the wall at the ends', () => {
    assert.equal(canopyFront(0), CANOPY_OUT);
    assert.ok(canopyFront(CANOPY_HALF * 0.5) > CANOPY_OUT * 0.95);
    assert.ok(canopyFront(CANOPY_HALF * 0.97) < canopyFront(CANOPY_HALF * 0.8));
    assert.equal(canopyFront(CANOPY_HALF), 0);
    assert.equal(canopyFront(-CANOPY_HALF - 1), 0);
    assert.equal(canopyLow(0), CANOPY_LOW);
    assert.ok(canopyLow(CANOPY_HALF) < CANOPY_LOW);
    assert.ok(CANOPY_HALF > PORTAL_HALF && PORTAL_HALF > DOOR_HALF);
});

test('canopy clearance: climber hangs in front of the canopy only while passing it', () => {
    const base = 0.55, head = 3;
    // Standing on the plaza under the canopy: head clears the soffit, so no push.
    assert.ok(CANOPY_LOW - head >= 0.4);
    // Climbing through its height in the middle: in front of the fascia.
    assert.ok(canopyClearance(0, 1.5, head, base) > CANOPY_OUT);
    assert.ok(canopyClearance(0, CANOPY_TOP - 0.1, head, base) > CANOPY_OUT);
    // Well above it, or beside it: back on the glass.
    assert.equal(canopyClearance(0, CANOPY_TOP + 1, head, base), base);
    assert.equal(canopyClearance(CANOPY_HALF + 0.5, 2, head, base), base);
    // Eases in: a little above the top it is between the two.
    const mid = canopyClearance(0, CANOPY_TOP + 0.25, head, base);
    assert.ok(mid > base && mid < CANOPY_OUT);
    // Never pulls the climber in.
    assert.equal(canopyClearance(0, 2, head, 5), 5);
});

test('face position: middle of the face is 0, edges are ±half', () => {
    assert.equal(faceU(5.5, 11, 9), 0);
    assert.equal(faceU(11 + 5.5, 11, 9), 0);
    assert.equal(faceU(0, 11, 9), -9);
    assert.ok(faceU(10.99, 11, 9) > 8.9);
});

test('crowd: windows behind the doors, canopy and piers stay empty; the bay above does not', () => {
    const colHalf = 9 / 11;
    assert.ok(entranceCovers(0, colHalf, 1.3, 1.5));
    assert.ok(entranceCovers((DOOR_HALF + PORTAL_HALF) / 2, colHalf, 6, 6.2));
    assert.ok(entranceCovers(0, colHalf, PORTAL_TOP - 0.3, PORTAL_TOP - 0.1));
    assert.ok(!entranceCovers(0, colHalf, 6, 6.2));
    assert.ok(!entranceCovers(7, colHalf, 1.3, 1.5));
    assert.ok(!entranceCovers(0, colHalf, PORTAL_TOP + 1, PORTAL_TOP + 1.2));
});
