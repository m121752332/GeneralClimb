import {
    _decorator, Button, Color, Component, Graphics, Label, Mask, Node, Sprite, SpriteFrame,
    UITransform, Widget, assetManager, director,
} from 'cc';
import { LevelLoader } from '../config/LevelLoader';
import type { LevelConfig } from '../config/LevelConfig';
import {
    type FsDocument, type FsNavigator, fullscreenSupport, isFullscreen, onFullscreenChange, toggleFullscreen,
} from '../core/Fullscreen';
import { GameSession } from '../core/GameSession';
import { lang, nextLang, t } from '../core/I18n';
import { formatBest, readLocalBest } from '../core/LocalBest';
import { formatRound, readProgress, unlockedIndex } from '../core/Progress';
import { applyScreenFit } from '../core/ScreenFit';
import { settings } from '../core/Settings';
import { sound } from '../core/Sound';
import { openLevelSelect } from '../ui/LevelSelectPanel';
import { openSettings } from '../ui/SettingsPanel';
import { playIntro } from '../ui/IntroOverlay';
import { Toast } from '../ui/Toast';
import { STYLE, cachedBrandIcon, hex, loadBrandIcon, makeButton, makeLabel, makeNode, roundRect } from '../ui/UiKit';
import { HomeBackdrop3D } from './HomeBackdrop3D';

const { ccclass } = _decorator;

const CLIMB_SCENE = 'Climb';
const HOME_SCENE = 'Home';
const ICON_SIZE = 144;

/** Main menu (GDD §7): title, start, level select, practice, settings, sign-in, best record. */
@ccclass('Home')
export class Home extends Component {
    private toast!: Toast;
    private config: LevelConfig | null = null;
    private drawSound: (() => void) | null = null;
    private gmBadge: Node | null = null;
    private drawFullscreen: (() => void) | null = null;
    private offFullscreen: (() => void) | null = null;

    onLoad(): void {
        (globalThis as { __GC_SCENE?: string }).__GC_SCENE = 'Home';
        GameSession.devMode = settings().get().devMode;
    }

    start(): void {
        applyScreenFit();
        HomeBackdrop3D.mount(this.node);
        this.buildTitle();
        this.buildMenu();
        this.buildCorners();
        this.buildTopBar();
        this.toast = new Toast(this.node);
        this.syncDevMode();
        sound().music('home');
        if (!GameSession.introPlayed) {
            // GDD §7: the 3 s opening plays once per visit, on top of the finished menu.
            GameSession.introPlayed = true;
            // tools/smoke-site.mjs checks that the opening ran and handed over to the menu.
            const g = globalThis as { __GC_SCENE?: string; __GC_INTRO?: string };
            g.__GC_SCENE = 'Intro';
            g.__GC_INTRO = 'playing';
            playIntro(this.node, () => {
                g.__GC_SCENE = 'Home';
                g.__GC_INTRO = 'done';
            });
        }

        LevelLoader.load().then((cfg) => {
            this.config = cfg;
            this.version.string = `levels.json v${cfg.version}`;
        }).catch((err: unknown) => {
            console.error(err);
            this.version.string = t('home.levelsFailed');
            this.versionFailed = true;
            this.version.node.active = true;
        });
    }

    private version!: Label;
    private versionFailed = false;

    private buildTitle(): void {
        const icon = makeNode('Icon', this.node, ICON_SIZE, ICON_SIZE, 0, 520);
        const frame = icon.addComponent(Graphics);
        roundRect(frame, ICON_SIZE + 12, ICON_SIZE + 12, 30, hex('#fff1c2'), hex('#ff5a3c'), 4);
        const clip = makeNode('Clip', icon, ICON_SIZE, ICON_SIZE);
        const mask = clip.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_STENCIL;
        const shape = clip.getComponent(Graphics)!;
        shape.roundRect(-ICON_SIZE / 2, -ICON_SIZE / 2, ICON_SIZE, ICON_SIZE, 24);
        shape.fill();
        const art = makeNode('Art', clip, ICON_SIZE, ICON_SIZE);
        const show = (sf: SpriteFrame): void => {
            if (!art.isValid) return;
            const sprite = art.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.spriteFrame = sf;
            art.getComponent(UITransform)!.setContentSize(ICON_SIZE, ICON_SIZE);
        };
        // Boot preloads the logo, so it is normally drawn on the first frame instead of popping in.
        const cached = cachedBrandIcon();
        if (cached) show(cached);
        else loadBrandIcon().then(show).catch((err: unknown) => console.warn('GCR icon not loaded', err));

        makeLabel(this.node, t('game.title'), lang() === 'en' ? 54 : 68, Color.WHITE, {
            y: 375, bold: true, outline: hex('#2a0d3a'), outlineWidth: 5, shadow: hex('#ff5a3c', 200),
        });
        makeLabel(this.node, 'GENERAL CLIMB · GCR', 26, hex('#ffc94a'), {
            y: 305, bold: true, outline: hex('#2a0d3a'), outlineWidth: 2,
        });
    }

