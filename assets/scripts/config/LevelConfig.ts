/**
 * levels.json schema and validation.
 * Pure TypeScript on purpose (no `cc` import) so it can be unit-tested with plain Node.
 */

export type EventKind = 'wind' | 'rain' | 'eagle';

export interface PlayerConfig {
    cellSec: number;
    gripDelaySec: number;
    rowsPerFloor: number;
    crisisInputDelaySec: number;
    ladderRows: number;
}

export interface RiskConfig {
    dangerPerSec: number;
    windMovePerSec: number;
    rainGraceSec: number;
    calmGripPerSec: number;
    calmClimbPerSec: number;
    tense: number;
    crisis: number;
    max: number;
}

export interface TimedEventConfig {
    everySec: number;
    firstSec: number;
    /** [min, max] seconds */
    durationSec: [number, number];
}

export interface EventsConfig {
    warningSec: number;
    cooldownSec: number;
    /** pushEverySec: moving in a gust pushes the climber one cell outward this often. */
    wind: TimedEventConfig & { pushEverySec: number };
    rain: TimedEventConfig;
    eagle: TimedEventConfig & { spotSec: number };
}

export interface WidthConfig {
    cols: number;
    safe: number;
    danger: number;
}

export interface PagodaFlareConfig {
    /** [fromLevelId, toLevelId], inclusive */
    levels: [number, number];
    topRows: number;
    extraDangerPerSide: number;
}

/** ADR-10: how the climbable columns wrap around the tower. */
export interface TowerConfig {
    /** 1 = one flat wall (fall lines at both edges); 4 = all four faces, round the corners. */
    faces: number;
}

export interface LevelDef {
    id: number;
    name: string;
    /** "27-34F" or "spire-lower" / "spire-upper" */
    floors: string;
    width: string;
    windChance: number;
    obstaclesPer12Rows: number;
    /** Derived: first / last floor, null on the spire. */
    floorFrom: number | null;
    floorTo: number | null;
    /** Derived: grid rows to climb in this level. */
    rows: number;
}

export interface PracticeConfig {
    floors: number;
    width: string;
    demoEvents: EventKind[];
    intensity: number;
}

export interface LevelConfig {
    version: number;
    player: PlayerConfig;
    risk: RiskConfig;
    events: EventsConfig;
    widths: Record<string, WidthConfig>;
    pagodaFlare: PagodaFlareConfig;
    tower: TowerConfig;
    levels: LevelDef[];
    practice: PracticeConfig;
}

/** Schema version this build understands. */
export const SUPPORTED_VERSION = 1;
/** ADR-05: the run is always 14 levels. */
export const LEVEL_COUNT = 14;

const EVENT_KINDS: readonly string[] = ['wind', 'rain', 'eagle'];
const FLOOR_RANGE = /^(\d+)-(\d+)F$/;
const SPIRE = /^spire-(lower|upper)$/;

export class LevelConfigError extends Error {
    readonly issues: string[];

    constructor(issues: string[]) {
        super(`levels.json invalid (${issues.length}):\n- ${issues.join('\n- ')}`);
        this.name = 'LevelConfigError';
        this.issues = issues;
    }
}

type Obj = Record<string, unknown>;

interface NumRule {
    /** value >= min */
    min?: number;
    /** value <= max */
    max?: number;
    /** value > gt */
    gt?: number;
    /** value < lt */
    lt?: number;
    int?: boolean;
}

function isObj(v: unknown): v is Obj {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class Checker {
    readonly issues: string[] = [];

    fail(path: string, msg: string): void {
        this.issues.push(`${path}: ${msg}`);
    }

    obj(parent: Obj | undefined, key: string, path: string): Obj | undefined {
        if (!parent) return undefined;
        const v = parent[key];
        if (!isObj(v)) {
            this.fail(`${path}.${key}`, 'must be an object');
            return undefined;
        }
        return v;
    }

    /** Returns NaN (and records an issue) when the value is missing or out of range. */
    num(parent: Obj | undefined, key: string, path: string, rule: NumRule = {}): number {
        if (!parent) return NaN;
        return this.numValue(parent[key], `${path}.${key}`, rule);
    }

    numValue(v: unknown, at: string, rule: NumRule = {}): number {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
            this.fail(at, 'must be a finite number');
            return NaN;
        }
        if (rule.int && !Number.isInteger(v)) this.fail(at, `must be an integer, got ${v}`);
        if (rule.min !== undefined && v < rule.min) this.fail(at, `must be >= ${rule.min}, got ${v}`);
        if (rule.max !== undefined && v > rule.max) this.fail(at, `must be <= ${rule.max}, got ${v}`);
        if (rule.gt !== undefined && !(v > rule.gt)) this.fail(at, `must be > ${rule.gt}, got ${v}`);
        if (rule.lt !== undefined && !(v < rule.lt)) this.fail(at, `must be < ${rule.lt}, got ${v}`);
        return v;
    }

    str(parent: Obj | undefined, key: string, path: string): string {
        if (!parent) return '';
        const v = parent[key];
        if (typeof v !== 'string' || v.length === 0) {
            this.fail(`${path}.${key}`, 'must be a non-empty string');
            return '';
        }
        return v;
    }

    /** [a, b] with rule applied to both and a <= b. */
    pair(parent: Obj | undefined, key: string, path: string, rule: NumRule): [number, number] {
        if (!parent) return [NaN, NaN];
        const at = `${path}.${key}`;
        const v = parent[key];
        if (!Array.isArray(v) || v.length !== 2) {
            this.fail(at, 'must be a [min, max] pair');
            return [NaN, NaN];
        }
        const a = this.numValue(v[0], `${at}[0]`, rule);
        const b = this.numValue(v[1], `${at}[1]`, rule);
        if (a > b) this.fail(at, `min ${a} is greater than max ${b}`);
        return [a, b];
    }
}

