import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
    NAME_MAX, NAME_MIN, PROFILE_KEY, normalizeName, readCachedProfile, renameWaitSec, validatePlayerName, writeCachedProfile,
} from '../assets/scripts/core/PlayerName.ts';

test('names are trimmed, single-spaced and stripped of control characters', () => {
    assert.equal(normalizeName('  Tiger   Lee \t'), 'Tiger Lee');
    assert.equal(normalizeName('霍\u0000將​軍'), '霍將軍');
    assert.equal(normalizeName('　霍將軍　'), '霍將軍');
    assert.deepEqual(validatePlayerName('  霍 將軍  '), { ok: true, name: '霍 將軍' });
});

test('2 to 12 characters, one Chinese character counts as one', () => {
    assert.deepEqual(validatePlayerName('霍將'), { ok: true, name: '霍將' });
    assert.deepEqual(validatePlayerName('一二三四五六七八九十甲乙'), { ok: true, name: '一二三四五六七八九十甲乙' });
    assert.deepEqual(validatePlayerName('一二三四五六七八九十甲乙丙'), { ok: false, error: 'length' });
    assert.deepEqual(validatePlayerName('霍'), { ok: false, error: 'length' });
    assert.deepEqual(validatePlayerName('a'), { ok: false, error: 'length' });
    assert.equal(NAME_MIN, 2);
    assert.equal(NAME_MAX, 12);
});

test('empty and whitespace-only names are rejected', () => {
    assert.deepEqual(validatePlayerName(''), { ok: false, error: 'empty' });
    assert.deepEqual(validatePlayerName('   \t　 '), { ok: false, error: 'empty' });
    assert.deepEqual(validatePlayerName('\u0000\u0007'), { ok: false, error: 'empty' });
});

test('only Chinese, English letters, digits, underscore, space and hyphen', () => {
    for (const ok of ['Tiger_01', 'tiger-lee', '曾阿康', 'Ah Kang 2', '霍將軍-101']) {
        assert.equal(validatePlayerName(ok).ok, true, ok);
    }
    for (const bad of ['霍將軍#1', 'a.b', '😀😀', 'ｔｉｇｅｒ', 'こんにちは', '<b>hi', '霍，將軍', 'a/b']) {
        assert.deepEqual(validatePlayerName(bad), { ok: false, error: 'chars' }, bad);
    }
});

test('rename cooldown counts down in whole seconds', () => {
    assert.equal(renameWaitSec(null, 1000, 30), 0);
    assert.equal(renameWaitSec(0, 0, 30), 30);
    assert.equal(renameWaitSec(0, 29_001, 30), 1);
    assert.equal(renameWaitSec(0, 30_000, 30), 0);
});

test('the name cache is per account and ignores bad data', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    assert.equal(readCachedProfile(storage, 'u1'), null);
    writeCachedProfile(storage, { uid: 'u1', name: '曾阿康', renamedAtMs: 5 });
    assert.deepEqual(readCachedProfile(storage, 'u1'), { uid: 'u1', name: '曾阿康', renamedAtMs: 5 });
    assert.equal(readCachedProfile(storage, 'u2'), null);
    data.set(PROFILE_KEY, '{"uid":"u1","name":"a#b"}');
    assert.equal(readCachedProfile(storage, 'u1'), null);
    data.set(PROFILE_KEY, 'not json');
    assert.equal(readCachedProfile(storage, 'u1'), null);
    assert.equal(readCachedProfile(null, 'u1'), null);
});

test('firestore.rules limits players/{uid} names the same way', () => {
    const rules = readFileSync(new URL('../config/firestore.rules', import.meta.url), 'utf8');
    const cfg = JSON.parse(readFileSync(new URL('../assets/resources/config/levels.json', import.meta.url), 'utf8')) as { cloud: { renameCooldownSec: number } };
    const size = rules.match(/d\.name\.size\(\) >= (\d+) && d\.name\.size\(\) <= (\d+) \/\/ player name/);
    assert.ok(size, 'player name size limit not found in firestore.rules');
    assert.equal(Number(size[1]), NAME_MIN);
    assert.equal(Number(size[2]), NAME_MAX);
    const cool = rules.match(/nameUpdatedAt \+ duration\.value\((\d+), 's'\)/);
    assert.ok(cool, 'rename cooldown not found in firestore.rules');
    assert.equal(Number(cool[1]), cfg.cloud.renameCooldownSec);
    assert.match(rules, /affectedKeys\(\)\.hasOnly\(\['name', 'nameUpdatedAt'\]\)/);
});
