/**
 * Grand entrance at the foot of each face of the 101 (one per face, in the middle): glass
 * doors, a light stone portal framing a tall glass bay, and a curved metal canopy over the
 * doors. Original low-poly drawing (ADR-08), proportioned to the climber, not to the real
 * building. Pure TypeScript (no `cc`): the canopy outline and the clearance the climber keeps
 * from it are unit-tested.
 *
 * Coordinates are per face: `u` runs along the face from its middle (world units, + to the
 * right seen from outside), `out` is the distance in front of the face, `y` is world height.
 */

/** Door opening: half width and height of the glass door wall. */
export const DOOR_HALF = 2.0;
export const DOOR_TOP = 2.7;
/** Sign band over the doors (light panel). */
export const SIGN_TOP = 3.15;
/** Stone portal: piers from DOOR_HALF out to PORTAL_HALF, up to PORTAL_TOP, with a lintel. */
export const PORTAL_HALF = 3.1;
export const PORTAL_TOP = 10.6;
export const LINTEL_H = 1.1;
/** How far the stone stands out of the face (in front of the level's glass and pilasters). */
export const STONE_OUT = 0.4;
/** Canopy: half width, how far its front sticks out, underside and top at the middle. */
export const CANOPY_HALF = 3.5;
export const CANOPY_OUT = 2.2;
export const CANOPY_LOW = 3.45;
export const CANOPY_TOP = 3.95;
/** The canopy's ends wrap down this much (the fascia is deeper at the ends). */
export const CANOPY_DROOP = 0.45;
/** Paved forecourt in front of each entrance and the plaza paving round the base. */
export const FORECOURT_HALF = 4.2;
export const FORECOURT_LEN = 11;
export const PAVING_MARGIN = 10;
export const TILE = 2;

/** 0..1 across the canopy: 0 in the middle, 1 at the ends. */
function across(u: number): number {
    return Math.min(1, Math.abs(u) / CANOPY_HALF);
}

/**
 * Plan outline of the canopy: how far the front edge stands out at `u`. Square in the middle,
 * its ends curving back to the wall like a wing; 0 beyond the canopy.
 */
export function canopyFront(u: number): number {
    const a = Math.abs(u) / CANOPY_HALF;
    if (a >= 1) return 0;
    return CANOPY_OUT * Math.sqrt(1 - Math.pow(a, 6));
}

/** Underside of the fascia at `u`: lowest at the ends, where it wraps down. */
export function canopyLow(u: number): number {
    return CANOPY_LOW - CANOPY_DROOP * Math.pow(across(u), 3);
}

function smooth(t: number): number {
    const x = Math.min(1, Math.max(0, t));
    return x * x * (3 - 2 * x);
}

/** Vertical gap within which the climber starts easing out round the canopy. */
const EASE = 0.5;
/** Room left between the canopy's front and the climber. */
const CLEAR = 0.45;

/**
 * How far out from the face the climber must hang at face position `u` with feet at `feetY`
 * and the given body height, so they climb round the front of the canopy instead of through
 * it. Returns `base` when the canopy is not in the way; eases in over EASE above and below.
 */
export function canopyClearance(u: number, feetY: number, height: number, base: number): number {
    const front = canopyFront(u);
    if (front <= 0) return base;
    const below = canopyLow(u) - (feetY + height);
    const above = feetY - CANOPY_TOP;
    const gap = Math.max(below, above);
    const w = gap <= 0 ? 1 : 1 - smooth(gap / EASE);
    const need = front + CLEAR;
    return need > base ? base + (need - base) * w : base;
}

/**
 * True when a window (one level cell column centred at `u`, half width `colHalf`, between
 * heights y0..y1) is covered by the entrance: behind the doors, sign band or canopy, or
 * behind a stone pier. The crowd leaves those windows empty.
 */
export function entranceCovers(u: number, colHalf: number, y0: number, y1: number): boolean {
    if (y0 >= PORTAL_TOP) return false;
    const a = Math.abs(u);
    if (a - colHalf < CANOPY_HALF && y0 < CANOPY_TOP) return true;
    // A pier hides the window if it covers the middle of the column.
    if (a > DOOR_HALF - colHalf * 0.4 && a < PORTAL_HALF + colHalf * 0.4) return true;
    // Lintel band.
    return a - colHalf < PORTAL_HALF && y1 > PORTAL_TOP - LINTEL_H;
}

/** Face position (world units from the middle) of perimeter coordinate `s` on a face of half width `half`. */
export function faceU(s: number, cols: number, half: number): number {
    const local = ((s % cols) + cols) % cols;
    return (-1 + (2 * local) / cols) * half;
}
