/**
 * Original sound effects and background music, synthesized with the Web Audio API (GDD §9, M4).
 * No audio files: every sound is a short list of oscillator / noise notes, so there is nothing
 * to license (ADR-08) and nothing extra to download.
 *
 * Pure TypeScript with no `cc` and no runtime imports, so the tables and the gain math can be
 * unit-tested with plain Node. In Node (no AudioContext) the engine is a silent no-op.
 */

export type SoundId =
    | 'click' | 'step' | 'grip' | 'warnWind' | 'warnRain' | 'warnEagle' | 'eagleDive'
    | 'fall' | 'land' | 'levelUp' | 'summit';

export type Wave = 'square' | 'triangle' | 'sawtooth' | 'sine' | 'noise';

export interface Tone {
    /** Start, seconds after the sound is triggered. */
    at: number;
    dur: number;
    wave: Wave;
    /** Hz; for noise it is the band-pass centre. */
    freq: number;
    /** Glide target in Hz at the end of the note (optional). */
    toFreq?: number;
    /** Peak gain before the master volume, 0–1. */
    gain: number;
}

export const SOUNDS: Readonly<Record<SoundId, readonly Tone[]>> = {
    click: [{ at: 0, dur: 0.05, wave: 'square', freq: 880, toFreq: 660, gain: 0.18 }],
    // A soft scuff of a hand on glass.
    step: [{ at: 0, dur: 0.06, wave: 'noise', freq: 2400, gain: 0.12 }],
    grip: [{ at: 0, dur: 0.07, wave: 'triangle', freq: 220, toFreq: 160, gain: 0.25 }],
    warnWind: [
        { at: 0, dur: 0.9, wave: 'noise', freq: 500, toFreq: 1400, gain: 0.3 },
        { at: 0, dur: 0.12, wave: 'square', freq: 740, gain: 0.12 },
        { at: 0.18, dur: 0.12, wave: 'square', freq: 740, gain: 0.12 },
    ],
    warnRain: [
        { at: 0, dur: 0.6, wave: 'noise', freq: 5200, gain: 0.18 },
        { at: 0, dur: 0.12, wave: 'square', freq: 620, gain: 0.12 },
        { at: 0.18, dur: 0.12, wave: 'square', freq: 620, gain: 0.12 },
    ],
    // A high falling cry, then two warning beeps.
    warnEagle: [
        { at: 0, dur: 0.35, wave: 'sawtooth', freq: 1900, toFreq: 1300, gain: 0.12 },
        { at: 0.4, dur: 0.12, wave: 'square', freq: 990, gain: 0.12 },
        { at: 0.58, dur: 0.12, wave: 'square', freq: 990, gain: 0.12 },
    ],
    // The stoop: a sharp screech over a rising rush of air.
    eagleDive: [
        { at: 0, dur: 0.28, wave: 'sawtooth', freq: 2300, toFreq: 1500, gain: 0.13 },
        { at: 0.05, dur: 0.75, wave: 'noise', freq: 600, toFreq: 2600, gain: 0.26 },
    ],
    fall: [
        { at: 0, dur: 0.12, wave: 'square', freq: 330, gain: 0.2 },
        { at: 0.3, dur: 1.6, wave: 'triangle', freq: 880, toFreq: 90, gain: 0.3 },
        { at: 0.3, dur: 1.6, wave: 'noise', freq: 900, toFreq: 300, gain: 0.12 },
    ],
    land: [
        { at: 0, dur: 0.25, wave: 'noise', freq: 180, gain: 0.45 },
        { at: 0, dur: 0.2, wave: 'sine', freq: 90, toFreq: 45, gain: 0.5 },
    ],
    levelUp: [
        { at: 0, dur: 0.12, wave: 'square', freq: 523, gain: 0.15 },
        { at: 0.12, dur: 0.12, wave: 'square', freq: 659, gain: 0.15 },
        { at: 0.24, dur: 0.12, wave: 'square', freq: 784, gain: 0.15 },
        { at: 0.36, dur: 0.3, wave: 'square', freq: 1047, gain: 0.15 },
    ],
    summit: [
        { at: 0, dur: 0.18, wave: 'square', freq: 523, gain: 0.15 },
        { at: 0.18, dur: 0.18, wave: 'square', freq: 659, gain: 0.15 },
        { at: 0.36, dur: 0.18, wave: 'square', freq: 784, gain: 0.15 },
        { at: 0.54, dur: 0.6, wave: 'square', freq: 1047, gain: 0.16 },
        { at: 0.54, dur: 0.6, wave: 'triangle', freq: 523, gain: 0.2 },
        { at: 1.2, dur: 0.15, wave: 'square', freq: 880, gain: 0.13 },
        { at: 1.35, dur: 0.9, wave: 'square', freq: 1047, gain: 0.15 },
        { at: 1.35, dur: 0.9, wave: 'triangle', freq: 659, gain: 0.2 },
    ],
};

export type TrackId = 'home' | 'climb';

