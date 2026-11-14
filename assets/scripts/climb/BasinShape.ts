/**
 * Layout of the Taipei basin round the tower (ADR-11): a ring of green mountains, a dense city
 * plain with two rivers, a few parks and a hill just east of the tower, plus the drifting cloud
 * banks and the layered sky colours. Pure TypeScript (no `cc`) so it can be unit tested; the
 * scene side (Basin3D / Atmosphere3D) only turns these numbers into meshes.
 *
 * World axes as in Tower3D: the tower stands on the origin, y is up; north is -z, east is +x.
 * One world unit is roughly 2 m, but distances are compressed so the mountains fit inside the
 * camera's far plane. These are drawing proportions only; gameplay numbers stay in levels.json.
 */

export type RGB = readonly [number, number, number];
export type XZ = readonly [number, number];

/** Deterministic PRNG (mulberry32): the basin looks the same on every run and every device. */
export function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function clamp01(x: number): number {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function smoothstep(a: number, b: number, x: number): number {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
}

export function mix(a: RGB, b: RGB, t: number): [number, number, number] {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** '#rrggbb' to 0..1 floats. */
export function rgb(hex: string): RGB {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ------------------------------------------------------------------ extents

/** Inner edge of the terrain mesh; the plaza square covers the tower's footprint inside it. */
export const PLAIN_MIN = 40;
/** The terrain ends here; the sky dome's haze below the horizon takes over beyond. */
export const BASIN_MAX = 1600;
/** City blocks start here, well outside the camera's orbit (at most ~33 from the axis). */
export const CITY_MIN = 60;
/** The dense city stops here; green fields beyond, up to the mountains. */
export const CITY_EDGE = 460;
/** The plain sits a little below the plaza (y = 0) so the two never z-fight. */
export const PLAIN_Y = -0.15;
/** Rivers float this far above the plain. */
export const RIVER_Y = 0.25;

// ------------------------------------------------------------------ rivers

export interface River {
    /** Centre line from upstream to downstream. */
    path: XZ[];
    width: number;
}

/**
 * Two rivers like the basin's: one comes in from the east, swings past north of the tower and
 * joins the wider one, which comes up from the south-west and leaves through a gap in the
 * north-west mountains.
 */
export const RIVERS: readonly River[] = [
    {
        width: 24,
        path: [[1500, -380], [900, -330], [640, -300], [500, -330], [380, -200], [250, -230], [120, -270], [0, -205],
            [-130, -255], [-260, -330], [-380, -300]],
    },
    {
        width: 42,
        path: [[-150, 1500], [-180, 900], [-220, 560], [-330, 380], [-420, 140], [-430, -90], [-380, -300],
            [-470, -480], [-560, -620], [-700, -820], [-1100, -1250]],
    },
];

/** Distance from (x, z) to segment a-b. */
function segDist(x: number, z: number, a: XZ, b: XZ): number {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? clamp01(((x - a[0]) * dx + (z - a[1]) * dz) / len2) : 0;
    return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

/** How far (x, z) is from the bank of the nearest river (negative = on the water). */
export function riverBankDist(x: number, z: number): number {
    let best = Infinity;
    for (const r of RIVERS) {
        for (let i = 0; i + 1 < r.path.length; i++) {
            best = Math.min(best, segDist(x, z, r.path[i], r.path[i + 1]) - r.width / 2);
        }
    }
    return best;
}

// ------------------------------------------------------------------ mountains

/** Angle on the ground: 0 = north (-z), growing clockwise seen from above (towards east, +x). */
export function bearing(x: number, z: number): number {
    const a = Math.atan2(x, -z);
    return a < 0 ? a + Math.PI * 2 : a;
}

function angDist(a: number, b: number): number {
    const d = Math.abs(a - b) % (Math.PI * 2);
    return d > Math.PI ? Math.PI * 2 - d : d;
}

/** Bumps on the ridge line: [bearing (deg), half width (deg), extra height]. */
const PEAKS: ReadonlyArray<readonly [number, number, number]> = [
    [10, 38, 90], // the big volcanic massif to the north
    [-25, 20, 55],
    [95, 30, 45], // eastern hills
    [160, 35, 50], // southern ranges
    [250, 30, 30], // western plateau
];
/** Where the rivers cut through: [bearing (deg), half width (deg), share of height kept]. */
const GAPS: ReadonlyArray<readonly [number, number, number]> = [
    [319, 9, 0.12], // the river mouth, north-west
    [104, 7, 0.55],
    [190, 8, 0.5],
];

/** Distance from the axis to the foot of the mountains in the direction `b` (radians). */
export function mountainFoot(b: number): number {
    // Close in the east and south-east, far across the plain to the west.
    return 690 + 120 * Math.cos(b - (260 * Math.PI) / 180) + 30 * Math.sin(b * 3 + 1.1);
}

/** Ridge height (above the plain) in the direction `b`, before the radial profile. */
export function ridgeHeight(b: number): number {
    let h = 85 + 18 * Math.sin(b * 5 + 0.7) + 10 * Math.sin(b * 11 + 2.3) + 6 * Math.sin(b * 23);
    for (const [deg, w, extra] of PEAKS) {
        const d = angDist(b, (deg * Math.PI) / 180) / ((w * Math.PI) / 180);
        h += extra * Math.exp(-d * d);
    }
    for (const [deg, w, keep] of GAPS) {
        const d = angDist(b, (deg * Math.PI) / 180) / ((w * Math.PI) / 180);
        h *= 1 - (1 - keep) * Math.exp(-d * d);
    }
    return Math.max(20, h);
}

/** Hills on the plain: [x, z, radius, height]. The first is the steep hill just east of the tower. */
export const HILLS: ReadonlyArray<readonly [number, number, number, number]> = [
    [300, 70, 75, 58],
    [380, -40, 60, 36],
    [-120, 520, 70, 26],
    [470, 360, 80, 40],
];

/**
 * Terrain height at (x, z), relative to PLAIN_Y. Flat plain with a few hills, then the
 * mountains rise from their foot to the crest, with lower ranges behind, cut into valleys
 * where the rivers run.
 */
export function terrainHeight(x: number, z: number): number {
    const r = Math.hypot(x, z);
    const b = bearing(x, z);
    let h = 0;
    for (const [hx, hz, hr, hh] of HILLS) {
        const d = Math.hypot(x - hx, z - hz) / hr;
        if (d < 1.6) h += hh * Math.exp(-d * d * 2.2);
    }
    const foot = mountainFoot(b);
    if (r > foot) {
        const u = (r - foot) / (BASIN_MAX - foot);
        const profile = smoothstep(0, 0.24, u) * (1 - 0.4 * smoothstep(0.3, 1, u)) + 0.22 * Math.exp(-(((u - 0.68) / 0.12) ** 2));
        // Spurs and gullies so the slopes are not a smooth wall.
        const rough = 1 + 0.14 * Math.sin(b * 37 + u * 9) + 0.08 * Math.sin(b * 47 - u * 17);
        let m = ridgeHeight(b) * profile * rough;
        // Valleys along the rivers.
        m *= smoothstep(5, 140, riverBankDist(x, z));
        h += m;
    }
    return h;
}

// ------------------------------------------------------------------ colours

/** Distant things fade towards this (aerial perspective), matched to the low sky's horizon. */
export const HAZE = rgb('#d6e2e6');
export const HAZE_MAX = 0.62;

/** Share of haze at `dist` from the camera's usual spot (the tower axis). */
export function hazeAt(dist: number): number {
    return HAZE_MAX * Math.pow(clamp01((dist - 120) / 1500), 0.85);
}

export function hazed(c: RGB, dist: number): [number, number, number] {
    return mix(c, HAZE, hazeAt(dist));
}

const PLAIN = rgb('#a7a497');
/** Fields and suburbs round the city, like the green rim of the basin floor. */
const PLAIN_FAR = rgb('#a3c46e');
const FOOTHILL = rgb('#7fb556');
const FOREST = rgb('#4f9a45');
const DEEP = rgb('#3d8239');
/** Bare tan tops on the highest peaks. */
const GRASS = rgb('#b9a874');

/** Ground colour at a point of the terrain with height `h` (city plain, then forest). */
export function terrainColor(x: number, z: number, h: number): [number, number, number] {
    const r = Math.hypot(x, z);
    let c: [number, number, number] = mix(PLAIN, PLAIN_FAR, smoothstep(330, 480, r));
    if (h > 0.5) {
        c = mix(c, FOOTHILL, smoothstep(0.5, 12, h));
        c = mix(c, FOREST, smoothstep(25, 90, h));
        c = mix(c, DEEP, smoothstep(110, 170, h) * 0.7);
        // Grassy tops on the high northern peaks.
        c = mix(c, GRASS, smoothstep(190, 240, h));
    }
    return hazed(c, r);
}

export const RIVER_COLOR = rgb('#4f9fd2');
export const PARK_COLOR = rgb('#77b35a');

// ------------------------------------------------------------------ city

/** Parks on the plain: [x, z, half width x, half width z]. No blocks inside. */
export const PARKS: ReadonlyArray<readonly [number, number, number, number]> = [
    [-230, 180, 48, 34],
    [-90, -60, 24, 30],
    [120, 330, 30, 22],
];

export interface Block {
    x: number;
    z: number;
    w: number;
    d: number;
    h: number;
    yaw: number;
    /** Index into the scene's tone list. */
    tone: number;
}

export interface CityOptions {
    /** Points (x, z, radius) to keep clear of blocks, e.g. the practice mode's skyline 101. */
    keepClear?: ReadonlyArray<readonly [number, number, number]>;
    tones?: number;
}

function inPark(x: number, z: number, pad: number): boolean {
    for (const [px, pz, hx, hz] of PARKS) {
        if (Math.abs(x - px) < hx + pad && Math.abs(z - pz) < hz + pad) return true;
    }
    return false;
}

/**
 * City blocks across the plain: a jittered grid, denser and taller near the tower (a cluster
 * of high-rises to its east and north), thinning and lower towards the mountains. Nothing on
 * the rivers, in the parks, on the hills or inside CITY_MIN.
 */
export function cityPlan(opts: CityOptions = {}): Block[] {
    const rnd = rng(101);
    const tones = opts.tones ?? 6;
    const out: Block[] = [];
    const place = (step: number, rMin: number, rMax: number, keep: (r: number) => number): void => {
        const n = Math.ceil(rMax / step);
        for (let gx = -n; gx <= n; gx++) {
            for (let gz = -n; gz <= n; gz++) {
                const x = gx * step + (rnd() - 0.5) * step * 0.35;
                const z = gz * step + (rnd() - 0.5) * step * 0.35;
                const r = Math.hypot(x, z);
                const roll = rnd();
                const wr = rnd(), dr = rnd(), hr = rnd(), hr2 = rnd(), yr = rnd(), tr = rnd();
                if (r < rMin || r >= rMax) continue;
                if (roll > keep(r)) continue;
                const foot = mountainFoot(bearing(x, z));
                // The city fills the middle of the basin; fields ring it at the mountains' feet.
                if (r > foot - 25 || r > CITY_EDGE) continue;
                const size = step * (0.5 + wr * 0.28);
                if (riverBankDist(x, z) < size * 0.8 + 6) continue;
                if (inPark(x, z, size * 0.6)) continue;
                if (terrainHeight(x, z) > 1.5) continue;
                if (opts.keepClear?.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr + size)) continue;
                // Taller near the tower, with a high-rise cluster to its east / north-east.
                const core = Math.exp(-(((x - 110) / 150) ** 2) - (((z + 40) / 170) ** 2));
                const fall = 1 - smoothstep(80, 650, r);
                // Low right round the plaza, so the tower's base and the skyline stay in view.
                const open = smoothstep(CITY_MIN, 170, r);
                const h = 5 + hr * (8 + 22 * fall * open) + hr2 * hr2 * hr2 * (25 + 70 * core) * open;
                out.push({
                    x, z, w: size, d: step * (0.5 + dr * 0.28), h, yaw: (yr - 0.5) * 0.25, tone: Math.floor(tr * tones),
                });
            }
        }
    };
    place(15, CITY_MIN, 320, (r) => 0.9 - 0.15 * smoothstep(60, 320, r));
    place(27, 320, 900, (r) => 0.72 - 0.3 * smoothstep(320, 800, r));
    return out;
}

// ------------------------------------------------------------------ sky

/** A sky colour at an elevation: sin(elevation) from -1 (straight down) to 1 (straight up). */
export type SkyStop = readonly [number, RGB];

const SKY_LOW: readonly SkyStop[] = [
    [-1, rgb('#cfd9da')], [-0.02, HAZE], [0, rgb('#dae7ef')], [0.06, rgb('#c1d9ec')], [0.2, rgb('#93c0e6')],
    [0.5, rgb('#71a9dd')], [1, rgb('#4d86cb')],
];
/** Near the summit the air is clearer: deeper blue overhead, a brighter band at the horizon. */
const SKY_HIGH: readonly SkyStop[] = [
    [-1, rgb('#c3d0d6')], [-0.02, rgb('#cfdde3')], [0, rgb('#e6eef2')], [0.06, rgb('#bcd8ee')], [0.2, rgb('#86b8e6')],
    [0.5, rgb('#4f8ad4')], [1, rgb('#2c5fb2')],
];
/** Rain: low grey overcast. */
const SKY_STORM: readonly SkyStop[] = [
    [-1, rgb('#7e888c')], [-0.02, rgb('#8d979b')], [0, rgb('#a0a9ad')], [0.06, rgb('#929ca2')], [0.2, rgb('#838d94')],
    [0.5, rgb('#727c84')], [1, rgb('#626b73')],
];

/**
 * Layered sky colours for the camera's altitude (0 at the plaza, 1 at the summit) and how
 * stormy it is (0 clear, 1 raining). All palettes share the same elevations.
 */
export function skyStops(altitude: number, gloom: number): SkyStop[] {
    const a = clamp01(altitude), g = clamp01(gloom);
    return SKY_LOW.map(([e, low], i) => [e, mix(mix(low, SKY_HIGH[i][1], a), SKY_STORM[i][1], g)] as SkyStop);
}

/** Colour of the sky at sin(elevation) `e`, interpolated between the stops. */
export function skyColorAt(stops: readonly SkyStop[], e: number): [number, number, number] {
    if (e <= stops[0][0]) return [...stops[0][1]] as [number, number, number];
    for (let i = 1; i < stops.length; i++) {
        const [e1, c1] = stops[i];
        if (e <= e1) {
            const [e0, c0] = stops[i - 1];
            return mix(c0, c1, (e - e0) / (e1 - e0));
        }
    }
    return [...stops[stops.length - 1][1]] as [number, number, number];
}

// ------------------------------------------------------------------ clouds

export interface Puff {
    /** Centre relative to the cloud, and radii (flattened ellipsoid). */
    x: number;
    y: number;
    z: number;
    rx: number;
    ry: number;
    rz: number;
}

export interface Cloud {
    layer: number;
    /** Where it sits at t = 0: bearing (radians), distance from the axis, height. */
    angle: number;
    dist: number;
    y: number;
    puffs: Puff[];
}

/** Cloud layers, low to high: [count, lowest y, highest y, nearest, farthest, degrees per second]. */
export const CLOUD_LAYERS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
    [9, 110, 160, 320, 900, 0.5],
    [9, 190, 270, 240, 1000, 0.75],
    [8, 320, 420, 220, 1100, 1.05],
];
/** Clouds never come nearer the axis than this (the ending's camera circles at ~40). */
export const CLOUD_MIN_DIST = 200;

/** A fixed set of cumulus clouds spread round the basin in three layers. */
export function cloudPlan(): Cloud[] {
    const rnd = rng(1010);
    const out: Cloud[] = [];
    CLOUD_LAYERS.forEach(([count, y0, y1, r0, r1], layer) => {
        for (let i = 0; i < count; i++) {
            const angle = ((i + rnd() * 0.7) / count) * Math.PI * 2 + layer;
            const dist = Math.max(CLOUD_MIN_DIST, r0 + rnd() * (r1 - r0));
            const y = y0 + rnd() * (y1 - y0);
            const size = 26 + rnd() * 30 + dist * 0.03;
            const n = 4 + Math.floor(rnd() * 4);
            const puffs: Puff[] = [];
            for (let k = 0; k < n; k++) {
                const t = n === 1 ? 0 : k / (n - 1) - 0.5;
                const rx = size * (0.45 + rnd() * 0.35) * (1 - Math.abs(t) * 0.6);
                puffs.push({
                    x: t * size * 2.2 + (rnd() - 0.5) * size * 0.3,
                    y: rx * 0.25 + rnd() * size * 0.15,
                    z: (rnd() - 0.5) * size * 0.8,
                    rx,
                    ry: rx * (0.5 + rnd() * 0.2),
                    rz: rx * (0.8 + rnd() * 0.3),
                });
            }
            out.push({ layer, angle, dist, y, puffs });
        }
    });
    return out;
}

/** Cloud drift speed of a layer (radians per second round the axis); wind (0..1) speeds it up. */
export function cloudSpin(layer: number, wind: number): number {
    return ((CLOUD_LAYERS[layer][5] * Math.PI) / 180) * (1 + 3 * clamp01(wind));
}
