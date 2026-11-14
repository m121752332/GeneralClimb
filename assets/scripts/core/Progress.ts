/**
 * Level unlocks, rounds (周目) and summit count, kept in localStorage. Pure TypeScript (no `cc`).
 *
 * - Clearing level N opens level N+1 in the level select, and it stays open after quitting
 *   or reloading the page, so a run can be resumed from there.
 * - A fall means starting over (ADR-06): the unlocks reset to level 1.
 * - Reaching the spire tip and finishing the ending completes a round: the unlocks reset to
 *   level 1, `rounds` and `summits` go up by one.
 * - `summits` is the number to show off. When Google sign-in (M3) arrives, the cloud total is
 *   raised by `summits - syncedSummits` and `syncedSummits` is set to `summits`, so summits made
 *   while signed out are not lost and none are counted twice.
 */
import type { StorageLike } from './Settings';
import { t } from './I18n';

export const PROGRESS_KEY = 'gcr.progress.v1';

export interface Progress {
    /** 0-based index of the furthest open level (0 = only level 1). */
    unlocked: number;
    /** Completed rounds (周目). The current round is `rounds + 1`. */
    rounds: number;
    /** Total summits on this device. */
    summits: number;
    /** Part of `summits` already added to the cloud total (for M3). */
    syncedSummits: number;
    /** ISO time of the last summit, or null. */
    lastSummitAt: string | null;
}

export const EMPTY_PROGRESS: Readonly<Progress> = Object.freeze({
    unlocked: 0,
    rounds: 0,
    summits: 0,
    syncedSummits: 0,
    lastSummitAt: null,
});

function count(v: unknown): number {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
}

/** Keeps only well-typed fields; anything broken falls back to a fresh start. */
export function parseProgress(text: string | null): Progress {
    if (!text) return { ...EMPTY_PROGRESS };
    try {
        const r = JSON.parse(text) as Record<string, unknown> | null;
        if (typeof r !== 'object' || r === null) return { ...EMPTY_PROGRESS };
        const summits = count(r.summits);
        return {
            unlocked: count(r.unlocked),
            rounds: count(r.rounds),
            summits,
            syncedSummits: Math.min(count(r.syncedSummits), summits),
            lastSummitAt: typeof r.lastSummitAt === 'string' ? r.lastSummitAt : null,
        };
    } catch {
        return { ...EMPTY_PROGRESS };
    }
}

export function readProgress(storage: StorageLike | null): Progress {
    try {
        return parseProgress(storage ? storage.getItem(PROGRESS_KEY) : null);
    } catch {
        return { ...EMPTY_PROGRESS };
    }
}

export function writeProgress(storage: StorageLike | null, p: Progress): void {
    try {
        storage?.setItem(PROGRESS_KEY, JSON.stringify(p));
    } catch {
        // private mode / blocked storage: progress lives for this page load only
    }
}

/** Highest open index for a config with `levelCount` levels. */
export function unlockedIndex(p: Progress, levelCount: number): number {
    return Math.max(0, Math.min(p.unlocked, levelCount - 1));
}

/** After clearing the level at `index`: the next one opens (never closes anything). */
export function afterLevelCleared(p: Progress, index: number, levelCount: number): Progress {
    const next = Math.min(index + 1, levelCount - 1);
    return next > p.unlocked ? { ...p, unlocked: next } : p;
}

/** After a fall: back to level 1, only level 1 open. Rounds and summits stay. */
export function afterFall(p: Progress): Progress {
    return p.unlocked === 0 ? p : { ...p, unlocked: 0 };
}

/** After the summit ending: one round done, unlocks back to level 1. */
export function afterSummit(p: Progress, now: Date): Progress {
    return {
        ...p,
        unlocked: 0,
        rounds: p.rounds + 1,
        summits: p.summits + 1,
        lastSummitAt: now.toISOString(),
    };
}

/** Summits not yet added to the cloud total. */
export function unsyncedSummits(p: Progress): number {
    return Math.max(0, p.summits - p.syncedSummits);
}

/** After `added` summits were written to the cloud total. */
export function markSynced(p: Progress, added: number): Progress {
    if (added <= 0) return p;
    return { ...p, syncedSummits: Math.min(p.summits, p.syncedSummits + added) };
}

/** Home text, e.g. 「第 1 周目」 or 「第 3 周目 · 已登頂 2 次」. */
export function formatRound(p: Progress): string {
    const round = t('round.n', { n: p.rounds + 1 });
    return p.summits > 0 ? t('round.summits', { round, n: p.summits }) : round;
}

/** Load → change → save, for the scenes. */
export function updateProgress(storage: StorageLike | null, change: (p: Progress) => Progress): Progress {
    const next = change(readProgress(storage));
    writeProgress(storage, next);
    return next;
}
