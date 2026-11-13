import {
    _decorator, Camera, Color, Component, director, EventKeyboard, EventMouse, EventTouch, Graphics,
    input, Input, KeyCode, Label, Node, UITransform, Vec2, Vec3, view,
} from 'cc';
import type { LevelConfig } from '../config/LevelConfig';
import { LevelLoader } from '../config/LevelLoader';
import { effectiveSpeed, nextSpeed, speedText } from '../core/ClimbSpeed';
import { GameSession } from '../core/GameSession';
import { settings } from '../core/Settings';
import { sound } from '../core/Sound';
import { applyScreenFit } from '../core/ScreenFit';
import {
    ClimbSim, Dir, FALL_TEXT, NO_DIR, dirFromKeys, dirFromStick, formatClimbTime, randomSeed,
} from '../climb/ClimbCore';
import { ROW_H } from '../climb/TowerShape';
import { ENDING_SEC, Tower3D } from './Tower3D';

const { ccclass } = _decorator;

// Presentation-only constants (rules and tunables live in levels.json).
const STICK_RADIUS = 90;
/** GDD 3: virtual stick dead zone 20 %. */
const STICK_DEAD_ZONE = 0.2;
/** GDD 7: freeze 0.3 s, then fall; the whole fall screen is 2.5 s. */
const FALL_FREEZE_SEC = 0.3;
const FALL_TOTAL_SEC = 2.5;
/** Fall acceleration in world units / s² (3D view). */
const FALL_G = 30;
/** A press that moves less than this (pixels) is a tap, not a view drag. */
const DRAG_SLOP = 8;
/** Mouse events this soon after a touch are the browser's emulation of it; ignore them. */
const TOUCH_MOUSE_GAP_MS = 800;
const PLAYER_NAME = '霍將軍';
/** ADR-02: level-to-level scroll lasts about 1.5 s. */
const TRANSITION_SEC = 1.5;
/** Overlay text sits above the climber so it never covers them. */
const OVERLAY_Y = 230;
const HOME_SCENE = 'Home';
/** Exit button in the top band (left of pause), and the dev speed chip under the event icon. */
const BTN = 68;
const EXIT_W = 112;
const SPEED_W = 96;
const SPEED_TOP = 192;

const C = {
    facade: hex('#1b2836'),
    safe: hex('#3b6f93'),
    safeHi: hex('#5d93b8'),
    danger: hex('#8a3d3d'),
    dangerHi: hex('#b25555'),
    obstacle: hex('#5a5a5a'),
    obstacleMark: hex('#2b2b2b'),
    slab: hex('#0e161f'),
    fallLine: hex('#ff4040'),
    ground: hex('#4a4a52'),
    platform: hex('#c9b27a'),
    text: hex('#f2f2f2'),
    dim: new Color(0, 0, 0, 170),
    riskSafe: hex('#3ccf6a'),
    riskTense: hex('#e6c33a'),
    riskCrisis: hex('#e04040'),
    body: hex('#d62c2c'),
    skin: hex('#f0c090'),
    wind: hex('#7fd8ff'),
    rain: hex('#5b7cff'),
    eagle: hex('#b07a3a'),
};

function hex(s: string): Color {
    return new Color().fromHEX(s);
}

function alpha(c: Color, a: number): Color {
    return new Color(c.r, c.g, c.b, a);
}

type Mode = 'loading' | 'ready' | 'play' | 'paused' | 'transition' | 'falling' | 'fallen' | 'ending' | 'cleared' | 'error';

/** "1–8F", or 尖塔 on the ladder levels. */
function floorsText(l: { floors: string; floorFrom: number | null; floorTo: number | null }): string {
    return l.floorFrom === null ? '尖塔' : `${l.floorFrom}–${l.floorTo}F`;
}

/** Mini map (top right): height in pixels and the panel's half width. */
const MINIMAP_H = 300;
const MINIMAP_HALF_W = 34;

const EVENT_LABEL = { wind: '風', rain: '雨', eagle: '鷹' } as const;

/** Practice mode (GDD §7): what to do when each event comes, shown while it warns and runs. */
const PRACTICE_TIP = {
    wind: '強風來了！放開方向鍵抓牢\n亂動會被吹向轉角（危險區）',
    rain: '下雨了！手會滑\n完全停下，等雨停再爬',
    eagle: '老鷹來了！不要動\n等牠飛走就安全',
} as const;
/** Practice tip sits under the HUD band. */
const TIP_TOP = 250;

/** `?practice=1` in the page URL opens practice mode directly (testing aid, like `?level=`). */
function practiceFromUrl(): boolean {
    try {
        return new URLSearchParams(globalThis.location?.search ?? '').get('practice') === '1';
    } catch {
        return false;
    }
}

/**
 * Climb scene: levels 1–12 in one run (grid climbing, grip on release, risk meter,
 * wind / rain / eagle, pagoda flare, rise between levels, fall back to the start).
 * ADR-10: the tower is 3D and the grid wraps round all four faces; the camera orbits the
 * tower axis (drag the upper half of the screen, mouse drag, or Q / E) and swings back to
 * the climber after a moment. All rules are in ClimbCore; Tower3D draws the world and this
 * component handles input, flow, effects and the 2D HUD.
 * Dev aid: `?level=6` in the page URL starts the run at that level (ADR-06 runs start at 1).
 */
