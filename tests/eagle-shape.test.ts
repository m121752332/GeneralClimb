import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EAGLE_SPAN, eagleParts } from '../assets/scripts/climb/EagleShape.ts';

test('eagle: body, two spread wings and talons, well-formed buffers', () => {
    const parts = eagleParts();
    assert.deepEqual(parts.map((p) => p.name), ['Body', 'WingL', 'WingR', 'Legs', 'Glow']);
    let tris = 0;
    for (const p of parts) {
        const verts = p.positions.length / 3;
        assert.equal(p.colors.length, verts * 4, p.name);
        assert.equal(p.indices.length % 3, 0);
        assert.ok(p.indices.every((i) => i >= 0 && i < verts), p.name);
        assert.ok(p.positions.every(Number.isFinite), p.name);
        assert.ok(p.colors.every((c) => c >= 0 && c <= 1), p.name);
        tris += p.indices.length / 3;
    }
    assert.ok(tris < 2000, `low poly (${tris} triangles)`);
});

test('eagle: wings are spread wide and mirror each other; beak points forward (-Z)', () => {
    const [body, wingL, wingR] = eagleParts();
    const xs = (p: { positions: number[]; pivot: number[] }) =>
        p.positions.filter((_, i) => i % 3 === 0).map((x) => x + p.pivot[0]);
    const span = Math.max(...xs(wingR)) - Math.min(...xs(wingL));
    assert.ok(Math.abs(span - EAGLE_SPAN) < 0.6, `span ${span.toFixed(2)}`);
    assert.ok(Math.abs(Math.max(...xs(wingR)) + Math.min(...xs(wingL))) < 1e-6, 'symmetric');
    const zs = body.positions.filter((_, i) => i % 3 === 2);
    assert.ok(Math.min(...zs) < -1.2, 'beak ahead of the head');
});