function checkPlayer(c: Checker, root: Obj): void {
    const p = c.obj(root, 'player', '$');
    c.num(p, 'cellSec', '$.player', { gt: 0 });
    c.num(p, 'gripDelaySec', '$.player', { min: 0 });
    c.num(p, 'rowsPerFloor', '$.player', { min: 1, int: true });
    c.num(p, 'crisisInputDelaySec', '$.player', { min: 0 });
    c.num(p, 'ladderRows', '$.player', { min: 1, int: true });
}

function checkRisk(c: Checker, root: Obj): void {
    const r = c.obj(root, 'risk', '$');
    c.num(r, 'dangerPerSec', '$.risk', { gt: 0 });
    c.num(r, 'windMovePerSec', '$.risk', { gt: 0 });
    c.num(r, 'rainGraceSec', '$.risk', { min: 0 });
    c.num(r, 'calmGripPerSec', '$.risk', { lt: 0 });
    c.num(r, 'calmClimbPerSec', '$.risk', { lt: 0 });
    const tense = c.num(r, 'tense', '$.risk', { gt: 0 });
    const crisis = c.num(r, 'crisis', '$.risk', { gt: 0 });
    const max = c.num(r, 'max', '$.risk', { gt: 0 });
    if (!(tense < crisis && crisis < max)) {
        c.fail('$.risk', `thresholds must satisfy tense < crisis < max, got ${tense} / ${crisis} / ${max}`);
    }
}

function checkEvents(c: Checker, root: Obj): void {
    const e = c.obj(root, 'events', '$');
    c.num(e, 'warningSec', '$.events', { min: 0 });
    c.num(e, 'cooldownSec', '$.events', { min: 0 });
    for (const kind of EVENT_KINDS) {
        const path = `$.events.${kind}`;
        const ev = c.obj(e, kind, '$.events');
        c.num(ev, 'everySec', path, { gt: 0 });
        c.num(ev, 'firstSec', path, { min: 0 });
        c.pair(ev, 'durationSec', path, { gt: 0 });
        if (kind === 'eagle') c.num(ev, 'spotSec', path, { gt: 0 });
        if (kind === 'wind') c.num(ev, 'pushEverySec', path, { gt: 0 });
    }
}

function checkWidths(c: Checker, root: Obj): Obj {
    const widths = c.obj(root, 'widths', '$') ?? {};
    for (const key of Object.keys(widths)) {
        const path = `$.widths.${key}`;
        const w = c.obj(widths, key, '$.widths');
        const cols = c.num(w, 'cols', path, { min: 1, int: true });
        const safe = c.num(w, 'safe', path, { min: 1, int: true });
        const danger = c.num(w, 'danger', path, { min: 0, int: true });
        if (cols !== safe + 2 * danger) {
            c.fail(path, `cols must equal safe + 2 * danger, got ${cols} vs ${safe} + 2 * ${danger}`);
        }
    }
    return widths;
}