    private buildMenu(): void {
        const best = makeNode('Best', this.node, 0, 0, 0, 0);
        const bestBg = best.addComponent(Graphics);
        roundRect(bestBg, 380, 54, 27, hex('#0b1024', 190), hex('#ffc94a', 160), 2);
        makeLabel(best, formatBest(readLocalBest(this.storage())), 26, hex('#ffe2a0'), { bold: true });
        // 周目 and total summits (core/Progress); the cloud total joins this with Google sign-in (M3).
        makeLabel(this.node, formatRound(readProgress(this.storage())), 24, hex('#c9d3ff'), {
            y: 52, bold: true, outline: hex('#0b1024'), outlineWidth: 2,
        });

        makeButton(this.node, t('home.start'), 460, 112, STYLE.primary, () => this.startGame(0), 0, -110);

        const colX = 158;
        const btnW = 296;
        const btnH = 86;
        makeButton(this.node, t('home.levels'), btnW, btnH, STYLE.secondary, () => this.openLevels(), -colX, -245);
        makeButton(this.node, t('home.practice'), btnW, btnH, STYLE.secondary, () => this.startPractice(), colX, -245);
        makeButton(this.node, t('home.settings'), btnW, btnH, STYLE.secondary, () => openSettings(this.node, {
            onChange: () => {
                this.drawSound?.();
                this.syncDevMode();
            },
            toast: (text) => this.toast.show(text),
            onClose: () => this.toast.hide(),
        }), -colX, -345);
        const google = makeButton(this.node, t('home.google'), btnW, btnH, STYLE.light, () => this.toast.show(t('home.googleSoon')), colX, -345);
        google.label.node.setPosition(18, 3);
        const g = makeNode('G', google.node, 0, 0, -btnW / 2 + 40, 3).addComponent(Graphics);
        g.circle(0, 0, 20);
        g.fillColor = Color.WHITE;
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = hex('#d0d4e4');
        g.stroke();
        makeLabel(g.node, 'G', 26, hex('#4285f4'), { bold: true, y: 1 });
    }

    private buildCorners(): void {
        // Sound on / off, pinned to the visible top-right corner.
        const size = 76;
        const soundBtn = makeNode('Sound', this.node, size, size);
        const w = soundBtn.addComponent(Widget);
        w.isAlignTop = true;
        w.isAlignRight = true;
        w.top = 24;
        w.right = 24;
        const g = soundBtn.addComponent(Graphics);
        this.drawSound = (): void => {
            const muted = settings().get().muted;
            g.clear();
            roundRect(g, size, size, size / 2, hex('#0b1024', 200), hex('#8fa6ff', 200), 2);
            g.fillColor = Color.WHITE;
            g.moveTo(-20, -8); g.lineTo(-10, -8); g.lineTo(4, -20); g.lineTo(4, 20); g.lineTo(-10, 8); g.lineTo(-20, 8);
            g.close();
            g.fill();
            g.lineWidth = 4;
            if (muted) {
                g.strokeColor = hex('#ff6a5a');
                g.moveTo(12, -10); g.lineTo(26, 10);
                g.moveTo(26, -10); g.lineTo(12, 10);
                g.stroke();
            } else {
                g.strokeColor = Color.WHITE;
                g.arc(4, 0, 14, -Math.PI / 4, Math.PI / 4, true);
                g.stroke();
                g.arc(4, 0, 24, -Math.PI / 4, Math.PI / 4, true);
                g.stroke();
            }
        };
        this.drawSound();
        const btn = soundBtn.addComponent(Button);
        btn.target = soundBtn;
        btn.transition = Button.Transition.SCALE;
        btn.zoomScale = 0.9;
        soundBtn.on(Button.EventType.CLICK, () => {
            const muted = settings().set({ muted: !settings().get().muted }).muted;
            this.drawSound?.();
            sound().applyVolume();
            if (!muted) sound().play('click');
            this.toast.show(t(muted ? 'home.muted' : 'home.unmuted'), 1);
        });

        // "GM" badge while developer mode (金手指) is on, pinned to the visible top-left corner.
        const gm = makeNode('GmBadge', this.node, 96, 52);
        const gw = gm.addComponent(Widget);
        gw.isAlignTop = true;
        gw.isAlignLeft = true;
        gw.top = 36;
        gw.left = 24;
        roundRect(gm.addComponent(Graphics), 96, 52, 26, hex('#ffc94a'), hex('#fff1c2'), 3);
        makeLabel(gm, 'GM', 30, hex('#3a2400'), { bold: true, y: 1 });
        gm.active = false;
        this.gmBadge = gm;

        // Version, pinned to the visible bottom-right corner.
        const ver = makeNode('Version', this.node, 320, 40);
        const vw = ver.addComponent(Widget);
        vw.isAlignBottom = true;
        vw.isAlignRight = true;
        // Above the place caption (HomeBackdrop3D).
        vw.bottom = 72;
        vw.right = 20;
        this.version = makeLabel(ver, 'levels.json …', 22, hex('#e8ecff', 220), { outline: hex('#0b1024'), outlineWidth: 2 });
        this.version.node.getComponent(UITransform)!.setAnchorPoint(1, 0.5);
        this.version.node.setPosition(160, 0);
    }

