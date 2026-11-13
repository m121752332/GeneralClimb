import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, SETTINGS_KEY, SettingsStore, normalizeSettings, type StorageLike } from '../assets/scripts/core/Settings.ts';

class MemoryStorage implements StorageLike {
    readonly map = new Map<string, string>();
    getItem(key: string): string | null {
        return this.map.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        this.map.set(key, value);
    }
}

const throwing: StorageLike = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
};

test('defaults when storage is empty', () => {
    assert.deepEqual(new SettingsStore(new MemoryStorage()).get(), DEFAULT_SETTINGS);
});

test('set persists and a new store reads it back', () => {
    const storage = new MemoryStorage();
    new SettingsStore(storage).set({ volume: 0.25, vibration: false, muted: true });
    assert.deepEqual(new SettingsStore(storage).get(), { volume: 0.25, vibration: false, flashEffects: true, muted: true });
    assert.ok(storage.getItem(SETTINGS_KEY));
});

test('volume is clamped and bad types fall back to defaults', () => {
    assert.equal(normalizeSettings({ volume: 3 }).volume, 1);
    assert.equal(normalizeSettings({ volume: -1 }).volume, 0);
    assert.equal(normalizeSettings({ volume: Number.NaN }).volume, DEFAULT_SETTINGS.volume);
    assert.equal(normalizeSettings({ vibration: 'yes' }).vibration, DEFAULT_SETTINGS.vibration);
    assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
});

test('corrupt JSON falls back to defaults', () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, '{not json');
    assert.deepEqual(new SettingsStore(storage).get(), DEFAULT_SETTINGS);
});

test('throwing or missing storage still works in memory', () => {
    for (const storage of [throwing, null]) {
        const store = new SettingsStore(storage);
        assert.deepEqual(store.get(), DEFAULT_SETTINGS);
        assert.equal(store.set({ flashEffects: false }).flashEffects, false);
        assert.equal(store.get().flashEffects, false);
    }
});

test('effectiveVolume is zero when muted', () => {
    const store = new SettingsStore(new MemoryStorage());
    store.set({ volume: 0.6 });
    assert.equal(store.effectiveVolume, 0.6);
    store.set({ muted: true });
    assert.equal(store.effectiveVolume, 0);
});
