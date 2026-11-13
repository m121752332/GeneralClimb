import {
    Camera, Color, Layers, Material, Mesh, MeshRenderer, Node, Vec3, director, primitives, resources, utils,
} from 'cc';
import type { ClimbSim } from '../climb/ClimbCore';
import { isObstacle, zoneOf } from '../climb/ClimbCore';
import {
    LIFT, ROW_H, Section, angleDelta, halfAt, ringDelta, roofY, rowY, surfacePoint, towerSections,
} from '../climb/TowerShape';

/**
 * 3D view of the climb (ADR-10): a low-poly Taipei 101 built in code, the current level's
 * climbing grid wrapped round its four faces, a block-figure climber, and a camera that
 * orbits the tower axis. Everything is vertex-coloured unlit geometry in a handful of meshes
 * (one material), so it stays cheap on phones. No rules here: it only draws a ClimbSim.
 */

// Presentation-only constants.
const SKY = hex('#9cc8e6');
/** Climber stands this far in front of the glass. */
const PLAYER_OUT = 0.45;
/** Grid quads float just off the facade to avoid z-fighting. */
const GRID_OUT = 0.04;
/** Horizontal field of view, so a face fills the width on any phone. */
const FOV = 42;
/** Camera distance from the face: `half * DIST_K + DIST_C`. */
const DIST_K = 1.5;
const DIST_C = 9;
/** The camera looks this far above the climber, to show what's coming. */
const LOOK_UP = 2.2;
/** Degrees per second for Q / E, and radians per pixel for drags. */
const KEY_ORBIT_DEG = 100;
const DRAG_ORBIT = 0.008;
/** After the player lets go of the view, wait this long, then swing back to the climber. */
const RETURN_DELAY_SEC = 1.5;
const RETURN_RATE = 3;
/** Nearest city block distance from the tower axis; the orbit radius is at most ~33. */
const CITY_MIN = 60;

const COL = {
    glass: hex('#3f8f98'),
    glassDark: hex('#2b6f78'),
    mullion: hex('#1f4f57'),
    ledge: hex('#cfd8d6'),
    disc: hex('#b9c6c4'),
    discInner: hex('#7d8f8d'),
    ruyi: hex('#f2f2ee'),
    crown: hex('#5aa0a8'),
    spire: hex('#d8dcdc'),
    plaza: hex('#b8b2a6'),
    mat: hex('#24474a'),
    safe: hex('#6fd0e0'),
    danger: hex('#e0605a'),
    obstacle: hex('#5a5a5a'),
    obstacleTop: hex('#8a8a8a'),
    slab: hex('#173a40'),
    goal: hex('#e8c66a'),
    body: hex('#d62c2c'),
    skin: hex('#f0c090'),
    hair: hex('#2a2a2a'),
    pants: hex('#3a3f4a'),
    shoe: hex('#f2c230'),
};

function hex(s: string): Color {
    return new Color().fromHEX(s);
}

/** Fixed light: faces turned towards it are brighter (baked into vertex colours). */
const LIGHT = new Vec3(0.45, 0.75, 0.5).normalize();

function shade(c: Color, nx: number, ny: number, nz: number): [number, number, number, number] {
    const len = Math.hypot(nx, ny, nz) || 1;
    const d = (nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z) / len;
    const k = 0.62 + 0.38 * Math.max(0, d);
    return [c.r / 255 * k, c.g / 255 * k, c.b / 255 * k, 1];
}

type V3 = [number, number, number];

