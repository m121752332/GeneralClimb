/**
 * Developer climb-speed selector (pure TS, no `cc`). Players always climb at x1; with
 * developer mode (RUNGM) the speed cycles through levels.json `dev.climbSpeeds`.
 */

/** Speed actually used: 1 outside developer mode or when the saved value isn't offered. */
export function effectiveSpeed(devMode: boolean, speeds: readonly number[], chosen: number): number {
    return devMode && speeds.includes(chosen) ? chosen : 1;
}

/** The next speed after `current`, wrapping to the first. */
export function nextSpeed(speeds: readonly number[], current: number): number {
    const i = speeds.indexOf(current);
    return speeds[(i + 1) % speeds.length] ?? 1;
}

/** "×1", "×1.5" … */
export function speedText(speed: number): string {
    return `×${speed}`;
}
