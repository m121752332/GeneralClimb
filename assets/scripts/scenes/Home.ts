import {
    _decorator, Button, Color, Component, Graphics, Label, Mask, Node, Sprite, SpriteFrame,
    UITransform, Widget, assetManager, director, view,
} from 'cc';
import { LevelLoader } from '../config/LevelLoader';
import type { LevelConfig } from '../config/LevelConfig';
import {
    type FsDocument, type FsNavigator, fullscreenSupport, isFullscreen, onFullscreenChange, toggleFullscreen,
} from '../core/Fullscreen';
import { auth } from '../core/AuthService';
import { formatCloudCount } from '../core/CloudSummit';
import { GameSession } from '../core/GameSession';
import { lang, nextLang, t } from '../core/I18n';
import { formatBest, readLocalBest } from '../core/LocalBest';
import { formatRound, readProgress, unlockedIndex } from '../core/Progress';
import { applyScreenFit } from '../core/ScreenFit';
import { settings } from '../core/Settings';
import { sound } from '../core/Sound';
import { openAccountPanel } from '../ui/AccountPanel';
import { openLeaderboard } from '../ui/LeaderboardPanel';
import { openLevelSelect } from '../ui/LevelSelectPanel';
import { openSettings } from '../ui/SettingsPanel';
import { playIntro } from '../ui/IntroOverlay';
import { Toast } from '../ui/Toast';
import { STYLE, cachedBrandIcon, drawButton, hex, loadBrandIcon, makeLabel, makeNode, roundRect } from '../ui/UiKit';
import { HomeBackdrop3D } from './HomeBackdrop3D';

const { ccclass } = _decorator;

const CLIMB_SCENE = 'Climb';
const HOME_SCENE = 'Home';
const ICON_SIZE = 104;
/** Gap to the visible screen edge on portrait (tall) and landscape (wide) screens. */
const EDGE_TALL = 24;
const EDGE_WIDE = 48;
const MENU_W = 460;
const CHIP_W = 310;
const TIP_W = 660;
/** Landscape letterbox bars (design px); portrait keeps only the bottom one. */
const BAR_TOP = 96;
const BAR_BOTTOM = 72;
/** Wider than any visible width, so the bars run edge to edge. */
const BAR_SPAN = 8000;

/** Widget offsets from the visible edges; an edge left out is not aligned. */
interface Dock {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
    centerX?: boolean;
}

function applyDock(w: Widget, d: Dock): void {
    w.isAlignTop = d.top !== undefined;
    w.top = d.top ?? 0;
    w.isAlignBottom = d.bottom !== undefined;
    w.bottom = d.bottom ?? 0;
    w.isAlignLeft = d.left !== undefined;
    w.left = d.left ?? 0;
    w.isAlignRight = d.right !== undefined;
    w.right = d.right ?? 0;
    w.isAlignHorizontalCenter = !!d.centerX;
    w.horizontalCenter = 0;
    w.updateAlignment();
}

function leftAlign(label: Label, x: number): Label {
    label.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    label.node.setPosition(x, label.node.position.y);
    return label;
}

/**
 * Main menu (GDD §7): logo and title top-left, the menu column on the left (start, level select,
 * practice, leaderboard, settings, best record), language / fullscreen pill, account chip and sound
 * top-right, a tip and the place caption along the bottom; the 3D 101 stands right of the menu.
 */
@ccclass('Home')
export class Home extends Component {
    private toast!: Toast;
    private config: LevelConfig | null = null;
    private drawSound: (() => void) | null = null;
    private gmBadge: Node | null = null;
    private drawFullscreen: (() => void) | null = null;
    private offFullscreen: (() => void) | null = null;
    private roundLabel: Label | null = null;
    private offAuth: (() => void) | null = null;

    onLoad(): void {
        (globalThis as { __GC_SCENE?: string }).__GC_SCENE = 'Home';
        GameSession.devMode = settings().get().devMode;
    }

