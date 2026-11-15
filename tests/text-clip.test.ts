import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipText } from '../assets/scripts/core/TextClip.ts';

test('clipText keeps short text', () => {
    assert.equal(clipText('a@b.co', 26), 'a@b.co');
    assert.equal(clipText('x'.repeat(26), 26), 'x'.repeat(26));
});

test('clipText cuts long text with an ellipsis within the limit', () => {
    const out = clipText('very.long.address.for.testing@example.com', 26);
    assert.equal(Array.from(out).length, 26);
    assert.ok(out.endsWith('…'));
    assert.ok(out.startsWith('very.long.address'));
});

test('clipText counts code points, not UTF-16 units', () => {
    assert.equal(clipText('霍將軍爬101大樓', 4), '霍將軍…');
    assert.equal(clipText('😀😀😀', 2), '😀…');
    assert.equal(clipText('abc', 0), '');
});
