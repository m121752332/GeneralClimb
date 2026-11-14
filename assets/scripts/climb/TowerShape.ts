/**
 * Shape of the 3D tower (ADR-10) and where a climbing cell sits on it. Pure TypeScript (no
 * `cc`) so the geometry can be unit-tested. Units are world units; one grid row is ROW_H tall.
 *
 * The silhouette follows the building: a base that narrows as it rises (1–26F), eight
 * segments that flare outward like stacked pagoda sections (27–90F, 8 floors each), then the
 * top floors (91–101F), a stepped crown and the spire. These are drawing proportions only;
 * gameplay numbers stay in levels.json.
 */

/** World height of one grid row. 12 rows make a floor, so a floor is 2.4 units tall. */
export const ROW_H = 0.2;
/** The first row sits this high, so the climber starts standing on the plaza reaching up. */
export const LIFT = 1.3;

export type SectionKind = 'base' | 'segment' | 'top';

export interface Section {
    kind: SectionKind;
    /** First and last floor of the section (inclusive). */
    floorFrom: number;
    floorTo: number;
    /** World y of the bottom and top of the section. */
    y0: number;
    y1: number;
    /** Distance from the tower axis to the middle of a face, at the bottom and the top. */
    half0: number;
    half1: number;
}

/** Floor structure of the building (ADR-05): base 1–26F, 8 segments of 8 floors, top 91–101F. */
const BASE_TO = 26;
const SEGMENTS = 8;
const SEGMENT_FLOORS = 8;
const TOP_TO = 101;

/** Half widths: the base tapers in, every segment flares out, the top section a little. */
const BASE_HALF: [number, number] = [9.6, 7.4];
const SEGMENT_HALF: [number, number] = [5.2, 6.8];
const TOP_HALF: [number, number] = [4.4, 4.9];

/** World y of the bottom of a (0-based, run-wide) row. */
export function rowY(globalRow: number): number {
    return LIFT + globalRow * ROW_H;
}

/** Bottom of a floor (1-based) in world units. */
export function floorY(floor: number, rowsPerFloor: number): number {
    return rowY((floor - 1) * rowsPerFloor);
}

export function towerSections(rowsPerFloor: number): Section[] {
    const out: Section[] = [];
    const add = (kind: SectionKind, floorFrom: number, floorTo: number, half: [number, number]): void => {
        out.push({
            kind, floorFrom, floorTo,
            y0: kind === 'base' ? 0 : floorY(floorFrom, rowsPerFloor),
            y1: floorY(floorTo + 1, rowsPerFloor),
            half0: half[0],
            half1: half[1],
        });
    };
    add('base', 1, BASE_TO, BASE_HALF);
    for (let i = 0; i < SEGMENTS; i++) {
        const from = BASE_TO + 1 + i * SEGMENT_FLOORS;
        add('segment', from, from + SEGMENT_FLOORS - 1, SEGMENT_HALF);
    }
    add('top', BASE_TO + SEGMENTS * SEGMENT_FLOORS + 1, TOP_TO, TOP_HALF);
    return out;
}

/** Practice house (GDD §7): half width of its square plan (about 12 units across). */
export const HOUSE_HALF = 6;

/**
 * The practice house as a single straight section from the ground to the roof of its top
 * floor, so the same surface maths (halfAt, surfacePoint) and level grid work on it.
 */
export function houseSections(rowsPerFloor: number, floors: number): Section[] {
    return [{ kind: 'base', floorFrom: 1, floorTo: floors, y0: 0, y1: floorY(floors + 1, rowsPerFloor), half0: HOUSE_HALF, half1: HOUSE_HALF }];
}

/** Roof of the top floors: the crown and spire start here. */
export function roofY(rowsPerFloor: number): number {
    return floorY(TOP_TO + 1, rowsPerFloor);
}

/** Face half width at height y (clamped to the first / last section). */
export function halfAt(sections: readonly Section[], y: number): number {
    let s = sections[0];
    for (const sec of sections) {
        if (y >= sec.y0) s = sec;
    }
    const t = Math.min(1, Math.max(0, (y - s.y0) / (s.y1 - s.y0)));
    return s.half0 + (s.half1 - s.half0) * t;
}

export interface SurfacePoint {
    x: number;
    z: number;
    /** Outward facing direction (radians about +Y); 0 faces +Z. Blends round the corners. */
    yaw: number;
}

/** Outward normal angle of a face: face 0 looks along +Z, face 1 along +X, and so on. */
export function faceYaw(face: number, faces: number): number {
    return faces === 1 ? 0 : (face * 2 * Math.PI) / faces;
}

