/**
 * Window crowd (GDD §9 "窗內 NPC", M2): who stands behind which window on the current level,
 * and how they react to the climber. Purely cosmetic, so it uses its own fixed hash per level
 * instead of the run's seeded RNG (rule 4 is about events that change the game).
 *
 * Pure TypeScript, no `cc` and only type imports, so it runs under plain `node --test`.
 */

export type NpcKind = 'passer' | 'staff' | 'tourist';
export type NpcMood = 'idle' | 'photo' | 'wave' | 'worried';

export interface NpcSpot {
    /** Ring column (0 … ring-1) the window is in. */
    col: number;
    /** Floor inside the level, 0-based (rows floor*rowsPerFloor … +rowsPerFloor-1). */
    floor: number;
    kind: NpcKind;
    /** Index into the kind's colour palettes. */
    palette: number;
    /** 0–1, de-syncs idle animation between NPCs. */
    phase: number;
}

export interface CrowdWall {
    readonly cols: number;
    readonly faces: number;
    readonly ring: number;
    readonly rows: number;
}

/** Tunables, from levels.json `crowd` (see LevelConfig.CrowdConfig). */
export interface CrowdTuning {
    secondChance: number;
    minGap: number;
    reactFloors: number;
    waveCols: number;
    /** From this level id up, only `cols / refCols` of the floors get an NPC (narrower facade). */
    shrinkFromLevel?: number;
    refCols?: number;
}

/** Share of floors that get an NPC on this level: 1, or `cols / refCols` once the tower narrows. */
export function crowdShare(cols: number, levelId: number, tuning: CrowdTuning): number {
    const { shrinkFromLevel, refCols } = tuning;
    if (shrinkFromLevel === undefined || refCols === undefined || levelId < shrinkFromLevel) return 1;
    return Math.min(1, cols / refCols);
}

/** Small deterministic PRNG (mulberry32), so a level always gets the same crowd. */
export function hashRng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Ring distance between two columns (wraps round the tower when it has 4 faces). */
export function ringDistance(a: number, b: number, ring: number, faces: number): number {
    const d = Math.abs(a - b);
    return faces === 1 ? d : Math.min(d, ring - d);
}

/**
 * Picks the windows. `clear(col, row)` says whether a cell is safe glass without an obstacle;
 * a window is used only if its whole floor in that column is clear, so an NPC never sits over
 * a danger column or a vent. Ladder walls (one column) get no crowd.
 */
export function planCrowd(
    wall: CrowdWall, rowsPerFloor: number, levelId: number, tuning: CrowdTuning, clear: (col: number, row: number) => boolean,
): NpcSpot[] {
    if (wall.cols <= 1) return [];
    const rnd = hashRng(levelId * 7919 + 101);
    const floors = Math.floor(wall.rows / rowsPerFloor);
    const out: NpcSpot[] = [];
    // Narrow levels skip floors evenly so the share of floors with people matches the width.
    // The skip doesn't touch rnd(), so wider levels keep exactly the crowd they had.
    const share = crowdShare(wall.cols, levelId, tuning);
    let acc = 0.5;
    for (let f = 0; f < floors; f++) {
        acc += share;
        if (acc < 1) continue;
        acc -= 1;
        const free: number[] = [];
        for (let c = 0; c < wall.ring; c++) {
            let ok = true;
            for (let r = f * rowsPerFloor; r < (f + 1) * rowsPerFloor && ok; r++) ok = clear(c, r);
            if (ok) free.push(c);
        }
        const want = rnd() < tuning.secondChance ? 2 : 1;
        const picked: number[] = [];
        for (let tries = 0; tries < 8 && picked.length < want && free.length > 0; tries++) {
            const c = free[Math.floor(rnd() * free.length)];
            if (picked.some((p) => ringDistance(p, c, wall.ring, wall.faces) < tuning.minGap)) continue;
            picked.push(c);
        }
        for (const col of picked) {
            const k = rnd();
            const kind: NpcKind = k < 0.4 ? 'tourist' : k < 0.75 ? 'passer' : 'staff';
            out.push({ col, floor: f, kind, palette: Math.floor(rnd() * 4), phase: rnd() });
        }
    }
    return out;
}

export interface ClimberView {
    col: number;
    /** Climber's floor inside the level (row / rowsPerFloor, may be fractional). */
    floor: number;
    /** Risk tier is not 'safe', or the climber is falling. */
    alarmed: boolean;
}

/** How an NPC behaves this frame. */
export function npcMood(spot: NpcSpot, climber: ClimberView, ring: number, faces: number, tuning: CrowdTuning): NpcMood {
    const df = Math.abs(climber.floor - (spot.floor + 0.5));
    if (df > tuning.reactFloors) return 'idle';
    const dc = ringDistance(spot.col, climber.col, ring, faces);
    if (climber.alarmed && df <= 1.5) return 'worried';
    if (df <= 1.5 && dc <= tuning.waveCols) return spot.kind === 'tourist' ? 'photo' : 'wave';
    return spot.kind === 'tourist' ? 'photo' : 'idle';
}
