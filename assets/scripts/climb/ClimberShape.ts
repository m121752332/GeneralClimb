/**
 * Geometry of the climber, 霍將軍 (ADR-08: original design, no likeness of a real person).
 * Pure TypeScript (no `cc`) so it can be unit-tested; Tower3D turns each part into a mesh.
 *
 * A chibi general in a red robe with gold trim, a red cape, dark trousers and boots, black
 * hair in a topknot with a small gold crown, and a face (eyes, brows, nose, mouth, cheeks).
 * Rounded parts are low-poly ellipsoids and lathes with per-vertex lighting baked into the
 * vertex colours (same unlit material as the tower), so the whole figure is ~2k triangles.
 *
 * Model space: feet at y = 0, about 1.9 units tall, facing -Z (into the wall; the camera
 * mostly sees the back). Limb pivots and lengths match the old block figure, so the poses in
 * Tower3D (climb, walk, fall, seated ending) still fit.
 */

export type RGB = readonly [number, number, number];
type V3 = [number, number, number];

/** One mesh of the figure. Arms and legs pivot at `pivot` (in the body's space). */
export interface ClimberPart {
    name: 'Torso' | 'Cape' | 'ArmL' | 'ArmR' | 'LegL' | 'LegR';
    pivot: V3;
    positions: number[];
    /** RGBA per vertex, 0..1, lighting already applied. */
    colors: number[];
    indices: number[];
}

