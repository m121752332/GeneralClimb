import { Color, Mesh, Vec3, primitives, utils } from 'cc';

/** Vertex-coloured mesh building shared by the 3D scene parts (Tower3D, WindowCrowd). */

/** Fixed light: faces turned towards it are brighter (baked into vertex colours). */
const LIGHT = new Vec3(0.45, 0.75, 0.5).normalize();

export function shade(c: Color, nx: number, ny: number, nz: number): [number, number, number, number] {
    const len = Math.hypot(nx, ny, nz) || 1;
    const d = (nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z) / len;
    const k = 0.62 + 0.38 * Math.max(0, d);
    return [c.r / 255 * k, c.g / 255 * k, c.b / 255 * k, 1];
}

export type V3 = [number, number, number];

/** Collects vertex-coloured triangles into one mesh. */
export class MeshBuilder {
    positions: number[] = [];
    colors: number[] = [];
    indices: number[] = [];
    private min: V3 = [Infinity, Infinity, Infinity];
    private max: V3 = [-Infinity, -Infinity, -Infinity];

    get vertexCount(): number {
        return this.positions.length / 3;
    }

    private vert(p: V3, c: number[]): number {
        this.positions.push(p[0], p[1], p[2]);
        this.colors.push(c[0], c[1], c[2], c[3]);
        for (let i = 0; i < 3; i++) {
            if (p[i] < this.min[i]) this.min[i] = p[i];
            if (p[i] > this.max[i]) this.max[i] = p[i];
        }
        return this.vertexCount - 1;
    }

    /** Quad a-b-c-d counter-clockwise seen from the front. Shaded by its own normal. */
    quad(a: V3, b: V3, c: V3, d: V3, color: Color, flat = false): void {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
        const col = flat ? [color.r / 255, color.g / 255, color.b / 255, 1]
            : shade(color, uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        const i = this.vert(a, col);
        this.vert(b, col);
        this.vert(c, col);
        this.vert(d, col);
        this.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }

    /** Quad a-b-c-d whose bottom edge (a, b) is `bottom` and top edge (c, d) is `top`. */
    gradQuad(a: V3, b: V3, c: V3, d: V3, bottom: Color, top: Color, flat = false): void {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const tone = (col: Color): number[] => (flat ? [col.r / 255, col.g / 255, col.b / 255, 1] : shade(col, nx, ny, nz));
        const lo = tone(bottom), hi = tone(top);
        const i = this.vert(a, lo);
        this.vert(b, lo);
        this.vert(c, hi);
        this.vert(d, hi);
        this.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }

    /** Axis-aligned box (optionally turned about Y by `yaw` around its centre). */
    box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: Color, yaw = 0, top?: Color): void {
        const hx = sx / 2, hy = sy / 2, hz = sz / 2;
        const cs = Math.cos(yaw), sn = Math.sin(yaw);
        const p = (x: number, y: number, z: number): V3 => [cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs];
        const v = [p(-hx, -hy, -hz), p(hx, -hy, -hz), p(hx, hy, -hz), p(-hx, hy, -hz),
            p(-hx, -hy, hz), p(hx, -hy, hz), p(hx, hy, hz), p(-hx, hy, hz)];
        this.quad(v[4], v[5], v[6], v[7], color); // +z
        this.quad(v[1], v[0], v[3], v[2], color); // -z
        this.quad(v[5], v[1], v[2], v[6], color); // +x
        this.quad(v[0], v[4], v[7], v[3], color); // -x
        this.quad(v[7], v[6], v[2], v[3], top ?? color); // +y
        this.quad(v[0], v[1], v[5], v[4], color); // -y
    }

    /** Vertical prism with `n` sides, radius r0 at y0 tapering to r1 at y1, capped. */
    prism(n: number, y0: number, y1: number, r0: number, r1: number, color: Color, x = 0, z = 0): void {
        for (let i = 0; i < n; i++) {
            const a0 = (i / n) * Math.PI * 2;
            const a1 = ((i + 1) / n) * Math.PI * 2;
            this.quad(
                [x + Math.sin(a0) * r0, y0, z + Math.cos(a0) * r0],
                [x + Math.sin(a1) * r0, y0, z + Math.cos(a1) * r0],
                [x + Math.sin(a1) * r1, y1, z + Math.cos(a1) * r1],
                [x + Math.sin(a0) * r1, y1, z + Math.cos(a0) * r1],
                color,
            );
        }
        const top = shade(color, 0, 1, 0);
        const c = this.vert([x, y1, z], top);
        for (let i = 0; i <= n; i++) {
            const a = (i / n) * Math.PI * 2;
            this.vert([x + Math.sin(a) * r1, y1, z + Math.cos(a) * r1], top);
        }
        for (let i = 0; i < n; i++) this.indices.push(c, c + 1 + i, c + 2 + i);
    }

    /** Wraps ready-made buffers (e.g. a ClimberShape part, already lit). */
    static from(positions: number[], colors: number[], indices: number[]): MeshBuilder {
        const mb = new MeshBuilder();
        mb.positions = positions;
        mb.colors = colors;
        mb.indices = indices;
        for (let i = 0; i < positions.length; i += 3) {
            for (let k = 0; k < 3; k++) {
                const v = positions[i + k];
                if (v < mb.min[k]) mb.min[k] = v;
                if (v > mb.max[k]) mb.max[k] = v;
            }
        }
        return mb;
    }

    build(): Mesh {
        const geometry = {
            positions: this.positions,
            colors: this.colors,
            indices: this.indices,
            minPos: new Vec3(this.min[0], this.min[1], this.min[2]),
            maxPos: new Vec3(this.max[0], this.max[1], this.max[2]),
        } as unknown as primitives.IGeometry;
        // `utils.MeshUtils.createMesh` in 3.8; older builds expose `utils.createMesh`.
        const u = utils as unknown as {
            MeshUtils?: { createMesh: (g: primitives.IGeometry) => Mesh };
            createMesh?: (g: primitives.IGeometry) => Mesh;
        };
        const create = u.MeshUtils?.createMesh ?? u.createMesh;
        if (!create) throw new Error('createMesh is not available (is the 3D module enabled?)');
        return create(geometry);
    }
}
