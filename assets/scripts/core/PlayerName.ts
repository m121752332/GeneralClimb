/**
 * Player-chosen display name (account panel 「修改名稱」). Pure TypeScript (no `cc`, no Firebase)
 * so the rules can be unit-tested; config/firestore.rules enforces the same limits on
 * `players/{uid}` = { name, nameUpdatedAt } (tests/player-name.test.ts checks both sides agree).
 *
 * Only the name is editable; the 「#844056」 tag after it always comes from the uid (playerTag).
 */
import type { StorageLike } from './Settings';

/** Shortest / longest name, in characters (code points: one Chinese character counts as one). */
export const NAME_MIN = 2;
export const NAME_MAX = 12;
/** Characters a typed name may use: Chinese (Han), English letters, digits, `_`, space, `-`. */
export const NAME_PATTERN = /^[\p{Script=Han}A-Za-z0-9_ -]+$/u;
/** localStorage key of the cached name, so it shows before (or without) the Firestore read. */
export const PROFILE_KEY = 'gcr.profile.v1';

export type NameError = 'empty' | 'length' | 'chars';

export type NameCheck = { ok: true; name: string } | { ok: false; error: NameError };

/** Drops control / zero-width characters, turns any run of whitespace into one space, trims. */
export function normalizeName(raw: string): string {
    return raw
        .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function nameLength(name: string): number {
    return Array.from(name).length;
}

export function validatePlayerName(raw: string): NameCheck {
    const name = normalizeName(raw);
    if (!name) return { ok: false, error: 'empty' };
    if (!NAME_PATTERN.test(name)) return { ok: false, error: 'chars' };
    const n = nameLength(name);
    if (n < NAME_MIN || n > NAME_MAX) return { ok: false, error: 'length' };
    return { ok: true, name };
}

/** Seconds left before the player may rename again (0 = now). */
export function renameWaitSec(lastRenameMs: number | null, nowMs: number, cooldownSec: number): number {
    if (lastRenameMs === null) return 0;
    return Math.max(0, Math.ceil((lastRenameMs + cooldownSec * 1000 - nowMs) / 1000));
}

export interface CachedProfile {
    uid: string;
    name: string;
    /** Device time of the last rename, for the cooldown. */
    renamedAtMs: number | null;
}

/** The cached name for `uid`, or null if none / another account's / no longer valid. */
export function readCachedProfile(storage: StorageLike | null, uid: string): CachedProfile | null {
    try {
        const raw = storage?.getItem(PROFILE_KEY);
        if (!raw) return null;
        const v = JSON.parse(raw) as Partial<CachedProfile>;
        if (v.uid !== uid || typeof v.name !== 'string') return null;
        const check = validatePlayerName(v.name);
        if (!check.ok || check.name !== v.name) return null;
        return { uid, name: v.name, renamedAtMs: typeof v.renamedAtMs === 'number' ? v.renamedAtMs : null };
    } catch {
        return null;
    }
}

export function writeCachedProfile(storage: StorageLike | null, profile: CachedProfile | null): void {
    try {
        storage?.setItem(PROFILE_KEY, profile ? JSON.stringify(profile) : '');
    } catch {
        // Private mode / quota: the cache is only a convenience.
    }
}
