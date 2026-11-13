/**
 * Climb gameplay rules: seeded RNG, wall grid with obstacles, event scheduler and the
 * per-frame climb simulation. Pure TypeScript on purpose (no `cc` import, type-only
 * imports) so it runs under plain `node --test`. Every tunable number comes from levels.json.
 */
import type { EventKind, EventsConfig, LevelConfig, LevelDef, WidthConfig } from '../config/LevelConfig';

// ---------------------------------------------------------------- RNG

export type Rng = () => number;

/** mulberry32: small, fast, deterministic. Returns floats in [0, 1). */
export function createRng(seed: number): Rng {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A fresh 32-bit seed for a new run. Stored with the run so it can be replayed. */
export function randomSeed(): number {
    return Math.floor(Math.random() * 4294967296) >>> 0;
}

function randInt(rng: Rng, min: number, maxInclusive: number): number {
    return min + Math.floor(rng() * (maxInclusive - min + 1));
}

// ---------------------------------------------------------------- Wall

export type Zone = 'safe' | 'danger' | 'out';

export interface Wall {
    readonly cols: number;
    readonly rows: number;
    readonly safe: number;
    readonly danger: number;
    /** Column the climber starts on (row 0). */
    readonly startCol: number;
    /** Keys are `row * cols + col`. */
    readonly obstacles: ReadonlySet<number>;
}

/** Rows per obstacle block (GDD: "每 12 列至少 1 個"). */
export const OBSTACLE_BLOCK_ROWS = 12;

export function zoneOf(wall: Wall, col: number): Zone {
    if (col < 0 || col >= wall.cols) return 'out';
    return col < wall.danger || col >= wall.cols - wall.danger ? 'danger' : 'safe';
}

export function isObstacle(wall: Wall, col: number, row: number): boolean {
    return wall.obstacles.has(row * wall.cols + col);
}

/**
 * True when the top row can be reached from the start using only safe columns and no
 * obstacles (GDD 4: there is always a route that never touches a danger column).
 */
export function hasSafeRoute(wall: Wall): boolean {
    const { cols, rows } = wall;
    if (zoneOf(wall, wall.startCol) !== 'safe' || isObstacle(wall, wall.startCol, 0)) return false;
    const seen = new Uint8Array(cols * rows);
    const stack = [wall.startCol];
    seen[wall.startCol] = 1;
    while (stack.length > 0) {
        const key = stack.pop() as number;
        const row = Math.floor(key / cols);
        const col = key % cols;
        if (row === rows - 1) return true;
        const next: Array<[number, number]> = [[col, row + 1], [col - 1, row], [col + 1, row], [col, row - 1]];
        for (const [c, r] of next) {
            if (r < 0 || r >= rows || zoneOf(wall, c) !== 'safe') continue;
            const k = r * cols + c;
            if (seen[k] || wall.obstacles.has(k)) continue;
            seen[k] = 1;
            stack.push(k);
        }
    }
    return false;
}

/**
 * Builds the wall for one level. Each 12-row block gets `obstaclesPer12Rows` ungrabbable
 * cells; a candidate that would cut the safe route is rejected and re-rolled.
 * Row 0 (the start row) never has obstacles.
 */
export function buildWall(width: WidthConfig, level: LevelDef, rng: Rng): Wall {
    const obstacles = new Set<number>();
    const wall: Wall = {
        cols: width.cols,
        rows: level.rows,
        safe: width.safe,
        danger: width.danger,
        startCol: Math.floor(width.cols / 2),
        obstacles,
    };
    const blocks = Math.ceil(level.rows / OBSTACLE_BLOCK_ROWS);
    for (let b = 0; b < blocks; b++) {
        const fromRow = Math.max(1, b * OBSTACLE_BLOCK_ROWS);
        const toRow = Math.min(level.rows - 1, (b + 1) * OBSTACLE_BLOCK_ROWS - 1);
        if (fromRow > toRow) continue;
        for (let n = 0; n < level.obstaclesPer12Rows; n++) {
            for (let attempt = 0; attempt < 20; attempt++) {
                const key = randInt(rng, fromRow, toRow) * wall.cols + randInt(rng, 0, wall.cols - 1);
                if (obstacles.has(key)) continue;
                obstacles.add(key);
                if (hasSafeRoute(wall)) break;
                obstacles.delete(key);
            }
        }
    }
    return wall;
}

// ---------------------------------------------------------------- Event scheduler

export type SchedulerState = 'idle' | 'warning' | 'active' | 'cooldown';

/**
 * GDD 5 / ADR-04: one crisis event at a time. Rain and eagle that come due while another
 * event runs are queued; a wind roll that collides with anything is skipped.
 * Idle -> Warning -> Active -> Cooldown -> Idle. `update` must only receive climbing time.
 */
export class EventScheduler {
    clock = 0;
    state: SchedulerState = 'idle';
    kind: EventKind | null = null;
    /** Seconds left in the current state. */
    left = 0;
    /** Length of the current Active phase, for the HUD time bar. */
    activeTotal = 0;

    private readonly queue: EventKind[] = [];
    private readonly due: Record<EventKind, number>;
    private readonly events: EventsConfig;
    private readonly windChance: number;
    private readonly rng: Rng;

    constructor(events: EventsConfig, windChance: number, rng: Rng) {
        this.events = events;
        this.windChance = windChance;
        this.rng = rng;
        this.due = {
            wind: events.wind.firstSec,
            rain: events.rain.firstSec,
            eagle: events.eagle.firstSec,
        };
    }

    /** The event whose effects apply right now (Active phase only). */
    get activeKind(): EventKind | null {
        return this.state === 'active' ? this.kind : null;
    }

    get queued(): readonly EventKind[] {
        return this.queue;
    }

    update(dt: number): void {
        this.clock += dt;
        this.tick(dt);

        for (const kind of ['eagle', 'rain'] as const) {
            while (this.clock >= this.due[kind]) {
                this.due[kind] += this.events[kind].everySec;
                this.queue.push(kind);
            }
        }
        let windHit = false;
        while (this.clock >= this.due.wind) {
            this.due.wind += this.events.wind.everySec;
            const free = this.state === 'idle' && this.queue.length === 0 && !windHit;
            if (free && this.rng() < this.windChance) windHit = true;
        }

        if (this.state !== 'idle') return;
        const next = this.queue.shift() ?? (windHit ? 'wind' : null);
        if (next) this.enter('warning', next, this.events.warningSec);
    }

    private tick(dt: number): void {
        if (this.state === 'idle') return;
        this.left -= dt;
        while (this.left <= 0 && this.state !== 'idle') {
            const carry = this.left;
            if (this.state === 'warning') {
                const kind = this.kind as EventKind;
                const [min, max] = this.events[kind].durationSec;
                this.activeTotal = min + this.rng() * (max - min);
                this.enter('active', kind, this.activeTotal + carry);
            } else if (this.state === 'active') {
                this.enter('cooldown', this.kind, this.events.cooldownSec + carry);
            } else {
                this.enter('idle', null, 0);
            }
        }
    }

    private enter(state: SchedulerState, kind: EventKind | null, left: number): void {
        this.state = state;
        this.kind = kind;
        this.left = left;
    }
}

// ---------------------------------------------------------------- Input

export interface Dir {
    dx: number;
    dy: number;
}

export const NO_DIR: Dir = { dx: 0, dy: 0 };

export function dirFromKeys(up: boolean, down: boolean, left: boolean, right: boolean): Dir {
    return { dx: (right ? 1 : 0) - (left ? 1 : 0), dy: (up ? 1 : 0) - (down ? 1 : 0) };
}

/** Eight-way stick: (x, y) is the knob offset over the stick radius. */
export function dirFromStick(x: number, y: number, deadZone: number): Dir {
    const len = Math.hypot(x, y);
    if (len < deadZone) return NO_DIR;
    const sector = Math.round(Math.atan2(y, x) / (Math.PI / 4));
    const angle = sector * (Math.PI / 4);
    return { dx: Math.round(Math.cos(angle)), dy: Math.round(Math.sin(angle)) };
}

// ---------------------------------------------------------------- Climb simulation

export type Phase = 'climbing' | 'fallen' | 'cleared';
export type FallCause = 'edge' | 'wind' | 'rain' | 'eagle';
export type RiskTier = 'safe' | 'tense' | 'crisis';

/** GDD 7 fall messages. */
export const FALL_TEXT: Record<FallCause, string> = {
    edge: '太靠邊了…',
    wind: '風大時要抓牢',
    rain: '雨天手滑了',
    eagle: '被老鷹看到了',
};

export class ClimbSim {
    readonly level: LevelDef;
    readonly wall: Wall;
    readonly scheduler: EventScheduler;

    phase: Phase = 'climbing';
    fallCause: FallCause | null = null;
    /** Current cell. While a step is animating this is already the target cell. */
    col: number;
    row = 0;
    fromCol: number;
    fromRow = 0;
    /** Step progress 0..1, or -1 when not stepping. */
    stepT = -1;
    risk = 0;
    gripping = true;
    /** Seconds of climbing time; pauses and transitions are never fed in. */
    climbSec = 0;
    maxRow = 0;
    /** Seconds the eagle has been watching a moving climber (0 when not spotted). */
    eagleSpotSec = 0;

    readonly seed: number;

    private readonly cfg: LevelConfig;
    private idleSec = 0;
    private holdSec = 0;
    private rainMoveSec = 0;

    constructor(cfg: LevelConfig, levelIndex: number, seed: number) {
        this.cfg = cfg;
        this.seed = seed;
        const level = cfg.levels[levelIndex];
        if (!level) throw new Error(`no level at index ${levelIndex}`);
        const width = cfg.widths[level.width];
        const rng = createRng(seed);
        this.level = level;
        this.wall = buildWall(width, level, rng);
        this.scheduler = new EventScheduler(cfg.events, level.windChance, rng);
        this.col = this.wall.startCol;
        this.fromCol = this.col;
        this.gripping = true;
        this.idleSec = cfg.player.gripDelaySec;
    }

    get stepping(): boolean {
        return this.stepT >= 0;
    }

    get tier(): RiskTier {
        const r = this.cfg.risk;
        if (this.risk >= r.crisis) return 'crisis';
        if (this.risk >= r.tense) return 'tense';
        return 'safe';
    }

    /** Floor the climber is on, e.g. 1..8 on level 1; null on the spire. */
    floorAt(row: number): number | null {
        const { floorFrom, floorTo } = this.level;
        if (floorFrom === null || floorTo === null) return null;
        const f = floorFrom + Math.floor(Math.max(0, row) / this.cfg.player.rowsPerFloor);
        return Math.min(floorTo, f);
    }

    get floor(): number | null {
        return this.floorAt(Math.min(this.row, this.wall.rows - 1));
    }

    get maxFloor(): number | null {
        return this.floorAt(Math.min(this.maxRow, this.wall.rows - 1));
    }

    update(dt: number, dir: Dir): void {
        if (this.phase !== 'climbing' || dt <= 0) return;
        const { player, risk } = this.cfg;
        this.climbSec += dt;
        this.scheduler.update(dt);

        const hasInput = dir.dx !== 0 || dir.dy !== 0;

        if (this.stepping) {
            this.stepT += dt / player.cellSec;
            if (this.stepT >= 1) {
                this.stepT = -1;
                this.fromCol = this.col;
                this.fromRow = this.row;
                if (this.col < 0 || this.col >= this.wall.cols) {
                    this.fall('edge');
                    return;
                }
                if (this.row >= this.wall.rows) {
                    this.phase = 'cleared';
                    return;
                }
            }
        }

        if (hasInput && !this.stepping) {
            this.holdSec += dt;
            const delay = this.tier === 'crisis' ? player.crisisInputDelaySec : 0;
            if (this.holdSec >= delay) this.tryStep(dir);
        } else if (!hasInput) {
            this.holdSec = 0;
        }

        const moving = hasInput || this.stepping;
        if (moving) {
            this.idleSec = 0;
            this.gripping = false;
        } else {
            this.idleSec += dt;
            this.gripping = this.idleSec >= player.gripDelaySec;
        }

        // Risk (ADR-03). Zone uses the cell being climbed onto.
        const zone = zoneOf(this.wall, this.col);
        let perSec = 0;
        let cause: FallCause = 'edge';
        if (zone === 'danger') perSec += risk.dangerPerSec;
        else if (zone === 'safe') perSec += this.gripping ? risk.calmGripPerSec : risk.calmClimbPerSec;

        const active = this.scheduler.activeKind;
        if (active === 'wind' && moving) {
            perSec += risk.windMovePerSec;
            cause = 'wind';
        }
        this.risk = Math.min(risk.max, Math.max(0, this.risk + perSec * dt));

        if (active === 'rain' && moving) {
            this.rainMoveSec += dt;
            if (this.rainMoveSec > risk.rainGraceSec) {
                this.fall('rain');
                return;
            }
        } else {
            this.rainMoveSec = 0;
        }

        if (active === 'eagle' && moving) {
            this.eagleSpotSec += dt;
            if (this.eagleSpotSec >= this.cfg.events.eagle.spotSec) {
                this.fall('eagle');
                return;
            }
        } else {
            this.eagleSpotSec = 0;
        }

        if (this.risk >= risk.max) this.fall(cause);
    }

    private tryStep(dir: Dir): void {
        // Vertical first (GDD 3); fall back to the horizontal part when the way up is blocked.
        const options: Array<[number, number]> = [];
        if (dir.dy !== 0) options.push([0, Math.sign(dir.dy)]);
        if (dir.dx !== 0) options.push([Math.sign(dir.dx), 0]);
        for (const [dx, dy] of options) {
            const col = this.col + dx;
            const row = this.row + dy;
            if (row < 0) continue;
            if (row < this.wall.rows && col >= 0 && col < this.wall.cols && isObstacle(this.wall, col, row)) continue;
            this.fromCol = this.col;
            this.fromRow = this.row;
            this.col = col;
            this.row = row;
            this.maxRow = Math.max(this.maxRow, Math.min(row, this.wall.rows - 1));
            this.stepT = 0;
            return;
        }
    }

    private fall(cause: FallCause): void {
        this.phase = 'fallen';
        this.fallCause = cause;
        this.risk = this.cfg.risk.max;
        this.stepT = -1;
    }
}

/** "1:05.3" style climbing time. */
export function formatClimbTime(sec: number): string {
    const tenths = Math.floor(sec * 10);
    const m = Math.floor(tenths / 600);
    const s = Math.floor((tenths % 600) / 10);
    return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}