@ccclass('Climb')
export class Climb extends Component {
    /** Level the run starts at (0 = level 1). */
    levelIndex = 0;

    private cfg: LevelConfig | null = null;
    private sim: ClimbSim | null = null;
    private mode: Mode = 'loading';

    private tower: Tower3D | null = null;
    private nameTag!: Label;
    private fxG!: Graphics;
    private hudG!: Graphics;
    private floorLabel!: Label;
    private levelLabel!: Label;
    private timeLabel!: Label;
    private eventLabel!: Label;
    private riskLabel!: Label;
    private gmLabel!: Label;
    private overlayLabel!: Label;
    private exitLabel!: Label;
    private speedLabel!: Label;
    /** Climb speed multiplier: x1 for players, the developer's pick in RUNGM mode. */
    private speed = 1;
    private leaving = false;

    private keys = { up: false, down: false, left: false, right: false, orbitL: false, orbitR: false };
    private stickId: number | null = null;
    private stickOrigin = new Vec2();
    private stickVec = new Vec2();
    /** Touch that is turning the view, and its last x. */
    private orbitId: number | null = null;
    private orbitLastX = 0;
    /** Mouse press: where it started, last x, and whether it became a drag. */
    private mouseDown = false;
    private mouseStart = new Vec2();
    private mouseLastX = 0;
    private mouseDragged = false;
    private lastTouchMs = 0;
    /** Radians of view orbit collected from drags since the last frame. */
    private pendingOrbit = 0;
    /** Climber's screen position (Canvas space), for the name tag and the eagle. */
    private playerUi = new Vec3();
    private tmpV = new Vec3();
    private fallSec = 0;
    /** World y of the climber's feet while falling. */
    private fallY = 0;
    private fallV = 0;
    private tumble = 0;
    private elapsed = 0;
    private lastTapMs = 0;
    private startIndex = 0;
    private nextSim: ClimbSim | null = null;
    /** Practice mode: the three-storey house, one gentle wind, rain and eagle, nothing recorded. */
    private practice = false;
    private tipLabel!: Label;
    private transSec = 0;
    private endSec = 0;
    /** The fall has hit the ground (plays the landing thud once). */
    private landed = false;

    start(): void {
        applyScreenFit();
        this.buildNodes();
        this.showOverlay('載入中…');
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);

        // The 3D camera clears the screen with the sky; the UI camera only draws on top.
        const uiCam = this.node.getComponentInChildren(Camera);
        if (uiCam) uiCam.clearFlags = Camera.ClearFlag.DEPTH_ONLY;

