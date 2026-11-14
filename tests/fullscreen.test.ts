import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type FsDocument, fullscreenSupport, isFullscreen, isIos, onFullscreenChange, toggleFullscreen } from '../assets/scripts/core/Fullscreen.ts';

const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', maxTouchPoints: 5 };
const IPAD_AS_MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 };
const DESKTOP = { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', platform: 'Win32', maxTouchPoints: 0 };

function fakeDoc(prefixed = false): FsDocument & { calls: string[] } {
    const calls: string[] = [];
    const doc: FsDocument & { calls: string[] } = {
        calls,
        documentElement: prefixed
            ? { webkitRequestFullscreen: () => { calls.push('enter'); doc.webkitFullscreenElement = doc.documentElement; } }
            : { requestFullscreen: async () => { calls.push('enter'); doc.fullscreenElement = doc.documentElement; } },
    };
    if (prefixed) doc.webkitExitFullscreen = () => { calls.push('exit'); doc.webkitFullscreenElement = null; };
    else doc.exitFullscreen = async () => { calls.push('exit'); doc.fullscreenElement = null; };
    return doc;
}

test('detects iOS, including iPadOS posing as a Mac', () => {
    assert.equal(isIos(IPHONE), true);
    assert.equal(isIos(IPAD_AS_MAC), true);
    assert.equal(isIos(DESKTOP), false);
    assert.equal(isIos(undefined), false);
});

test('support: API, iPhone without API, standalone, none', () => {
    assert.equal(fullscreenSupport(fakeDoc(), DESKTOP), 'api');
    assert.equal(fullscreenSupport(fakeDoc(true), IPAD_AS_MAC), 'api');
    assert.equal(fullscreenSupport({ documentElement: {} }, IPHONE), 'ios');
    assert.equal(fullscreenSupport({ documentElement: {} }, { ...IPHONE, standalone: true }), 'standalone');
    assert.equal(fullscreenSupport(fakeDoc(), DESKTOP, true), 'standalone');
    assert.equal(fullscreenSupport({ documentElement: {} }, DESKTOP), 'none');
    assert.equal(fullscreenSupport({ ...fakeDoc(), fullscreenEnabled: false }, DESKTOP), 'none');
});

test('toggle enters and leaves, standard and WebKit-prefixed', async () => {
    for (const prefixed of [false, true]) {
        const doc = fakeDoc(prefixed);
        assert.equal(await toggleFullscreen(doc), true);
        assert.equal(isFullscreen(doc), true);
        assert.equal(await toggleFullscreen(doc), false);
        assert.equal(isFullscreen(doc), false);
        assert.deepEqual(doc.calls, ['enter', 'exit']);
    }
    await assert.rejects(toggleFullscreen({ documentElement: {} }));
});

test('change listener covers both event names and unsubscribes', () => {
    const listeners = new Map<string, () => void>();
    const doc: FsDocument = {
        documentElement: {},
        addEventListener: (type, fn) => listeners.set(type, fn),
        removeEventListener: (type) => listeners.delete(type),
    };
    const off = onFullscreenChange(doc, () => {});
    assert.deepEqual([...listeners.keys()].sort(), ['fullscreenchange', 'webkitfullscreenchange']);
    off();
    assert.equal(listeners.size, 0);
});