    /**
     * Top bar pill, left of the sound button: 🌐 中文 / EN (language, saved in Settings.lang) and
     * the fullscreen toggle. Switching language reloads Home so every label is rebuilt.
     */
    private buildTopBar(): void {
        const h = 64;
        const langW = 210;
        const en = lang() === 'en';
        const fsW = en ? 190 : 150;
        const w = langW + fsW;
        const bar = makeNode('TopBar', this.node, w, h);
        const bw = bar.addComponent(Widget);
        bw.isAlignTop = true;
        bw.isAlignRight = true;
        bw.top = 30;
        bw.right = 24 + 76 + 14; // sound button width + gap
        const bg = bar.addComponent(Graphics);
        roundRect(bg, w, h, h / 2, hex('#0b1024', 200), hex('#8fa6ff', 200), 2);
        bg.rect(-w / 2 + langW - 1, -h / 2 + 14, 2, h - 28);
        bg.fillColor = hex('#8fa6ff', 140);
        bg.fill();

        const segment = (name: string, x: number, sw: number, onClick: () => void): Node => {
            const node = makeNode(name, bar, sw, h, x, 0);
            const btn = node.addComponent(Button);
            btn.target = node;
            btn.transition = Button.Transition.SCALE;
            btn.zoomScale = 0.94;
            node.on(Button.EventType.CLICK, () => {
                sound().play('click');
                onClick();
            });
            return node;
        };

        // Language: globe icon, then 中文 / EN with the current one highlighted.
        const ln = segment('Lang', -w / 2 + langW / 2, langW, () => this.switchLanguage());
        const globe = makeNode('Globe', ln, 0, 0, -langW / 2 + 30, 0).addComponent(Graphics);
        globe.lineWidth = 3;
        globe.strokeColor = Color.WHITE;
        globe.circle(0, 0, 15);
        globe.stroke();
        globe.ellipse(0, 0, 6.5, 15);
        globe.stroke();
        globe.moveTo(-15, 0); globe.lineTo(15, 0);
        globe.stroke();
        const cur = lang();
        const on = hex('#ffc94a');
        const off = hex('#9aa6d8');
        makeLabel(ln, t('home.langName'), 26, cur === 'zh-TW' ? on : off, { x: -8, y: 1, bold: cur === 'zh-TW' });
        makeLabel(ln, '/', 24, off, { x: 30, y: 1 });
        makeLabel(ln, 'EN', 26, cur === 'en' ? on : off, { x: 60, y: 1, bold: cur === 'en' });

        // Fullscreen: four corners, pointing out (enter) or in (leave).
        const fs = segment('Fullscreen', w / 2 - fsW / 2, fsW, () => this.toggleFullscreen());
        const icon = makeNode('FsIcon', fs, 0, 0, -fsW / 2 + 30, 0).addComponent(Graphics);
        const fsLabel = makeLabel(fs, t('home.fullscreen'), 24, Color.WHITE, { x: en ? 26 : 18, y: 1, bold: true });
        this.drawFullscreen = (): void => {
            const active = isFullscreen(this.doc());
            const c = active ? on : Color.WHITE;
            icon.clear();
            icon.lineWidth = 3.5;
            icon.strokeColor = c;
            const a = 13;
            const b = 6;
            for (const [sx, sy] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
                // Corner at (sx*a, sy*a); arms point toward the centre when leaving fullscreen.
                const cx = active ? sx * (a - b) : sx * a;
                const cy = active ? sy * (a - b) : sy * a;
                const dx = active ? sx * b : -sx * b;
                const dy = active ? sy * b : -sy * b;
                icon.moveTo(cx + dx, cy);
                icon.lineTo(cx, cy);
                icon.lineTo(cx, cy + dy);
                icon.stroke();
            }
            fsLabel.color = c;
        };
        this.drawFullscreen();
        const doc = this.doc();
        if (doc) this.offFullscreen = onFullscreenChange(doc, () => this.drawFullscreen?.());
    }

