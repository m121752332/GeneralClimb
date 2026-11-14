import { Color } from 'cc';
import {
    CANOPY_HALF, CANOPY_LOW, CANOPY_TOP, DOOR_HALF, DOOR_TOP, FORECOURT_HALF, FORECOURT_LEN, LINTEL_H, PAVING_MARGIN,
    PORTAL_HALF, PORTAL_TOP, SIGN_TOP, STONE_OUT, TILE, canopyFront, canopyLow,
} from '../climb/EntranceShape';
import { MeshBuilder, type V3 } from './MeshKit';

/**
 * Draws the grand entrance on each face of the 101 (EntranceShape) and the stone-paved plaza
 * round the base, into the static scenery mesh. Everything follows the base's inward lean
 * (`half(y)`), so the stone stays flush with the glass all the way up the portal.
 */

const COL = {
    stone: hex('#dcdfdc'),
    stoneTop: hex('#eceeeb'),
    doorLow: hex('#1c3a40'),
    doorHigh: hex('#3f6d72'),
    doorLeaf: hex('#14292d'),
    mullion: hex('#b9c1c1'),
    sign: hex('#e9ece8'),
    signText: hex('#3b4a4e'),
    canopy: hex('#c3c9cb'),
    canopyHigh: hex('#e2e6e7'),
    canopyTop: hex('#aab1b3'),
    canopyUnder: hex('#5b6365'),
    emblem: hex('#f4f4f0'),
    emblemRing: hex('#9aa3a3'),
    paving: hex('#cbc6bc'),
    joint: hex('#a9a397'),
    kerb: hex('#8e8a83'),
    forecourt: hex('#bdb7ac'),
    planter: hex('#cfcbc2'),
    hedge: hex('#4f7a45'),
};

function hex(s: string): Color {
    return new Color().fromHEX(s);
}

/** Corners of a quad and the way its front should face; flips the winding to match. */
function quadToward(mb: MeshBuilder, a: V3, b: V3, c: V3, d: V3, n: V3, color: Color, top?: Color): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const ok = cx * n[0] + cy * n[1] + cz * n[2] >= 0;
    if (top) {
        if (ok) mb.gradQuad(a, b, c, d, color, top);
        else mb.gradQuad(b, a, d, c, color, top);
    } else if (ok) mb.quad(a, b, c, d, color);
    else mb.quad(d, c, b, a, color);
}

export function buildEntrances(mb: MeshBuilder, half: (y: number) => number, faces = 4): void {
    buildPaving(mb, half(0));
    for (let f = 0; f < faces; f++) buildFace(mb, half, f, faces);
}

/** Plaza paving round the base: square stone tiles, a darker kerb at the edge. */
function buildPaving(mb: MeshBuilder, h0: number): void {
    const m = h0 + PAVING_MARGIN;
    mb.quad([-m, 0.015, m], [m, 0.015, m], [m, 0.015, -m], [-m, 0.015, -m], COL.paving, true);
    const k = 0.7;
    for (const [x0, z0, x1, z1] of [[-m - k, m, m + k, m + k], [-m - k, -m - k, m + k, -m], [m, -m, m + k, m], [-m - k, -m, -m, m]]) {
        mb.quad([x0, 0.016, z1], [x1, 0.016, z1], [x1, 0.016, z0], [x0, 0.016, z0], COL.kerb, true);
    }
    const w = 0.035;
    for (let v = -m + TILE; v < m - 1e-6; v += TILE) {
        mb.quad([v - w, 0.02, m], [v + w, 0.02, m], [v + w, 0.02, -m], [v - w, 0.02, -m], COL.joint, true);
        mb.quad([-m, 0.02, v + w], [m, 0.02, v + w], [m, 0.02, v - w], [-m, 0.02, v - w], COL.joint, true);
    }
}

