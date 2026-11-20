/**
 * Game time → "real" climbing time for display (1 game minute = 9.5 real minutes).
 * Pure TypeScript (no `cc`). Display only: records, Firestore `bestRunMs` and the leaderboard
 * order keep the raw game ms.
 */
import { type Lang, lang, translate } from './I18n';

/** 1 game minute = REAL_TIME_FACTOR real minutes. */
export const REAL_TIME_FACTOR = 9.5;

/** Game ms → real ms (bad input → 0). */
export function toRealMs(gameMs: number): number {
    return Number.isFinite(gameMs) && gameMs > 0 ? gameMs * REAL_TIME_FACTOR : 0;
}

export interface RealDurationOptions {
    /** Also show seconds (「1小時39分45秒」 / "1h 39m 45s"). */
    withSeconds?: boolean;
}

/**
 * 「1小時39分」 / "1h 39m"; under an hour 「47分」 / "47m". Truncated (floor), so game 10m30s
 * (99.75 real minutes) is 「1小時39分」.
 */
export function formatRealDuration(gameMs: number, language: Lang = lang(), opts: RealDurationOptions = {}): string {
    const totalSec = Math.floor(toRealMs(gameMs) / 1000 + 1e-6);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (opts.withSeconds) return translate(language, h > 0 ? 'time.realHMS' : 'time.realMS', { h, m, s });
    return translate(language, h > 0 ? 'time.realHM' : 'time.realM', { h, m });
}