/** Collects vertex-coloured triangles into one mesh. */
class MeshBuilder {
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

/** Corners of a face strip at heights y0..y1 between perimeter coordinates s0..s1. */
function faceQuad(mb: MeshBuilder, sections: readonly Section[], cols: number, faces: number,
    s0: number, s1: number, y0: number, y1: number, out: number, color: Color, flat = false): void {
    const h0 = halfAt(sections, y0 + 1e-4);
    const h1 = halfAt(sections, y1 - 1e-4);
    const a = surfacePoint(s0, h0, cols, faces, out);
    const b = surfacePoint(s1, h0, cols, faces, out);
    const c = surfacePoint(s1, h1, cols, faces, out);
    const d = surfacePoint(s0, h1, cols, faces, out);
    mb.quad([a.x, y0, a.z], [b.x, y0, b.z], [c.x, y1, c.z], [d.x, y1, d.z], color, flat);
}

/** Loads the shared vertex-colour unlit material (resources/materials/vertex-color.mtl). */
function loadMaterial(): Promise<Material> {
    return new Promise((resolve, reject) => {
        resources.load('materials/vertex-color', Material, (err, mat) => {
            if (err || !mat) {
                // Fall back to building it from the built-in effect.
                try {
                    const m = new Material();
                    m.initialize({ effectName: 'builtin-unlit', defines: { USE_VERTEX_COLOR: true } });
                    resolve(m);
                } catch (e) {
                    reject(err ?? e);
                }
                return;
            }
            resolve(mat);
        });
    });
}

interface Limb {
    node: Node;
    /** Swing phase sign, so opposite limbs alternate. */
    sign: number;
    arm: boolean;
}

export class Tower3D {
    readonly root: Node;
    readonly camera: Camera;
    /** Extra orbit added by the player (radians); eases back to 0 after RETURN_DELAY_SEC. */
    userYaw = 0;

    private readonly rowsPerFloor: number;
    private readonly sections: Section[];
    private material: Material | null = null;
    private gridNode: Node | null = null;
    private gridMesh: Mesh | null = null;
    private player!: Node;
    private body!: Node;
    private limbs: Limb[] = [];
    private followYaw = 0;
    private camYaw = 0;
    private playerYaw = 0;
    private camY = 0;
    private camHalf = 8;
    private idleOrbitSec = 0;
    private baseRow = 0;
    private readonly tmp = new Vec3();

    constructor(rowsPerFloor: number) {
        this.rowsPerFloor = rowsPerFloor;
        this.sections = towerSections(rowsPerFloor);
        const scene = director.getScene()!;
        this.root = new Node('Tower3D');
        this.root.layer = Layers.Enum.DEFAULT;
        scene.addChild(this.root);

        const camNode = new Node('Camera3D');
        camNode.layer = Layers.Enum.DEFAULT;
        scene.addChild(camNode);
        const cam = camNode.addComponent(Camera);
        cam.projection = Camera.ProjectionType.PERSPECTIVE;
        cam.fovAxis = Camera.FOVAxis.HORIZONTAL;
        cam.fov = FOV;
        cam.near = 0.3;
        cam.far = 1500;
        cam.priority = 0;
        cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        cam.clearColor = SKY;
        cam.visibility = Layers.Enum.DEFAULT;
        this.camera = cam;
    }

    /** Builds the static scenery once the material is loaded. */
    async init(): Promise<void> {
        this.material = await loadMaterial();
        this.addMesh('Scenery', this.buildScenery());
        this.buildPlayer();
    }

    destroy(): void {
        this.gridMesh?.destroy();
        this.root.destroy();
        this.camera.node.destroy();
    }

    private addMesh(name: string, mb: MeshBuilder, parent: Node = this.root): { node: Node; mesh: Mesh } {
        const node = new Node(name);
        node.layer = Layers.Enum.DEFAULT;
        parent.addChild(node);
        const mesh = mb.build();
        const mr = node.addComponent(MeshRenderer);
        mr.mesh = mesh;
        mr.setSharedMaterial(this.material!, 0);
        mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
        return { node, mesh };
    }

    // ------------------------------------------------------------ static scenery

