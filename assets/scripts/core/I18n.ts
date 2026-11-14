/**
 * UI language (繁體中文 by default, English). Pure TypeScript (no `cc`) so the catalogs can be
 * unit-tested with plain Node. Every player-visible string lives here; `{name}` placeholders are
 * filled by `t()`. Both catalogs must have the same keys and the same placeholders (tests check).
 */
import { settings } from './Settings';

export type Lang = 'zh-TW' | 'en';

export const LANGS: readonly Lang[] = ['zh-TW', 'en'];
export const DEFAULT_LANG: Lang = 'zh-TW';

export function isLang(v: unknown): v is Lang {
    return v === 'zh-TW' || v === 'en';
}

const ZH = {
    // Shared
    'game.title': '霍將軍爬101大樓',
    'player.name': '霍將軍',
    'common.loading': '載入中…',
    'common.skip': '點擊或按任意鍵略過 ▶▶',
    'floors.spire': '尖塔',
    'floors.tip': '塔尖',

    // Home
    'home.start': '開始遊戲',
    'home.levels': '選擇關卡',
    'home.practice': '練習模式',
    'home.settings': '設定',
    'home.google': 'Google 登入',
    'home.googleSoon': 'Google 登入將於 M3 推出',
    'home.muted': '已靜音',
    'home.unmuted': '已開啟聲音',
    'home.levelWip': '第 {n} 關製作中',
    'home.practiceWip': '練習模式製作中',
    'home.levelsLoading': '關卡資料載入中…',
    'home.levelsFailed': 'levels.json 載入失敗',
    'home.langName': '中文',
    'home.fullscreen': '全螢幕',
    'home.fullscreenIos': 'iPhone 請用 Safari「分享 → 加入主畫面」以全螢幕遊玩',
    'home.fullscreenNo': '此瀏覽器不支援全螢幕',
    'home.fullscreenFail': '無法進入全螢幕',
    'home.fullscreenStandalone': '已是全螢幕（主畫面 App）',

    // Best record / progress
    'best.none': '最佳紀錄：尚無紀錄',
    'best.summit': '最佳紀錄：登頂',
    'best.summitTime': '最佳紀錄：登頂 {time}',
    'best.floor': '最佳紀錄：{floor}F',
    'round.n': '第 {n} 周目',
    'round.summits': '{round} · 已登頂 {n} 次',

    // Intro
    'intro.tagline': '從 1F 徒手爬上塔尖',

    // Boot
    'boot.config': '讀取遊戲設定',
    'boot.configOk': 'levels.json v{version} OK · {n} 關',
    'boot.account': '載入帳號',
    'boot.guest': '訪客模式 · {best}',
    'boot.weather': '天氣系統',
    'boot.weatherOk': '風／雨／鷹 OK，強風 {lo}–{hi}',
    'boot.weatherBad': '天氣參數錯誤：{issues}',
    'boot.npc': 'NPC 載入',
    'boot.npcOk': '窗內 NPC：路人、員工、觀光客',
    'boot.sound': '音效',
    'boot.soundNo': '此瀏覽器不支援音效',
    'boot.soundOk': '合成音效 · 音量 {pct}%',
    'boot.soundOkMuted': '合成音效 · 音量 {pct}%（靜音）',
    'boot.render': '場景渲染',
    'boot.renderOk': '主畫面與圖示就緒',
    'boot.renderNoIcon': '主畫面就緒（圖示稍後載入）',
    'boot.done': '載入完成',
    'boot.failed': '{title} 載入失敗',
    'boot.retry': '重試',
    'boot.preparing': '準備中…',

    // Settings
    'settings.title': '設定',
    'settings.volume': '音量',
    'settings.vibration': '震動',
    'settings.flash': '閃光效果',
    'settings.flashHint': '對閃光敏感可關閉閃電與危機閃爍',
    'settings.cheat': '金手指',
    'settings.cheatPlaceholder': '輸入指令',
    'settings.devOn': '開發人員模式：開啟',
    'settings.devOff': '關閉',
    'settings.devOnToast': '開發人員模式已開啟',
    'settings.devOffToast': '開發人員模式已關閉',
    'settings.badCode': '無效指令',
    'settings.enter': '輸入',
    'settings.done': '完成',

    // Level select
    'levels.title': '選擇關卡',
    'levels.titleGm': '選擇關卡 · GM',
    'levels.hintDev': '開發人員模式：可從任一關開始（不計紀錄）',
    'levels.hintUnlocked': '{round} · 已解鎖到第 {n} 關，墜落就全部重來',
    'levels.hintFresh': '破一關開一關，墜落回 1F 重新上鎖',
    'levels.hintFreshRound': '{round} · 破一關開一關，墜落回 1F 重新上鎖',
    'levels.spireLocked': '尖塔關卡尚未開放',
    'levels.locked': '尚未解鎖：先破第 {n} 關',

    // Climb
    'climb.loadFailed': '載入失敗\n{error}',
    'climb.controls': '方向鍵 / WASD 或拖曳下半部攀爬\n放開 = 抓牢\n拖曳上半部 / Q E 旋轉視角',
    'climb.practiceIntro': '練習模式 · {name}\n風、雨、老鷹各來一次（較溫和）\n不計紀錄\n\n{controls}\n爬上屋頂就完成',
    'climb.hintLadder': '爬梯只能上下，強風時抓牢',
    'climb.hintWall': '可繞到其他面，轉角是危險區',
    'climb.levelIntro': '第 {id} 關 {name}\n{floors}\n\n{controls}\n{hint}',
    'climb.practiceFall': '{cause}\n\n練習不計紀錄\n\n點擊或按空白鍵 再練一次',
    'climb.fall': '{cause}\n\n最高 {floor}F · {time}\n種子 {seed}\n\n點擊或按空白鍵 從 {from}F 再爬一次',
    'climb.practiceDone': '練習完成！\n\n攀爬時間 {time}（不計紀錄）\n\n點擊或按空白鍵 再練一次\n右上「退出」回主畫面 開始挑戰 101',
    'climb.levelDone': '第 {done} 關完成\n\n第 {id} 關 {name}\n{floors}',
    'climb.summitShort': '抵達塔尖！',
    'climb.summitRound': '完成第 {rounds} 周目 · 累計登頂 {summits} 次\n關卡重新上鎖，接下來是第 {next} 周目',
    'climb.summit': '抵達塔尖！\n\n攀爬時間 {time}\n種子 {seed}{round}\n\n點擊或按空白鍵 再玩一次',
    'climb.paused': '暫停中\n\nEsc 或點擊繼續\n右上「退出」回主畫面',
    'climb.risk': '風險',
    'climb.gm': 'GM 開發人員模式',
    'climb.exit': '退出',
    'climb.hudPractice': '練習模式 {name}',
    'climb.hudLevel': '第 {id} 關 {name} {floors}',
    'climb.practiceWait': '天氣還沒示範完\n抓牢等一下再上屋頂',
    'event.wind': '風',
    'event.rain': '雨',
    'event.eagle': '鷹',
    'tip.wind': '強風來了！放開方向鍵抓牢\n亂動會被吹向轉角（危險區）',
    'tip.rain': '下雨了！手會滑\n完全停下，等雨停再爬',
    'tip.eagle': '老鷹來了！完全不要動\n一動就會被牠紅眼盯上撲下來',
    'fall.edge': '太靠邊了…',
    'fall.wind': '風大時要抓牢',
    'fall.rain': '雨天手滑了',
    'fall.eagle': '被老鷹撲下來了',
} as const;