export interface Track {
    bpm: number;
    /** One entry per eighth note: semitones from `root`, or null for a rest. Loops. */
    melody: readonly (number | null)[];
    /** One entry per bar (8 eighths): semitones from `root` an octave down. */
    bass: readonly number[];
    root: number;
    melodyGain: number;
    bassGain: number;
}

/** Major pentatonic tunes: calm on Home, a steady climbing pulse in the Climb scene. */
export const TRACKS: Readonly<Record<TrackId, Track>> = {
    home: {
        bpm: 92,
        root: 392,
        melody: [
            0, null, 4, 7, 9, null, 7, 4,
            2, null, 4, 2, 0, null, null, null,
            0, null, 4, 7, 12, null, 9, 7,
            9, 7, 4, 2, 4, null, null, null,
        ],
        bass: [0, -5, -3, -5],
        melodyGain: 0.06,
        bassGain: 0.08,
    },
    climb: {
        bpm: 120,
        root: 330,
        melody: [
            0, 4, 7, 4, 9, 7, 4, 2,
            0, 4, 7, 9, 12, 9, 7, null,
            2, 4, 7, 4, 2, 0, 2, 4,
            7, 9, 7, 4, 2, null, 0, null,
        ],
        bass: [0, 0, -3, -5],
        melodyGain: 0.045,
        bassGain: 0.07,
    },
};

/** Music sits under the effects. */
export const MUSIC_MIX = 0.6;

/** Settings volume (0–1) → output gain. Squared so the slider feels even; mute wins. */
export function masterGain(volume: number, muted: boolean): number {
    if (muted || !Number.isFinite(volume)) return 0;
    const v = Math.min(1, Math.max(0, volume));
    return v * v;
}

export function semitone(root: number, steps: number): number {
    return root * Math.pow(2, steps / 12);
}

/** Seconds per eighth note. */
export function eighthSec(bpm: number): number {
    return 30 / bpm;
}

export interface VolumeSource {
    get(): { volume: number; muted: boolean };
}

// ---- Minimal Web Audio typing, so this file needs no DOM lib. ----
interface AudioParamLike {
    value: number;
    setValueAtTime(v: number, t: number): void;
    linearRampToValueAtTime(v: number, t: number): void;
    exponentialRampToValueAtTime(v: number, t: number): void;
}
interface AudioNodeLike { connect(n: AudioNodeLike): void; disconnect(): void }
interface GainLike extends AudioNodeLike { gain: AudioParamLike }
interface OscLike extends AudioNodeLike { type: string; frequency: AudioParamLike; start(t: number): void; stop(t: number): void }
interface FilterLike extends AudioNodeLike { type: string; frequency: AudioParamLike; Q: AudioParamLike }
interface BufferLike { getChannelData(c: number): Float32Array }
interface BufferSourceLike extends AudioNodeLike { buffer: BufferLike | null; start(t: number): void; stop(t: number): void }
interface ContextLike {
    currentTime: number;
    state: string;
    sampleRate: number;
    destination: AudioNodeLike;
    resume(): Promise<void>;
    createGain(): GainLike;
    createOscillator(): OscLike;
    createBiquadFilter(): FilterLike;
    createBuffer(ch: number, len: number, rate: number): BufferLike;
    createBufferSource(): BufferSourceLike;
}

const LOOKAHEAD_SEC = 0.25;
const TICK_MS = 100;

export class AudioEngine {
    private ctx: ContextLike | null = null;
    private sfxBus: GainLike | null = null;
    private musicBus: GainLike | null = null;
    private noise: BufferLike | null = null;
    private track: TrackId | null = null;
    private nextNoteTime = 0;
    private noteIndex = 0;
    private timer: ReturnType<typeof setInterval> | null = null;
    private unlockBound = false;
    private readonly volume: VolumeSource;

    constructor(volume: VolumeSource) {
        this.volume = volume;
    }

    /** Browsers start audio suspended until a user gesture; resume on the first one. */
    private ensure(): ContextLike | null {
        if (this.ctx) return this.ctx;
        const g = globalThis as unknown as { AudioContext?: new () => ContextLike; webkitAudioContext?: new () => ContextLike };
        const Ctor = g.AudioContext ?? g.webkitAudioContext;
        if (!Ctor) return null;
        try {
            this.ctx = new Ctor();
        } catch {
            return null;
        }
        const ctx = this.ctx;
        this.sfxBus = ctx.createGain();
        this.sfxBus.connect(ctx.destination);
        this.musicBus = ctx.createGain();
        this.musicBus.connect(ctx.destination);
        const len = Math.floor(ctx.sampleRate * 0.5);
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        this.applyVolume();
        this.bindUnlock();
        return ctx;
    }

    private bindUnlock(): void {
        if (this.unlockBound) return;
        const w = globalThis as unknown as { addEventListener?: (t: string, f: () => void, o?: unknown) => void };
        if (!w.addEventListener) return;
        this.unlockBound = true;
        const resume = (): void => { void this.ctx?.resume().catch(() => undefined); };
        for (const t of ['pointerdown', 'touchstart', 'keydown', 'mousedown']) w.addEventListener(t, resume, { capture: true, passive: true });
    }