    private buildScenery(): MeshBuilder {
        const mb = new MeshBuilder();
        const S = this.sections;
        const faces = 4;
        const rpf = this.rowsPerFloor;

        // Plaza and the crash mats round the base.
        mb.quad([-400, 0, 400], [400, 0, 400], [400, 0, -400], [-400, 0, -400], COL.plaza, true);
        const m = S[0].half0 + 3;
        mb.quad([-m, 0.02, m], [m, 0.02, m], [m, 0.02, -m], [-m, 0.02, -m], COL.mat, true);

        for (let i = 0; i < S.length; i++) {
            const sec = S[i];
            // Facade: four trapezoids (one cell = one face here, cols = 1).
            for (let f = 0; f < faces; f++) faceQuad(mb, S, 1, faces, f, f + 1, sec.y0, sec.y1, 0, i % 2 ? COL.glass : COL.glassDark);
            // Floor lines on the glass.
            for (let fl = sec.floorFrom + 1; fl <= sec.floorTo; fl++) {
                const y = rowY((fl - 1) * rpf);
                for (let f = 0; f < faces; f++) faceQuad(mb, S, 1, faces, f, f + 1, y - 0.06, y + 0.06, 0.015, COL.mullion);
            }
            // Vertical mullions: a few per face.
            for (let f = 0; f < faces; f++) {
                for (let k = 1; k < 6; k++) {
                    const s = f + k / 6;
                    faceQuad(mb, S, 1, faces, s - 0.004, s + 0.004, sec.y0, sec.y1, 0.015, COL.mullion);
                }
            }
            // Ledge on top: from this section's top edge in to the next one's bottom edge.
            const next = S[i + 1];
            const inner = next ? next.half0 : 0;
            this.ring(mb, sec.y1, sec.half1 + 0.15, inner, COL.ledge);
            // Ledge lip.
            for (let f = 0; f < faces; f++) faceQuad(mb, S, 1, faces, f, f + 1, sec.y1 - 0.35, sec.y1, 0.15, COL.ledge);
            if (sec.kind === 'segment') {
                // Ruyi ornaments at the corners, a third of the way up.
                const y = sec.y0 + (sec.y1 - sec.y0) * 0.35;
                const h = halfAt(S, y);
                for (let f = 0; f < faces; f++) {
                    const p = surfacePoint(f, h, 1, faces, 0.25);
                    mb.box(p.x, y, p.z, 0.9, 0.35, 0.9, COL.ruyi, Math.PI / 4);
                    mb.box(p.x, y - 0.55, p.z, 0.3, 0.8, 0.3, COL.ruyi, Math.PI / 4);
                }
            }
        }

        // Round medallions on each face at the top of the base (26F).
        const base = S[0];
        const dy = base.y1 - 2.4;
        const dh = halfAt(S, dy);
        for (let f = 0; f < faces; f++) {
            const yaw = (f * Math.PI) / 2;
            this.disc(mb, dh + 0.08, dy, yaw, 1.9, COL.disc);
            this.disc(mb, dh + 0.14, dy, yaw, 1.2, COL.discInner);
        }

        // Crown and spire above 101F.
        const roof = roofY(rpf);
        mb.box(0, roof + 1.2, 0, 7.4, 2.4, 7.4, COL.crown, 0, COL.ledge);
        mb.box(0, roof + 3.4, 0, 5.4, 2.0, 5.4, COL.glass, 0, COL.ledge);
        mb.box(0, roof + 5.2, 0, 3.6, 1.6, 3.6, COL.crown, 0, COL.ledge);
        mb.prism(8, roof + 6, roof + 14, 1.1, 0.8, COL.spire);
        mb.prism(8, roof + 14, roof + 34, 0.55, 0.12, COL.spire);

        // City blocks round the plaza (fixed layout, so every run looks the same). They start
        // well outside the camera's orbit (CITY_MIN) so the camera never ends up inside one.
        let seed = 101;
        const rnd = (): number => {
            seed = (seed * 16807) % 2147483647;
            return seed / 2147483647;
        };
        const tones = [hex('#c9c3b8'), hex('#a9b3b8'), hex('#d8cfc0'), hex('#8f9ca3'), hex('#b7c4c9'), hex('#9aa89a')];
        for (let i = 0; i < 260; i++) {
            const a = rnd() * Math.PI * 2;
            const r = CITY_MIN + Math.pow(rnd(), 0.7) * 300;
            const near = r < CITY_MIN + 40;
            const w = 6 + rnd() * 14;
            const d = 6 + rnd() * 14;
            const h = near ? 4 + rnd() * 18 : 6 + rnd() * rnd() * 60;
            mb.box(Math.sin(a) * r, h / 2, Math.cos(a) * r, w, h, d, tones[i % tones.length], rnd() * 0.4, hex('#e4e0d8'));
        }
        return mb;
    }