function rgb(hex: string): RGB {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const CLIMBER_COL = {
    robe: rgb('#d62c2c'),
    robeDark: rgb('#a81e24'),
    cape: rgb('#b8202a'),
    gold: rgb('#e8b43a'),
    jade: rgb('#3faa78'),
    skin: rgb('#f2c39a'),
    blush: rgb('#f0968a'),
    hair: rgb('#2a2422'),
    pants: rgb('#2f3440'),
    boot: rgb('#3b2a22'),
    sole: rgb('#1e1814'),
    eyeWhite: rgb('#ffffff'),
    pupil: rgb('#1a1418'),
    brow: rgb('#231c1a'),
    mouth: rgb('#8e2a2e'),
};

/** Same light direction as the tower, but a brighter floor so the face reads in shadow. */
const LIGHT: V3 = norm([0.45, 0.75, 0.5]);
const AMBIENT = 0.74;

function norm(v: V3): V3 {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
}

/** Two-sided lighting: the material draws both faces, so light whichever side faces the sun. */
function lit(c: RGB, n: V3): [number, number, number, number] {
    const u = norm(n);
    const d = Math.abs(u[0] * LIGHT[0] + u[1] * LIGHT[1] + u[2] * LIGHT[2]);
    const k = AMBIENT + (1 - AMBIENT) * d;
    return [c[0] * k, c[1] * k, c[2] * k, 1];
}

class PartBuilder {
    positions: number[] = [];
    colors: number[] = [];
    indices: number[] = [];

    private vert(p: V3, n: V3, c: RGB): number {
        this.positions.push(p[0], p[1], p[2]);
        this.colors.push(...lit(c, n));
        return this.positions.length / 3 - 1;
    }

    /** Quad with a normal per corner (smooth shading). */
    quad(p: V3[], n: V3[], c: RGB): void {
        const i = this.vert(p[0], n[0], c);
        this.vert(p[1], n[1], c);
        this.vert(p[2], n[2], c);
        this.vert(p[3], n[3], c);
        this.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }

    /** Flat quad, normal from its own edges. */
    flat(a: V3, b: V3, c: V3, d: V3, col: RGB): void {
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
        const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        this.quad([a, b, c, d], [n, n, n, n], col);
    }

    /**
     * Ellipsoid centred at c with radii r. `keep(dir)` (unit direction of a quad's middle)
     * drops quads, e.g. to make a hair cap. `seg` around, `rings` from top to bottom.
     */
    ellipsoid(c: V3, r: V3, col: RGB, seg = 10, rings = 7, keep?: (d: V3) => boolean): void {
        const dir = (i: number, j: number): V3 => {
            const th = (i / rings) * Math.PI;
            const ph = (j / seg) * Math.PI * 2;
            return [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
        };
        const pos = (d: V3): V3 => [c[0] + d[0] * r[0], c[1] + d[1] * r[1], c[2] + d[2] * r[2]];
        const nrm = (d: V3): V3 => [d[0] / r[0], d[1] / r[1], d[2] / r[2]];
        for (let i = 0; i < rings; i++) {
            for (let j = 0; j < seg; j++) {
                if (keep && !keep(dir(i + 0.5, j + 0.5))) continue;
                const ds = [dir(i, j), dir(i, j + 1), dir(i + 1, j + 1), dir(i + 1, j)];
                this.quad(ds.map(pos), ds.map(nrm), col);
            }
        }
    }

    /**
     * Surface of revolution round a vertical axis at (x, z): each band runs from radius r0 at
     * y0 to r1 at y1. `sz` squashes it front to back (a torso is not round).
     */
    lathe(x: number, z: number, bands: readonly (readonly [number, number, number, number, RGB])[],
        n = 10, sz = 1, caps: { bottom?: RGB; top?: RGB } = {}): void {
        for (const [r0, y0, r1, y1, col] of bands) {
            const dy = y1 - y0;
            const slope = Math.abs(dy) < 1e-6 ? 0 : -(r1 - r0) / dy;
            for (let i = 0; i < n; i++) {
                const ps: V3[] = [];
                const ns: V3[] = [];
                for (const [a, r, y] of [[i, r0, y0], [i + 1, r0, y0], [i + 1, r1, y1], [i, r1, y1]] as const) {
                    const ang = (a / n) * Math.PI * 2;
                    const sx = Math.sin(ang), cz = Math.cos(ang);
                    ps.push([x + sx * r, y, z + cz * r * sz]);
                    ns.push(Math.abs(dy) < 1e-6 ? [0, r1 < r0 ? 1 : -1, 0] : [sx, slope, cz / sz]);
                }
                this.quad(ps, ns, col);
            }
        }
        const first = bands[0];
        const last = bands[bands.length - 1];
        if (caps.bottom) this.disc(x, z, first[0], first[1], sz, n, caps.bottom, -1);
        if (caps.top) this.disc(x, z, last[2], last[3], sz, n, caps.top, 1);
    }

    private disc(x: number, z: number, r: number, y: number, sz: number, n: number, col: RGB, up: number): void {
        const nn: V3 = [0, up, 0];
        const c = this.vert([x, y, z], nn, col);
        for (let i = 0; i <= n; i++) {
            const a = (i / n) * Math.PI * 2;
            this.vert([x + Math.sin(a) * r, y, z + Math.cos(a) * r * sz], nn, col);
        }
        for (let i = 0; i < n; i++) this.indices.push(c, c + 1 + i, c + 2 + i);
    }

    /** Box with flat faces (soles, toes). */
    box(c: V3, s: V3, col: RGB): void {
        const [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
        const p = (x: number, y: number, z: number): V3 => [c[0] + x * hx, c[1] + y * hy, c[2] + z * hz];
        this.flat(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), col);
        this.flat(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), col);
        this.flat(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), col);
        this.flat(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), col);
        this.flat(p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1), col);
        this.flat(p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), col);
    }

    part(name: ClimberPart['name'], pivot: V3): ClimberPart {
        return { name, pivot, positions: this.positions, colors: this.colors, indices: this.indices };
    }
}

// Proportions (model units).
const HEAD_C: V3 = [0, 1.52, 0];
const HEAD_R: V3 = [0.25, 0.245, 0.24];
/** Torso is squashed front to back by this much. */
const TORSO_SZ = 0.62;

/** Z of the face surface at (x, y): the front (-Z) of the head ellipsoid. */
function faceZ(x: number, y: number): number {
    const u = x / HEAD_R[0];
    const v = (y - HEAD_C[1]) / HEAD_R[1];
    return HEAD_C[2] - HEAD_R[2] * Math.sqrt(Math.max(0, 1 - u * u - v * v));
}

/** Robe radius at height y (front-to-back squashed by TORSO_SZ), matching the torso lathe. */
const ROBE: readonly [number, number][] = [[0.46, 0.29], [0.52, 0.285], [0.73, 0.24], [0.83, 0.24], [1.02, 0.27], [1.14, 0.285], [1.25, 0.2], [1.29, 0.1]];
function robeR(y: number): number {
    for (let i = 1; i < ROBE.length; i++) {
        const [y0, r0] = ROBE[i - 1];
        const [y1, r1] = ROBE[i];
        if (y <= y1) return r0 + (r1 - r0) * Math.max(0, (y - y0) / (y1 - y0));
    }
    return ROBE[ROBE.length - 1][1];
}