function buildFace(mb: MeshBuilder, half: (y: number) => number, f: number, faces: number): void {
    const yaw = (f * 2 * Math.PI) / faces;
    const nx = Math.sin(yaw), nz = Math.cos(yaw);
    const tx = Math.cos(yaw), tz = -Math.sin(yaw);
    const OUT: V3 = [nx, 0, nz];
    const UP: V3 = [0, 1, 0];
    const DOWN: V3 = [0, -1, 0];
    /** Face-local (u along the face, y up, out from the glass) to world. */
    const P = (u: number, y: number, out: number): V3 => {
        const r = half(y) + out;
        return [nx * r + tx * u, y, nz * r + tz * u];
    };
    /** Front of a flat panel standing on the face. */
    const panel = (u0: number, u1: number, y0: number, y1: number, out: number, color: Color, top?: Color): void => {
        quadToward(mb, P(u0, y0, out), P(u1, y0, out), P(u1, y1, out), P(u0, y1, out), OUT, color, top);
    };
    /** A block on the face, leaning with it: front, both sides and top. */
    const slab = (u0: number, u1: number, y0: number, y1: number, o0: number, o1: number, color: Color, top = color): void => {
        panel(u0, u1, y0, y1, o1, color);
        const L: V3 = [-tx, 0, -tz], R: V3 = [tx, 0, tz];
        quadToward(mb, P(u0, y0, o0), P(u0, y0, o1), P(u0, y1, o1), P(u0, y1, o0), L, color);
        quadToward(mb, P(u1, y0, o1), P(u1, y0, o0), P(u1, y1, o0), P(u1, y1, o1), R, color);
        quadToward(mb, P(u0, y1, o1), P(u1, y1, o1), P(u1, y1, o0), P(u0, y1, o0), UP, top);
    };

    // Forecourt: a slab of paving leading out from the doors, with joints across it.
    const fl = FORECOURT_LEN, fh = FORECOURT_HALF;
    const g = (u: number, out: number, y: number): V3 => {
        const r = half(0) + out;
        return [nx * r + tx * u, y, nz * r + tz * u];
    };
    quadToward(mb, g(-fh, 0, 0.025), g(fh, 0, 0.025), g(fh, fl, 0.025), g(-fh, fl, 0.025), UP, COL.forecourt);
    for (let o = 1.4; o < fl; o += 1.4) {
        quadToward(mb, g(-fh, o - 0.03, 0.03), g(fh, o - 0.03, 0.03), g(fh, o + 0.03, 0.03), g(-fh, o + 0.03, 0.03), UP, COL.joint);
    }
    for (const u of [-fh, fh]) {
        quadToward(mb, g(u - 0.12, 0, 0.03), g(u + 0.12, 0, 0.03), g(u + 0.12, fl, 0.03), g(u - 0.12, fl, 0.03), UP, COL.kerb);
    }

    // Glass door wall: dark glass, the two door leaves darker, metal mullions and a transom.
    panel(-DOOR_HALF, DOOR_HALF, 0, DOOR_TOP, 0.3, COL.doorLow, COL.doorHigh);
    panel(-0.85, 0.85, 0, 2.15, 0.31, COL.doorLeaf);
    for (let u = -DOOR_HALF; u <= DOOR_HALF + 1e-6; u += 0.8) slab(u - 0.04, u + 0.04, 0, DOOR_TOP, 0.3, 0.36, COL.mullion);
    slab(-DOOR_HALF, DOOR_HALF, 2.15, 2.23, 0.3, 0.36, COL.mullion);
    // Lit sign band over the doors, with a dark lettering strip (no real text).
    slab(-DOOR_HALF, DOOR_HALF, DOOR_TOP, SIGN_TOP, 0.3, 0.42, COL.sign);
    panel(-0.9, 0.9, DOOR_TOP + 0.16, SIGN_TOP - 0.16, 0.425, COL.signText);

    // Stone portal: a pier each side, a lintel with a cornice on top.
    slab(-PORTAL_HALF, -DOOR_HALF, 0, PORTAL_TOP, 0, STONE_OUT, COL.stone, COL.stoneTop);
    slab(DOOR_HALF, PORTAL_HALF, 0, PORTAL_TOP, 0, STONE_OUT, COL.stone, COL.stoneTop);
    slab(-DOOR_HALF, DOOR_HALF, PORTAL_TOP - LINTEL_H, PORTAL_TOP, 0, STONE_OUT, COL.stone, COL.stoneTop);
    slab(-PORTAL_HALF - 0.12, PORTAL_HALF + 0.12, PORTAL_TOP - 0.14, PORTAL_TOP + 0.04, 0, STONE_OUT + 0.1, COL.stoneTop);
    // Plinth strip at the foot of the piers.
    for (const s of [-1, 1]) slab(s < 0 ? -PORTAL_HALF - 0.05 : DOOR_HALF - 0.05, s < 0 ? -DOOR_HALF + 0.05 : PORTAL_HALF + 0.05, 0, 0.35, 0, STONE_OUT + 0.06, COL.joint);

    // Round emblem on the lintel: a pale ring round a bright disc.
    const ey = PORTAL_TOP - LINTEL_H / 2 - 0.03;
    disc(mb, P, ey, STONE_OUT + 0.01, 0.44, COL.emblemRing, OUT);
    disc(mb, P, ey, STONE_OUT + 0.02, 0.32, COL.emblem, OUT);

    // Canopy over the doors: a thick metal fascia whose plan curves back to the wall at the
    // ends and whose underside dips there, a sloped top and a dark soffit.
    const N = 24;
    const wall = 0.3;
    for (let i = 0; i < N; i++) {
        const u0 = -CANOPY_HALF + (2 * CANOPY_HALF * i) / N;
        const u1 = -CANOPY_HALF + (2 * CANOPY_HALF * (i + 1)) / N;
        const f0 = Math.max(wall, canopyFront(u0)), f1 = Math.max(wall, canopyFront(u1));
        const l0 = canopyLow(u0), l1 = canopyLow(u1);
        const t0 = CANOPY_TOP, t1 = CANOPY_TOP;
        // Outward direction of this piece of the fascia (in plan).
        const du = u1 - u0, df = f1 - f0;
        const len = Math.hypot(du, df) || 1;
        const pn: V3 = [nx * (du / len) - tx * (df / len), 0, nz * (du / len) - tz * (df / len)];
        quadToward(mb, P(u0, l0, f0), P(u1, l1, f1), P(u1, t1, f1), P(u0, t0, f0), pn, COL.canopy, COL.canopyHigh);
        // Top, rising a little towards the wall so it reads as a slab.
        quadToward(mb, P(u0, t0, f0), P(u1, t1, f1), P(u1, CANOPY_TOP + 0.12, wall), P(u0, CANOPY_TOP + 0.12, wall), UP, COL.canopyTop);
        // Soffit.
        quadToward(mb, P(u0, l0 + 0.04, f0), P(u1, l1 + 0.04, f1), P(u1, CANOPY_LOW + 0.04, wall), P(u0, CANOPY_LOW + 0.04, wall), DOWN, COL.canopyUnder);
    }
    // Downlights under the canopy.
    for (const u of [-1.8, -0.6, 0.6, 1.8]) {
        for (const o of [0.9, 1.6]) {
            quadToward(mb, P(u - 0.12, CANOPY_LOW + 0.02, o - 0.12), P(u + 0.12, CANOPY_LOW + 0.02, o - 0.12),
                P(u + 0.12, CANOPY_LOW + 0.02, o + 0.12), P(u - 0.12, CANOPY_LOW + 0.02, o + 0.12), DOWN, COL.emblem);
        }
    }

    // Hedge planters either side of the forecourt.
    for (const s of [-1, 1]) {
        const c = g(s * (FORECOURT_HALF + 1.8), 3.2, 0);
        mb.box(c[0], 0.35, c[2], 2.8, 0.7, 1.3, COL.planter, yaw, COL.planter);
        mb.box(c[0], 0.85, c[2], 2.5, 0.35, 1.05, COL.hedge, yaw, COL.hedge);
    }
}

/** Flat disc on the face (fan of quads), centred on u = 0 at height y. */
function disc(mb: MeshBuilder, P: (u: number, y: number, out: number) => V3, y: number, out: number, r: number, color: Color, n: V3): void {
    const k = 16;
    const c = P(0, y, out);
    for (let i = 0; i < k; i++) {
        const a0 = (i / k) * Math.PI * 2;
        const a1 = ((i + 1) / k) * Math.PI * 2;
        const p0 = P(Math.cos(a0) * r, y + Math.sin(a0) * r, out);
        const p1 = P(Math.cos(a1) * r, y + Math.sin(a1) * r, out);
        quadToward(mb, c, p0, p1, p1, n, color);
    }
}
