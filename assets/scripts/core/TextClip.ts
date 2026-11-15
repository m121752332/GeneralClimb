/**
 * Shortens `text` to at most `max` characters (code points), ending in "…" when cut. Used where a
 * label has a fixed width and shrinking the font would make it unreadable (Home account chip e-mail).
 */
export function clipText(text: string, max: number): string {
    const chars = Array.from(text);
    if (max <= 0) return '';
    if (chars.length <= max) return text;
    return chars.slice(0, Math.max(0, max - 1)).join('') + '…';
}