    /** Flat square ring at height y between half widths outer and inner. */
    private ring(mb: MeshBuilder, y: number, outer: number, inner: number, color: Color): void {
        const pts = (h: number): V3[] => [[h, y, h], [h, y, -h], [-h, y, -h], [-h, y, h]];
        const o = pts(outer);
        const n = pts(inner);
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            mb.quad(o[i], o[j], n[j], n[i], color);
        }
    }

    /** 16-sided disc facing outward from a face at distance `out`. */
    private disc(mb: MeshBuilder, out: number, y: number, yaw: number, r: number, color: Color): void {
        const nx = Math.sin(yaw), nz = Math.cos(yaw);
        const tx = Math.cos(yaw), tz = -Math.sin(yaw);
        const n = 16;
        for (let i = 0; i < n; i++) {
            const a0 = (i / n) * Math.PI * 2;
            const a1 = ((i + 1) / n) * Math.PI * 2;
            const p = (a: number): V3 => [nx * out + tx * Math.cos(a) * r, y + Math.sin(a) * r, nz * out + tz * Math.cos(a) * r];
            const c: V3 = [nx * out, y, nz * out];
            mb.quad(c, p(a0), p(a1), c, color);
        }
    }

    // ------------------------------------------------------------ level grid

    /** Rebuilds the climbing grid for the sim's level. */
    setLevel(sim: ClimbSim): void {
        this.gridNode?.destroy();
        this.gridMesh?.destroy();
        const { wall, level } = sim;
        const S = this.sections;
        this.baseRow = level.floorFrom === null ? 0 : (level.floorFrom - 1) * this.rowsPerFloor;
        const mb = new MeshBuilder();
        const inset = 0.08;
        for (let r = 0; r < wall.rows; r++) {
            const y0 = rowY(this.baseRow + r);
            const y1 = y0 + ROW_H;
            for (let c = 0; c < wall.ring; c++) {
                if (isObstacle(wall, c, r)) continue;
                const color = zoneOf(wall, c, r) === 'safe' ? COL.safe : COL.danger;
                faceQuad(mb, S, wall.cols, wall.faces, c + inset, c + 1 - inset, y0 + 0.03, y1 - 0.03, GRID_OUT, color, true);
            }
        }
        // Floor slabs inside this level, and the goal band at the top.
        for (let r = this.rowsPerFloor; r <= wall.rows; r += this.rowsPerFloor) {
            const y = rowY(this.baseRow + r);
            const top = r === wall.rows;
            faceQuad(mb, S, wall.cols, wall.faces, 0, wall.ring, y - (top ? 0.1 : 0.05), y + (top ? 0.1 : 0.05), GRID_OUT + 0.01, top ? COL.goal : COL.slab, true);
        }
        // Obstacles: vents sticking out of the glass.
        for (const key of wall.obstacles) {
            const c = key % wall.ring;
            const r = Math.floor(key / wall.ring);
            const y = rowY(this.baseRow + r) + ROW_H / 2;
            const p = surfacePoint(c + 0.5, halfAt(S, y), wall.cols, wall.faces, 0.2);
            const width = (2 * halfAt(S, y)) / wall.cols;
            mb.box(p.x, y, p.z, width * 0.92, ROW_H * 1.6, 0.45, COL.obstacle, p.yaw, COL.obstacleTop);
        }
        const { node, mesh } = this.addMesh('Grid', mb);
        this.gridNode = node;
        this.gridMesh = mesh;
    }

