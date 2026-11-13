/**
 * 金手指 (cheat codes) typed in the Settings panel. Pure TS (no `cc`).
 * The code is the plain word, trimmed and case-insensitive: "RUNGM", " rungm ". Brackets are not
 * part of a code ("[RUNGM]" is unknown).
 */

export type CheatAction = 'devModeOn' | 'devModeOff' | 'unknown' | 'empty';

const CODES: Record<string, CheatAction> = {
    RUNGM: 'devModeOn',
    STOPGM: 'devModeOff',
};

export function normalizeCheat(input: string): string {
    return (input ?? '').trim().toUpperCase();
}

export function parseCheat(input: string): CheatAction {
    const code = normalizeCheat(input);
    if (!code) return 'empty';
    return CODES[code] ?? 'unknown';
}
