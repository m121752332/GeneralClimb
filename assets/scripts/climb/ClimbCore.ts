/**
 * Climb gameplay rules: seeded RNG, wall grid with obstacles, event scheduler and the
 * per-frame climb simulation. Pure TypeScript on purpose (no `cc` import, type-only
 * imports) so it runs under plain `node --test`. Every tunable number comes from levels.json.
 */
import type { EventKind, EventsConfig, LevelConfig, LevelDef, PagodaFlareConfig, WidthConfig } from '../config/LevelConfig';

// ---------------------------------------------------------------- Practice (GDD §7)

/** Level id of the practice house; real levels are 1..14. */
export const PRACTICE_LEVEL_ID = 0;

/**
 * Practice mode's only level: a low house of `practice.floors` floors on the `practice.width`
 * wall, standing on the ground (start platform), no random wind and no obstacles.
 */
export function practiceLevel(cfg: LevelConfig): LevelDef {
    const floors = cfg.practice.floors;
    return {
        id: PRACTICE_LEVEL_ID,
        name: '三層樓平房',
        floors: `1-${floors}F`,
        width: cfg.practice.width,
        windChance: 0,
        obstaclesPer12Rows: 0,
        startPlatform: true,
        floorFrom: 1,
        floorTo: floors,
        rows: floors * cfg.player.rowsPerFloor,
    };
}

/**
 * Rows at which the practice demo events start: `practice.demoAt` (shares of the house
 * height) turned into rows, never the ground row nor the roof.
 */
export function demoRows(rows: number, demoAt: readonly number[]): number[] {
    return demoAt.map((f) => Math.min(rows - 1, Math.max(1, Math.round(rows * f))));
}

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
    /** Columns on one face of the tower. */
    readonly cols: number;
    /**
     * Faces the climbable columns wrap around (ADR-10). 1 = a single flat wall with fall
     * lines on both sides; 4 = the square tower, where stepping past a face's outer column
     * goes round the corner onto the next face and there is no edge to fall off.
     */
    readonly faces: number;
    /** Columns all the way round: `cols * faces`. Columns are 0..ring-1, face = col / cols. */
    readonly ring: number;
    readonly rows: number;
    readonly safe: number;
    readonly danger: number;
    /** Column the climber starts on (row 0). */
    readonly startCol: number;
    /** Pagoda flare (GDD 4): the top `flareRows` rows get `flareExtra` more danger columns per side. */
    readonly flareRows: number;
    readonly flareExtra: number;
    /** Keys are `row * ring + col`. */
    readonly obstacles: ReadonlySet<number>;
}

/** Rows per obstacle block (GDD: "每 12 列至少 1 個"). */
export const OBSTACLE_BLOCK_ROWS = 12;

/** Danger columns per side on a row (wider near the top of a flared section). */
export function dangerAt(wall: Wall, row: number): number {
    const flared = wall.flareRows > 0 && row >= wall.rows - wall.flareRows;
    return Math.min(Math.floor((wall.cols - 1) / 2), wall.danger + (flared ? wall.flareExtra : 0));
}

/** Wraps a column onto the ring on a wrapping tower; unchanged on a flat wall. */
export function wrapCol(wall: Wall, col: number): number {
    return wall.faces > 1 ? ((col % wall.ring) + wall.ring) % wall.ring : col;
}

/** Column within its face, 0..cols-1. */
export function localCol(wall: Wall, col: number): number {
    return wrapCol(wall, col) % wall.cols;
}

export function zoneOf(wall: Wall, col: number, row = 0): Zone {
    if (wall.faces === 1 && (col < 0 || col >= wall.cols)) return 'out';
    const local = localCol(wall, col);
    const danger = dangerAt(wall, row);
    return local < danger || local >= wall.cols - danger ? 'danger' : 'safe';
}

/** Flare that applies to a level, or none outside `pagodaFlare.levels`. */
export function flareFor(flare: PagodaFlareConfig, level: LevelDef): { rows: number; extra: number } {
    const [from, to] = flare.levels;
    return level.id >= from && level.id <= to ? { rows: flare.topRows, extra: flare.extraDangerPerSide } : { rows: 0, extra: 0 };
}

export function isObstacle(wall: Wall, col: number, row: number): boolean {
    return wall.obstacles.has(row * wall.ring + wrapCol(wall, col));
}

/**
 * True when the top row can be reached from the start using only safe columns and no
 * obstacles (GDD 4: there is always a route that never touches a danger column).
 */
