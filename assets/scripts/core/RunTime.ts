/**
 * Fastest full run (第 1 關到第 14 關一次登頂，不墜落) for the 「最快時間」 leaderboard tab.
 * Pure TypeScript (no `cc`, no Firebase).
 *
 * The time is ClimbSim.climbSec: only time spent climbing counts (pause, level transitions,
 * the fall animation and the ending do not), and a fall starts a new run at 0. Practice and
 * developer mode never record one, nor a run resumed from the level select (not from level 1).
 *
 * Firestore `summits/{uid}.bestRunMs` (int ms). config/firestore.rules only lets it go down and
 * never below `cloud.minRunSec` × 1000, the same limit `bestRunToUpload` applies here, so the
 * client never sends a write the rules would refuse (that would also drop the summit count).
 */
import { type Lang, lang, translate } from './I18n';

export interface TimeRow {
    uid: string;
    name: string;
    bestRunMs: number;
}

export interface RankedTimeRow extends TimeRow {
    /** 1-based; equal times share a rank (1, 1, 3). */
    rank: number;
}

/** A stored run time, or null if it is missing or not a positive whole number of ms. */
export function parseRunMs(v: unknown): number | null {
    return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}

/** The faster of two run times (null = no run yet). */
export function fasterRun(a: number | null, b: number | null): number | null {
    if (a === null) return b;
    if (b === null) return a;
    return Math.min(a, b);
}

/** climbSec → whole ms for the record. */
export function runMsFromSec(sec: number): number {
    return Math.round(sec * 1000);
}

/**
 * The local best to write to the cloud now, or null: only when it beats the cloud value and is
 * not below the rules' lower limit.
 */
export function bestRunToUpload(localBest: number | null, cloudBest: number | null, minRunSec: number): number | null {
    if (localBest === null || localBest < minRunSec * 1000) return null;
    return cloudBest === null || localBest < cloudBest ? localBest : null;
}

/** Fastest first; equal times share a rank. */
export function rankTimes(rows: readonly TimeRow[]): RankedTimeRow[] {
    const sorted = rows.filter((r) => parseRunMs(r.bestRunMs) !== null).slice().sort((a, b) => a.bestRunMs - b.bestRunMs);
    let rank = 0;
    return sorted.map((r, i) => {
        if (i === 0 || r.bestRunMs !== sorted[i - 1].bestRunMs) rank = i + 1;
        return { ...r, rank };
    });
}

/** 「10分32秒456」 / "10m 32.456s"; seconds and ms are zero-padded. */
export function formatRunTime(ms: number, language: Lang = lang()): string {
    const total = Math.max(0, Math.round(ms));
    const m = Math.floor(total / 60_000);
    const s = Math.floor(total / 1000) % 60;
    const milli = total % 1000;
    return translate(language, 'time.run', { m, s: String(s).padStart(2, '0'), ms: String(milli).padStart(3, '0') });
}

/** 總周目 tab: 「10周目」 / "10 rounds", "1 round". */
export function formatRounds(n: number, language: Lang = lang()): string {
    return n === 1 ? translate(language, 'lb.round1') : translate(language, 'lb.rounds', { n });
}
