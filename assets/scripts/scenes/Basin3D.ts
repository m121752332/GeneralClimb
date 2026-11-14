import { MeshBuilder } from './MeshKit';
import {
    BASIN_MAX, type Block, PARKS, PARK_COLOR, PLAIN_MIN, PLAIN_Y, RIVERS, RIVER_COLOR, RIVER_Y, type RGB,
    cityPlan, hazed, mix, mountainFoot, rgb, terrainColor, terrainHeight,
} from '../climb/BasinShape';

/**
 * Meshes for the Taipei basin round the tower (ADR-11): one indexed polar heightfield for the
 * city plain and the mountain ring, flat ribbons for the rivers and parks, and the city blocks.
 * All vertex coloured with the light and the distance haze baked in, drawn with the shared
 * unlit material, so the whole landscape costs a handful of draw calls.
 */

/** Same fixed light as MeshKit.shade. */
const LIGHT: RGB = (() => {
    const l = Math.hypot(0.45, 0.75, 0.5);
    return [0.45 / l, 0.75 / l, 0.5 / l];
})();

function lit(c: readonly number[], nx: number, ny: number, nz: number): number[] {
    const len = Math.hypot(nx, ny, nz) || 1;
    const d = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / len;
    const k = 0.62 + 0.38 * Math.max(0, d);
    return [c[0] * k, c[1] * k, c[2] * k, 1];
}

/** Angular segments of the terrain (2° each). */
const SEGMENTS = 180;
/** Rings on the plain (absolute distance), then on the mountains (share of foot..BASIN_MAX). */
const PLAIN_RINGS = [PLAIN_MIN, 60, 85, 115, 150, 190, 230, 265, 300, 335, 370, 410, 450, 495];
const MOUNTAIN_RINGS = [0, 0.025, 0.06, 0.1, 0.15, 0.21, 0.28, 0.36, 0.46, 0.58, 0.7, 0.84, 1];
/** Meshes stay under 16-bit indices. */
const MAX_VERTS = 60000;

/** City plain and mountain ring as one smooth-shaded indexed mesh. */
export function buildTerrain(): MeshBuilder {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const rows = PLAIN_RINGS.length + MOUNTAIN_RINGS.length;
    const e = 2;
    for (let i = 0; i <= SEGMENTS; i++) {
        const b = (i / SEGMENTS) * Math.PI * 2;
        const sx = Math.sin(b), sz = -Math.cos(b);
        const foot = mountainFoot(b);
        const radii = [...PLAIN_RINGS, ...MOUNTAIN_RINGS.map((u) => foot + u * (BASIN_MAX - foot))];
        for (const r of radii) {
            const x = sx * r, z = sz * r;
            const h = terrainHeight(x, z);
            // Normal from central differences of the height field.
            const nx = terrainHeight(x - e, z) - terrainHeight(x + e, z);
            const nz = terrainHeight(x, z - e) - terrainHeight(x, z + e);
            positions.push(x, PLAIN_Y + h, z);
            colors.push(...lit(terrainColor(x, z, h), nx, 2 * e, nz));
        }
    }
    for (let i = 0; i < SEGMENTS; i++) {
        for (let j = 0; j + 1 < rows; j++) {
            const a = i * rows + j, b = a + 1, c = a + rows, d = c + 1;
            // Counter-clockwise seen from above.
            indices.push(a, c, b, b, c, d);
        }
    }
    return MeshBuilder.from(positions, colors, indices);
}

