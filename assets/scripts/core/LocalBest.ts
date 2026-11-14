/**
 * Local best record for players who are not signed in (GDD §8: same shape as Firestore `best/{uid}`).
 * Pure TypeScript (no `cc`). The result screen writes it; Home only reads it.
 */
import type { StorageLike } from './Settings';
import { t } from './I18n';

export const BEST_KEY = 'gcr.best.v1';
/** GDD §8: maxFloor 102 means the spire tip. */
export const SPIRE_TIP_FLOOR = 102;

export interface LocalBest {
    maxFloor: number;
    bestClearMs: number | null;
}

export function parseLocalBest(text: string | null): LocalBest | null {
    if (!text) return null;
    try {
        const raw = JSON.parse(text) as Record<string, unknown> | null;
        const maxFloor = raw?.maxFloor;
        if (typeof maxFloor !== 'number' || !Number.isInteger(maxFloor) || maxFloor < 1 || maxFloor > SPIRE_TIP_FLOOR) {
            return null;
        }
        const ms = raw?.bestClearMs;
        return { maxFloor, bestClearMs: typeof ms === 'number' && ms > 0 ? ms : null };
    } catch {
        return null;
    }
}

function formatDuration(ms: number): string {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Home screen text, e.g. 「最佳紀錄：47F」 or 「最佳紀錄：登頂 12:34」. */
export function formatBest(best: LocalBest | null): string {
    if (!best) return t('best.none');
    if (best.maxFloor >= SPIRE_TIP_FLOOR) {
        return best.bestClearMs ? t('best.summitTime', { time: formatDuration(best.bestClearMs) }) : t('best.summit');
    }
    return t('best.floor', { floor: best.maxFloor });
}

export function readLocalBest(storage: StorageLike | null): LocalBest | null {
    try {
        return parseLocalBest(storage ? storage.getItem(BEST_KEY) : null);
    } catch {
        return null;
    }
}

/** Keeps the better record: a summit beats any floor, a faster clear beats a slower one. */
export function betterBest(old: LocalBest | null, run: LocalBest): LocalBest {
    if (!old) return run;
    if (run.maxFloor !== old.maxFloor) return run.maxFloor > old.maxFloor ? run : { ...old };
    if (run.bestClearMs === null) return { ...old };
    if (old.bestClearMs === null || run.bestClearMs < old.bestClearMs) return { ...old, bestClearMs: run.bestClearMs };
    return { ...old };
}

/** Called when a run ends (fall or summit). Storage failures are ignored. */
export function recordLocalBest(storage: StorageLike | null, run: LocalBest): LocalBest {
    const next = betterBest(readLocalBest(storage), run);
    try {
        storage?.setItem(BEST_KEY, JSON.stringify(next));
    } catch {
        // blocked storage: nothing kept
    }
    return next;
}
