import {
    _decorator, Color, Component, EventKeyboard, EventMouse, EventTouch, Graphics,
    input, Input, KeyCode, Label, Node, UITransform, Vec2, Vec3, view,
} from 'cc';
import type { LevelConfig } from '../config/LevelConfig';
import { LevelLoader } from '../config/LevelLoader';
import { applyScreenFit } from '../core/ScreenFit';
import {
    ClimbSim, Dir, FALL_TEXT, NO_DIR, dirFromKeys, dirFromStick, formatClimbTime, isObstacle, randomSeed, zoneOf,
} from '../climb/ClimbCore';

const { ccclass } = _decorator;

// Presentation-only constants (rules and tunables live in levels.json).
const CELL = 56;
const STICK_RADIUS = 90;
/** GDD 3: virtual stick dead zone 20 %. */
const STICK_DEAD_ZONE = 0.2;
/** GDD 7: freeze 0.3 s, then fall; the whole fall screen is 2.5 s. */
const FALL_FREEZE_SEC = 0.3;
const FALL_TOTAL_SEC = 2.5;
const PLAYER_NAME = '霍將軍';

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

type Mode = 'loading' | 'ready' | 'play' | 'paused' | 'falling' | 'fallen' | 'cleared' | 'error';

const EVENT_LABEL = { wind: '風', rain: '雨', eagle: '鷹' } as const;

/**
 * M1 climb scene, level 1 (基座下段 1–8F) for now: grid climbing, grip on release,
 * risk meter, crisis events, fall back to 1F. All rules are in ClimbCore; this
 * component only reads input and draws colour blocks.
 */
@ccclass('Climb')
export class Climb extends Component {
    /** Level to play (0 = level 1). */
    levelIndex = 0;

    private cfg: LevelConfig | null = null;
    private sim: ClimbSim | null = null;
    private mode: Mode = 'loading';

    private world!: Node;
    private wallG!: Graphics;
    private player!: Node;
    private playerG!: Graphics;
    private fxG!: Graphics;
    private hudG!: Graphics;
    private floorLabel!: Label;
    private levelLabel!: Label;
    private timeLabel!: Label;
    private eventLabel!: Label;
    private riskLabel!: Label;
    private overlayLabel!: Label;

    private keys = { up: false, down: false, left: false, right: false };
    private stickId: number | null = null;
    private stickOrigin = new Vec2();
    private stickVec = new Vec2();
    private camY = 0;
    private fallSec = 0;
    private fallY = 0;
    private fallV = 0;
    private elapsed = 0;
    private lastTapMs = 0;

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

