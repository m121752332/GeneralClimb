/**
 * Geometry of the eagle (ADR-08: an original low-poly design). Pure TypeScript (no `cc`) so
 * it can be unit-tested; Tower3D turns each part into a mesh and poses the wings and talons.
 *
 * A dark maroon-brown body, a white head with a hooked yellow beak and golden eyes, a cream
 * tail fan, and wide spread wings: brown coverts, an orange band, orange-tipped flight
 * feathers and long splayed "finger" primaries. Lighting is baked into the vertex colours
 * (same unlit vertex-colour material as the tower), two-sided, about 900 triangles.
 *
 * Model space: the eagle faces -Z (beak at -Z), back up (+Y), wings along ±X. Wings pivot at
 * the shoulders and are modelled flat and fully spread; Tower3D raises / sweeps them. Legs
 * pivot at the hips, modelled hanging straight down with the talons open.
 */

export type RGB = readonly [number, number, number];
type V3 = [number, number, number];

export type EaglePartName = 'Body' | 'WingL' | 'WingR' | 'Legs';

export interface EaglePart {
    name: EaglePartName;
    /** Pivot in body space (the body's own pivot is the origin). */
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

export const EAGLE_COL = {
    body: rgb('#5a2622'),
    bodyDark: rgb('#3a1a1c'),
    covert: rgb('#6e2c24'),
    band: rgb('#d9662a'),
    feather: rgb('#7d3a2a'),
    featherTip: rgb('#ef8a3a'),
    primary: rgb('#3b1c22'),
    primaryTip: rgb('#22141a'),
    head: rgb('#f5ecd6'),
    neck: rgb('#e9dcbc'),
    beak: rgb('#f2a51a'),
    beakTip: rgb('#c9761a'),
    iris: rgb('#f2cf3a'),
    pupil: rgb('#141012'),
    tail: rgb('#f1e3c4'),
    tailTip: rgb('#e88a3c'),
    leg: rgb('#efa02a'),
    claw: rgb('#2a1a16'),
    trousers: rgb('#4a2020'),
};

/** Wing span in model units (tip to tip, fully spread). */
export const EAGLE_SPAN = 7.0;
/** Shoulder pivots, in body space. */
export const SHOULDER: V3 = [0.24, 0.12, -0.12];
/** Hip pivot, in body space. */
export const HIP: V3 = [0, -0.18, 0.18];

const LIGHT: V3 = norm([0.45, 0.75, 0.5]);
const AMBIENT = 0.7;

function norm(v: V3): V3 {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: V3, b: V3): V3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function sub(a: V3, b: V3): V3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mix(a: RGB, b: RGB, k: number): RGB {
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Two-sided lighting (the material draws both faces). */
function lit(c: RGB, n: V3): [number, number, number, number] {
    const u = norm(n);
    const d = Math.abs(u[0] * LIGHT[0] + u[1] * LIGHT[1] + u[2] * LIGHT[2]);
    const k = AMBIENT + (1 - AMBIENT) * d;
    return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k), 1];
}

class Builder {
    positions: number[] = [];
    colors: number[] = [];
    indices: number[] = [];

    private vert(p: V3, n: V3, c: RGB): number {
        this.positions.push(p[0], p[1], p[2]);
        this.colors.push(...lit(c, n));
        return this.positions.length / 3 - 1;
    }

    /** Flat triangle; one colour per corner. */
    tri(a: V3, b: V3, c: V3, ca: RGB, cb: RGB = ca, cc: RGB = ca): void {
        const n = cross(sub(b, a), sub(c, a));
        const i = this.vert(a, n, ca);
        this.vert(b, n, cb);
        this.vert(c, n, cc);
        this.indices.push(i, i + 1, i + 2);
    }

    /** Flat quad a-b-c-d; colours per corner. */
    quad(a: V3, b: V3, c: V3, d: V3, ca: RGB, cb: RGB = ca, cc: RGB = cb, cd: RGB = ca): void {
        const n = cross(sub(b, a), sub(d, a));
        const i = this.vert(a, n, ca);
        this.vert(b, n, cb);
        this.vert(c, n, cc);
        this.vert(d, n, cd);
        this.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }

    /** Ellipsoid, smooth shaded; `tint(dir)` may recolour by direction (e.g. a darker belly). */
    ellipsoid(c: V3, r: V3, col: RGB, seg = 10, rings = 7, tint?: (d: V3) => RGB): void {
        const dir = (i: number, j: number): V3 => {
            const th = (i / rings) * Math.PI;
            const ph = (j / seg) * Math.PI * 2;
            return [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
        };
        for (let i = 0; i < rings; i++) {
            for (let j = 0; j < seg; j++) {
                const ds = [dir(i, j), dir(i, j + 1), dir(i + 1, j + 1), dir(i + 1, j)];
                const base = this.positions.length / 3;
                for (const d of ds) {
                    const p: V3 = [c[0] + d[0] * r[0], c[1] + d[1] * r[1], c[2] + d[2] * r[2]];
                    this.vert(p, [d[0] / r[0], d[1] / r[1], d[2] / r[2]], tint ? tint(d) : col);
                }
                this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            }
        }
    }

    /**
     * A feather: a tapered blade from `root` along unit direction `dir` (in the XZ plane, the
     * wing's plane), `len` long, `w` wide at the root and pointed at the tip.
     */
    feather(root: V3, dir: V3, len: number, w: number, base: RGB, tip: RGB, y = 0): void {
        const side: V3 = norm([-dir[2], 0, dir[0]]);
        const at = (k: number, off: number): V3 => [
            root[0] + dir[0] * len * k + side[0] * off,
            root[1] + y * k,
            root[2] + dir[2] * len * k + side[2] * off,
        ];
        const a = at(0, -w / 2), b = at(0, w / 2);
        const c = at(0.78, w * 0.42), d = at(0.78, -w * 0.42);
        const tipP = at(1, 0);
        const mid = mix(base, tip, 0.75);
        this.quad(a, b, c, d, base, base, mid, mid);
        this.tri(d, c, tipP, mid, mid, tip);
    }

    part(name: EaglePartName, pivot: V3): EaglePart {
        return { name, pivot, positions: this.positions, colors: this.colors, indices: this.indices };
    }
}

function buildBody(): EaglePart {
    const b = new Builder();
    const C = EAGLE_COL;
    // Torso: long ellipsoid, darker underneath.
    b.ellipsoid([0, 0, 0.12], [0.34, 0.3, 0.8], C.body, 12, 8, (d) => (d[1] < -0.35 ? C.bodyDark : C.body));
    // White head and neck ruff.
    b.ellipsoid([0, 0.1, -0.55], [0.3, 0.29, 0.3], C.neck, 10, 6);
    b.ellipsoid([0, 0.17, -0.82], [0.24, 0.23, 0.28], C.head, 10, 7);
    // Brow ridge gives the fierce look.
    for (const s of [-1, 1]) {
        b.quad([s * 0.06, 0.32, -0.98], [s * 0.21, 0.29, -0.9], [s * 0.22, 0.25, -0.95], [s * 0.07, 0.27, -1.03], C.neck);
        // Eye: golden iris with a dark pupil.
        b.ellipsoid([s * 0.17, 0.22, -0.95], [0.045, 0.045, 0.04], C.iris, 6, 4);
        b.ellipsoid([s * 0.195, 0.222, -0.965], [0.022, 0.024, 0.02], C.pupil, 5, 3);
    }
    // Hooked beak: a wedge forward from the face, curling down at the tip.
    const top: V3 = [0, 0.24, -1.0];
    const l: V3 = [-0.09, 0.12, -0.98];
    const r: V3 = [0.09, 0.12, -0.98];
    const bot: V3 = [0, 0.04, -0.98];
    const tip: V3 = [0, 0.14, -1.26];
    const hook: V3 = [0, 0.0, -1.24];
    b.tri(top, r, tip, C.beak, C.beak, C.beakTip);
    b.tri(top, tip, l, C.beak, C.beakTip, C.beak);
    b.tri(r, bot, tip, C.beak, C.beak, C.beakTip);
    b.tri(l, tip, bot, C.beak, C.beakTip, C.beak);
    b.tri(l, hook, r, C.beak, C.beakTip, C.beak);
    b.tri(tip, hook, [0.03, 0.08, -1.2], C.beakTip);
    b.tri(tip, [-0.03, 0.08, -1.2], hook, C.beakTip);
    // Tail fan: cream feathers with orange tips, slightly spread.
    const n = 7;
    for (let i = 0; i < n; i++) {
        const a = ((i / (n - 1)) * 2 - 1) * 0.42;
        const dir: V3 = [Math.sin(a), 0, Math.cos(a)];
        const col = i % 2 === 0 ? C.tailTip : C.tail;
        b.feather([Math.sin(a) * 0.08, -0.02 + (i % 2) * 0.012, 0.72], dir, 1.0 - Math.abs(a) * 0.4, 0.26, C.tail, col);
    }
    return b.part('Body', [0, 0, 0]);
}

/**
 * Right wing, along +X from the shoulder (origin). Left wing is its mirror image.
 * Leading edge towards -Z, flight feathers trail towards +Z, primaries splay at the tip.
 */
function buildWing(side: 1 | -1): EaglePart {
    const b = new Builder();
    const C = EAGLE_COL;
    const m = (p: V3): V3 => [p[0] * side, p[1], p[2]];
    const quad = (a: V3, bb: V3, c: V3, d: V3, ca: RGB, cb?: RGB, cc?: RGB, cd?: RGB): void =>
        b.quad(m(a), m(bb), m(c), m(d), ca, cb, cc, cd);
    // Arm (inner wing): coverts, an orange band, then a row of secondaries.
    const lead = (x: number): number => -0.28 + 0.12 * Math.sin((x / 1.9) * Math.PI); // leading edge z
    const xs = [0, 0.45, 0.9, 1.35, 1.9];
    for (let i = 0; i < xs.length - 1; i++) {
        const x0 = xs[i], x1 = xs[i + 1];
        const y0 = 0.02 * (1 - x0 / 1.9), y1 = 0.02 * (1 - x1 / 1.9);
        const z0 = lead(x0), z1 = lead(x1);
        const w0 = 0.55 - x0 * 0.12, w1 = 0.55 - x1 * 0.12;
        quad([x0, y0 + 0.03, z0], [x1, y1 + 0.03, z1], [x1, y1, z1 + w1], [x0, y0, z0 + w0], C.covert, C.covert, C.covert, C.covert);
        quad([x0, y0, z0 + w0], [x1, y1, z1 + w1], [x1, y1 - 0.01, z1 + w1 + 0.16], [x0, y0 - 0.01, z0 + w0 + 0.16], C.band);
    }
    // Secondaries along the inner trailing edge.
    for (let i = 0; i < 9; i++) {
        const x = 0.1 + i * 0.2;
        const z = lead(x) + 0.55 - x * 0.12 + 0.12;
        const tipCol = i % 3 === 1 ? C.featherTip : mix(C.featherTip, C.feather, 0.45);
        b.feather(m([x, -0.01, z]), [side * 0.12, 0, 1], 0.62 - i * 0.025, 0.26, C.feather, tipCol, -0.02);
    }
    // Hand: from the wrist the wing narrows towards the splayed primaries.
    const wx = 1.9;
    quad([wx, 0.0, lead(wx) + 0.02], [2.35, -0.02, -0.12], [2.35, -0.03, 0.2], [wx, -0.01, lead(wx) + 0.46], C.covert);
    quad([wx, -0.01, lead(wx) + 0.46], [2.35, -0.03, 0.2], [2.3, -0.04, 0.36], [wx, -0.02, lead(wx) + 0.62], C.band);
    // Primaries: long dark "fingers" fanning from the tip (outermost first).
    const fingers = 6;
    for (let i = 0; i < fingers; i++) {
        const a = (-0.25 + (i / (fingers - 1)) * 1.05); // radians back from straight out
        const dir: V3 = [Math.cos(a) * side, 0, Math.sin(a)];
        const root: V3 = m([2.15 + 0.04 * (fingers - i), -0.02 - i * 0.004, -0.08 + i * 0.09]);
        const len = 0.95 - Math.abs(i - 1.5) * 0.06;
        const base = i >= 4 ? C.featherTip : C.primary;
        b.feather(root, dir, len, 0.2, base, i >= 4 ? C.feather : C.primaryTip, 0.03);
    }
    return b.part(side === 1 ? 'WingR' : 'WingL', [SHOULDER[0] * side, SHOULDER[1], SHOULDER[2]]);
}

/** Feathered thighs, yellow shanks and open talons, hanging down from the hip pivot. */
function buildLegs(): EaglePart {
    const b = new Builder();
    const C = EAGLE_COL;
    for (const s of [-1, 1]) {
        const x = s * 0.15;
        b.ellipsoid([x, -0.1, 0], [0.13, 0.17, 0.14], C.trousers, 7, 5);
        // Shank: a thin four-sided column.
        const t = 0.035;
        const y0 = -0.22, y1 = -0.5;
        b.quad([x - t, y0, -t], [x + t, y0, -t], [x + t, y1, -t], [x - t, y1, -t], C.leg);
        b.quad([x + t, y0, t], [x - t, y0, t], [x - t, y1, t], [x + t, y1, t], C.leg);
        b.quad([x - t, y0, t], [x - t, y0, -t], [x - t, y1, -t], [x - t, y1, t], C.leg);
        b.quad([x + t, y0, -t], [x + t, y0, t], [x + t, y1, t], [x + t, y1, -t], C.leg);
        // Toes spread forward (three) and back (one), each ending in a dark hooked claw.
        const foot: V3 = [x, y1, 0];
        const toes: [number, number][] = [[-0.5, 1], [0, 1], [0.5, 1], [0, -1]];
        for (const [ang, fwd] of toes) {
            const dx = Math.sin(ang) * 0.16;
            const dz = -fwd * Math.cos(ang) * 0.16;
            const end: V3 = [x + dx, y1 - 0.05, dz];
            const w: V3 = [Math.cos(ang) * 0.025, 0, Math.sin(ang) * 0.025 * fwd];
            b.quad([foot[0] - w[0], foot[1], foot[2] - w[2]], [foot[0] + w[0], foot[1], foot[2] + w[2]],
                [end[0] + w[0], end[1], end[2] + w[2]], [end[0] - w[0], end[1], end[2] - w[2]], C.leg);
            const claw: V3 = [end[0] + dx * 0.45, end[1] - 0.1, end[2] + dz * 0.45];
            b.tri([end[0] - w[0], end[1], end[2] - w[2]], [end[0] + w[0], end[1], end[2] + w[2]], claw, C.claw);
        }
    }
    return b.part('Legs', HIP);
}

/** All parts: body (with head, beak, tail), both spread wings, legs with talons. */
export function eagleParts(): EaglePart[] {
    return [buildBody(), buildWing(-1), buildWing(1), buildLegs()];
}