function checkLevels(c: Checker, root: Obj, widths: Obj): void {
    const levels = root.levels;
    if (!Array.isArray(levels)) {
        c.fail('$.levels', 'must be an array');
        return;
    }
    if (levels.length !== LEVEL_COUNT) {
        c.fail('$.levels', `must have ${LEVEL_COUNT} levels, got ${levels.length}`);
    }

    const player = isObj(root.player) ? root.player : {};
    const rowsPerFloor = typeof player.rowsPerFloor === 'number' ? player.rowsPerFloor : NaN;
    const ladderRows = typeof player.ladderRows === 'number' ? player.ladderRows : NaN;

    let nextFloor = 1;
    let onSpire = false;
    levels.forEach((raw: unknown, i: number) => {
        const path = `$.levels[${i}]`;
        if (!isObj(raw)) {
            c.fail(path, 'must be an object');
            return;
        }
        const id = c.num(raw, 'id', path, { int: true });
        if (id !== i + 1) c.fail(`${path}.id`, `must be ${i + 1} (ids are consecutive from 1), got ${id}`);
        c.str(raw, 'name', path);
        const width = c.str(raw, 'width', path);
        if (width && !isObj(widths[width])) c.fail(`${path}.width`, `unknown width "${width}"`);
        c.num(raw, 'windChance', path, { min: 0, max: 1 });
        c.num(raw, 'obstaclesPer12Rows', path, { min: 0, int: true });

        const floors = c.str(raw, 'floors', path);
        const range = FLOOR_RANGE.exec(floors);
        if (range) {
            const from = Number(range[1]);
            const to = Number(range[2]);
            if (onSpire) c.fail(`${path}.floors`, 'floor levels must come before spire levels');
            if (from !== nextFloor) c.fail(`${path}.floors`, `must start at ${nextFloor}F, got ${from}F`);
            if (to < from) c.fail(`${path}.floors`, `range is reversed: ${floors}`);
            nextFloor = to + 1;
            raw.floorFrom = from;
            raw.floorTo = to;
            raw.rows = (to - from + 1) * rowsPerFloor;
        } else if (SPIRE.test(floors)) {
            onSpire = true;
            raw.floorFrom = null;
            raw.floorTo = null;
            raw.rows = ladderRows;
        } else if (floors) {
            c.fail(`${path}.floors`, `must look like "27-34F" or "spire-lower" / "spire-upper", got "${floors}"`);
        }
    });
}

function checkPagodaFlare(c: Checker, root: Obj): void {
    const f = c.obj(root, 'pagodaFlare', '$');
    const levelCount = Array.isArray(root.levels) ? root.levels.length : LEVEL_COUNT;
    c.pair(f, 'levels', '$.pagodaFlare', { min: 1, max: levelCount, int: true });
    c.num(f, 'topRows', '$.pagodaFlare', { min: 0, int: true });
    c.num(f, 'extraDangerPerSide', '$.pagodaFlare', { min: 0, int: true });
}

function checkTower(c: Checker, root: Obj): void {
    const t = c.obj(root, 'tower', '$');
    const faces = c.num(t, 'faces', '$.tower', { int: true });
    if (t && Number.isInteger(faces) && faces !== 1 && faces !== 4) c.fail('$.tower.faces', `must be 1 or 4, got ${faces}`);
}

function checkPractice(c: Checker, root: Obj, widths: Obj): void {
    const p = c.obj(root, 'practice', '$');
    c.num(p, 'floors', '$.practice', { min: 1, int: true });
    const width = c.str(p, 'width', '$.practice');
    if (width && !isObj(widths[width])) c.fail('$.practice.width', `unknown width "${width}"`);
    c.num(p, 'intensity', '$.practice', { gt: 0, max: 1 });
    const demo = p?.demoEvents;
    if (!Array.isArray(demo)) {
        if (p) c.fail('$.practice.demoEvents', 'must be an array');
        return;
    }
    demo.forEach((kind: unknown, i: number) => {
        if (typeof kind !== 'string' || EVENT_KINDS.indexOf(kind) < 0) {
            c.fail(`$.practice.demoEvents[${i}]`, `must be one of ${EVENT_KINDS.join(' / ')}`);
        }
    });
}

/**
 * Validates raw levels.json content and returns it typed, with derived
 * `floorFrom` / `floorTo` / `rows` filled in on every level.
 * The input is not mutated. Throws LevelConfigError listing every problem found.
 */
export function parseLevelConfig(input: unknown): LevelConfig {
    const c = new Checker();
    if (!isObj(input)) throw new LevelConfigError(['$: must be an object']);

    const root = JSON.parse(JSON.stringify(input)) as Obj;
    if (root.version !== SUPPORTED_VERSION) {
        c.fail('$.version', `must be ${SUPPORTED_VERSION}, got ${String(root.version)}`);
    }
    checkPlayer(c, root);
    checkRisk(c, root);
    checkEvents(c, root);
    const widths = checkWidths(c, root);
    checkLevels(c, root, widths);
    checkPagodaFlare(c, root);
    checkTower(c, root);
    checkPractice(c, root, widths);

    if (c.issues.length > 0) throw new LevelConfigError(c.issues);
    return root as unknown as LevelConfig;
}