        this.practice = GameSession.mode === 'practice' || practiceFromUrl();
        LevelLoader.load().then((cfg) => {
            this.cfg = cfg;
            this.startIndex = this.practice ? 0 : this.resolveStartIndex(cfg);
            this.tower = new Tower3D(cfg.player.rowsPerFloor, cfg.player.ladderRows, cfg.crowd, this.practice ? cfg.practice.floors : 0);
            return this.tower.init();
        }).then(() => {
            this.newRun();
        }).catch((err: unknown) => {
            console.error(err);
            this.mode = 'error';
            this.showOverlay(`載入失敗\n${err instanceof Error ? err.message : String(err)}`);
        });
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.off(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);
        this.tower?.destroy();
        sound().music(null);
    }

    /** Read-only snapshot for tests and debugging. */
    get state(): { mode: Mode; practice: boolean; seed: number; row: number; col: number; floor: number | null; risk: number; climbSec: number; event: string | null } | null {
        const s = this.sim;
        if (!s) return null;
        return {
            mode: this.mode, practice: s.practice, seed: s.seed, row: s.row, col: s.col, floor: s.floor, risk: s.risk,
            climbSec: s.climbSec, event: s.scheduler.state === 'idle' ? null : `${s.scheduler.kind}:${s.scheduler.state}`,
        };
    }

    // ------------------------------------------------------------ run flow

    /**
     * Start level: GameSession.levelIndex from Home (always 0 unless developer mode / RUNGM
     * picked a level), or `?level=N` (1-based) for testing. Spire levels are not playable yet.
     * A fall restarts the run at this level.
     */
    private resolveStartIndex(cfg: LevelConfig): number {
        let index = GameSession.levelIndex || this.levelIndex;
        try {
            const q = new URLSearchParams(globalThis.location?.search ?? '').get('level');
            if (q !== null) index = Number(q) - 1;
        } catch {
            // no URL in this environment
        }
        const ok = Number.isInteger(index) && index >= 0 && index < cfg.levels.length;
        return ok ? index : 0;
    }

    private newRun(): void {
        if (!this.cfg) return;
        this.nextSim = null;
        this.sim = new ClimbSim(this.cfg, this.startIndex, randomSeed(), undefined, this.practice);
        this.speed = effectiveSpeed(GameSession.devMode === true, this.cfg.dev.climbSpeeds, settings().get().devSpeed);
        this.sim.speed = this.speed;
        console.log(this.practice ? `[Climb] practice seed ${this.sim.seed}` : `[Climb] level ${this.sim.level.id} seed ${this.sim.seed}`);
        this.tumble = 0;
        this.tower!.setLevel(this.sim);
        this.tower!.snap(this.sim);
        sound().music('climb');
        this.mode = 'ready';
        const l = this.sim.level;
        if (this.practice) {
            this.showOverlay(`練習模式 · ${l.name}\n風、雨、老鷹各來一次（較溫和）\n不計紀錄\n\n方向鍵 / WASD 或拖曳下半部攀爬\n放開 = 抓牢\n拖曳上半部 / Q E 旋轉視角\n爬上屋頂就完成`);
            return;
        }
        const hint = l.floorFrom === null ? '爬梯只能上下，強風時抓牢' : '可繞到其他面，轉角是危險區';
        this.showOverlay(`第 ${l.id} 關 ${l.name}\n${floorsText(l)}\n\n方向鍵 / WASD 或拖曳下半部攀爬\n放開 = 抓牢\n拖曳上半部 / Q E 旋轉視角\n${hint}`);
    }

    update(dt: number): void {
        this.elapsed += dt;
        const sim = this.sim;
        if (!sim || !this.tower) return;
        const dir = this.currentDir();

        if (this.mode === 'ready' && (dir.dx !== 0 || dir.dy !== 0)) {
            this.mode = 'play';
            this.hideOverlay();
        }
        if (this.mode === 'play') {
            const before = { stepping: sim.stepping, stepT: sim.stepT, gripping: sim.gripping, event: sim.scheduler.state };
            sim.update(dt, dir);
            this.playSimSounds(sim, before);
            if (sim.phase === 'fallen') this.beginFall();
            else if (sim.phase === 'cleared') this.onCleared();
        } else if (this.mode === 'falling') {
            this.tickFall(dt);
        } else if (this.mode === 'transition') {
            this.tickTransition(dt);
        } else if (this.mode === 'ending') {
            this.tickEnding(dt);
        }
        this.render(dt);
    }

    /** Effects for what changed during this frame's update (GDD §9 sounds, M4). */
    private playSimSounds(sim: ClimbSim, before: { stepping: boolean; stepT: number; gripping: boolean; event: string }): void {
        const sfx = sound();
        // A new cell: starting from rest, or the next step began while holding the key (stepT wrapped).
        if (sim.stepping && (!before.stepping || sim.stepT < before.stepT)) sfx.play('step');
        else if (sim.gripping && !before.gripping) sfx.play('grip');
        const sched = sim.scheduler;
        if (sched.state === 'warning' && before.event !== 'warning' && sched.kind) {
            sfx.play(sched.kind === 'wind' ? 'warnWind' : sched.kind === 'rain' ? 'warnRain' : 'warnEagle');
        }
    }

    private beginFall(): void {
        sound().music(null);
        sound().play('fall');
        this.landed = false;
        this.mode = 'falling';
        this.fallSec = 0;
        this.fallY = this.tower!.fallStartY(this.sim as ClimbSim);
        this.fallV = 0;
        this.tumble = 0;
    }

    private tickFall(dt: number): void {
        this.fallSec += dt;
        if (this.fallSec > FALL_FREEZE_SEC) {
            this.fallV += FALL_G * dt;
            this.fallY = Math.max(this.tower!.floorY(), this.fallY - this.fallV * dt);
            if (!this.landed && this.fallY <= this.tower!.floorY()) {
                this.landed = true;
                sound().play('land');
            }
            this.tumble = Math.min(1, this.tumble + 1.8 * dt);
        }
        if (this.fallSec >= FALL_TOTAL_SEC) {
            const sim = this.sim as ClimbSim;
            this.mode = 'fallen';
            if (sim.practice) {
                this.showOverlay(`${FALL_TEXT[sim.fallCause ?? 'edge']}\n\n練習不計紀錄\n\n點擊或按空白鍵 再練一次`);
                return;
            }
            const from = this.cfg!.levels[this.startIndex].floorFrom;
            this.showOverlay(`${FALL_TEXT[sim.fallCause ?? 'edge']}\n\n最高 ${sim.runMaxFloor ?? '-'}F · ${formatClimbTime(sim.climbSec)}\n種子 ${sim.seed}\n\n點擊或按空白鍵 從 ${from}F 再爬一次`);
        }
    }

    private onCleared(): void {
        const sim = this.sim as ClimbSim;
        if (sim.practice) {
            // Practice ends on the roof: no next level, no ending, nothing recorded.
            sound().music(null);
            sound().play('levelUp');
            this.mode = 'cleared';
            this.showOverlay(`練習完成！\n\n攀爬時間 ${formatClimbTime(sim.climbSec)}（不計紀錄）\n\n點擊或按空白鍵 再練一次\n右上「退出」回主畫面 開始挑戰 101`);
            return;
        }
        const next = sim.next();
        if (next) {
            // ADR-02: stand on the platform, scroll up, show the next level; no black screen.
            this.nextSim = next;
            sound().play('levelUp');
            this.mode = 'transition';
            this.transSec = 0;
            const l = next.level;
            this.showOverlay(`第 ${sim.level.id} 關完成\n\n第 ${l.id} 關 ${l.name}\n${floorsText(l)}`);
            return;
        }
        // Summit: about 10 s sitting on the top looking down over the city, then the result.
        sound().music(null);
        sound().play('summit');
        this.mode = 'ending';
        this.endSec = 0;
        this.hideOverlay();
    }

    private tickEnding(dt: number): void {
        this.endSec += dt;
        if (this.endSec > 5 && this.endSec < ENDING_SEC && !this.overlayLabel.node.active) {
            this.overlayLabel.string = '抵達塔尖！';
            this.overlayLabel.node.active = true;
        }
        if (this.endSec >= ENDING_SEC) this.finishEnding();
    }

    private finishEnding(): void {
        const sim = this.sim as ClimbSim;
        this.endSec = ENDING_SEC;
        this.mode = 'cleared';
        this.showOverlay(`抵達塔尖！\n\n攀爬時間 ${formatClimbTime(sim.climbSec)}\n種子 ${sim.seed}\n\n點擊或按空白鍵 再玩一次`);
    }

    /**
     * The next level's grid replaces the finished one on the first frame (it starts where the
     * old one ended, on the same tower), then the camera rises and settles on the start.
     */
    private tickTransition(dt: number): void {
        this.transSec += dt;
        if (this.nextSim) {
            this.sim = this.nextSim;
            this.nextSim = null;
            console.log(`[Climb] level ${this.sim.level.id}`);
            this.tower!.setLevel(this.sim);
        }
        if (this.transSec < TRANSITION_SEC) return;
        this.mode = 'play';
        this.hideOverlay();
    }

    private confirm(): void {
        if (this.mode === 'ending') {
            // The ending can be skipped (GDD: from the second time on; kept simple for now).
            if (this.endSec > 1.5) this.finishEnding();
            return;
        }
        if (this.mode === 'fallen' || this.mode === 'cleared') this.newRun();
        else if (this.mode === 'paused') this.togglePause();
    }

    private togglePause(): void {
        if (this.mode === 'play') {
            this.mode = 'paused';
            sound().music(null);
            this.showOverlay('暫停中\n\nEsc 或點擊繼續\n右上「退出」回主畫面');
        } else if (this.mode === 'paused') {
            sound().music('climb');
            this.mode = 'play';
            this.hideOverlay();
        }
    }

    // ------------------------------------------------------------ input

    private currentDir(): Dir {
        if (this.stickId !== null) {
            return dirFromStick(this.stickVec.x / STICK_RADIUS, this.stickVec.y / STICK_RADIUS, STICK_DEAD_ZONE);
        }
        const k = this.keys;
        const d = dirFromKeys(k.up, k.down, k.left, k.right);
        return d.dx === 0 && d.dy === 0 ? NO_DIR : d;
    }

    private setKey(code: KeyCode, down: boolean): boolean {
        switch (code) {
            case KeyCode.ARROW_UP: case KeyCode.KEY_W: this.keys.up = down; return true;
            case KeyCode.ARROW_DOWN: case KeyCode.KEY_S: this.keys.down = down; return true;
            case KeyCode.ARROW_LEFT: case KeyCode.KEY_A: this.keys.left = down; return true;
            case KeyCode.ARROW_RIGHT: case KeyCode.KEY_D: this.keys.right = down; return true;
            case KeyCode.KEY_Q: this.keys.orbitL = down; return true;
            case KeyCode.KEY_E: this.keys.orbitR = down; return true;
            default: return false;
        }
    }

    private onKeyDown(e: EventKeyboard): void {
        if (this.setKey(e.keyCode, true)) return;
        if (e.keyCode === KeyCode.ESCAPE) this.togglePause();
        else if (e.keyCode === KeyCode.KEY_X && this.canExit()) this.exitToHome();
        else if (e.keyCode === KeyCode.KEY_V && this.canChangeSpeed()) this.cycleSpeed();
        else if (e.keyCode === KeyCode.SPACE || e.keyCode === KeyCode.ENTER) this.confirm();
    }

    private onKeyUp(e: EventKeyboard): void {
        this.setKey(e.keyCode, false);
    }

    /** Taps arrive as both touch and mouse on some browsers; act once. */
    private tap(local: Vec3): void {
        const now = Date.now();
        if (now - this.lastTapMs < 250) return;
        this.lastTapMs = now;
        if (this.inPauseButton(local) && (this.mode === 'play' || this.mode === 'paused')) {
            this.togglePause();
            return;
        }
        if (this.canExit() && this.inExitButton(local)) {
            this.exitToHome();
            return;
        }
        if (this.canChangeSpeed() && this.inSpeedButton(local)) {
            this.cycleSpeed();
            return;
        }
        this.confirm();
    }

    private toLocal(ui: Vec2): Vec3 {
        return this.node.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
    }

    private fromTouch(): boolean {
        return Date.now() - this.lastTouchMs < TOUCH_MOUSE_GAP_MS;
    }

    /** Mouse: a click is a tap; a drag (left button) turns the view round the tower. */
    private onMouseDown(e: EventMouse): void {
        if (this.fromTouch() || e.getButton() !== EventMouse.BUTTON_LEFT) return;
        this.mouseDown = true;
        this.mouseDragged = false;
        const p = e.getUILocation();
        this.mouseStart.set(p.x, p.y);
        this.mouseLastX = p.x;
    }

    private onMouseMove(e: EventMouse): void {
        if (!this.mouseDown || this.fromTouch()) return;
        const p = e.getUILocation();
        if (!this.mouseDragged && Vec2.distance(p, this.mouseStart) > DRAG_SLOP) this.mouseDragged = true;
        if (this.mouseDragged) this.pendingOrbit += Tower3D.dragOrbit(p.x - this.mouseLastX);
        this.mouseLastX = p.x;
    }

    private onMouseUp(e: EventMouse): void {
        if (!this.mouseDown) return;
        this.mouseDown = false;
        if (this.fromTouch()) return;
        if (!this.mouseDragged) this.tap(this.toLocal(e.getUILocation()));
    }

    /** Upper half of the screen (below the HUD band) turns the view; the rest is the stick. */
    private inOrbitArea(local: Vec3): boolean {
        const top = view.getVisibleSize().height / 2;
        return local.y > 0 && local.y < top - 160;
    }

    private onTouchStart(e: EventTouch): void {
        this.lastTouchMs = Date.now();
        const local = this.toLocal(e.getUILocation());
        const playing = this.mode === 'play' || this.mode === 'ready';
        const onButton = this.inPauseButton(local) || (this.canExit() && this.inExitButton(local))
            || (this.canChangeSpeed() && this.inSpeedButton(local));
        if (playing && !onButton && this.orbitId === null && this.inOrbitArea(local)) {
            this.orbitId = e.getID();
            this.orbitLastX = e.getUILocation().x;
            return;
        }
        if (!playing || onButton) {
            this.tap(local);
            return;
        }
        if (this.stickId === null) {
            this.stickId = e.getID();
            this.stickOrigin.set(local.x, local.y);
            this.stickVec.set(0, 0);
        }
    }

    private onTouchMove(e: EventTouch): void {
        this.lastTouchMs = Date.now();
        if (e.getID() === this.orbitId) {
            const x = e.getUILocation().x;
            this.pendingOrbit += Tower3D.dragOrbit(x - this.orbitLastX);
            this.orbitLastX = x;
            return;
        }
        if (e.getID() !== this.stickId) return;
        const local = this.toLocal(e.getUILocation());
        this.stickVec.set(local.x - this.stickOrigin.x, local.y - this.stickOrigin.y);
        const len = this.stickVec.length();
        if (len > STICK_RADIUS) this.stickVec.multiplyScalar(STICK_RADIUS / len);
    }

    private onTouchEnd(e: EventTouch): void {
        this.lastTouchMs = Date.now();
        if (e.getID() === this.orbitId) {
            this.orbitId = null;
            return;
        }
        if (e.getID() !== this.stickId) return;
        this.stickId = null;
        this.stickVec.set(0, 0);
    }

    private inPauseButton(local: Vec3): boolean {
        const vs = view.getVisibleSize();
        return local.x > vs.width / 2 - 110 && local.y > vs.height / 2 - 110;
    }

    /** Left edge of the exit button, measured from the right side of the screen. */
    private static readonly EXIT_X = 92 + 14 + EXIT_W;

    private inExitButton(local: Vec3): boolean {
        const vs = view.getVisibleSize();
        const x0 = vs.width / 2 - Climb.EXIT_X;
        const top = vs.height / 2;
        return local.x > x0 - 8 && local.x < x0 + EXIT_W + 8 && local.y > top - 100 && local.y < top - 16;
    }

    private inSpeedButton(local: Vec3): boolean {
        const vs = view.getVisibleSize();
        const x0 = -vs.width / 2 + 24;
        const y1 = vs.height / 2 - SPEED_TOP;
        return local.x > x0 - 8 && local.x < x0 + SPEED_W + 8 && local.y > y1 - BTN - 8 && local.y < y1 + 8;
    }

    /**
     * Quitting is offered at a level's starting point (row 0, before or after climbing back
     * down to it), while paused, and on the fall / result screens. Mid-wall it is not, so a
     * tap on the climb never ends the run by accident.
     */
    private canExit(): boolean {
        const sim = this.sim;
        if (!sim || this.leaving) return false;
        if (this.mode === 'paused' || this.mode === 'fallen' || this.mode === 'cleared') return true;
        return (this.mode === 'ready' || this.mode === 'play') && sim.row === 0;
    }

    private canChangeSpeed(): boolean {
        return GameSession.devMode === true && this.sim !== null && this.mode !== 'ending' && this.mode !== 'loading';
    }

    private cycleSpeed(): void {
        const speeds = this.cfg!.dev.climbSpeeds;
        this.speed = nextSpeed(speeds, this.speed);
        if (this.sim) this.sim.speed = this.speed;
        if (this.nextSim) this.nextSim.speed = this.speed;
        settings().set({ devSpeed: this.speed });
        console.log(`[Climb] speed ${speedText(this.speed)}`);
    }

    /** Back to the home screen; the run is abandoned (nothing is recorded). */
    private exitToHome(): void {
        if (this.leaving) return;
        this.leaving = true;
        console.log('[Climb] exit to home');
        director.loadScene(HOME_SCENE);
    }

    // ------------------------------------------------------------ nodes

    private makeNode(name: string, parent: Node): Node {
        const n = new Node(name);
        n.layer = this.node.layer;
        n.parent = parent;
        n.addComponent(UITransform);
        return n;
    }

    private makeLabel(name: string, parent: Node, size: number, align: number = Label.HorizontalAlign.CENTER): Label {
        const n = this.makeNode(name, parent);
        const label = n.addComponent(Label);
        label.fontSize = size;
        label.lineHeight = Math.round(size * 1.3);
        label.horizontalAlign = align;
        label.color = C.text;
        const anchorX = align === Label.HorizontalAlign.LEFT ? 0 : align === Label.HorizontalAlign.RIGHT ? 1 : 0.5;
        n.getComponent(UITransform)!.setAnchorPoint(anchorX, 0.5);
        return label;
    }

    private buildNodes(): void {
        const tag = this.makeLabel('Name', this.node, 20);
        tag.string = PLAYER_NAME;
        tag.enableOutline = true;
        tag.outlineColor = new Color(0, 0, 0, 200);
        tag.outlineWidth = 2;
        this.nameTag = tag;

        this.fxG = this.makeNode('Fx', this.node).addComponent(Graphics);
        const hud = this.makeNode('Hud', this.node);
        this.hudG = hud.addComponent(Graphics);
        this.floorLabel = this.makeLabel('Floor', hud, 52);
        this.levelLabel = this.makeLabel('Level', hud, 24);
        this.timeLabel = this.makeLabel('Time', hud, 30, Label.HorizontalAlign.RIGHT);
        this.eventLabel = this.makeLabel('Event', hud, 40);
        this.riskLabel = this.makeLabel('Risk', hud, 20);
        this.riskLabel.string = '風險';
        const gm = this.makeLabel('GmBadge', hud, 24);
        gm.string = 'GM 開發人員模式';
        gm.color = hex('#ffd34a');
        gm.node.active = GameSession.devMode === true;
        this.gmLabel = gm;
        this.overlayLabel = this.makeLabel('Overlay', hud, 36);
        this.exitLabel = this.makeLabel('Exit', hud, 28);
        this.exitLabel.string = '退出';
        this.speedLabel = this.makeLabel('Speed', hud, 28);
        this.speedLabel.color = hex('#ffd34a');
        const tip = this.makeLabel('PracticeTip', hud, 30);
        tip.enableOutline = true;
        tip.outlineColor = new Color(0, 0, 0, 220);
        tip.outlineWidth = 3;
        tip.color = hex('#ffe2a0');
        tip.node.active = false;
        this.tipLabel = tip;
    }

    private showOverlay(text: string): void {
        this.overlayLabel.string = text;
        this.overlayLabel.node.active = true;
    }

    private hideOverlay(): void {
        this.overlayLabel.node.active = false;
    }

    // ------------------------------------------------------------ drawing

    private render(dt: number): void {
        const sim = this.sim as ClimbSim;
        const vs = view.getVisibleSize();
        const left = -vs.width / 2;
        const right = vs.width / 2;
        const top = vs.height / 2;
        const bottom = -vs.height / 2;
        const risk = this.cfg!.risk;
        const s = sim.scheduler;

        // Climber and camera (3D).
        const fallen = this.mode === 'falling' || this.mode === 'fallen';
        const shake = sim.tier === 'crisis' && this.mode === 'play' ? (Math.random() - 0.5) * 0.12 : 0;
        const keyDir = (this.keys.orbitR ? 1 : 0) - (this.keys.orbitL ? 1 : 0);
        const orbit = this.pendingOrbit + Tower3D.keyOrbit(dt, keyDir);
        this.pendingOrbit = 0;
        // Rise past the platform between levels, in one continuous move.
        const lift = this.mode === 'transition' ? Math.sin(Math.PI * Math.min(1, this.transSec / TRANSITION_SEC)) * 3 : 0;
        const tower = this.tower as Tower3D;
        const ending = this.mode === 'ending' || (this.mode === 'cleared' && sim.summit);
        if (ending) tower.updateEnding(this.endSec);
        else tower.update(dt, sim, {
            elapsed: this.elapsed,
            fallY: fallen ? this.fallY : null,
            tumble: fallen ? this.tumble : 0,
            grip: sim.gripping && !fallen,
            orbitInput: orbit,
            shake,
            lift,
        });
        tower.camera.convertToUINode(tower.headWorld(this.tmpV), this.node, this.playerUi);
        this.nameTag.node.setPosition(this.playerUi.x, this.playerUi.y + 14);
        this.nameTag.node.active = tower.climberInView && !ending;
        this.nameTag.color = sim.tier === 'crisis' && Math.floor(this.elapsed * 10) % 2 === 0 ? C.riskCrisis : C.text;

        // Effects layer (screen space). Warning phase gives a softer hint of what is coming.
        const fx = this.fxG;
        fx.clear();
        const kind = s.state === 'warning' || s.state === 'active' ? s.kind : null;
        const strength = s.state === 'active' ? 1 : s.state === 'warning' ? 0.35 : 0;
        if (kind === 'rain') {
            fx.fillColor = new Color(0, 0, 20, Math.round(100 * strength));
            fx.rect(left, bottom, vs.width, vs.height);
            fx.fill();
            fx.strokeColor = alpha(C.rain, Math.round(170 * strength));
            fx.lineWidth = 2;
            const drops = s.state === 'active' ? 70 : 12;
            for (let i = 0; i < drops; i++) {
                const x = left + ((i * 97 + this.elapsed * 300) % vs.width);
                const y = bottom + ((i * 211 - this.elapsed * 900) % vs.height + vs.height) % vs.height;
                fx.moveTo(x, y);
                fx.lineTo(x - 6, y - 24);
            }
            fx.stroke();
            // Lightning flash as the rain starts.
            if (s.state === 'active' && s.activeTotal - s.left < 0.18) {
                fx.fillColor = new Color(255, 255, 255, 120);
                fx.rect(left, bottom, vs.width, vs.height);
                fx.fill();
            }
        } else if (kind === 'wind') {
            const dirX = s.state === 'active' ? s.windDir : 1;
            fx.strokeColor = alpha(C.wind, Math.round(150 * strength));
            fx.lineWidth = 3;
            const lines = s.state === 'active' ? 16 : 6;
            const speed = s.state === 'active' ? 900 : 400;
            for (let i = 0; i < lines; i++) {
                const y = bottom + (i * 173) % vs.height;
                const run = (i * 131 + this.elapsed * speed) % (vs.width + 200);
                const x = dirX > 0 ? left - 100 + run : right + 100 - run;
                fx.moveTo(x, y);
                fx.lineTo(x - dirX * 90, y);
                // Falling leaf.
                if (s.state === 'active' && i % 4 === 0) {
                    fx.moveTo(x + dirX * 20, y + 10 + Math.sin(this.elapsed * 9 + i) * 8);
                    fx.lineTo(x + dirX * 30, y + 16 + Math.sin(this.elapsed * 9 + i) * 8);
                }
            }
            fx.stroke();
        } else if (kind === 'eagle') {
            const ey = this.playerUi.y + 170;
            if (s.state === 'warning') {
                // Shadow sweeping over the glass.
                const t = 1 - s.left / this.cfg!.events.warningSec;
                fx.fillColor = new Color(0, 0, 0, 60);
                fx.ellipse(right + 80 - t * (vs.width + 160), ey - 120, 70, 18);
                fx.fill();
            } else {
                const t = 1 - s.left / s.activeTotal;
                const ex = left - 60 + t * (vs.width + 120);
                const flap = Math.sin(this.elapsed * 18) * 10;
                fx.fillColor = C.eagle;
                fx.moveTo(ex - 44, ey + flap);
                fx.lineTo(ex, ey - 6);
                fx.lineTo(ex + 44, ey + flap);
                fx.lineTo(ex, ey + 4);
                fx.close();
                fx.fill();
                fx.fillColor = new Color(0, 0, 0, 50);
                fx.ellipse(ex, ey - 140, 50, 12);
                fx.fill();
            }
        }
        // Edge vignette (GDD 6).
        if (sim.tier !== 'safe' || this.mode === 'falling') {
            const blink = sim.tier === 'crisis' ? 0.5 + 0.5 * Math.sin(this.elapsed * 12) : 1;
            fx.fillColor = new Color(220, 30, 30, Math.round((sim.tier === 'crisis' ? 120 : 60) * blink));
            const w = 28;
            fx.rect(left, bottom, w, vs.height);
            fx.rect(right - w, bottom, w, vs.height);
            fx.rect(left, top - w, vs.width, w);
            fx.rect(left, bottom, vs.width, w);
            fx.fill();
        }

        // HUD.
        const h = this.hudG;
        h.clear();
        // Overlay dim covers the whole screen; drawn first so the HUD stays readable on top.
        if (this.overlayLabel.node.active) {
            h.fillColor = C.dim;
            h.rect(left, bottom, vs.width, vs.height);
            h.fill();
            this.overlayLabel.node.setPosition(0, OVERLAY_Y);
        }
        // Top band behind the title so floor lines don't run through it.
        h.fillColor = new Color(8, 12, 20, 230);
        h.rect(left, top - 150, vs.width, 150);
        h.fill();

        const floor = fallen ? sim.floorAt(tower.rowAtFeet(this.fallY)) : sim.floor;
        this.floorLabel.string = floor === null ? sim.level.name : `${floor}F`;
        this.floorLabel.node.setPosition(0, top - 52);
        const shown = sim.level;
        this.levelLabel.string = sim.practice ? `練習模式 ${shown.name}` : `第 ${shown.id} 關 ${shown.name} ${floorsText(shown)}`;
        this.levelLabel.node.setPosition(0, top - 106);
        this.timeLabel.string = formatClimbTime(sim.climbSec);
        this.timeLabel.node.setPosition(right - 24, top - 130);

        // Pause button.
        h.fillColor = new Color(255, 255, 255, 60);
        h.rect(right - 92, top - 92, 68, 68);
        h.fill();
        h.fillColor = C.text;
        h.rect(right - 72, top - 76, 10, 36);
        h.rect(right - 54, top - 76, 10, 36);
        h.fill();

        // Exit (at a level's start, paused, or on a result screen) and the dev speed chip.
        const showExit = this.canExit();
        this.exitLabel.node.active = showExit;
        if (showExit) {
            const x0 = right - Climb.EXIT_X;
            h.fillColor = new Color(178, 60, 60, 220);
            h.roundRect(x0, top - 92, EXIT_W, BTN, 10);
            h.fill();
            this.exitLabel.node.setPosition(x0 + EXIT_W / 2, top - 58);
        }
        const showSpeed = this.canChangeSpeed();
        this.speedLabel.node.active = showSpeed;
        if (showSpeed) {
            const x0 = left + 24;
            const y0 = top - SPEED_TOP - BTN;
            h.fillColor = new Color(0, 0, 0, 160);
            h.roundRect(x0, y0, SPEED_W, BTN, 10);
            h.fill();
            h.strokeColor = hex('#ffd34a');
            h.lineWidth = 2;
            h.roundRect(x0, y0, SPEED_W, BTN, 10);
            h.stroke();
            this.speedLabel.string = speedText(this.speed);
            this.speedLabel.node.setPosition(x0 + SPEED_W / 2, y0 + BTN / 2);
        }

        // Risk meter (left, vertical).
        const mx = left + 30;
        const my = -220;
        const mh = 440;
        h.fillColor = new Color(0, 0, 0, 220);
        h.rect(mx - 4, my - 4, 28, mh + 8);
        h.fill();
        h.fillColor = sim.tier === 'crisis' ? C.riskCrisis : sim.tier === 'tense' ? C.riskTense : C.riskSafe;
        h.rect(mx, my, 20, mh * (sim.risk / risk.max));
        h.fill();
        h.strokeColor = C.text;
        h.lineWidth = 2;
        for (const v of [risk.tense, risk.crisis]) {
            const y = my + mh * (v / risk.max);
            h.moveTo(mx - 6, y);
            h.lineTo(mx + 26, y);
        }
        h.stroke();
        this.riskLabel.node.setPosition(mx + 10, my + mh + 22);
        this.gmLabel.node.setPosition(0, top - 172);
        if (!ending && !sim.practice) this.drawMiniMap(h, tower, sim, right - 52, top - 170);

        // Practice: say what to do while an event warns and runs (not over the result screens).
        const tipKind = sim.practice && (this.mode === 'play' || this.mode === 'paused') ? kind : null;
        // Rushed to the top before the demos are done: the roof waits for them.
        const waitRoof = sim.practice && this.mode === 'play' && tipKind === null && sim.roofLocked && sim.row >= sim.wall.rows - 1;
        this.tipLabel.node.active = (tipKind !== null || waitRoof) && !this.overlayLabel.node.active;
        if (tipKind || waitRoof) {
            this.tipLabel.string = tipKind ? PRACTICE_TIP[tipKind] : '天氣還沒示範完\n抓牢等一下再上屋頂';
            this.tipLabel.node.setPosition(0, top - TIP_TOP);
        }

        // Event icon (top-left): blinks during warning, time bar while active.
        const showIcon = kind !== null && (s.state === 'active' || Math.floor(this.elapsed * 8) % 2 === 0);
        this.eventLabel.node.active = showIcon;
        if (kind && showIcon) {
            const color = C[kind];
            const ix = left + 70;
            const iy = top - 70;
            h.fillColor = alpha(color, 220);
            if (kind === 'wind') h.rect(ix - 36, iy - 36, 72, 72);
            else if (kind === 'rain') h.circle(ix, iy, 38);
            else {
                h.moveTo(ix, iy + 40);
                h.lineTo(ix + 40, iy - 34);
                h.lineTo(ix - 40, iy - 34);
                h.close();
            }
            h.fill();
            this.eventLabel.string = EVENT_LABEL[kind];
            this.eventLabel.node.setPosition(ix, iy - 2);
            if (s.state === 'active') {
                h.fillColor = color;
                h.rect(ix - 36, iy - 56, 72 * Math.max(0, s.left / s.activeTotal), 8);
                h.fill();
            }
        }

        // Virtual stick.
        if (this.stickId !== null) {
            h.fillColor = new Color(255, 255, 255, 40);
            h.circle(this.stickOrigin.x, this.stickOrigin.y, STICK_RADIUS);
            h.fill();
            h.fillColor = new Color(255, 255, 255, 120);
            h.circle(this.stickOrigin.x + this.stickVec.x, this.stickOrigin.y + this.stickVec.y, 36);
            h.fill();
        }
    }

    /**
     * Mini map (top right): the whole 101 silhouette, the current level's band, and a dot
     * where the climber is. Heights are to scale; widths are exaggerated so it reads.
     */
    private drawMiniMap(h: Graphics, tower: Tower3D, sim: ClimbSim, cx: number, topY: number): void {
        const total = tower.totalHeight;
        const k = MINIMAP_H / total;
        const bottom = topY - MINIMAP_H;
        const wk = (MINIMAP_HALF_W - 8) / 9.6;
        h.fillColor = new Color(0, 0, 0, 120);
        h.roundRect(cx - MINIMAP_HALF_W, bottom - 10, MINIMAP_HALF_W * 2, MINIMAP_H + 20, 8);
        h.fill();
        // Silhouette, sampled up one side and down the other.
        const steps = 90;
        h.fillColor = new Color(90, 170, 180, 230);
        for (let i = 0; i <= steps; i++) {
            const y = (total * i) / steps;
            const x = cx + tower.half(y) * wk;
            if (i === 0) h.moveTo(x, bottom);
            else h.lineTo(x, bottom + y * k);
        }
        for (let i = steps; i >= 0; i--) {
            const y = (total * i) / steps;
            h.lineTo(cx - tower.half(y) * wk, bottom + y * k);
        }
        h.close();
        h.fill();
        // Current level band.
        const y0 = tower.levelBottomY;
        const y1 = y0 + sim.wall.rows * ROW_H;
        h.fillColor = new Color(255, 211, 74, 70);
        h.rect(cx - MINIMAP_HALF_W + 3, bottom + y0 * k, MINIMAP_HALF_W * 2 - 6, Math.max(2, (y1 - y0) * k));
        h.fill();
        // Climber.
        const py = bottom + Math.max(0, tower.climberY) * k;
        h.fillColor = C.text;
        h.circle(cx, py, 7);
        h.fill();
        h.fillColor = C.body;
        h.circle(cx, py, 5);
        h.fill();
    }
}
