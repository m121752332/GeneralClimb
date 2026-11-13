import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AudioEngine, SOUNDS, TRACKS, eighthSec, masterGain, semitone } from '../assets/scripts/core/Audio.ts';

test('mute or zero volume silences everything', () => {
    assert.equal(masterGain(0.8, true), 0);
    assert.equal(masterGain(0, false), 0);
    assert.equal(masterGain(Number.NaN, false), 0);
});

test('volume is squared and clamped', () => {
    assert.equal(masterGain(1, false), 1);
    assert.equal(masterGain(0.5, false), 0.25);
    assert.equal(masterGain(3, false), 1);
});

test('every sound has playable tones', () => {
    for (const [id, tones] of Object.entries(SOUNDS)) {
        assert.ok(tones.length > 0, id);
        for (const t of tones) {
            assert.ok(t.dur > 0 && t.at >= 0, id);
            assert.ok(t.freq > 20 && t.freq < 20000, id);
            assert.ok(t.gain > 0 && t.gain <= 1, id);
            if (t.toFreq !== undefined) assert.ok(t.toFreq > 0, id);
        }
    }
});

test('tracks loop in whole bars', () => {
    for (const [id, tr] of Object.entries(TRACKS)) {
        assert.equal(tr.melody.length % 8, 0, id);
        assert.ok(tr.bass.length > 0, id);
        assert.ok(tr.bpm > 40 && tr.bpm < 240, id);
    }
});

test('pitch and tempo helpers', () => {
    assert.ok(Math.abs(semitone(440, 12) - 880) < 1e-9);
    assert.equal(eighthSec(120), 0.25);
});

test('engine is a silent no-op without Web Audio (Node)', () => {
    const engine = new AudioEngine({ get: () => ({ volume: 1, muted: false }) });
    engine.play('fall');
    engine.music('climb');
    engine.music(null);
    assert.equal(engine.ready, false);
});