function smooth(t: number): number {
    const x = Math.min(1, Math.max(0, t));
    return x * x * (3 - 2 * x);
}

/**
 * Point on the tower surface for a perimeter coordinate `s` (in cells, 0..cols*faces, cell c
 * spans [c, c+1)) and half width `half`, pushed `out` units along the face normal.
 * Moving +s goes to the right as seen from outside; past a face's edge it turns the corner.
 */
export function surfacePoint(s: number, half: number, cols: number, faces: number, out = 0): SurfacePoint {
    const ring = cols * faces;
    const p = faces === 1 ? s : ((s % ring) + ring) % ring;
    const face = faces === 1 ? 0 : Math.min(faces - 1, Math.floor(p / cols));
    const u = -1 + (2 * (p - face * cols)) / cols;
    const yaw0 = faceYaw(face, faces);
    const nx = Math.sin(yaw0);
    const nz = Math.cos(yaw0);
    const tx = Math.cos(yaw0);
    const tz = -Math.sin(yaw0);
    const r = half + out;
    let yaw = yaw0;
    if (faces > 1) {
        const w = 0.2;
        const q = Math.PI / faces;
        yaw += q * smooth((u - (1 - w)) / w) - q * smooth((-u - (1 - w)) / w);
    }
    return { x: nx * r + tx * u * half, z: nz * r + tz * u * half, yaw };
}

/** Shortest signed column step from `from` to `to` on a ring of `ring` columns. */
export function ringDelta(from: number, to: number, ring: number, faces: number): number {
    let d = to - from;
    if (faces > 1) {
        if (d > ring / 2) d -= ring;
        if (d < -ring / 2) d += ring;
    }
    return d;
}

/** Shortest signed angle from a to b, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
    let d = (b - a) % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d <= -Math.PI) d += 2 * Math.PI;
    return d;
}

// ---------------------------------------------------------------- crown and spire

/** Crown above 101F, bottom to top: [height, half width] of each stepped block. */
export const CROWN: ReadonlyArray<readonly [number, number]> = [[2.4, 3.7], [2.0, 2.7], [1.6, 1.8]];
/** Spire radius where the ladder starts and where it ends (top of level 14). */
export const SPIRE_HALF: readonly [number, number] = [1.0, 0.45];
/** Needle above the summit ring. */
export const SPIRE_TIP = 6;

/** Top of the crown: the roof platform where level 13 (the ladder) starts. */
export function crownTopY(rowsPerFloor: number): number {
    return roofY(rowsPerFloor) + CROWN.reduce((h, [dh]) => h + dh, 0);
}

/** Top of the ladder: the summit ring (the end of level 14). */
export function summitY(rowsPerFloor: number, ladderRows: number, spireLevels = 2): number {
    return crownTopY(rowsPerFloor) + spireLevels * ladderRows * ROW_H;
}

/**
 * Half width above the roof (crown blocks, then the tapering spire), or null below it,
 * where the sections apply.
 */
export function spireHalfAt(rowsPerFloor: number, ladderRows: number, y: number): number | null {
    let y0 = roofY(rowsPerFloor);
    if (y < y0) return null;
    for (const [h, half] of CROWN) {
        if (y < y0 + h) return half;
        y0 += h;
    }
    const top = summitY(rowsPerFloor, ladderRows);
    if (y <= top) return SPIRE_HALF[0] + (SPIRE_HALF[1] - SPIRE_HALF[0]) * ((y - y0) / (top - y0));
    return Math.max(0.04, SPIRE_HALF[1] * (1 - (y - top) / SPIRE_TIP));
}

/** Whole-building half width at y (sections, crown, spire). */
export function profileHalf(sections: readonly Section[], rowsPerFloor: number, ladderRows: number, y: number): number {
    return spireHalfAt(rowsPerFloor, ladderRows, y) ?? halfAt(sections, y);
}

/**
 * World y of row 0 of a level: floor levels sit on their floors, spire levels stack up
 * the ladder from the crown top ("spire-lower" first, then "spire-upper").
 */
export function levelBaseY(level: { floorFrom: number | null; floors: string }, rowsPerFloor: number, ladderRows: number): number {
    if (level.floorFrom !== null) return rowY((level.floorFrom - 1) * rowsPerFloor);
    const index = level.floors === 'spire-upper' ? 1 : 0;
    return crownTopY(rowsPerFloor) + index * ladderRows * ROW_H;
}