export type TextKey = keyof typeof ZH;

const EN: Record<TextKey, string> = {
    'game.title': 'General Huo Climbs 101',
    'player.name': 'Gen. Huo',
    'common.loading': 'Loading…',
    'common.skip': 'Tap or press any key to skip ▶▶',
    'floors.spire': 'Spire',
    'floors.tip': 'Tip',

    'home.start': 'Start',
    'home.levels': 'Levels',
    'home.practice': 'Practice',
    'home.settings': 'Settings',
    'home.google': 'Sign in',
    'home.googleSoon': 'Google sign-in arrives in M3',
    'home.muted': 'Sound off',
    'home.unmuted': 'Sound on',
    'home.levelWip': 'Level {n} is coming soon',
    'home.practiceWip': 'Practice mode is coming soon',
    'home.levelsLoading': 'Loading levels…',
    'home.levelsFailed': 'levels.json failed to load',
    'home.langName': '中文',
    'home.fullscreen': 'Fullscreen',
    'home.fullscreenIos': 'On iPhone, use Safari Share → Add to Home Screen to play fullscreen',
    'home.fullscreenNo': 'This browser does not support fullscreen',
    'home.fullscreenFail': 'Could not enter fullscreen',
    'home.fullscreenStandalone': 'Already fullscreen (Home Screen app)',

    'best.none': 'Best: none yet',
    'best.summit': 'Best: summit',
    'best.summitTime': 'Best: summit {time}',
    'best.floor': 'Best: {floor}F',
    'round.n': 'Round {n}',
    'round.summits': '{round} · {n} summits',

    'intro.tagline': 'Bare hands, 1F to the tip',

    'boot.config': 'Game settings',
    'boot.configOk': 'levels.json v{version} OK · {n} levels',
    'boot.account': 'Account',
    'boot.guest': 'Guest · {best}',
    'boot.weather': 'Weather',
    'boot.weatherOk': 'Wind / rain / eagle OK, gusts {lo}–{hi}',
    'boot.weatherBad': 'Bad weather settings: {issues}',
    'boot.npc': 'NPCs',
    'boot.npcOk': 'Window NPCs: passers-by, staff, tourists',
    'boot.sound': 'Sound',
    'boot.soundNo': 'This browser has no audio support',
    'boot.soundOk': 'Synth sound · volume {pct}%',
    'boot.soundOkMuted': 'Synth sound · volume {pct}% (muted)',
    'boot.render': 'Scene',
    'boot.renderOk': 'Home and icon ready',
    'boot.renderNoIcon': 'Home ready (icon loads later)',
    'boot.done': 'Ready',
    'boot.failed': '{title} failed to load',
    'boot.retry': 'Retry',
    'boot.preparing': 'Getting ready…',

    'settings.title': 'Settings',
    'settings.volume': 'Volume',
    'settings.vibration': 'Vibration',
    'settings.flash': 'Flashes',
    'settings.flashHint': 'Turn off lightning and crisis flashes if sensitive',
    'settings.cheat': 'Cheats',
    'settings.cheatPlaceholder': 'Code',
    'settings.devOn': 'Developer mode: on',
    'settings.devOff': 'Off',
    'settings.devOnToast': 'Developer mode on',
    'settings.devOffToast': 'Developer mode off',
    'settings.badCode': 'Unknown code',
    'settings.enter': 'Enter',
    'settings.done': 'Done',

    'levels.title': 'Levels',
    'levels.titleGm': 'Levels · GM',
    'levels.hintDev': 'Developer mode: start anywhere (not recorded)',
    'levels.hintUnlocked': '{round} · Unlocked to level {n}, a fall resets all',
    'levels.hintFresh': 'Clear a level to open the next; a fall locks them again',
    'levels.hintFreshRound': '{round} · Clear one to open the next; a fall relocks',
    'levels.spireLocked': 'Spire levels are not open yet',
    'levels.locked': 'Locked: clear level {n} first',

    'climb.loadFailed': 'Failed to load\n{error}',
    'climb.controls': 'Arrows / WASD or drag low half: climb\nLet go = hold on\nDrag top half / Q E: turn view',
    'climb.practiceIntro': 'Practice · {name}\nWind, rain, eagle once each (gentler)\nNot recorded\n\n{controls}\nReach the roof to finish',
    'climb.hintLadder': 'Ladder: up/down only, hold on in gusts',
    'climb.hintWall': 'Go round the faces; corners are deadly',
    'climb.levelIntro': 'Level {id} {name}\n{floors}\n\n{controls}\n{hint}',
    'climb.practiceFall': '{cause}\n\nPractice is not recorded\n\nTap or press Space to practise again',
    'climb.fall': '{cause}\n\nHighest {floor}F · {time}\nSeed {seed}\n\nTap / Space: climb again from {from}F',
    'climb.practiceDone': 'Practice complete!\n\nClimb time {time} (not recorded)\n\nTap or press Space to practise again\n"Exit" at top right to take on the 101',
    'climb.levelDone': 'Level {done} cleared\n\nLevel {id} {name}\n{floors}',
    'climb.summitShort': 'You reached the tip!',
    'climb.summitRound': 'Round {rounds} done · {summits} summits\nLevels lock again; next is round {next}',
    'climb.summit': 'You reached the tip!\n\nClimb time {time}\nSeed {seed}{round}\n\nTap or press Space to play again',
    'climb.paused': 'Paused\n\nEsc or tap to resume\n"Exit" at top right for Home',
    'climb.risk': 'Risk',
    'climb.gm': 'GM developer mode',
    'climb.exit': 'Exit',
    'climb.hudPractice': 'Practice {name}',
    'climb.hudLevel': 'Lv {id} {name} {floors}',
    'climb.practiceWait': 'The weather demo is not done\nHold on, then climb to the roof',
    'event.wind': 'W',
    'event.rain': 'R',
    'event.eagle': 'E',
    'tip.wind': 'Gust! Let go of the keys to hold on\nMoving blows you to a corner (danger)',
    'tip.rain': 'Rain! Your hands slip\nStop completely until it ends',
    'tip.eagle': 'Eagle! Do not move at all\nMove and its red eye spots you',
    'fall.edge': 'Too close to the edge…',
    'fall.wind': 'Hold on when the wind blows',
    'fall.rain': 'Your hands slipped in the rain',
    'fall.eagle': 'The eagle knocked you off',
};

