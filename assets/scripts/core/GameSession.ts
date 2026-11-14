/**
 * Choices carried from one scene to the next (pure TS, no `cc`).
 * Home writes it before loading Climb; Climb reads it on start.
 */
export type GameMode = 'normal' | 'practice';

export const GameSession = {
    /** 0-based index into levels.json `levels`. ADR-06: a normal run always starts at 0. */
    levelIndex: 0,
    mode: 'normal' as GameMode,
    /** Developer mode (cheat code RUNGM in Settings): any non-spire level can be picked. */
    devMode: false,
    /** The 3 s opening has been shown (once per page load; GDD §7). */
    introPlayed: false,
    /** Home's start buttons set this; Climb plays the push-in to the tower base once, then clears it. */
    pushIn: false,
};