    start(): void {
        applyScreenFit();
        const caption = HomeBackdrop3D.mount(this.node);
        this.buildBars(caption);
        this.buildTitle();
        this.buildMenu();
        this.buildCorners();
        this.buildTopBar();
        this.buildAccountChip();
        this.buildBottom(caption);
        this.relayout();
        view.on('canvas-resize', this.onResize);
        view.on('design-resolution-changed', this.onResize);
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

        // Cloud (ADR-09): refresh the sign-in button and the cloud count, and push this device's
        // unsynced summits whenever a player is signed in.
        this.offAuth = auth().onChange(() => this.syncAccount());
        this.syncAccount();

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

    private lastUid: string | null = null;

    private syncAccount(): void {
        const svc = auth();
        const uid = svc.user?.uid ?? null;
        if (uid && uid !== this.lastUid) void svc.syncSummits(this.storage());
        this.lastUid = uid;
        this.drawChip?.();
        if (this.roundLabel?.isValid) {
            const cloud = svc.user ? formatCloudCount(svc.cloudCount) : '';
            this.roundLabel.string = formatRound(readProgress(this.storage())) + (cloud ? ` · ${cloud}` : '');
        }
    }

    private onGoogle(): void {
        const svc = auth();
        if (svc.user) {
            openAccountPanel(this.node, { storage: this.storage(), toast: (t) => this.toast.show(t), onClose: () => this.toast.hide() });
            return;
        }
        // signInWithPopup must start inside this click (ADR-09), so nothing async runs before it.
        void svc.signIn().then((text) => this.toast.show(text));
    }

    private version!: Label;
    private versionFailed = false;
    /** Widgets whose offsets differ between portrait (tall) and landscape (wide) screens. */
    private readonly docked: { widget: Widget; tall: Dock; wide: Dock }[] = [];
    private layoutWide: boolean | null = null;
    private tipLabel: Label | null = null;
    private drawChip: (() => void) | null = null;
    private bars: { node: Node; g: Graphics; tall: number; wide: number }[] = [];

    /** Pins `node` to the visible edges; relayout() switches between the tall and wide offsets. */
    private dock(node: Node, tall: Dock, wide: Dock): void {
        const widget = node.getComponent(Widget) ?? node.addComponent(Widget);
        this.docked.push({ widget, tall, wide });
    }

    private readonly onResize = (): void => {
        this.scheduleOnce(() => this.relayout(), 0);
    };

    /** Portrait: everything stacks down the left; landscape: title and menu on the left, 101 on the right. */
    private relayout(): void {
        const size = view.getVisibleSize();
        const wide = size.width > size.height;
        if (wide === this.layoutWide) return;
        this.layoutWide = wide;
        for (const b of this.bars) {
            const h = wide ? b.wide : b.tall;
            b.node.active = h > 0;
            b.node.getComponent(UITransform)!.setContentSize(BAR_SPAN, h);
            b.g.clear();
            b.g.rect(-BAR_SPAN / 2, -h / 2, BAR_SPAN, h);
            b.g.fillColor = hex('#06060b', 238);
            b.g.fill();
        }
        for (const d of this.docked) applyDock(d.widget, wide ? d.wide : d.tall);
        if (this.tipLabel) this.tipLabel.horizontalAlign = wide ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.CENTER;
    }

    /**
     * Letterbox bars: a dark strip along the top (behind the language pill, account chip and sound
     * button) and the bottom (behind the tip and the place caption). Landscape only at the top, so the
     * portrait screen keeps the spire; drawn under the caption, over the 3D backdrop.
     */
    private buildBars(caption: Node): void {
        const make = (name: string, tall: number, wide: number, edge: Dock): void => {
            const node = makeNode(name, this.node, BAR_SPAN, 0);
            node.setSiblingIndex(caption.getSiblingIndex());
            this.bars.push({ node, g: node.addComponent(Graphics), tall, wide });
            this.dock(node, { ...edge, centerX: true }, { ...edge, centerX: true });
        };
        make('TopBar', 0, BAR_TOP, { top: 0 });
        make('BottomBar', 118, BAR_BOTTOM, { bottom: 0 });
    }

    /** Top-left: the GCR logo, then the title and the GENERAL CLIMB line beside it (landscape) or under it (portrait). */
    private buildTitle(): void {
        const icon = makeNode('Icon', this.node, ICON_SIZE + 12, ICON_SIZE + 12);
        this.dock(icon, { left: EDGE_TALL, top: 22 }, { left: EDGE_WIDE, top: BAR_TOP + 22 });
        const frame = icon.addComponent(Graphics);
        roundRect(frame, ICON_SIZE + 12, ICON_SIZE + 12, 24, hex('#fff1c2'), hex('#ff5a3c'), 4);
        const clip = makeNode('Clip', icon, ICON_SIZE, ICON_SIZE);
        const mask = clip.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_STENCIL;
        const shape = clip.getComponent(Graphics)!;
        shape.roundRect(-ICON_SIZE / 2, -ICON_SIZE / 2, ICON_SIZE, ICON_SIZE, 18);
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

        const title = makeNode('Title', this.node, 640, 120);
        title.getComponent(UITransform)!.setAnchorPoint(0, 1);
        this.dock(title, { left: EDGE_TALL, top: 186 }, { left: EDGE_WIDE + ICON_SIZE + 36, top: BAR_TOP + 26 });
        leftAlign(makeLabel(title, t('game.title'), lang() === 'en' ? 46 : 60, Color.WHITE, {
            y: -40, bold: true, outline: hex('#2a0d3a'), outlineWidth: 5, shadow: hex('#ff5a3c', 200),
        }), 0);
        leftAlign(makeLabel(title, 'GENERAL CLIMB · GCR', 24, hex('#ffc94a'), {
            y: -98, bold: true, outline: hex('#2a0d3a'), outlineWidth: 2,
        }), 0);

        // "GM" badge while developer mode (金手指) is on, after the GENERAL CLIMB line.
        const gm = makeNode('GmBadge', title, 76, 40, 350, -98);
        roundRect(gm.addComponent(Graphics), 76, 40, 20, hex('#ffc94a'), hex('#fff1c2'), 3);
        makeLabel(gm, 'GM', 24, hex('#3a2400'), { bold: true, y: 1 });
        gm.active = false;
        this.gmBadge = gm;
    }

    /**
     * Left menu column: one dark panel of stacked items (label + small subtitle), 開始遊戲 highlighted
     * on top, then 周目 and the best record at the bottom.
     */
    private buildMenu(): void {
        const pad = 18;
        const gap = 10;
        const startH = 112;
        const itemH = 92;
        const statsH = 104;
        const w = MENU_W;
        const h = pad + startH + 4 * (itemH + gap) + gap + statsH + pad;
        const menu = makeNode('Menu', this.node, w, h);
        this.dock(menu, { left: EDGE_TALL, top: 320 }, { left: EDGE_WIDE, top: BAR_TOP + 186 });
        roundRect(menu.addComponent(Graphics), w, h, 26, hex('#0b1024', 205), hex('#8fa6ff', 120), 2);

        let y = h / 2 - pad;
        const add = (label: string, sub: string, ih: number, primary: boolean, onClick: () => void): void => {
            this.menuItem(menu, label, sub, w - 2 * pad, ih, primary, onClick, y - ih / 2);
            y -= ih + gap;
        };
        add(t('home.start'), t('home.startSub'), startH, true, () => this.startGame(0));
        add(t('home.levels'), t('home.levelsSub'), itemH, false, () => this.openLevels());
        add(t('home.practice'), t('home.practiceSub'), itemH, false, () => this.startPractice());
        add(t('home.leaderboard'), t('home.leaderboardSub'), itemH, false, () => openLeaderboard(
            this.node, this.config?.cloud.leaderboardSize ?? 20, () => this.toast.hide(),
        ));
        add(t('home.settings'), t('home.settingsSub'), itemH, false, () => openSettings(this.node, {
            onChange: () => {
                this.drawSound?.();
                this.syncDevMode();
            },
            toast: (text) => this.toast.show(text),
            onClose: () => this.toast.hide(),
        }));

        // 周目 and total summits (core/Progress); syncAccount adds the cloud total when signed in.
        y -= gap;
        this.roundLabel = makeLabel(menu, formatRound(readProgress(this.storage())), 24, hex('#c9d3ff'), {
            y: y - 20, bold: true,
        });
        const best = makeNode('Best', menu, w - 2 * pad, 50, 0, y - 70);
        roundRect(best.addComponent(Graphics), w - 2 * pad, 50, 25, hex('#141a36', 230), hex('#ffc94a', 160), 2);
        makeLabel(best, formatBest(readLocalBest(this.storage())), 24, hex('#ffe2a0'), { bold: true });
    }

    private menuItem(parent: Node, label: string, sub: string, w: number, h: number, primary: boolean, onClick: () => void, y: number): void {
        const node = makeNode(`Item ${label}`, parent, w, h, 0, y);
        const g = node.addComponent(Graphics);
        if (primary) {
            drawButton(g, w, h, { ...STYLE.primary, radius: 20 });
        } else {
            roundRect(g, w, h, 18, hex('#1a2350', 230), hex('#8fa6ff', 90), 2);
            g.roundRect(-w / 2 + 12, -h / 2 + 22, 6, h - 44, 3);
            g.fillColor = hex('#8fa6ff', 200);
            g.fill();
        }
        const x0 = -w / 2 + (primary ? 30 : 34);
        leftAlign(makeLabel(node, label, primary ? 40 : 32, Color.WHITE, {
            bold: true, y: primary ? 16 : 13, outline: primary ? hex('#7a1a10') : undefined, outlineWidth: 3,
        }), x0);
        leftAlign(makeLabel(node, sub, primary ? 20 : 18, primary ? hex('#ffe2d0') : hex('#9aa6d8'), {
            bold: true, y: primary ? -26 : -22,
        }), x0);
        makeLabel(node, '›', 48, primary ? Color.WHITE : hex('#8fa6ff'), { x: w / 2 - 32, y: primary ? 6 : 4, bold: true });
        const button = node.addComponent(Button);
        button.target = node;
        button.transition = Button.Transition.SCALE;
        button.zoomScale = 0.96;
        button.duration = 0.08;
        node.on(Button.EventType.CLICK, () => {
            sound().play('click');
            onClick();
        });
    }

    private buildCorners(): void {
        // Sound on / off, pinned to the visible top-right corner.
        const size = 76;
        const soundBtn = makeNode('Sound', this.node, size, size);
        this.dock(soundBtn, { top: 24, right: 24 }, { top: 10, right: 24 });
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

        // Version, bottom-right above the place caption (HomeBackdrop3D) and, on portrait, the tip line.
        const ver = makeNode('Version', this.node, 320, 40);
        this.dock(ver, { bottom: 128, right: 20 }, { bottom: BAR_BOTTOM + 8, right: EDGE_TALL });
        this.version = makeLabel(ver, 'levels.json …', 22, hex('#e8ecff', 220), { outline: hex('#0b1024'), outlineWidth: 2 });
        this.version.node.getComponent(UITransform)!.setAnchorPoint(1, 0.5);
        this.version.node.setPosition(160, 0);
    }

    /** Bottom bar: a play tip (bottom-left on landscape, centred above the caption on portrait) and the place caption. */
    private buildBottom(caption: Node): void {
        this.dock(caption, { bottom: 14, centerX: true }, { bottom: 12, right: EDGE_TALL });
        const box = makeNode('Tip', this.node, TIP_W, 36);
        this.dock(box, { bottom: 76, centerX: true }, { bottom: 18, left: EDGE_WIDE });
        const tip = makeLabel(box, t('home.tip'), 20, hex('#f6dccf', 235), { outline: hex('#2a1a2e', 200), outlineWidth: 2 });
        tip.overflow = Label.Overflow.SHRINK;
        tip.node.getComponent(UITransform)!.setContentSize(TIP_W, 36);
        tip.verticalAlign = Label.VerticalAlign.CENTER;
        this.tipLabel = tip;
    }

    /**
     * Account chip, right of the language pill (landscape) or under it (portrait): Google sign-in
     * when signed out, avatar + 雲端存檔已開啟 + e-mail when signed in (opens the account panel).
     */
    private buildAccountChip(): void {
        const w = CHIP_W;
        const h = 64;
        const chip = makeNode('Account', this.node, w, h);
        this.dock(chip, { top: 108, right: 24 }, { top: 16, right: 24 + 76 + 14 });
        const g = chip.addComponent(Graphics);
        const avatar = makeNode('Avatar', chip, 44, 44, -w / 2 + 36, 0);
        const ag = avatar.addComponent(Graphics);
        const initial = makeLabel(avatar, '', 24, Color.WHITE, { bold: true, y: 1 });
        const line = (size: number, color: Color, y: number, bold: boolean): Label => {
            const l = leftAlign(makeLabel(chip, '', size, color, { y, bold }), -w / 2 + 68);
            l.overflow = Label.Overflow.SHRINK;
            l.horizontalAlign = Label.HorizontalAlign.LEFT;
            l.verticalAlign = Label.VerticalAlign.CENTER;
            l.node.getComponent(UITransform)!.setContentSize(w - 86, size + 8);
            return l;
        };
        const line1 = line(22, Color.WHITE, 12, true);
        const line2 = line(17, hex('#c9d3ff'), -14, false);
        this.drawChip = (): void => {
            if (!chip.isValid) return;
            const user = auth().user;
            g.clear();
            roundRect(g, w, h, h / 2, hex('#0b1024', 200), user ? hex('#5fe39a', 200) : hex('#8fa6ff', 200), 2);
            ag.clear();
            ag.circle(0, 0, 22);
            ag.fillColor = user ? hex('#ff5a3c') : Color.WHITE;
            ag.fill();
            if (!user) {
                ag.lineWidth = 2;
                ag.strokeColor = hex('#d0d4e4');
                ag.stroke();
            }
            initial.string = user ? (Array.from(user.name)[0] ?? '霍') : 'G';
            initial.color = user ? Color.WHITE : hex('#4285f4');
            line1.string = user ? t('home.cloudOn') : t('home.google');
            line1.color = user ? hex('#7dffb0') : Color.WHITE;
            line2.string = user ? (user.email || user.name) : t('home.signInSub');
        };
        this.drawChip();
        const btn = chip.addComponent(Button);
        btn.target = chip;
        btn.transition = Button.Transition.SCALE;
        btn.zoomScale = 0.94;
        chip.on(Button.EventType.CLICK, () => {
            sound().play('click');
            this.onGoogle();
        });
    }

    /**
     * Top bar pill: 🌐 中文 / EN (language, saved in Settings.lang) and the fullscreen toggle; left
     * of the account chip on landscape, left of the sound button on portrait. Switching language
     * reloads Home so every label is rebuilt.
     */
    private buildTopBar(): void {
        const h = 64;
        const langW = 210;
        const en = lang() === 'en';
        const fsW = en ? 190 : 150;
        const w = langW + fsW;
        const bar = makeNode('TopBar', this.node, w, h);
        this.dock(bar, { top: 30, right: 24 + 76 + 14 }, { top: 16, right: 24 + 76 + 14 + CHIP_W + 14 });
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
        view.off('canvas-resize', this.onResize);
        view.off('design-resolution-changed', this.onResize);
        this.offFullscreen?.();
        this.offFullscreen = null;
        this.offAuth?.();
        this.offAuth = null;
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
