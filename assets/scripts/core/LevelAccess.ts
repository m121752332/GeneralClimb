/**
 * Which levels the level-select panel lets a player start. Pure TS (no `cc`).
 * ADR-06: a fall always restarts at 1F, so normally only level 1 is open.
 * Developer mode (金手指 RUNGM) opens every level, the spire included.
 */

export type LevelAccess = 'open' | 'locked' | 'spire';

export interface LevelLike {
    /** null on the spire levels. */
    floorFrom: number | null;
}

/** `level` is kept for callers and future per-level rules. */
export function levelAccess(_level: LevelLike, index: number, devMode: boolean): LevelAccess {
    if (index === 0) return 'open';
    if (!devMode) return 'locked';
    return 'open';
}