/** Front surface of the robe at (x, y), pushed out a little. */
function robeFront(x: number, y: number, out = 0.008): V3 {
    const r = robeR(y);
    return [x, y, -TORSO_SZ * Math.sqrt(Math.max(0, r * r - x * x)) - out];
}

/** A trim strip lying on the robe front from a to b, in short pieces so it follows the curve. */
function collarStrip(b: PartBuilder, a: [number, number], e: [number, number], w: number, col: RGB): void {
    const n = 5;
    for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const p = (t: number, side: number): V3 => {
            const x = a[0] + (e[0] - a[0]) * t + side * w / 2;
            const y = a[1] + (e[1] - a[1]) * t;
            return robeFront(x, y);
        };
        b.flat(p(t0, -1), p(t0, 1), p(t1, 1), p(t1, -1), col);
    }
}

function buildTorso(): ClimberPart {
    const C = CLIMBER_COL;
    const b = new PartBuilder();
    // Robe: gold hem, flared skirt, gold belt, chest, shoulders, gold collar.
    b.lathe(0, 0, [
        [0.29, 0.46, 0.285, 0.52, C.gold],
        [0.285, 0.52, 0.24, 0.73, C.robe],
        [0.25, 0.73, 0.25, 0.83, C.gold],
        [0.24, 0.83, 0.27, 1.02, C.robe],
        [0.27, 1.02, 0.285, 1.14, C.robe],
        [0.285, 1.14, 0.2, 1.25, C.robe],
        [0.2, 1.25, 0.1, 1.29, C.gold],
    ], 14, TORSO_SZ, { bottom: C.pants });
    // Neck.
    b.lathe(0, 0, [[0.085, 1.26, 0.085, 1.38, C.skin]], 8);

    // Front details (-Z): crossed gold collar (left over right), jade belt buckle, skirt panel.
    const zf = (r: number): number => -r * TORSO_SZ - 0.006;
    collarStrip(b, [-0.1, 1.25], [0.03, 0.94], 0.065, C.gold);
    collarStrip(b, [0.1, 1.25], [0.02, 1.05], 0.06, C.gold);
    b.ellipsoid([0, 0.78, zf(0.25)], [0.06, 0.05, 0.025], C.jade, 8, 5);
    collarStrip(b, [0, 0.725], [0, 0.525], 0.09, C.robeDark);
    // Back details (+Z): darker panel under the cape, cape clasps on the shoulders.
    for (const sx of [-1, 1]) b.ellipsoid([sx * 0.17, 1.2, 0.13], [0.04, 0.04, 0.03], C.gold, 6, 4);

    // Head.
    b.ellipsoid(HEAD_C, HEAD_R, C.skin, 14, 10);
    for (const sx of [-1, 1]) b.ellipsoid([sx * 0.245, 1.5, 0.01], [0.04, 0.06, 0.04], C.skin, 6, 4);
    // Hair: a cap over the top, back and sides, leaving the face and ears open.
    b.ellipsoid([0, 1.535, 0.012], [0.265, 0.262, 0.256], C.hair, 14, 10,
        (d) => d[1] > 0.32 || (d[2] > -0.15 && d[1] > -0.75) || (Math.abs(d[0]) > 0.82 && d[1] > -0.1));
    // Topknot with a small gold crown and a jade stone in front.
    b.ellipsoid([0, 1.85, 0.03], [0.095, 0.1, 0.095], C.hair, 8, 6);
    b.lathe(0, 0.03, [[0.105, 1.74, 0.115, 1.83, C.gold]], 10, 1, { top: C.gold });
    b.flat([-0.07, 1.8, -0.08], [0.07, 1.8, -0.08], [0.0, 1.96, -0.075], [0.0, 1.96, -0.075], C.gold);
    b.flat([-0.12, 1.79, -0.04], [-0.06, 1.79, -0.08], [-0.1, 1.9, -0.06], [-0.1, 1.9, -0.06], C.gold);
    b.flat([0.06, 1.79, -0.08], [0.12, 1.79, -0.04], [0.1, 1.9, -0.06], [0.1, 1.9, -0.06], C.gold);
    b.ellipsoid([0, 1.83, -0.085], [0.024, 0.024, 0.012], C.jade, 6, 4);

    // Face (-Z): eyes with pupils and catch-lights, determined brows, nose, mouth, cheeks.
    for (const sx of [-1, 1]) {
        const ex = sx * 0.09;
        const ey = 1.51;
        b.ellipsoid([ex, ey, faceZ(ex, ey) + 0.012], [0.05, 0.06, 0.022], C.eyeWhite, 8, 6);
        const px = sx * 0.082;
        b.ellipsoid([px, ey - 0.006, faceZ(px, ey) - 0.006], [0.031, 0.041, 0.016], C.pupil, 8, 6);
        const hx = sx * 0.072 + 0.012;
        b.ellipsoid([hx, ey + 0.016, faceZ(hx, ey) - 0.02], [0.011, 0.011, 0.006], C.eyeWhite, 5, 4);
        for (let k = 0; k < 5; k++) {
            const bx = sx * (0.042 + k * 0.026);
            const by = 1.574 + k * 0.007;
            b.ellipsoid([bx, by, faceZ(bx, by) + 0.002], [0.026, 0.016, 0.014], C.brow, 5, 3);
        }
        const cx = sx * 0.155;
        b.ellipsoid([cx, 1.445, faceZ(cx, 1.445) + 0.008], [0.042, 0.024, 0.012], C.blush, 6, 4);
    }
    b.ellipsoid([0, 1.462, faceZ(0, 1.462) + 0.006], [0.02, 0.02, 0.018], C.skin, 6, 4);
    b.ellipsoid([0, 1.408, faceZ(0, 1.408) + 0.008], [0.052, 0.028, 0.014], C.mouth, 8, 5);
    return b.part('Torso', [0, 0, 0]);
}

