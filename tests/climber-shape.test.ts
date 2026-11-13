import assert from 'node:assert/strict';
import { test } from 'node:test';
import { climberParts } from '../assets/scripts/climb/ClimberShape.ts';

test('climber: six parts, well-formed buffers', () => {
    const parts = climberParts();
    assert.deepEqual(parts.map((p) => p.name), ['Torso', 'Cape', 'ArmL', 'ArmR', 'LegL', 'LegR']);
    for (const p of parts) {
        const verts = p.positions.length / 3;
        assert.equal(p.positions.length % 3, 0);
        assert.equal(p.colors.length, verts * 4, p.name);
        assert.equal(p.indices.length % 3, 0);
        assert.ok(p.indices.every((i) => i >= 0 && i < verts), p.name);
        assert.ok(p.positions.every(Number.isFinite), p.name);
        assert.ok(p.colors.every((c) => c >= 0 && c <= 1), p.name);
    }
});

test('climber: cheap enough for phones (< 3000 triangles, each part < 65536 vertices)', () => {
    const parts = climberParts();
    const tris = parts.reduce((n, p) => n + p.indices.length / 3, 0);
    assert.ok(tris < 3000, `${tris} triangles`);
    for (const p of parts) assert.ok(p.positions.length / 3 < 65536);
});

test('climber: same pivots as the old block figure, so poses and the ending still fit', () => {
    const byName = Object.fromEntries(climberParts().map((p) => [p.name, p.pivot]));
    assert.deepEqual(byName.ArmL, [-0.36, 1.2, 0]);
    assert.deepEqual(byName.ArmR, [0.36, 1.2, 0]);
    assert.deepEqual(byName.LegL, [-0.15, 0.55, 0]);
    assert.deepEqual(byName.LegR, [0.15, 0.55, 0]);
});

test('climber: head top under 2.0 units (name tag height) and the face is on -Z', () => {
    const torso = climberParts()[0];
    let top = -Infinity;
    let minZ = Infinity;
    for (let i = 0; i < torso.positions.length; i += 3) {
        top = Math.max(top, torso.positions[i + 1]);
        if (torso.positions[i + 1] > 1.35) minZ = Math.min(minZ, torso.positions[i + 2]);
    }
    assert.ok(top > 1.8 && top <= 2.0, `top ${top}`);
    assert.ok(minZ < -0.24, `face front ${minZ}`);
});