export const CATALOGS: Readonly<Record<Lang, Readonly<Record<TextKey, string>>>> = { 'zh-TW': ZH, en: EN };

/** English names for the level names in levels.json (which stay in Chinese, the source data). */
const LEVEL_NAMES_EN: Readonly<Record<string, string>> = {
    基座下段: 'Base, lower',
    基座中段: 'Base, middle',
    基座上段: 'Base, upper',
    頂部樓層: 'Top floors',
    尖塔下段: 'Spire, lower',
    尖塔上段: 'Spire, upper',
    三層樓平房: 'Three-storey house',
};

export type TextVars = Readonly<Record<string, string | number>>;

/** Fills `{name}` placeholders; unknown placeholders stay as they are. */
export function format(template: string, vars?: TextVars): string {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function translate(lang: Lang, key: TextKey, vars?: TextVars): string {
    return format(CATALOGS[lang][key] ?? ZH[key], vars);
}

/** Level names from levels.json in the given language (「第3節」 → "Section 3"). */
export function translateLevelName(lang: Lang, name: string): string {
    if (lang === 'zh-TW') return name;
    const section = /^第(\d+)節$/.exec(name);
    if (section) return `Section ${section[1]}`;
    return LEVEL_NAMES_EN[name] ?? name;
}

/** The player's language (Settings.lang). */
export function lang(): Lang {
    return settings().get().lang;
}

/** Text in the player's language. */
export function t(key: TextKey, vars?: TextVars): string {
    return translate(lang(), key, vars);
}

export function levelName(name: string): string {
    return translateLevelName(lang(), name);
}

/** The next language in LANGS (the Home toggle). */
export function nextLang(current: Lang): Lang {
    return LANGS[(LANGS.indexOf(current) + 1) % LANGS.length];
}