/** Cape hanging from the shoulders down the back; pivots at the shoulders so it can sway. */
function buildCape(): ClimberPart {
    const C = CLIMBER_COL;
    const b = new PartBuilder();
    const cols = 6;
    // Row boundaries down the cape; the last, narrow row is the gold hem.
    const vs = [0, 0.22, 0.44, 0.66, 0.86, 0.93, 1];
    const len = 0.74;
    const at = (u: number, v: number): V3 => {
        const half = 0.22 + 0.13 * v;
        const x = (u * 2 - 1) * half;
        const bulge = 0.05 * (1 - (u * 2 - 1) ** 2);
        return [x, -v * len, 0.02 + 0.08 * v + bulge];
    };
    for (let i = 0; i + 1 < vs.length; i++) {
        for (let j = 0; j < cols; j++) {
            const v0 = vs[i], v1 = vs[i + 1], u0 = j / cols, u1 = (j + 1) / cols;
            b.flat(at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1), i === vs.length - 2 ? C.gold : C.cape);
        }
    }
    return b.part('Cape', [0, 1.21, 0.14]);
}

function buildArm(name: 'ArmL' | 'ArmR', x: number): ClimberPart {
    const C = CLIMBER_COL;
    const b = new PartBuilder();
    // Modelled reaching up (+Y) from the shoulder pivot.
    b.ellipsoid([0, 0.03, 0], [0.12, 0.095, 0.12], C.gold, 8, 6, (d) => d[1] > -0.35);
    b.lathe(0, 0, [
        [0.088, 0.0, 0.08, 0.42, C.robe],
        [0.09, 0.42, 0.09, 0.5, C.gold],
    ], 8);
    b.ellipsoid([0, 0.585, 0], [0.068, 0.082, 0.062], C.skin, 8, 6);
    return b.part(name, [x, 1.2, 0]);
}

function buildLeg(name: 'LegL' | 'LegR', x: number): ClimberPart {
    const C = CLIMBER_COL;
    const b = new PartBuilder();
    // Modelled hanging down (-Y) from the hip pivot; toes point -Z.
    b.lathe(0, 0, [
        [0.1, 0.0, 0.088, -0.36, C.pants],
        [0.094, -0.36, 0.094, -0.41, C.gold],
        [0.09, -0.41, 0.086, -0.58, C.boot],
    ], 8);
    b.ellipsoid([0, -0.585, -0.06], [0.09, 0.065, 0.15], C.boot, 8, 6);
    b.box([0, -0.64, -0.055], [0.17, 0.035, 0.29], C.sole);
    return b.part(name, [x, 0.55, 0]);
}

/** All parts of the climber. Deterministic; built once per scene. */
export function climberParts(): ClimberPart[] {
    return [
        buildTorso(),
        buildCape(),
        buildArm('ArmL', -0.36),
        buildArm('ArmR', 0.36),
        buildLeg('LegL', -0.15),
        buildLeg('LegR', 0.15),
    ];
}
