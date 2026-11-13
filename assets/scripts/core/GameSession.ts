/**
 * Choices carried from one scene to the next (pure TS, no `cc`).
 * Home writes it before loading Climb; Climb reads it on start.
 */
export type GameMode = 'normal' | 'practice';

export const GameSession = {
    /** 0-based index into levels.json `levels`. ADR-06: a normal run always starts at 0. */
    levelIndex: 0,
    mode: 'normal' as GameMode,
};