    /** Re-reads the settings volume; called every music tick and before each effect. */
    applyVolume(): void {
        if (!this.ctx || !this.sfxBus || !this.musicBus) return;
        const s = this.volume.get();
        const g = masterGain(s.volume, s.muted);
        this.sfxBus.gain.value = g;
        this.musicBus.gain.value = g * MUSIC_MIX;
    }

    play(id: SoundId): void {
        const ctx = this.ensure();
        if (!ctx || ctx.state !== 'running') return;
        this.applyVolume();
        const s = this.volume.get();
        if (masterGain(s.volume, s.muted) === 0) return;
        const t0 = ctx.currentTime + 0.01;
        for (const tone of SOUNDS[id]) this.tone(tone, t0, this.sfxBus!);
    }

    private tone(t: Tone, t0: number, bus: GainLike): void {
        const ctx = this.ctx!;
        const start = t0 + t.at;
        const end = start + t.dur;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, start);
        env.gain.linearRampToValueAtTime(t.gain, start + Math.min(0.01, t.dur / 4));
        env.gain.exponentialRampToValueAtTime(0.0001, end);
        env.connect(bus);
        let src: OscLike | BufferSourceLike;
        if (t.wave === 'noise') {
            const b = ctx.createBufferSource();
            b.buffer = this.noise;
            const f = ctx.createBiquadFilter();
            f.type = 'bandpass';
            f.Q.value = 1.2;
            f.frequency.setValueAtTime(t.freq, start);
            if (t.toFreq) f.frequency.exponentialRampToValueAtTime(t.toFreq, end);
            b.connect(f);
            f.connect(env);
            src = b;
        } else {
            const o = ctx.createOscillator();
            o.type = t.wave;
            o.frequency.setValueAtTime(t.freq, start);
            if (t.toFreq) o.frequency.exponentialRampToValueAtTime(t.toFreq, end);
            o.connect(env);
            src = o;
        }
        src.start(start);
        src.stop(end + 0.02);
    }

    /** Starts (or keeps) a looping track; the same track again is a no-op. */
    music(id: TrackId | null): void {
        if (id === this.track) return;
        this.track = id;
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
        this.cutMusic();
        if (!id) return;
        const ctx = this.ensure();
        if (!ctx) return;
        this.noteIndex = 0;
        this.nextNoteTime = ctx.currentTime + 0.1;
        this.timer = setInterval(() => this.tick(), TICK_MS);
    }

    /**
     * Notes already handed to Web Audio keep playing after the scheduler stops (a bass note
     * lasts most of a bar), so fade the old music bus out and start a fresh one.
     */
    private cutMusic(): void {
        const ctx = this.ctx;
        const old = this.musicBus;
        if (!ctx || !old) return;
        const t = ctx.currentTime;
        old.gain.setValueAtTime(old.gain.value, t);
        old.gain.linearRampToValueAtTime(0, t + 0.05);
        setTimeout(() => old.disconnect(), 200);
        this.musicBus = ctx.createGain();
        this.musicBus.connect(ctx.destination);
        this.applyVolume();
    }

    private tick(): void {
        const ctx = this.ctx;
        if (!ctx || !this.track) return;
        this.applyVolume();
        if (ctx.state !== 'running') {
            // Not unlocked yet: keep the clock from falling behind, so the music starts cleanly.
            this.nextNoteTime = ctx.currentTime + 0.1;
            return;
        }
        const tr = TRACKS[this.track];
        const step = eighthSec(tr.bpm);
        if (this.nextNoteTime < ctx.currentTime) this.nextNoteTime = ctx.currentTime + 0.05;
        const s = this.volume.get();
        const silent = masterGain(s.volume, s.muted) === 0;
        while (this.nextNoteTime < ctx.currentTime + LOOKAHEAD_SEC) {
            const i = this.noteIndex % tr.melody.length;
            // Muted: keep the clock moving but build no nodes.
            if (silent) {
                this.nextNoteTime += step;
                this.noteIndex++;
                continue;
            }
            const n = tr.melody[i];
            if (n !== null) {
                this.tone({ at: 0, dur: step * 0.9, wave: 'square', freq: semitone(tr.root, n), gain: tr.melodyGain }, this.nextNoteTime, this.musicBus!);
            }
            if (i % 8 === 0) {
                const b = tr.bass[(i / 8) % tr.bass.length];
                this.tone({ at: 0, dur: step * 7.5, wave: 'triangle', freq: semitone(tr.root / 2, b), gain: tr.bassGain }, this.nextNoteTime, this.musicBus!);
            }
            this.nextNoteTime += step;
            this.noteIndex++;
        }
    }

    /** False where the browser has no Web Audio at all. */
    static get supported(): boolean {
        const g = globalThis as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
        return Boolean(g.AudioContext ?? g.webkitAudioContext);
    }

    /** True once the browser lets sound play (after the first tap / key). */
    get ready(): boolean {
        return this.ctx?.state === 'running';
    }
}