    // ------------------------------------------------------------ climber

    private buildPlayer(): void {
        this.player = new Node('Climber');
        this.player.layer = Layers.Enum.DEFAULT;
        this.root.addChild(this.player);
        this.body = new Node('Body');
        this.body.layer = Layers.Enum.DEFAULT;
        this.player.addChild(this.body);

        // Torso, head, hair (facing -Z, i.e. into the wall; the camera sees the back).
        const torso = new MeshBuilder();
        torso.box(0, 0.95, 0, 0.56, 0.62, 0.32, COL.body);
        torso.box(0, 0.58, 0, 0.5, 0.14, 0.3, COL.pants);
        torso.box(0, 1.42, 0, 0.32, 0.34, 0.32, COL.skin);
        torso.box(0, 1.6, 0.02, 0.34, 0.1, 0.34, COL.hair);
        torso.box(0, 1.47, 0.12, 0.34, 0.26, 0.1, COL.hair);
        this.addMesh('Torso', torso, this.body);

        const limb = (name: string, x: number, y: number, len: number, w: number, color: Color, end: Color, sign: number, arm: boolean): void => {
            const n = new Node(name);
            n.layer = Layers.Enum.DEFAULT;
            this.body.addChild(n);
            n.setPosition(x, y, 0);
            const mb = new MeshBuilder();
            const dir = arm ? 1 : -1;
            mb.box(0, dir * len / 2, 0, w, len, w, color);
            mb.box(0, dir * (len + 0.06), arm ? 0 : -0.06, w * 1.1, 0.14, arm ? w * 1.1 : w * 1.6, end);
            this.addMesh('Mesh', mb, n);
            this.limbs.push({ node: n, sign, arm });
        };
        limb('ArmL', -0.36, 1.2, 0.6, 0.15, COL.body, COL.skin, 1, true);
        limb('ArmR', 0.36, 1.2, 0.6, 0.15, COL.body, COL.skin, -1, true);
        limb('LegL', -0.15, 0.55, 0.55, 0.18, COL.pants, COL.shoe, -1, false);
        limb('LegR', 0.15, 0.55, 0.55, 0.18, COL.pants, COL.shoe, 1, false);
    }

    /** Where the climber is: perimeter coordinate and world height of the feet. */
    climberPos(sim: ClimbSim, fallY: number | null): { s: number; y: number } {
        const { wall } = sim;
        const t = sim.stepT < 0 ? 1 : sim.stepT * sim.stepT * (3 - 2 * sim.stepT);
        const dc = ringDelta(sim.fromCol, sim.col, wall.ring, wall.faces);
        const s = sim.fromCol + dc * t + 0.5;
        const row = sim.fromRow + (sim.row - sim.fromRow) * t;
        // Hands on the current row, so the feet hang a body length below.
        const y = fallY ?? rowY(this.baseRow + row) + ROW_H - 1.55;
        return { s, y };
    }

    /** World y of the climber's feet for a fall that starts now. */
    feetY(sim: ClimbSim): number {
        return this.climberPos(sim, null).y;
    }

    /** Lowest the climber can fall to in this level: the plaza or the ledge below. */
    floorY(): number {
        return this.baseRow === 0 ? 0 : rowY(this.baseRow) - 1.55;
    }

    /** Converts a fall height back to a level row for the HUD. */
    rowAtFeet(y: number): number {
        return Math.floor((y + 1.55 - LIFT) / ROW_H) - this.baseRow;
    }