/** Rivers as flat ribbons sampled along their centre lines, and the parks as flat lawns. */
export function buildWater(): MeshBuilder {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const put = (x: number, y: number, z: number, c: readonly number[]): number => {
        positions.push(x, y, z);
        colors.push(c[0], c[1], c[2], 1);
        return positions.length / 3 - 1;
    };
    for (const river of RIVERS) {
        // Resample the centre line every ~20 units.
        const pts: [number, number][] = [];
        for (let i = 0; i + 1 < river.path.length; i++) {
            const [ax, az] = river.path[i], [bx, bz] = river.path[i + 1];
            const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 20));
            for (let k = 0; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
        }
        pts.push([...river.path[river.path.length - 1]] as [number, number]);
        let prev = -1;
        for (let i = 0; i < pts.length; i++) {
            const [x, z] = pts[i];
            const [px, pz] = pts[Math.max(0, i - 1)], [nx, nz] = pts[Math.min(pts.length - 1, i + 1)];
            const tx = nx - px, tz = nz - pz;
            const tl = Math.hypot(tx, tz) || 1;
            const ox = (-tz / tl) * river.width / 2, oz = (tx / tl) * river.width / 2;
            const c = hazed(RIVER_COLOR, Math.hypot(x, z));
            const l = put(x + ox, PLAIN_Y + RIVER_Y, z + oz, c);
            put(x - ox, PLAIN_Y + RIVER_Y, z - oz, c);
            if (prev >= 0) indices.push(prev, prev + 1, l, prev + 1, l + 1, l, prev, l, prev + 1, prev + 1, l, l + 1);
            prev = l;
        }
    }
    for (const [px, pz, hx, hz] of PARKS) {
        const c = hazed(PARK_COLOR, Math.hypot(px, pz));
        const y = PLAIN_Y + 0.2;
        const a = put(px - hx, y, pz - hz, c);
        put(px + hx, y, pz - hz, c);
        put(px + hx, y, pz + hz, c);
        put(px - hx, y, pz + hz, c);
        // Both windings: the shared material has no culling, but keep it explicit.
        indices.push(a, a + 3, a + 2, a, a + 2, a + 1);
    }
    return MeshBuilder.from(positions, colors, indices);
}

const TONES: RGB[] = ['#c9c3b8', '#a9b3b8', '#d8cfc0', '#8f9ca3', '#b7c4c9', '#9aa89a', '#c4b6a4', '#e0dcd2'].map(rgb);
const ROOF = rgb('#e4e0d8');
/** Facades are darker at street level. */
const STREET_SHADE = 0.72;

/**
 * City blocks (roof and four walls, no floor), split into meshes under MAX_VERTS.
 * `keepClear` holds [x, z, radius] spots with no blocks.
 */
export function buildCity(keepClear: ReadonlyArray<readonly [number, number, number]> = []): MeshBuilder[] {
    const blocks = cityPlan({ keepClear, tones: TONES.length });
    const out: MeshBuilder[] = [];
    let positions: number[] = [], colors: number[] = [], indices: number[] = [];
    const flush = (): void => {
        if (indices.length) out.push(MeshBuilder.from(positions, colors, indices));
        positions = [];
        colors = [];
        indices = [];
    };
    for (const bl of blocks) {
        if (positions.length / 3 + 20 > MAX_VERTS) flush();
        addBlock(bl, positions, colors, indices);
    }
    flush();
    return out;
}

function addBlock(bl: Block, positions: number[], colors: number[], indices: number[]): void {
    const dist = Math.hypot(bl.x, bl.z);
    const wall = hazed(TONES[bl.tone], dist);
    const foot = hazed(mix(TONES[bl.tone], [0, 0, 0], 1 - STREET_SHADE), dist);
    const roof = hazed(ROOF, dist);
    const cs = Math.cos(bl.yaw), sn = Math.sin(bl.yaw);
    const hx = bl.w / 2, hz = bl.d / 2;
    const y0 = PLAIN_Y, y1 = PLAIN_Y + bl.h;
    const p = (x: number, z: number): [number, number] => [bl.x + x * cs + z * sn, bl.z - x * sn + z * cs];
    const c = [p(-hx, -hz), p(hx, -hz), p(hx, hz), p(-hx, hz)];
    const quad = (pts: number[][], cols: number[][]): void => {
        const i = positions.length / 3;
        for (let k = 0; k < 4; k++) {
            positions.push(pts[k][0], pts[k][1], pts[k][2]);
            colors.push(cols[k][0], cols[k][1], cols[k][2], 1);
        }
        indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    };
    // Walls: counter-clockwise from outside; bottom edge darker.
    for (let k = 0; k < 4; k++) {
        const a = c[k], b = c[(k + 1) % 4];
        // Outward normal of edge a->b.
        const nx = b[1] - a[1], nz = -(b[0] - a[0]);
        const lo = lit(foot, nx, 0, nz), hi = lit(wall, nx, 0, nz);
        quad([[b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]]], [lo, lo, hi, hi]);
    }
    const r = lit(roof, 0, 1, 0);
    quad([[c[0][0], y1, c[0][1]], [c[3][0], y1, c[3][1]], [c[2][0], y1, c[2][1]], [c[1][0], y1, c[1][1]]], [r, r, r, r]);
}

