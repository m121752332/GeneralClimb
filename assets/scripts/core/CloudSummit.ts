/**
 * Cloud summit count and leaderboard rules (ADR-09). Pure TypeScript (no `cc`, no Firebase):
 * AuthService feeds it Firestore data, the tests feed it plain objects.
 *
 * Firestore `summits/{uid}` = { name, count, updatedAt }. config/firestore.rules enforces the
 * same limits as `planSummitSync`: the first write creates count 1, and later writes may raise
 * the count by k only when k × `cloud.minSummitSec` has passed since `updatedAt`. Summits made
 * faster than that (several offline, or before signing in) stay unsynced locally and are added
 * on later syncs, so none are lost and none are counted twice.
 */
// Type-only import: node --test runs these files without resolving extensionless value imports.
import type { Progress } from './Progress';
import { t } from './I18n';

/** Name shown when the Google account has no display name (ADR-09 default). */
export const DEFAULT_NAME = '霍將軍';
/** ADR-09: player names are 1–12 characters. */
export const NAME_MAX = 12;
/** Allowance for the device clock running ahead of the server's `request.time`. */
export const CLOCK_MARGIN_MS = 30_000;

export interface SummitDoc {
    name: string;
    count: number;
    /** Server time of the last count change, in ms. */
    updatedAtMs: number;
}

export interface LeaderRow extends SummitDoc {
    uid: string;
    /** 1-based; players with the same count share a rank (1, 1, 3). */
    rank: number;
}

export interface SyncPlan {
    /** Summits to add to the cloud count now (0 = nothing to add yet). */
    add: number;
    /** Set when the doc must be written: the new count and name. */
    write: { count: number; name: string; rename: boolean } | null;
}

/** Google display name → leaderboard name: trimmed, single spaces, at most 12 characters. */
export function cloudName(displayName: string | null | undefined): string {
    const text = (displayName ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    const chars = Array.from(text).slice(0, NAME_MAX).join('').trim();
    return chars || DEFAULT_NAME;
}

/** Firestore data → SummitDoc, or null if it is missing or not shaped like one. */
export function parseSummitDoc(data: unknown, updatedAtMs: number | null): SummitDoc | null {
    if (typeof data !== 'object' || data === null) return null;
    const r = data as Record<string, unknown>;
    const count = r.count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return null;
    return {
        name: typeof r.name === 'string' && r.name ? r.name : DEFAULT_NAME,
        count,
        updatedAtMs: updatedAtMs ?? 0,
    };
}

/** How many local summits may be added now, mirroring config/firestore.rules. */
export function summitsAllowed(cloud: SummitDoc | null, nowMs: number, minSummitSec: number): number {
    if (!cloud) return 1;
    const since = nowMs - cloud.updatedAtMs - CLOCK_MARGIN_MS;
    return Math.max(0, Math.floor(since / (minSummitSec * 1000)));
}

export function planSummitSync(local: Progress, cloud: SummitDoc | null, name: string, nowMs: number, minSummitSec: number): SyncPlan {
    const add = Math.min(Math.max(0, local.summits - local.syncedSummits), summitsAllowed(cloud, nowMs, minSummitSec));
    if (add > 0) return { add, write: { count: (cloud?.count ?? 0) + add, name, rename: false } };
    // Nothing to add: only keep the shown name in step with the Google account.
    if (cloud && cloud.name !== name) return { add: 0, write: { count: cloud.count, name, rename: true } };
    return { add: 0, write: null };
}

/** Most summits first; on a tie, whoever got there first. */
export function rankRows(rows: readonly (SummitDoc & { uid: string })[]): LeaderRow[] {
    const sorted = rows.filter((r) => r.count > 0).slice().sort((a, b) => b.count - a.count || a.updatedAtMs - b.updatedAtMs);
    let rank = 0;
    return sorted.map((r, i) => {
        if (i === 0 || r.count !== sorted[i - 1].count) rank = i + 1;
        return { ...r, rank };
    });
}

/** Home text for the cloud total, e.g. 「雲端登頂 5 次」. */
export function formatCloudCount(count: number | null): string {
    return count === null ? '' : t('cloud.count', { n: count });
}

/** Six-digit tag from the uid, so players with the same name can be told apart (「森上梅虔#670109」). */
export function playerTag(uid: string): string {
    let h = 2166136261;
    for (let i = 0; i < uid.length; i++) {
        h ^= uid.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return String(1_000_000 + (h % 1_000_000)).slice(1);
}

/** 「已同步・剛剛」/「已同步・3 分鐘前」/「尚未同步」 for the account panel. */
export function formatSyncAgo(lastMs: number | null, nowMs: number): string {
    if (lastMs === null) return t('sync.never');
    const min = Math.floor(Math.max(0, nowMs - lastMs) / 60_000);
    if (min < 1) return t('sync.justNow');
    if (min < 60) return t('sync.minutes', { n: min });
    const hr = Math.floor(min / 60);
    return hr < 24 ? t('sync.hours', { n: hr }) : t('sync.days', { n: Math.floor(hr / 24) });
}
