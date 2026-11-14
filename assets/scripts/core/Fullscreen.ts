/**
 * Browser fullscreen for the Home toggle. Pure TypeScript (no `cc`): the document and navigator
 * are passed in so tests can fake them. Handles the WebKit-prefixed API (Safari, older iPadOS).
 * iPhone Safari has no element fullscreen at all; there the game can only fill the screen when it
 * is added to the Home Screen (standalone), so `fullscreenSupport` says which case applies.
 */

export interface FsElement {
    requestFullscreen?: () => Promise<void> | void;
    webkitRequestFullscreen?: () => void;
}

export interface FsDocument {
    documentElement: FsElement;
    fullscreenEnabled?: boolean;
    webkitFullscreenEnabled?: boolean;
    fullscreenElement?: unknown;
    webkitFullscreenElement?: unknown;
    exitFullscreen?: () => Promise<void> | void;
    webkitExitFullscreen?: () => void;
    addEventListener?: (type: string, fn: () => void) => void;
    removeEventListener?: (type: string, fn: () => void) => void;
}

export interface FsNavigator {
    userAgent?: string;
    platform?: string;
    maxTouchPoints?: number;
    /** iOS Safari: true when launched from the Home Screen. */
    standalone?: boolean;
}

/**
 * - `api`: the Fullscreen API works (desktop browsers, Android, iPad).
 * - `standalone`: already running as a Home Screen app, nothing to toggle.
 * - `ios`: iPhone / iPod Safari, where only Add to Home Screen gives fullscreen.
 * - `none`: no fullscreen in this browser.
 */
export type FullscreenSupport = 'api' | 'standalone' | 'ios' | 'none';

export function isIos(nav: FsNavigator | undefined): boolean {
    if (!nav) return false;
    const ua = nav.userAgent ?? '';
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    // iPadOS 13+ reports itself as a Mac; touch points give it away.
    return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
}

export function fullscreenSupport(doc: FsDocument | undefined, nav: FsNavigator | undefined, displayStandalone = false): FullscreenSupport {
    if (nav?.standalone === true || displayStandalone) return 'standalone';
    if (doc) {
        const el = doc.documentElement;
        const enabled = doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? true;
        if (enabled && (typeof el?.requestFullscreen === 'function' || typeof el?.webkitRequestFullscreen === 'function')) return 'api';
    }
    return isIos(nav) ? 'ios' : 'none';
}

export function isFullscreen(doc: FsDocument | undefined): boolean {
    return !!(doc && (doc.fullscreenElement || doc.webkitFullscreenElement));
}

/**
 * Enters or leaves fullscreen; resolves to the new state. Must run inside a user gesture
 * (a click). Rejects when the browser refuses.
 */
export async function toggleFullscreen(doc: FsDocument): Promise<boolean> {
    if (isFullscreen(doc)) {
        if (doc.exitFullscreen) await doc.exitFullscreen();
        else doc.webkitExitFullscreen?.();
        return false;
    }
    const el = doc.documentElement;
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else throw new Error('Fullscreen API unavailable');
    return true;
}

/** Calls `fn` whenever fullscreen starts or ends (Esc, the browser's own UI). Returns an unsubscribe. */
export function onFullscreenChange(doc: FsDocument, fn: () => void): () => void {
    const types = ['fullscreenchange', 'webkitfullscreenchange'];
    for (const type of types) doc.addEventListener?.(type, fn);
    return () => {
        for (const type of types) doc.removeEventListener?.(type, fn);
    };
}
