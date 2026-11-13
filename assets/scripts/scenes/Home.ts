import {
    _decorator, Button, Color, Component, Graphics, Label, Mask, Node, Sprite, SpriteFrame, Texture2D,
    UITransform, Widget, assetManager, director, resources,
} from 'cc';
import { LevelLoader } from '../config/LevelLoader';
import type { LevelConfig } from '../config/LevelConfig';
import { GameSession } from '../core/GameSession';
import { formatBest, readLocalBest } from '../core/LocalBest';
import { applyScreenFit } from '../core/ScreenFit';
import { settings } from '../core/Settings';
import { openLevelSelect } from '../ui/LevelSelectPanel';
import { openSettings } from '../ui/SettingsPanel';
import { Toast } from '../ui/Toast';
import { STYLE, hex, makeButton, makeLabel, makeNode, roundRect } from '../ui/UiKit';
import { buildBackdrop } from './HomeBackdrop';

const { ccclass } = _decorator;

const CLIMB_SCENE = 'Climb';
const ICON_PATH = 'branding/gcr-icon/spriteFrame';
const ICON_SIZE = 144;

/** Main menu (GDD §7): title, start, level select, practice, settings, sign-in, best record. */
@ccclass('Home')
export class Home extends Component {
    private toast!: Toast;
    private config: LevelConfig | null = null;
    private drawSound: (() => void) | null = null;
    private gmBadge: Node | null = null;

    onLoad(): void {
        (globalThis as { __GC_SCENE?: string }).__GC_SCENE = 'Home';
        GameSession.devMode = settings().get().devMode;
    }

    start(): void {
        applyScreenFit();
        buildBackdrop(this.node);
        this.buildTitle();
        this.buildMenu();
        this.buildCorners();
        this.toast = new Toast(this.node);
        this.syncDevMode();

        LevelLoader.load().then((cfg) => {
            this.config = cfg;
            this.version.string = `levels.json v${cfg.version}`;
        }).catch((err: unknown) => {
            console.error(err);
            this.version.string = 'levels.json 載入失敗';
        });
    }

    private version!: Label;

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
        resources.load(ICON_PATH, SpriteFrame, (err, sf) => {
            if (err || !art.isValid) {
                if (err) console.warn('GCR icon not loaded', err);
                return;
            }
            // ADR / Agents.md: imported pixel art uses Nearest filtering.
            sf.texture.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
            const sprite = art.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.spriteFrame = sf;
            art.getComponent(UITransform)!.setContentSize(ICON_SIZE, ICON_SIZE);
        });

        makeLabel(this.node, '霍將軍爬101大樓', 68, Color.WHITE, {
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

        makeButton(this.node, '開始遊戲', 460, 112, STYLE.primary, () => this.startGame(0), 0, -110);

        const colX = 158;
        const btnW = 296;
        const btnH = 86;
        makeButton(this.node, '選擇關卡', btnW, btnH, STYLE.secondary, () => this.openLevels(), -colX, -245);
        makeButton(this.node, '練習模式', btnW, btnH, STYLE.secondary, () => this.toast.show('練習模式即將推出'), colX, -245);
        makeButton(this.node, '設定', btnW, btnH, STYLE.secondary, () => openSettings(this.node, {
            onChange: () => {
                this.drawSound?.();
                this.syncDevMode();
            },
            toast: (text) => this.toast.show(text),
            onClose: () => this.toast.hide(),
        }), -colX, -345);
        const google = makeButton(this.node, 'Google 登入', btnW, btnH, STYLE.light, () => this.toast.show('Google 登入將於 M3 推出'), colX, -345);
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
        const sound = makeNode('Sound', this.node, size, size);
        const w = sound.addComponent(Widget);
        w.isAlignTop = true;
        w.isAlignRight = true;
        w.top = 24;
        w.right = 24;
        const g = sound.addComponent(Graphics);
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
        const btn = sound.addComponent(Button);
        btn.target = sound;
        btn.transition = Button.Transition.SCALE;
        btn.zoomScale = 0.9;
        sound.on(Button.EventType.CLICK, () => {
            const muted = settings().set({ muted: !settings().get().muted }).muted;
            this.drawSound?.();
            this.toast.show(muted ? '已靜音' : '已開啟聲音', 1);
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
        vw.bottom = 16;
        vw.right = 20;
        this.version = makeLabel(ver, 'levels.json …', 22, hex('#e8ecff', 220), { outline: hex('#0b1024'), outlineWidth: 2 });
        this.version.node.getComponent(UITransform)!.setAnchorPoint(1, 0.5);
        this.version.node.setPosition(160, 0);
    }

    /** Settings.devMode is the source of truth; mirror it into GameSession and the GM badge. */
    private syncDevMode(): void {
        const on = settings().get().devMode;
        GameSession.devMode = on;
        if (this.gmBadge) this.gmBadge.active = on;
    }

    private startGame(levelIndex = 0): void {
        GameSession.levelIndex = levelIndex;
        GameSession.mode = 'normal';
        if (assetManager.main?.getSceneInfo(CLIMB_SCENE)) {
            director.loadScene(CLIMB_SCENE);
        } else {
            this.toast.show(`第 ${levelIndex + 1} 關製作中`);
        }
    }

    private openLevels(): void {
        if (!this.config) {
            this.toast.show('關卡資料載入中…');
            return;
        }
        openLevelSelect(this.node, this.config, GameSession.devMode, (i) => this.startGame(i), (msg) => this.toast.show(msg), () => this.toast.hide());
    }

    private storage(): Storage | null {
        try {
            return globalThis.localStorage ?? null;
        } catch {
            return null;
        }
    }
}