    /**
     * Places the climber and the camera. `orbitInput` is radians of manual orbit this frame
     * (drag or keys); `fallY` replaces the climber's height while falling; `tumble` is 0..1.
     */
    update(dt: number, sim: ClimbSim, opts: { elapsed: number; fallY: number | null; tumble: number; grip: boolean; orbitInput: number; shake: number; lift: number }): void {
        const { wall } = sim;
        const { s, y } = this.climberPos(sim, opts.fallY);
        const half = halfAt(this.sections, y + 1.3);
        const out = PLAYER_OUT + opts.tumble * 1.2;
        const p = surfacePoint(s, half, wall.cols, wall.faces, out);
        this.player.setPosition(p.x, y, p.z);
        this.playerYaw = p.yaw;
        this.player.setRotationFromEuler(0, (p.yaw * 180) / Math.PI, 0);

        // Pose: lean in when gripping, swing limbs while stepping, tumble when falling.
        // Arms are modelled reaching up the wall and legs hanging down; +X tilt swings them out.
        const reach = sim.stepT >= 0 ? Math.sin(sim.stepT * Math.PI) : 0;
        const lean = opts.grip ? 12 : 4;
        this.body.setRotationFromEuler(-lean + opts.tumble * 150, 0, opts.tumble * 40);
        for (const l of this.limbs) {
            const swing = l.sign * reach * 30;
            if (l.arm) l.node.setRotationFromEuler(swing + (opts.grip ? -6 : 6), 0, -l.sign * (opts.grip ? 10 : 22));
            else l.node.setRotationFromEuler(swing - 10, 0, l.sign * 6);
        }

        // Camera: follow the climber round the tower, plus the player's own orbit.
        this.followYaw += angleDelta(this.followYaw, p.yaw) * (1 - Math.exp(-dt * 5));
        if (opts.orbitInput !== 0) {
            this.userYaw += opts.orbitInput;
            this.idleOrbitSec = 0;
        } else {
            this.idleOrbitSec += dt;
            if (this.idleOrbitSec > RETURN_DELAY_SEC) {
                this.userYaw = angleDelta(0, this.userYaw) * Math.exp(-dt * RETURN_RATE);
            }
        }
        this.camYaw = this.followYaw + this.userYaw;
        const targetY = y + LOOK_UP + opts.lift;
        this.camY += (targetY - this.camY) * (1 - Math.exp(-dt * 6));
        this.camHalf += (half - this.camHalf) * (1 - Math.exp(-dt * 3));
        const dist = this.camHalf * (1 + DIST_K) + DIST_C;
        const cy = this.camY + 1.2 + opts.shake;
        this.camera.node.setPosition(Math.sin(this.camYaw) * dist, cy, Math.cos(this.camYaw) * dist);
        this.camera.node.lookAt(this.tmp.set(0, this.camY, 0));
    }

    /** Snaps the camera onto the climber (new run). */
    snap(sim: ClimbSim): void {
        const { s, y } = this.climberPos(sim, null);
        const p = surfacePoint(s, halfAt(this.sections, y), sim.wall.cols, sim.wall.faces);
        this.followYaw = p.yaw;
        this.userYaw = 0;
        this.camY = y + LOOK_UP;
        this.camHalf = halfAt(this.sections, y);
    }

    /**
     * False when the view is turned so far that the climber is round the back of the tower;
     * the 2D name tag would otherwise float on the wrong face.
     */
    get climberInView(): boolean {
        return Math.abs(angleDelta(this.camYaw, this.playerYaw)) < 1.45;
    }

    /** Climber's head in world space, for the name tag and screen effects. */
    headWorld(out: Vec3): Vec3 {
        this.player.getWorldPosition(out);
        out.y += 2.0;
        return out;
    }

    /** Manual orbit per second for held Q / E. */
    static keyOrbit(dt: number, dir: number): number {
        return dir * ((KEY_ORBIT_DEG * Math.PI) / 180) * dt;
    }

    static dragOrbit(dxPixels: number): number {
        return -dxPixels * DRAG_ORBIT;
    }
}
