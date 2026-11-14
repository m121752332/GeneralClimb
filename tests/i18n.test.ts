import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CATALOGS, LANGS, format, nextLang, translate, translateLevelName } from '../assets/scripts/core/I18n.ts';
import { normalizeSettings } from '../assets/scripts/core/Settings.ts';

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every language has the same keys, all non-empty', () => {
    const zh = Object.keys(CATALOGS['zh-TW']).sort();
    for (const lang of LANGS) {
        assert.deepEqual(Object.keys(CATALOGS[lang]).sort(), zh, lang);
        for (const [k, v] of Object.entries(CATALOGS[lang])) assert.ok(v.trim().length > 0, `${lang} ${k}`);
    }
});

test('translations use the same placeholders as the Chinese text', () => {
    for (const [key, zh] of Object.entries(CATALOGS['zh-TW'])) {
        assert.deepEqual(placeholders(CATALOGS.en[key as keyof typeof CATALOGS.en]), placeholders(zh), key);
    }
});

test('format fills placeholders and leaves unknown ones', () => {
    assert.equal(format('第 {n} 關 {x}', { n: 3 }), '第 3 關 {x}');
    assert.equal(translate('en', 'home.levelWip', { n: 2 }), 'Level 2 is coming soon');
    assert.equal(translate('zh-TW', 'round.summits', { round: '第 2 周目', n: 1 }), '第 2 周目 · 已登頂 1 次');
});

test('every level name in levels.json has an English name', () => {
    const cfg = JSON.parse(readFileSync(new URL('../assets/resources/config/levels.json', import.meta.url), 'utf8')) as { levels: { name: string }[] };
    for (const { name } of [...cfg.levels, { name: '三層樓平房' }]) {
        const en = translateLevelName('en', name);
        assert.ok(/^[\x20-\x7e]+$/.test(en), `${name} -> ${en}`);
        assert.equal(translateLevelName('zh-TW', name), name);
    }
    assert.equal(translateLevelName('en', '第3節'), 'Section 3');
});

test('nextLang cycles and Settings keeps only known languages', () => {
    assert.equal(nextLang('zh-TW'), 'en');
    assert.equal(nextLang('en'), 'zh-TW');
    assert.equal(normalizeSettings({ lang: 'en' }).lang, 'en');
    assert.equal(normalizeSettings({ lang: 'fr' }).lang, 'zh-TW');
    assert.equal(normalizeSettings(null).lang, 'zh-TW');
});
