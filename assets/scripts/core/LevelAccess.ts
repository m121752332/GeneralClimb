/**
 * Which levels the level-select panel lets a player start. Pure TS (no `cc`).
 * Level 1 is always open; clearing level N opens level N+1 (`unlocked`, from core/Progress),
 * so a run left by quitting can be resumed. A fall (ADR-06: back to 1F) or the summit ending
 * (one round done) locks everything again.
 * Developer mode (金手指 RUNGM) opens every level, the spire included.
 */

export type LevelAccess = 'open' | 'locked' | 'spire';

export interface LevelLike {
    /** null on the spire levels. */
    floorFrom: number | null;
}

/** `unlocked` = 0-based index of the furthest open level. `level` is kept for future per-level rules. */
export function levelAccess(_level: LevelLike, index: number, devMode: boolean, unlocked = 0): LevelAccess {
    if (index === 0 || devMode) return 'open';
    return index <= unlocked ? 'open' : 'locked';
}