        LevelLoader.load().then((cfg) => {
            this.cfg = cfg;
            this.newRun();
        }).catch((err: unknown) => {
            console.error(err);
            this.mode = 'error';
            this.showOverlay(`levels.json 載入失敗\n${err instanceof Error ? err.message : String(err)}`);
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
    }

    /** Read-only snapshot for tests and debugging. */
    get state(): { mode: Mode; seed: number; row: number; col: number; floor: number | null; risk: number; climbSec: number } | null {
        const s = this.sim;
        if (!s) return null;
        return { mode: this.mode, seed: s.seed, row: s.row, col: s.col, floor: s.floor, risk: s.risk, climbSec: s.climbSec };
    }

    // ------------------------------------------------------------ run flow

    private newRun(): void {
        if (!this.cfg) return;
        this.sim = new ClimbSim(this.cfg, this.levelIndex, randomSeed());
        console.log(`[Climb] level ${this.sim.level.id} seed ${this.sim.seed}`);
        this.drawWall();
        this.player.angle = 0;
        this.camY = this.cellY(0) + this.camOffset();
        this.mode = 'ready';
        const l = this.sim.level;
        this.showOverlay(`第 ${l.id} 關 ${l.name}\n${l.floors.replace('-', '–')}\n\n方向鍵 / WASD 或拖曳畫面攀爬\n放開 = 抓牢`);
    }

    update(dt: number): void {
        this.elapsed += dt;
        const sim = this.sim;
        if (!sim) return;
        const dir = this.currentDir();

        if (this.mode === 'ready' && (dir.dx !== 0 || dir.dy !== 0)) {
            this.mode = 'play';
            this.hideOverlay();
        }
        if (this.mode === 'play') {
            sim.update(dt, dir);
            if (sim.phase === 'fallen') this.beginFall();
            else if (sim.phase === 'cleared') this.onCleared();
        } else if (this.mode === 'falling') {
            this.tickFall(dt);
        }
        this.render(dt);
    }

    private beginFall(): void {
        this.mode = 'falling';
        this.fallSec = 0;
        this.fallY = this.playerY();
        this.fallV = 0;
    }

    private tickFall(dt: number): void {
        this.fallSec += dt;
        if (this.fallSec > FALL_FREEZE_SEC) {
            this.fallV += 2600 * dt;
            this.fallY = Math.max(this.cellY(0), this.fallY - this.fallV * dt);
            this.player.angle = Math.min(160, this.player.angle + 300 * dt);
        }
        if (this.fallSec >= FALL_TOTAL_SEC) {
            const sim = this.sim as ClimbSim;
            this.mode = 'fallen';
            this.showOverlay(`${FALL_TEXT[sim.fallCause ?? 'edge']}\n\n最高 ${sim.maxFloor ?? '-'}F · ${formatClimbTime(sim.climbSec)}\n種子 ${sim.seed}\n\n點擊或按空白鍵 從 1F 再爬一次`);
        }
    }

    private onCleared(): void {
        const sim = this.sim as ClimbSim;
        this.mode = 'cleared';
        this.showOverlay(`第 ${sim.level.id} 關完成！\n抵達 ${sim.level.floorTo}F 平台\n\n攀爬時間 ${formatClimbTime(sim.climbSec)}\n\n下一關製作中\n點擊或按空白鍵 再玩一次`);
    }

    private confirm(): void {
        if (this.mode === 'fallen' || this.mode === 'cleared') this.newRun();
        else if (this.mode === 'paused') this.togglePause();
    }

    private togglePause(): void {
        if (this.mode === 'play') {
            this.mode = 'paused';
            this.showOverlay('暫停中\n\nEsc 或點擊繼續');
        } else if (this.mode === 'paused') {
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
            default: return false;
        }
    }

    private onKeyDown(e: EventKeyboard): void {
        if (this.setKey(e.keyCode, true)) return;
        if (e.keyCode === KeyCode.ESCAPE) this.togglePause();
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
        this.confirm();
    }

    private toLocal(ui: Vec2): Vec3 {
        return this.node.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
    }

    private onMouseDown(e: EventMouse): void {
        this.tap(this.toLocal(e.getUILocation()));
    }

    private onTouchStart(e: EventTouch): void {
        const local = this.toLocal(e.getUILocation());
        const playing = this.mode === 'play' || this.mode === 'ready';
        if (!playing || this.inPauseButton(local)) {
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
        if (e.getID() !== this.stickId) return;
        const local = this.toLocal(e.getUILocation());
        this.stickVec.set(local.x - this.stickOrigin.x, local.y - this.stickOrigin.y);
        const len = this.stickVec.length();
        if (len > STICK_RADIUS) this.stickVec.multiplyScalar(STICK_RADIUS / len);
    }

    private onTouchEnd(e: EventTouch): void {
        if (e.getID() !== this.stickId) return;
        this.stickId = null;
        this.stickVec.set(0, 0);
    }

    private inPauseButton(local: Vec3): boolean {
        const vs = view.getVisibleSize();
        return local.x > vs.width / 2 - 110 && local.y > vs.height / 2 - 110;
    }

    // ------------------------------------------------------------ geometry

    private cellX(col: number): number {
        const cols = this.sim ? this.sim.wall.cols : 1;
        return (col - (cols - 1) / 2) * CELL;
    }

    private cellY(row: number): number {
        return row * CELL + CELL / 2;
    }

    /** Keeps the climber a little below the screen centre. */
    private camOffset(): number {
        return view.getVisibleSize().height * 0.1;
    }

    private playerY(): number {
        const s = this.sim as ClimbSim;
        return this.cellY(this.lerp(s.fromRow, s.row, s.stepT));
    }

    private playerX(): number {
        const s = this.sim as ClimbSim;
        return this.cellX(this.lerp(s.fromCol, s.col, s.stepT));
    }

    private lerp(a: number, b: number, t: number): number {
        if (t < 0) return b;
        const e = t * t * (3 - 2 * t);
        return a + (b - a) * e;
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
        this.world = this.makeNode('World', this.node);
        this.wallG = this.makeNode('Wall', this.world).addComponent(Graphics);
        this.player = this.makeNode('Player', this.world);
        this.playerG = this.player.addComponent(Graphics);
        const tag = this.makeLabel('Name', this.player, 20);
        tag.string = PLAYER_NAME;
        tag.node.setPosition(0, 46);

        this.fxG = this.makeNode('Fx', this.node).addComponent(Graphics);
        const hud = this.makeNode('Hud', this.node);
        this.hudG = hud.addComponent(Graphics);
        this.floorLabel = this.makeLabel('Floor', hud, 52);
        this.levelLabel = this.makeLabel('Level', hud, 24);
        this.timeLabel = this.makeLabel('Time', hud, 30, Label.HorizontalAlign.RIGHT);
        this.eventLabel = this.makeLabel('Event', hud, 40);
        this.riskLabel = this.makeLabel('Risk', hud, 20);
        this.riskLabel.string = '風險';
        this.overlayLabel = this.makeLabel('Overlay', hud, 36);
    }

    private showOverlay(text: string): void {
        this.overlayLabel.string = text;
        this.overlayLabel.node.active = true;
    }

    private hideOverlay(): void {
        this.overlayLabel.node.active = false;
    }

    // ------------------------------------------------------------ drawing

    private drawWall(): void {
        const sim = this.sim as ClimbSim;
        const { wall } = sim;
        const g = this.wallG;
        const rowsPerFloor = this.cfg!.player.rowsPerFloor;
        const half = (wall.cols / 2) * CELL;
        const top = wall.rows * CELL;
        g.clear();

        // Ground and facade.
        g.fillColor = C.ground;
        g.rect(-600, -400, 1200, 400);
        g.fill();
        g.fillColor = C.facade;
        g.rect(-half - 8, 0, wall.cols * CELL + 16, top);
        g.fill();

        // Windows, batched per colour.
        const fillCells = (color: Color, pick: (col: number, row: number) => boolean, inset: number): void => {
            g.fillColor = color;
            for (let r = 0; r < wall.rows; r++) {
                for (let c = 0; c < wall.cols; c++) {
                    if (pick(c, r)) g.rect(this.cellX(c) - CELL / 2 + inset, r * CELL + inset, CELL - 2 * inset, CELL - 2 * inset);
                }
            }
            g.fill();
        };
        const free = (c: number, r: number): boolean => !isObstacle(wall, c, r);
        fillCells(C.safe, (c, r) => free(c, r) && zoneOf(wall, c) === 'safe', 4);
        fillCells(C.danger, (c, r) => free(c, r) && zoneOf(wall, c) === 'danger', 4);
        fillCells(C.obstacle, (c, r) => !free(c, r), 2);
        // Glass highlight strip.
        fillCells(C.safeHi, (c, r) => free(c, r) && zoneOf(wall, c) === 'safe', 10);
        g.fillColor = C.safe;
        for (let r = 0; r < wall.rows; r++) {
            for (let c = 0; c < wall.cols; c++) {
                if (free(c, r) && zoneOf(wall, c) === 'safe') g.rect(this.cellX(c) - CELL / 2 + 14, r * CELL + 14, CELL - 28, CELL - 28);
            }
        }
        g.fill();

        // Obstacle hatching (vent / cleaning rail).
        g.strokeColor = C.obstacleMark;
        g.lineWidth = 4;
        for (const key of wall.obstacles) {
            const r = Math.floor(key / wall.cols);
            const c = key % wall.cols;
            const x = this.cellX(c);
            const y = this.cellY(r);
            for (let i = -1; i <= 1; i++) {
                g.moveTo(x - 20, y + i * 12);
                g.lineTo(x + 20, y + i * 12);
            }
        }
        g.stroke();

        // Floor slabs every rowsPerFloor rows.
        g.fillColor = C.slab;
        for (let r = rowsPerFloor; r < wall.rows; r += rowsPerFloor) g.rect(-half - 8, r * CELL - 3, wall.cols * CELL + 16, 6);
        g.fill();

        // Fall lines just outside the outer columns.
        g.strokeColor = C.fallLine;
        g.lineWidth = 3;
        for (const x of [-half - 10, half + 10]) {
            for (let y = 0; y < top; y += 40) {
                g.moveTo(x, y);
                g.lineTo(x, y + 22);
            }
        }
        g.stroke();

        // Goal platform.
        g.fillColor = C.platform;
        g.rect(-half - 60, top, wall.cols * CELL + 120, 24);
        g.fill();

        // Floor numbers on the left of the facade.
        this.world.children.filter((n) => n.name === 'FloorTag').forEach((n) => n.destroy());
        const { floorFrom, floorTo } = sim.level;
        if (floorFrom !== null && floorTo !== null) {
            for (let f = floorFrom; f <= floorTo; f++) {
                const tag = this.makeLabel('FloorTag', this.world, 22, Label.HorizontalAlign.RIGHT);
                tag.string = `${f}F`;
                tag.color = alpha(C.text, 150);
                tag.node.setPosition(-half - 18, (f - floorFrom) * rowsPerFloor * CELL + 18);
            }
            const goal = this.makeLabel('FloorTag', this.world, 26);
            goal.string = `${floorTo}F 平台`;
            goal.node.setPosition(0, top + 50);
        }
        const entrance = this.makeLabel('FloorTag', this.world, 26);
        entrance.string = '入口';
        entrance.node.setPosition(0, -40);
        this.player.setSiblingIndex(this.world.children.length - 1);
    }

    private render(dt: number): void {
        const sim = this.sim as ClimbSim;
        const vs = view.getVisibleSize();
        const left = -vs.width / 2;
        const right = vs.width / 2;
        const top = vs.height / 2;
        const bottom = -vs.height / 2;
        const risk = this.cfg!.risk;

        // Player and camera.
        const py = this.mode === 'falling' || this.mode === 'fallen' ? this.fallY : this.playerY();
        const shake = sim.tier === 'crisis' && this.mode === 'play' ? (Math.random() - 0.5) * 6 : 0;
        const tremble = sim.tier !== 'safe' && this.mode === 'play' ? Math.sin(this.elapsed * 60) * 1.5 : 0;
        this.player.setPosition(this.playerX() + tremble, py);
        const targetCam = py + this.camOffset();
        this.camY += (targetCam - this.camY) * (1 - Math.exp(-dt * 8));
        this.world.setPosition(shake, -this.camY);
        this.drawPlayer(sim);

        // Effects layer (screen space).
        const fx = this.fxG;
        fx.clear();
        const active = sim.scheduler.activeKind;
        if (active === 'rain') {
            fx.fillColor = new Color(0, 0, 20, 90);
            fx.rect(left, bottom, vs.width, vs.height);
            fx.fill();
            fx.strokeColor = alpha(C.rain, 160);
            fx.lineWidth = 2;
            for (let i = 0; i < 60; i++) {
                const x = left + ((i * 97 + this.elapsed * 300) % vs.width);
                const y = bottom + ((i * 211 - this.elapsed * 900) % vs.height + vs.height) % vs.height;
                fx.moveTo(x, y);
                fx.lineTo(x - 6, y - 24);
            }
            fx.stroke();
        } else if (active === 'wind') {
            fx.strokeColor = alpha(C.wind, 140);
            fx.lineWidth = 3;
            for (let i = 0; i < 14; i++) {
                const y = bottom + (i * 173) % vs.height;
                const x = left + ((i * 131 + this.elapsed * 700) % (vs.width + 200)) - 100;
                fx.moveTo(x, y);
                fx.lineTo(x + 90, y);
            }
            fx.stroke();
        } else if (active === 'eagle') {
            const t = 1 - sim.scheduler.left / sim.scheduler.activeTotal;
            const ex = left - 60 + t * (vs.width + 120);
            const ey = (py - this.camY) + 220;
            fx.fillColor = C.eagle;
            fx.moveTo(ex - 40, ey + 10);
            fx.lineTo(ex, ey - 6);
            fx.lineTo(ex + 40, ey + 10);
            fx.lineTo(ex, ey + 2);
            fx.close();
            fx.fill();
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
        const floor = this.mode === 'falling' || this.mode === 'fallen'
            ? sim.floorAt(Math.floor((this.fallY - CELL / 2) / CELL))
            : sim.floor;
        this.floorLabel.string = floor === null ? sim.level.name : `${floor}F`;
        this.floorLabel.node.setPosition(0, top - 60);
        this.levelLabel.string = `第 ${sim.level.id} 關 ${sim.level.name} ${sim.level.floors.replace('-', '–')}`;
        this.levelLabel.node.setPosition(0, top - 108);
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

        // Risk meter (left, vertical).
        const mx = left + 30;
        const my = -220;
        const mh = 440;
        h.fillColor = new Color(0, 0, 0, 150);
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

        // Event icon (top-left): blinks during warning, time bar while active.
        const s = sim.scheduler;
        const kind = s.state === 'warning' || s.state === 'active' ? s.kind : null;
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

        // Overlay dim.
        if (this.overlayLabel.node.active) {
            h.fillColor = C.dim;
            h.rect(left, -260, vs.width, 520);
            h.fill();
            this.overlayLabel.node.setPosition(0, 0);
        }
    }

    private drawPlayer(sim: ClimbSim): void {
        const g = this.playerG;
        g.clear();
        const grip = sim.gripping && this.mode !== 'falling';
        const a = grip ? 150 : 255;
        const reach = sim.stepping ? Math.sin(sim.stepT * Math.PI) * 8 : 0;
        // Limbs.
        g.strokeColor = alpha(C.skin, a);
        g.lineWidth = 6;
        const armY = grip ? 14 : 18 + reach;
        g.moveTo(-10, 8); g.lineTo(-22, armY);
        g.moveTo(10, 8); g.lineTo(22, grip ? 14 : 18 - reach);
        g.moveTo(-6, -14); g.lineTo(-16, -26 + reach);
        g.moveTo(6, -14); g.lineTo(16, -26 - reach);
        g.stroke();
        // Body and head.
        g.fillColor = alpha(sim.tier === 'crisis' && Math.floor(this.elapsed * 10) % 2 === 0 ? C.riskCrisis : C.body, a);
        g.rect(-12, -16, 24, 30);
        g.fill();
        g.fillColor = alpha(C.skin, a);
        g.circle(0, grip ? 18 : 24, 10);
        g.fill();
        if (sim.eagleSpotSec > 0) {
            g.fillColor = C.riskCrisis;
            g.rect(-3, 44, 6, 18);
            g.rect(-3, 36, 6, 5);
            g.fill();
        }
    }
}