export function hasSafeRoute(wall: Wall): boolean {
    const { ring, rows } = wall;
    if (zoneOf(wall, wall.startCol, 0) !== 'safe' || isObstacle(wall, wall.startCol, 0)) return false;
    const seen = new Uint8Array(ring * rows);
    const stack = [wall.startCol];
    seen[wall.startCol] = 1;
    while (stack.length > 0) {
        const key = stack.pop() as number;
        const row = Math.floor(key / ring);
        const col = key % ring;
        if (row === rows - 1) return true;
        const next: Array<[number, number]> = [[col, row + 1], [col - 1, row], [col + 1, row], [col, row - 1]];
        for (const [cc, r] of next) {
            if (r < 0 || r >= rows || zoneOf(wall, cc, r) !== 'safe') continue;
            const c = wrapCol(wall, cc);
            const k = r * ring + c;
            if (seen[k] || wall.obstacles.has(k)) continue;
            seen[k] = 1;
            stack.push(k);
        }
    }
    return false;
}

/**
 * Builds the wall for one level. Each 12-row block gets `obstaclesPer12Rows` ungrabbable
 * cells per face; a candidate that would cut the safe route is rejected and re-rolled.
 * Row 0 (the start row) never has obstacles. The climber starts in the middle of face 0.
 */
