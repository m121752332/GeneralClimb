/**
 * 金手指 (cheat codes) typed in the Settings panel. Pure TS (no `cc`).
 * Input is trimmed, case-insensitive, and may be wrapped in brackets: "RUNGM", " [rungm] ", "【RunGM】".
 */

export type CheatAction = 'devModeOn' | 'devModeOff' | 'unknown' | 'empty';

const CODES: Record<string, CheatAction> = {
    RUNGM: 'devModeOn',
    STOPGM: 'devModeOff',
};

/** Bracket pairs accepted around a code (ASCII and full-width). */
const BRACKETS: [string, string][] = [['[', ']'], ['(', ')'], ['{', '}'], ['<', '>'], ['【', '】'], ['［', '］'], ['（', '）'], ['「', '」']];

export function normalizeCheat(input: string): string {
    let s = (input ?? '').trim();
    for (const [open, close] of BRACKETS) {
        if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) {
            s = s.slice(open.length, s.length - close.length).trim();
            break;
        }
    }
    return s.toUpperCase();
}

export function parseCheat(input: string): CheatAction {
    const code = normalizeCheat(input);
    if (!code) return 'empty';
    return CODES[code] ?? 'unknown';
}
