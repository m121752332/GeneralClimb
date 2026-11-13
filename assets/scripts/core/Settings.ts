/**
 * Player settings (GDD §6), persisted to localStorage.
 * Pure TypeScript (no `cc`) so it can be unit-tested with plain Node.
 * Storage failures (private mode, blocked storage, corrupt JSON) fall back to defaults.
 */

export interface SettingsData {
    /** Master volume, 0-1. */
    volume: number;
    vibration: boolean;
    /** Lightning / crisis flashes. */
    flashEffects: boolean;
    muted: boolean;
}

/** The subset of the Web Storage API this module uses. */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export const SETTINGS_KEY = 'gcr.settings.v1';

export const DEFAULT_SETTINGS: Readonly<SettingsData> = Object.freeze({
    volume: 0.8,
    vibration: true,
    flashEffects: true,
    muted: false,
});

function clamp01(v: number): number {
    return Math.min(1, Math.max(0, v));
}

/** Keeps only known, well-typed fields; everything else takes the default. */
export function normalizeSettings(raw: unknown): SettingsData {
    const out: SettingsData = { ...DEFAULT_SETTINGS };
    if (typeof raw !== 'object' || raw === null) return out;
    const r = raw as Record<string, unknown>;
    if (typeof r.volume === 'number' && Number.isFinite(r.volume)) out.volume = clamp01(r.volume);
    if (typeof r.vibration === 'boolean') out.vibration = r.vibration;
    if (typeof r.flashEffects === 'boolean') out.flashEffects = r.flashEffects;
    if (typeof r.muted === 'boolean') out.muted = r.muted;
    return out;
}

function browserStorage(): StorageLike | null {
    try {
        return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
    } catch {
        return null;
    }
}

export class SettingsStore {
    private data: SettingsData;
    private readonly storage: StorageLike | null;

    constructor(storage: StorageLike | null = browserStorage()) {
        this.storage = storage;
        this.data = this.read();
    }

    get(): Readonly<SettingsData> {
        return { ...this.data };
    }

    /** Applies the patch (normalized), saves, and returns the new settings. */
    set(patch: Partial<SettingsData>): Readonly<SettingsData> {
        this.data = normalizeSettings({ ...this.data, ...patch });
        this.write();
        return this.get();
    }

    get effectiveVolume(): number {
        return this.data.muted ? 0 : this.data.volume;
    }

    private read(): SettingsData {
        if (!this.storage) return { ...DEFAULT_SETTINGS };
        try {
            const text = this.storage.getItem(SETTINGS_KEY);
            return normalizeSettings(text ? JSON.parse(text) : null);
        } catch {
            return { ...DEFAULT_SETTINGS };
        }
    }

    private write(): void {
        if (!this.storage) return;
        try {
            this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.data));
        } catch {
            // Quota or blocked storage: keep the in-memory value for this session.
        }
    }
}

let shared: SettingsStore | null = null;

/** App-wide settings backed by localStorage (created on first use). */
export function settings(): SettingsStore {
    if (!shared) shared = new SettingsStore();
    return shared;
}