export function buildWall(width: WidthConfig, level: LevelDef, rng: Rng, flare = { rows: 0, extra: 0 }, faces = 1): Wall {
    const obstacles = new Set<number>();
    const wall: Wall = {
        cols: width.cols,
        faces,
        ring: width.cols * faces,
        rows: level.rows,
        safe: width.safe,
        danger: width.danger,
        startCol: Math.floor(width.cols / 2),
        flareRows: Math.min(flare.rows, level.rows),
        flareExtra: flare.extra,
        obstacles,
    };
    const blocks = Math.ceil(level.rows / OBSTACLE_BLOCK_ROWS);
    for (let b = 0; b < blocks; b++) {
        const fromRow = Math.max(1, b * OBSTACLE_BLOCK_ROWS);
        const toRow = Math.min(level.rows - 1, (b + 1) * OBSTACLE_BLOCK_ROWS - 1);
        if (fromRow > toRow) continue;
        for (let n = 0; n < level.obstaclesPer12Rows * faces; n++) {
            for (let attempt = 0; attempt < 20; attempt++) {
                const key = randInt(rng, fromRow, toRow) * wall.ring + randInt(rng, 0, wall.ring - 1);
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
    /** Wind direction for the current wind event: -1 blows left, +1 right. */
    windDir = 1;

    private readonly queue: EventKind[] = [];
    private readonly due: Record<EventKind, number>;
    private readonly events: EventsConfig;
    private windChance: number;
    private readonly rng: Rng;

    /** Practice: no timed events; demo events come only from trigger() and use the shortest duration. */
    readonly demo: boolean;

    constructor(events: EventsConfig, windChance: number, rng: Rng, demo = false) {
        this.events = events;
        this.windChance = windChance;
        this.rng = rng;
        this.demo = demo;
        this.due = demo
            ? { wind: Infinity, rain: Infinity, eagle: Infinity }
            : { wind: events.wind.firstSec, rain: events.rain.firstSec, eagle: events.eagle.firstSec };
    }

    /** Queues one event now (practice demos). It still waits for any running event and its cooldown. */
    trigger(kind: EventKind): void {
        this.queue.push(kind);
    }

    /** The event whose effects apply right now (Active phase only). */
    get activeKind(): EventKind | null {
        return this.state === 'active' ? this.kind : null;
    }

    /** The run keeps one scheduler across levels; only the wind chance changes per level. */
    setWindChance(chance: number): void {
        this.windChance = chance;
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
        while (this.left <= 0 && (this.state as SchedulerState) !== 'idle') {
            const carry = this.left;
            if (this.state === 'warning') {
                const kind = this.kind as EventKind;
                const [min, max] = this.events[kind].durationSec;
                this.activeTotal = this.demo ? min : min + this.rng() * (max - min);
                if (kind === 'wind') this.windDir = this.rng() < 0.5 ? -1 : 1;
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

/** An eagle dive: progress 0..1 and the cell it is aimed at. */
export interface EagleDive {
    t: number;
    col: number;
    row: number;
}

/** GDD 7 fall messages. */
export const FALL_TEXT: Record<FallCause, string> = {
    edge: '太靠邊了…',
    wind: '風大時要抓牢',
    rain: '雨天手滑了',
    eagle: '被老鷹撲下來了',
};

/** What a run carries from one level into the next (ADR-03: risk is not reset between levels). */
export interface RunCarry {
    rng: Rng;
    scheduler: EventScheduler;
    risk: number;
    climbSec: number;
    runMaxFloor: number | null;
}

export class ClimbSim {
    readonly level: LevelDef;
    readonly levelIndex: number;
    readonly wall: Wall;
    readonly scheduler: EventScheduler;
    readonly seed: number;

    phase: Phase = 'climbing';
    fallCause: FallCause | null = null;
    /** Current cell. While a step is animating this is already the target cell. */
    col: number;
    row = 0;
    fromCol: number;
    fromRow = 0;
    /** Step progress 0..1, or -1 when not stepping. */
    stepT = -1;
    /** True while the current step is a wind push rather than the player's own move. */
    pushed = false;
    risk = 0;
    gripping = true;
    /** Seconds of climbing time for the whole run; pauses and transitions are never fed in. */
    climbSec = 0;
    maxRow = 0;
    /** Climb speed multiplier (developer mode only; 1 for players). Scales step time only. */
    speed = 1;
    /**
     * Red eyes: seconds left before the eagle dives, once it has seen the climber move
     * (0 = not locked on). Locking on is instant and cannot be undone by freezing.
     */
    eagleGlareSec = 0;
    /**
     * The eagle's dive, once it has spotted a moving climber: aimed at the cell the climber
     * was on when it dived, `t` 0..1 over `events.eagle.diveSec`. Stays at t = 1 after a hit.
     */
    eagleDive: EagleDive | null = null;
    /** After a missed dive the eagle pulls up for this long before it can spot again. */
    eagleRecoverSec = 0;

    private readonly cfg: LevelConfig;
    private readonly rng: Rng;
    private readonly prevMaxFloor: number | null;
    private idleSec = 0;
    private holdSec = 0;
    private rainMoveSec = 0;
    private windPushSec = 0;

    /**
     * Practice run (GDD §7): the practice house, each demo event once at its row, gentler
     * penalties (scaled by `practice.intensity`), no next level and nothing recorded.
     */
    readonly practice: boolean;
    /** Practice: rows where the demo events start, and how many have started. */
    readonly demoRows: readonly number[];
    demoIndex = 0;

    constructor(cfg: LevelConfig, levelIndex: number, seed: number, carry?: RunCarry, practice = false) {
        this.cfg = cfg;
        this.seed = seed;
        this.practice = practice;
        const level = practice ? practiceLevel(cfg) : cfg.levels[levelIndex];
        if (!level) throw new Error(`no level at index ${levelIndex}`);
        const width = cfg.widths[level.width];
        this.rng = carry ? carry.rng : createRng(seed);
        this.level = level;
        this.levelIndex = levelIndex;
        // A ladder (one column) is never wrapped round the tower.
        const faces = width.cols === 1 ? 1 : cfg.tower.faces;
        this.wall = buildWall(width, level, this.rng, flareFor(cfg.pagodaFlare, level), faces);
        this.scheduler = carry ? carry.scheduler : new EventScheduler(cfg.events, level.windChance, this.rng, practice);
        this.demoRows = practice ? demoRows(level.rows, cfg.practice.demoAt) : [];
        this.scheduler.setWindChance(level.windChance);
        this.risk = carry ? carry.risk : 0;
        this.climbSec = carry ? carry.climbSec : 0;
        this.prevMaxFloor = carry ? carry.runMaxFloor : null;
        this.col = this.wall.startCol;
        this.fromCol = this.col;
        this.idleSec = cfg.player.gripDelaySec;
    }

    /**
     * The next level of the same run (same seed stream, scheduler, risk and time), or null
     * after the last level (the summit).
     */
    next(): ClimbSim | null {
        if (this.phase !== 'cleared' || this.practice) return null;
        const nextLevel = this.cfg.levels[this.levelIndex + 1];
        if (!nextLevel) return null;
        const sim = new ClimbSim(this.cfg, this.levelIndex + 1, this.seed, {
            rng: this.rng,
            scheduler: this.scheduler,
            risk: this.risk,
            climbSec: this.climbSec,
            runMaxFloor: this.runMaxFloor,
        });
        sim.speed = this.speed;
        return sim;
    }

    get stepping(): boolean {
        return this.stepT >= 0;
    }

    /**
     * Standing on the level's start platform (plaza, ledge or roof): walking, no danger
     * zone and no passive risk; only the weather events still count (ADR-10).
     */
    get onPlatform(): boolean {
        return this.level.startPlatform && this.row === 0;
    }

    /** True after clearing the last level: the run reached the top of the spire. */
    get summit(): boolean {
        return !this.practice && this.phase === 'cleared' && this.levelIndex === this.cfg.levels.length - 1;
    }

    /**
     * Penalty strength: 1 in a real run, `practice.intensity` in practice. It softens what an
     * event does (slower wind push and risk, longer rain grace and eagle spotting time); the
     * events still last their shortest configured time.
     */
    get intensity(): number {
        return this.practice ? this.cfg.practice.intensity : 1;
    }

    /** Practice demo events still to come (not yet started). */
    get demosLeft(): number {
        return this.demoRows.length - this.demoIndex;
    }

    /**
     * Practice: the roof stays shut while a demo event is still to come, queued, warning or
     * running, so a player who rushes up still sees every one before practice ends.
     */
    get roofLocked(): boolean {
        if (!this.practice) return false;
        const s = this.scheduler;
        return this.demosLeft > 0 || s.queued.length > 0 || s.state === 'warning' || s.state === 'active';
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

    /** Highest floor reached in the whole run. */
    get runMaxFloor(): number | null {
        const here = this.maxFloor;
        if (here === null) return this.prevMaxFloor;
        return this.prevMaxFloor === null ? here : Math.max(here, this.prevMaxFloor);
    }

    update(dt: number, dir: Dir): void {
        if (this.phase !== 'climbing' || dt <= 0) return;
        const { player, risk } = this.cfg;
        this.climbSec += dt;
        this.scheduler.update(dt);
        const active = this.scheduler.activeKind;

        const hasInput = dir.dx !== 0 || dir.dy !== 0;

        if (this.stepping) {
            this.stepT += (dt * this.speed) / player.cellSec;
            if (this.stepT >= 1) {
                const wasPush = this.pushed;
                this.stepT = -1;
                this.pushed = false;
                this.fromCol = this.col;
                this.fromRow = this.row;
                if (this.wall.faces === 1 && (this.col < 0 || this.col >= this.wall.cols)) {
                    this.fall(wasPush ? 'wind' : 'edge');
                    return;
                }
                if (this.row >= this.wall.rows) {
                    this.phase = 'cleared';
                    return;
                }
            }
        }

        // Practice: each demo event starts once the climber first reaches its row.
        while (this.demoIndex < this.demoRows.length && this.maxRow >= this.demoRows[this.demoIndex]) {
            this.scheduler.trigger(this.cfg.practice.demoEvents[this.demoIndex]);
            this.demoIndex++;
        }

        const k = this.intensity;
        // Wind (ADR-04): moving in a gust pushes the climber one cell outward every pushEverySec.
        // Not while standing on a platform: there is nothing to be pushed off.
        const pushEvery = this.cfg.events.wind.pushEverySec / k;
        if (active === 'wind' && hasInput && !this.onPlatform) {
            this.windPushSec += dt;
            if (!this.stepping && this.windPushSec >= pushEvery) {
                this.windPushSec -= pushEvery;
                this.push();
            }
        } else {
            this.windPushSec = 0;
        }

        if (hasInput && !this.stepping) {
            this.holdSec += dt;
            const delay = this.tier === 'crisis' ? player.crisisInputDelaySec : 0;
            if (this.holdSec >= delay) this.tryStep(dir);
        } else if (!hasInput) {
            this.holdSec = 0;
        }

        const moving = hasInput || (this.stepping && !this.pushed);
        if (moving) {
            this.idleSec = 0;
            this.gripping = false;
        } else {
            this.idleSec += dt;
            this.gripping = this.idleSec >= player.gripDelaySec;
        }

        // Risk (ADR-03). Zone uses the cell being climbed onto; a platform is always calm.
        const zone = zoneOf(this.wall, this.col, Math.min(this.row, this.wall.rows - 1));
        let perSec = 0;
        let cause: FallCause = 'edge';
        if (this.onPlatform) perSec += risk.calmGripPerSec;
        else if (zone === 'danger') perSec += risk.dangerPerSec;
        else if (zone === 'safe') perSec += this.gripping ? risk.calmGripPerSec : risk.calmClimbPerSec;

        if (active === 'wind' && moving) {
            perSec += risk.windMovePerSec * k;
            cause = 'wind';
        }
        this.risk = Math.min(risk.max, Math.max(0, this.risk + perSec * dt));

        if (active === 'rain' && moving) {
            this.rainMoveSec += dt;
            if (this.rainMoveSec > risk.rainGraceSec / k) {
                this.fall('rain');
                return;
            }
        } else {
            this.rainMoveSec = 0;
        }

        // Eagle: any move while it is out locks it on (red eyes); spotSec later it dives at the
        // cell the climber is on then. The dive is committed: when it lands, a climber within
        // hitCols / hitRows of the aim (even a graze) is knocked off; one who got far enough
        // away is missed.
        const eagle = this.cfg.events.eagle;
        if (this.eagleDive) {
            this.eagleDive.t = Math.min(1, this.eagleDive.t + dt / eagle.diveSec);
            if (this.eagleDive.t >= 1) {
                if (this.eagleHits(this.eagleDive)) {
                    this.fall('eagle');
                    return;
                }
                this.eagleDive = null;
                this.eagleRecoverSec = eagle.diveSec;
            }
        } else if (this.eagleRecoverSec > 0) {
            this.eagleRecoverSec = Math.max(0, this.eagleRecoverSec - dt);
        } else if (this.eagleGlareSec > 0) {
            this.eagleGlareSec = Math.max(0, this.eagleGlareSec - dt);
            if (this.eagleGlareSec === 0) {
                this.eagleDive = { t: 0, col: this.col, row: Math.min(this.row, this.wall.rows - 1) };
            }
        } else if (active === 'eagle' && moving) {
            this.eagleGlareSec = eagle.spotSec / k;
        }

        if (this.risk >= risk.max) this.fall(cause);
    }

    /**
     * Outward = towards the nearer edge of the face (a corner, on the tower); from the centre
     * column, the way the wind blows.
     */
    private push(): void {
        const centre = (this.wall.cols - 1) / 2;
        const local = localCol(this.wall, this.col);
        const dx = local < centre ? -1 : local > centre ? 1 : this.scheduler.windDir;
        const row = Math.min(this.row, this.wall.rows - 1);
        const col = wrapCol(this.wall, this.col + dx);
        if (zoneOf(this.wall, col, row) !== 'out' && isObstacle(this.wall, col, row)) return;
        this.fromCol = this.col;
        this.fromRow = this.row;
        this.col = col;
        this.stepT = 0;
        this.pushed = true;
    }

    private tryStep(dir: Dir): void {
        // Vertical first (GDD 3); fall back to the horizontal part when the way up is blocked.
        const options: Array<[number, number]> = [];
        if (dir.dy !== 0) options.push([0, Math.sign(dir.dy)]);
        // A ladder has nowhere to go sideways; a flat wall's platform has no edge to walk off.
        const ladder = this.wall.cols === 1;
        const flatPlatformEdge = this.wall.faces === 1 && this.onPlatform;
        if (dir.dx !== 0 && !ladder) {
            const c = this.col + Math.sign(dir.dx);
            if (!(flatPlatformEdge && (c < 0 || c >= this.wall.cols))) options.push([Math.sign(dir.dx), 0]);
        }
        for (const [dx, dy] of options) {
            const col = wrapCol(this.wall, this.col + dx);
            const row = this.row + dy;
            if (row < 0) continue;
            if (row >= this.wall.rows && this.roofLocked) continue;
            if (row < this.wall.rows && zoneOf(this.wall, col, row) !== 'out' && isObstacle(this.wall, col, row)) continue;
            this.fromCol = this.col;
            this.fromRow = this.row;
            this.col = col;
            this.row = row;
            this.maxRow = Math.max(this.maxRow, Math.min(row, this.wall.rows - 1));
            this.stepT = 0;
            this.pushed = false;
            return;
        }
    }

    /** True when the climber is within the dive's reach (columns round the ring, rows up or down). */
    eagleHits(dive: EagleDive): boolean {
        const { hitCols, hitRows } = this.cfg.events.eagle;
        let dc = Math.abs(this.col - dive.col);
        if (this.wall.faces > 1) dc = Math.min(dc, this.wall.ring - dc);
        const row = Math.min(this.row, this.wall.rows - 1);
        return dc <= hitCols && Math.abs(row - dive.row) <= hitRows;
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