    onDestroy(): void {
        this.offFullscreen?.();
        this.offFullscreen = null;
    }

    private doc(): FsDocument | undefined {
        return (globalThis as { document?: FsDocument }).document;
    }

    private switchLanguage(): void {
        settings().set({ lang: nextLang(lang()) });
        // Every label on Home is built from t(); rebuilding the scene is the simplest full refresh.
        // The opening does not replay (GameSession.introPlayed) and the home music keeps playing.
        director.loadScene(HOME_SCENE);
    }

    private toggleFullscreen(): void {
        const g = globalThis as { document?: FsDocument; navigator?: FsNavigator; matchMedia?: (q: string) => { matches: boolean } };
        let displayStandalone = false;
        try {
            displayStandalone = !!g.matchMedia?.('(display-mode: standalone)').matches;
        } catch {
            displayStandalone = false;
        }
        const support = fullscreenSupport(g.document, g.navigator, displayStandalone);
        if (support === 'standalone') {
            this.toast.show(t('home.fullscreenStandalone'));
            return;
        }
        if (support === 'ios') {
            this.toast.show(t('home.fullscreenIos'), 3);
            return;
        }
        if (support === 'none' || !g.document) {
            this.toast.show(t('home.fullscreenNo'));
            return;
        }
        toggleFullscreen(g.document).then(() => this.drawFullscreen?.()).catch((err: unknown) => {
            console.warn('fullscreen refused', err);
            this.toast.show(t('home.fullscreenFail'));
        });
    }

    /**
     * Settings.devMode is the source of truth; mirror it into GameSession, the GM badge and the
     * levels.json version tag (a debug hint, so players only see it if loading failed).
     */
    private syncDevMode(): void {
        const on = settings().get().devMode;
        GameSession.devMode = on;
        if (this.gmBadge) this.gmBadge.active = on;
        if (this.version && !this.versionFailed) this.version.node.active = on;
    }

    private startGame(levelIndex = 0): void {
        GameSession.levelIndex = levelIndex;
        GameSession.mode = 'normal';
        GameSession.pushIn = true;
        if (assetManager.main?.getSceneInfo(CLIMB_SCENE)) {
            director.loadScene(CLIMB_SCENE);
        } else {
            this.toast.show(t('home.levelWip', { n: levelIndex + 1 }));
        }
    }

    /** Practice (GDD §7): the three-storey house in the Climb scene; nothing is recorded. */
    private startPractice(): void {
        GameSession.levelIndex = 0;
        GameSession.mode = 'practice';
        // The push-in to the 101's base belongs to the real climb, not the practice house.
        GameSession.pushIn = false;
        if (assetManager.main?.getSceneInfo(CLIMB_SCENE)) {
            director.loadScene(CLIMB_SCENE);
        } else {
            GameSession.mode = 'normal';
            this.toast.show(t('home.practiceWip'));
        }
    }

    private openLevels(): void {
        if (!this.config) {
            this.toast.show(t('home.levelsLoading'));
            return;
        }
        const progress = readProgress(this.storage());
        openLevelSelect(
            this.node, this.config, GameSession.devMode, (i) => this.startGame(i), (msg) => this.toast.show(msg), () => this.toast.hide(),
            unlockedIndex(progress, this.config.levels.length), formatRound(progress),
        );
    }

    private storage(): Storage | null {
        try {
            return globalThis.localStorage ?? null;
        } catch {
            return null;
        }
    }
}
