import {
    Camera, Color, Layers, Material, Mesh, MeshRenderer, Node, Vec3, director, resources, view,
} from 'cc';
import type { ClimbSim } from '../climb/ClimbCore';
import { zoneOf } from '../climb/ClimbCore';
import {
    CROWN, HOUSE_HALF, LIFT, ROW_H, SPIRE_HALF, SPIRE_TIP, Section, angleDelta, halfAt, houseSections, levelBaseY,
    profileHalf, ringDelta, roofY, rowY, summitY, surfacePoint, towerSections,
} from '../climb/TowerShape';
import { climberParts } from '../climb/ClimberShape';
import { MeshBuilder, type V3 } from './MeshKit';
import { WindowCrowd } from './WindowCrowd';
import type { CrowdTuning } from '../climb/CrowdPlan';
import { pushInPose } from '../core/Cutscene';
import { canopyClearance, faceU } from '../climb/EntranceShape';
import { buildEntrances } from './Entrance';
import { Eagle3D } from './Eagle3D';
import { buildCity, buildTerrain, buildWater } from './Basin3D';
import { Atmosphere3D, DOME_RADIUS } from './Atmosphere3D';

/**
 * 3D view of the climb (ADR-10): a low-poly Taipei 101 built in code, the current level's
 * climbing grid wrapped round its four faces, the climber (ClimberShape), and a camera that
 * orbits the tower axis. Everything is vertex-coloured unlit geometry in a handful of meshes
 * (one material), so it stays cheap on phones. No rules here: it only draws a ClimbSim.
 */

// Presentation-only constants.
const SKY = hex('#9cc8e6');
/** Climber stands this far in front of the glass. */
const PLAYER_OUT = 0.55;
/** The climber is modelled ~1.95 units tall; scaled up so it reads on a phone. */
const PLAYER_SCALE = 1.5;
/** Top of the head above the feet, after scaling. */
const HEAD = 2.0 * PLAYER_SCALE;
/** Ending: the climber sits on the summit ring for this long (ADR-07 / ADR-10). */
export const ENDING_SEC = 10;
/** Grid quads float just off the facade to avoid z-fighting. */
/**
 * How far the current level's glass sits out from the tower surface. Must clear the static
 * facade's bay pillars (0.1 out), or their 8-per-face rhythm shows through the level's own
 * columns as an extra frame down the middle of each pane.
 */
const GRID_OUT = 0.12;
/** Vent unit (obstacle): share of the column it covers, at most this wide, this much taller than its rows. */
const VENT_FILL = 0.62;
const VENT_W = 1.25;
const VENT_PAD = 0.3;
/** Half width of a pillar between two panes, in columns. */
const PILLAR_HALF = 0.025;
/** Half width of the wide pilasters at the corners and where safe glass meets danger glass. */
const PILASTER_HALF = 0.09;
/** Glass bays per face on the floors outside the current level. */
const FACADE_BAYS = 8;
/** Horizontal field of view, so a face fills the width on any phone. */
const FOV = 42;
/** Camera distance from the face: `half * DIST_K + DIST_C`. */
const DIST_K = 1.6;
const DIST_C = 13;
/**
 * Framing: the climber's middle sits this far up the screen (0 = bottom, 1 = top), so there is
 * room below them and a view of what's coming above. The look-at height is worked out from how
 * much of the wall is visible at the climber's distance, so it holds on any aspect ratio.
 */
const FRAME_AT = 0.42;
/** Smallest tan(half vertical FOV): on wide screens the horizontal FOV is widened to keep this. */
const MIN_VTAN = 0.42;
/** Degrees per second for Q / E, and radians per pixel for drags. */
const KEY_ORBIT_DEG = 100;
const DRAG_ORBIT = 0.008;
/** After the player lets go of the view, wait this long, then swing back to the climber. */
const RETURN_DELAY_SEC = 1.5;
const RETURN_RATE = 3;
/** Half width of the paved plaza square; the basin's city plain (Basin3D) lies round it. */
const PLAZA_HALF = 80;
/** Practice: the real 101 stands on the skyline this far away, scaled down to this share. */
const SKYLINE_101_DIST = 520;
const SKYLINE_101_SCALE = 0.8;

const COL = {
    glass: hex('#3f8f98'),
    // Floor-to-ceiling glass: darker at the floor, sky reflection towards the ceiling.
    paneLow: hex('#1d5c62'),
    paneHigh: hex('#4d9ea2'),
    // Light grey metal frame: thick vertical pillars, thinner horizontal transoms.
    pillar: hex('#d3dcda'),
    frame: hex('#c3cdcb'),
    mullion: hex('#1f4f57'),
    ledge: hex('#cfd8d6'),
    disc: hex('#b9c6c4'),
    discInner: hex('#7d8f8d'),
    ruyi: hex('#f2f2ee'),
    crown: hex('#5aa0a8'),
    spire: hex('#d8dcdc'),
    plaza: hex('#b8b2a6'),
    mat: hex('#24474a'),
    // Same dark teal as the rest of the tower, a touch brighter, so the level blends in.
    safe: hex('#20666b'),
    safeHigh: hex('#5cb0b4'),
    danger: hex('#a8443e'),
    dangerHigh: hex('#ea8c82'),
    // Vent units: brushed metal like the frames, with dark louvre slats.
    obstacle: hex('#a9b4b3'),
    obstacleTop: hex('#d3dcda'),
    louvre: hex('#3e4a4c'),
    goal: hex('#e8c66a'),
    // Practice house: tiled plinth, concrete roof, white parapet, stairwell, steel water tank.
    plinth: hex('#9a8f80'),
    roof: hex('#a7a49c'),
    parapet: hex('#ece8de'),
    stairwell: hex('#d9d2c2'),
    door: hex('#6b4a32'),
    tank: hex('#c7ccd0'),
    lawn: hex('#7f9a62'),
};

function hex(s: string): Color {
    return new Color().fromHEX(s);
}

/** Corners of a face strip at heights y0..y1 between perimeter coordinates s0..s1. */
function faceQuad(mb: MeshBuilder, sections: readonly Section[], cols: number, faces: number,
    s0: number, s1: number, y0: number, y1: number, out: number, color: Color, flat = false, top?: Color): void {
    const h0 = halfAt(sections, y0 + 1e-4);
    const h1 = halfAt(sections, y1 - 1e-4);
    const a = surfacePoint(s0, h0, cols, faces, out);
    const b = surfacePoint(s1, h0, cols, faces, out);
    const c = surfacePoint(s1, h1, cols, faces, out);
    const d = surfacePoint(s0, h1, cols, faces, out);
    if (top) mb.gradQuad([a.x, y0, a.z], [b.x, y0, b.z], [c.x, y1, c.z], [d.x, y1, d.z], color, top, flat);
    else mb.quad([a.x, y0, a.z], [b.x, y0, b.z], [c.x, y1, c.z], [d.x, y1, d.z], color, flat);
}

/**
 * A pillar standing out of the glass: front face plus both sides (shaded by their own normals,
 * so it reads as a 3D frame). At a corner the front cuts across, which makes a chamfered corner post.
 */
function facePillar(mb: MeshBuilder, sections: readonly Section[], cols: number, faces: number,
    s: number, hw: number, y0: number, y1: number, back: number, front: number, color: Color): void {
    faceQuad(mb, sections, cols, faces, s - hw, s + hw, y0, y1, front, color);
    const h0 = halfAt(sections, y0 + 1e-4);
    const h1 = halfAt(sections, y1 - 1e-4);
    for (const [sa, flip] of [[s - hw, false], [s + hw, true]] as const) {
        const bb = surfacePoint(sa, h0, cols, faces, back), bf = surfacePoint(sa, h0, cols, faces, front);
        const tb = surfacePoint(sa, h1, cols, faces, back), tf = surfacePoint(sa, h1, cols, faces, front);
        const a: V3 = [bb.x, y0, bb.z], b: V3 = [bf.x, y0, bf.z], c: V3 = [tf.x, y1, tf.z], d: V3 = [tb.x, y1, tb.z];
        if (flip) mb.quad(b, a, d, c, color);
        else mb.quad(a, b, c, d, color);
    }
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
    /** Forearm (elbow) or shin (knee). */
    lower: Node;
    /** Swing phase sign, so opposite limbs alternate. */
    sign: number;
    /** Which side of the body: -1 left (x < 0), +1 right. */
    side: number;
    arm: boolean;
}

/** Limb angles in degrees: upper X / Z, lower X / Z. */
type LimbPose = [number, number, number, number];

function lerpPose(a: LimbPose, b: LimbPose, t: number): LimbPose {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

/**
 * Wall crawl poses for a limb on side `xs` (-1 left, +1 right). Arms are modelled pointing up
 * and legs down; +Z spreads a left limb outward, so the side flips the sign.
 * Arm low = elbow out at shoulder height, forearm up (a "W"); arm high = reaching up the wall.
 * Leg up = knee drawn up and out like a frog; leg down = pushed nearly straight.
 */
function wallPose(arm: boolean, xs: number, raise: number): LimbPose {
    if (arm) {
        const low: LimbPose = [-8, -xs * 85, 0, xs * 95];
        const high: LimbPose = [-14, -xs * 22, 0, -xs * 6];
        return lerpPose(low, high, raise);
    }
    const down: LimbPose = [2, xs * 20, -4, -xs * 8];
    const up: LimbPose = [16, xs * 72, -16, -xs * 96];
    return lerpPose(down, up, raise);
}

export class Tower3D {
    readonly root: Node;
    readonly camera: Camera;
    /** Extra orbit added by the player (radians); eases back to 0 after RETURN_DELAY_SEC. */
    userYaw = 0;

    private readonly rowsPerFloor: number;
    private readonly ladderRows: number;
    private readonly sections: Section[];
    private material: Material | null = null;
    private gridNode: Node | null = null;
    private gridMesh: Mesh | null = null;
    private crowd: WindowCrowd | null = null;
    private eagle: Eagle3D | null = null;
    private atmosphere: Atmosphere3D | null = null;
    private readonly basinMeshes: Mesh[] = [];
    private player!: Node;
    private body!: Node;
    private cape: Node | null = null;
    private capeT = 0;
    private limbs: Limb[] = [];
    /** Wall crawl: which arm leads the current step (+1 right, -1 left) and how far along. */
    private climbSide = 1;
    private climbT = 1;
    private followYaw = 0;
    private camYaw = 0;
    private playerYaw = 0;
    private camY = 0;
    private camHalf = 8;
    private idleOrbitSec = 0;
    /** World y of row 0 of the current level. */
    private baseY = 0;
    /** Where the climber stands on the level's start platform: height and distance out. */
    private standY = 0;
    private standOut = 1;
    /** Feet height last frame, for the mini map. */
    private feetY = 0;
    private lastWalk = 0;
    private readonly tmp = new Vec3();
    private readonly tmp2 = new Vec3();

    private readonly crowdTuning: CrowdTuning;

    /** Practice mode: a small house of this many floors instead of the 101 (0 = the 101). */
    /** 0 = the 101, which has a grand entrance on each face (Entrance.ts) the climber goes round. */
    private readonly houseFloors: number;

    constructor(rowsPerFloor: number, ladderRows: number, crowdTuning: CrowdTuning, houseFloors = 0) {
        this.crowdTuning = crowdTuning;
        this.rowsPerFloor = rowsPerFloor;
        this.ladderRows = ladderRows;
        this.houseFloors = houseFloors;
        this.sections = houseFloors > 0 ? houseSections(rowsPerFloor, houseFloors) : towerSections(rowsPerFloor);
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
        // Past the sky dome (Atmosphere3D), which is centred on the camera.
        cam.far = DOME_RADIUS + 500;
        cam.priority = 0;
        cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        cam.clearColor = SKY;
        cam.visibility = Layers.Enum.DEFAULT;
        this.camera = cam;
    }

    /** Builds the static scenery once the material is loaded. */
    async init(): Promise<void> {
        this.material = await loadMaterial();
        this.addMesh('Scenery', this.houseFloors > 0 ? this.buildHouse() : this.buildScenery());
        this.buildBasin();
        this.crowd = new WindowCrowd(this.root, this.sections, this.rowsPerFloor, this.crowdTuning, (name, mb, parent) => {
            const { node, mesh } = this.addMesh(name, mb, parent);
            return { node, destroy: () => mesh.destroy() };
        });
        this.buildPlayer();
        this.eagle = new Eagle3D(this.root, (name, mb, parent) => {
            const { node, mesh } = this.addMesh(name, mb, parent);
            return { node, destroy: () => mesh.destroy() };
        });
    }

    destroy(): void {
        this.atmosphere?.destroy();
        for (const m of this.basinMeshes) m.destroy();
        this.crowd?.clear();
        this.eagle?.destroy();
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

        // Plaza, its stone paving and the grand entrance in the middle of each face.
        mb.quad([-PLAZA_HALF, 0, PLAZA_HALF], [PLAZA_HALF, 0, PLAZA_HALF], [PLAZA_HALF, 0, -PLAZA_HALF], [-PLAZA_HALF, 0, -PLAZA_HALF], COL.plaza, true);
        buildEntrances(mb, (y) => halfAt(S, y), faces);

        for (let i = 0; i < S.length; i++) {
            const sec = S[i];
            // Facade: floor-to-ceiling glass, one pane per floor and face (one cell = one face
            // here, cols = 1), with a spandrel band at every floor line.
            for (let fl = sec.floorFrom; fl <= sec.floorTo; fl++) {
                const y0 = fl === sec.floorFrom ? sec.y0 : rowY((fl - 1) * rpf);
                const y1 = fl === sec.floorTo ? sec.y1 : rowY(fl * rpf);
                for (let f = 0; f < faces; f++) faceQuad(mb, S, 1, faces, f, f + 1, y0, y1, 0, COL.paneLow, false, COL.paneHigh);
                if (fl === sec.floorFrom) continue;
                for (let f = 0; f < faces; f++) faceQuad(mb, S, 1, faces, f, f + 1, y0 - 0.08, y0 + 0.08, 0.04, COL.frame);
            }
            // Pillars between the glass bays (about 1/8 of a bay wide), wider at the corners.
            for (let f = 0; f < faces; f++) {
                for (let k = 0; k < FACADE_BAYS; k++) {
                    const s = f + k / FACADE_BAYS;
                    const hw = (k === 0 ? 2 : 1) * 0.5 / FACADE_BAYS / 8;
                    facePillar(mb, S, 1, faces, s, hw, sec.y0, sec.y1, 0, 0.1, COL.pillar);
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

        // Crown blocks above 101F, the spire with its ladder levels, the summit ring, the needle.
        let cy = roofY(rpf);
        const crownCols = [COL.crown, COL.glass, COL.crown];
        CROWN.forEach(([h, half], i) => {
            mb.box(0, cy + h / 2, 0, half * 2, h, half * 2, crownCols[i % crownCols.length], 0, COL.ledge);
            cy += h;
        });
        const top = summitY(rpf, this.ladderRows);
        mb.prism(8, cy, top, SPIRE_HALF[0], SPIRE_HALF[1], COL.spire);
        mb.prism(16, top - 0.3, top, 1.6, 1.6, COL.ledge);
        mb.prism(8, top, top + SPIRE_TIP, SPIRE_HALF[1], 0.04, COL.spire);

        return mb;
    }

    /**
     * Practice scenery (GDD §7): a three-storey house on a small lawn. Its walls are entirely
     * the level grid; this adds the tiled plinth below the first row, a flat roof with a
     * parapet, a stairwell hut and a water tank, the same city round it, and the real 101 far
     * off on the skyline.
     */
    private buildHouse(): MeshBuilder {
        const mb = new MeshBuilder();
        const S = this.sections;
        const faces = 4;
        const h = HOUSE_HALF;
        const top = S[0].y1;
        mb.quad([-PLAZA_HALF, 0, PLAZA_HALF], [PLAZA_HALF, 0, PLAZA_HALF], [PLAZA_HALF, 0, -PLAZA_HALF], [-PLAZA_HALF, 0, -PLAZA_HALF], COL.plaza, true);
        const lawn = h + 7;
        mb.quad([-lawn, 0.01, lawn], [lawn, 0.01, lawn], [lawn, 0.01, -lawn], [-lawn, 0.01, -lawn], COL.lawn, true);
        const m = h + 3;
        mb.quad([-m, 0.02, m], [m, 0.02, m], [m, 0.02, -m], [-m, 0.02, -m], COL.mat, true);
        // Plinth from the ground to the first climbing row, and a front door on the back face.
        for (let f = 0; f < faces; f++) faceQuad(mb, S, 1, faces, f, f + 1, 0, LIFT, 0.13, COL.plinth);
        mb.box(0, LIFT / 2 + 0.2, -h - 0.16, 1.6, LIFT + 0.4, 0.08, COL.door);
        // Roof slab, parapet, stairwell hut (door facing the climber's start) and water tank.
        mb.box(0, top + 0.12, 0, h * 2 + 0.5, 0.24, h * 2 + 0.5, COL.roof, 0, COL.roof);
        const pw = 0.25, ph = 0.9, edge = h + 0.25 - pw / 2;
        for (const [x, z, sx, sz] of [[0, edge, h * 2 + 0.5, pw], [0, -edge, h * 2 + 0.5, pw], [edge, 0, pw, h * 2], [-edge, 0, pw, h * 2]]) {
            mb.box(x, top + 0.24 + ph / 2, z, sx, ph, sz, COL.parapet);
        }
        mb.box(-h * 0.45, top + 0.24 + 1.3, -h * 0.35, 3.2, 2.6, 3, COL.stairwell, 0, COL.parapet);
        mb.box(-h * 0.45, top + 0.24 + 0.95, -h * 0.35 + 1.52, 1, 1.9, 0.05, COL.door);
        for (const [x, z] of [[1.6, -2.2], [3.2, -2.2], [1.6, -3.6], [3.2, -3.6]]) mb.box(x, top + 0.74, z, 0.12, 1, 0.12, COL.louvre);
        mb.prism(12, top + 1.24, top + 2.9, 1.05, 1.05, COL.tank, 2.4, -2.9);

        // The 101 on the skyline: the same sections, crown and spire, as simple tapered blocks.
        const k = SKYLINE_101_SCALE;
        const z0 = -SKYLINE_101_DIST;
        const tower = towerSections(this.rowsPerFloor);
        for (const sec of tower) {
            mb.prism(4, sec.y0 * k, sec.y1 * k, sec.half0 * Math.SQRT2 * k, sec.half1 * Math.SQRT2 * k, sec.kind === 'segment' ? COL.glass : COL.paneLow, 0, z0);
        }
        let cy = roofY(this.rowsPerFloor);
        for (const [ch, half] of CROWN) {
            mb.prism(4, cy * k, (cy + ch) * k, half * Math.SQRT2 * k, half * Math.SQRT2 * k, COL.crown, 0, z0);
            cy += ch;
        }
        const spireTop = summitY(this.rowsPerFloor, this.ladderRows) + SPIRE_TIP;
        mb.prism(8, cy * k, spireTop * k, SPIRE_HALF[0] * k, 0.04, COL.spire, 0, z0);
        return mb;
    }

    /**
     * The Taipei basin round the plaza (ADR-11): city plain, rivers and parks, the city blocks,
     * the ring of mountains, then the sky dome and drifting clouds. Fixed layout, so every run
     * looks the same. Practice keeps the skyline 101's footprint clear of blocks.
     */
    private buildBasin(): void {
        // Practice: a clear sight line from the house to the 101 on the skyline.
        const keep: [number, number, number][] = [];
        if (this.houseFloors > 0) for (let z = 60; z <= SKYLINE_101_DIST; z += 30) keep.push([0, -z, z < SKYLINE_101_DIST ? 16 : 22]);
        const parts = [buildTerrain(), buildWater(), ...buildCity(keep)];
        parts.forEach((mb, i) => this.basinMeshes.push(this.addMesh(`Basin${i}`, mb).mesh));
        const top = summitY(this.rowsPerFloor, this.ladderRows);
        this.atmosphere = new Atmosphere3D(this.root, this.camera, top, (name, mb, parent) => this.addMesh(name, mb, parent));
    }

    /**
     * Sky and clouds, once the camera is placed for the frame (climb, push-in or ending).
     * `gloom` 0..1 greys the sky for rain; `wind` 0..1 speeds up the clouds.
     */
    updateAtmosphere(dt: number, gloom: number, wind: number): void {
        this.atmosphere?.update(dt, gloom, wind);
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
        this.baseY = levelBaseY(level, this.rowsPerFloor, this.ladderRows);
        const ry = (r: number): number => this.baseY + r * ROW_H;
        // Start platform: the plaza on level 1, otherwise the ledge (or roof) under row 0.
        if (level.floorFrom === 1) {
            this.standY = 0;
            this.standOut = 1.2;
        } else {
            this.standY = this.baseY;
            this.standOut = Math.max(0.5, (this.half(this.baseY - 0.05) - this.half(this.baseY + 0.05)) * 0.55);
        }
        this.crowd?.build(sim, this.baseY);
        this.eagle?.reset();
        const mb = new MeshBuilder();
        if (wall.cols === 1) {
            this.buildLadder(mb, wall.rows);
            const { node, mesh } = this.addMesh('Grid', mb);
            this.gridNode = node;
            this.gridMesh = mesh;
            return;
        }
        const inset = PILLAR_HALF;
        // Floor-to-ceiling glass: one pane per column and floor, tinted by zone (light blue
        // safe, red danger), also split where the zone changes (pagoda flare). Vents sit in
        // front of the glass, so the pane stays whole behind them.
        // Rows are thin (ROW_H), so per-cell quads would read as noise.
        for (let c = 0; c < wall.ring; c++) {
            let start = 0;
            for (let r = 1; r <= wall.rows; r++) {
                const prevZone = zoneOf(wall, c, r - 1);
                const brk = r === wall.rows || r % this.rowsPerFloor === 0 || zoneOf(wall, c, r) !== prevZone;
                if (!brk) continue;
                const safe = prevZone === 'safe';
                // Gradient over the whole floor, so a pane split mid-floor still reads as one.
                const f0 = Math.floor(start / this.rowsPerFloor) * this.rowsPerFloor;
                const lo = Color.lerp(new Color(), safe ? COL.safe : COL.danger, safe ? COL.safeHigh : COL.dangerHigh, (start - f0) / this.rowsPerFloor);
                const hi = Color.lerp(new Color(), safe ? COL.safe : COL.danger, safe ? COL.safeHigh : COL.dangerHigh, (r - f0) / this.rowsPerFloor);
                faceQuad(mb, S, wall.cols, wall.faces, c + inset, c + 1 - inset, ry(start), ry(r), GRID_OUT, lo, true, hi);
                start = r;
            }
        }
        // Horizontal transoms at every floor line (half a pillar thick), the goal band at the top.
        for (let r = this.rowsPerFloor; r <= wall.rows; r += this.rowsPerFloor) {
            const y = ry(r);
            const top = r === wall.rows;
            const t = top ? 0.12 : 0.1;
            faceQuad(mb, S, wall.cols, wall.faces, 0, wall.ring, y - t, y + t, GRID_OUT + 0.09, top ? COL.goal : COL.pillar);
        }
        // Thin frames between the panes; wide pilasters at the corners and where safe glass
        // meets danger glass (the climber's natural route edge), standing out of the glass.
        for (let c = 0; c < wall.ring; c++) {
            const corner = wall.faces > 1 && c % wall.cols === 0;
            const edge = zoneOf(wall, c - 1, 0) !== zoneOf(wall, c, 0);
            const wide = corner || edge;
            facePillar(mb, S, wall.cols, wall.faces, c, wide ? PILASTER_HALF : PILLAR_HALF, ry(0), ry(wall.rows),
                GRID_OUT, GRID_OUT + (wide ? 0.18 : 0.06), COL.pillar);
        }
        // Obstacles: vent units bolted onto the glass in the middle of the blocked cell. Width is
        // capped so wide cells on narrow levels don't stretch them into long bars, and a run of
        // blocked rows in one column becomes one taller unit instead of a stack of boxes.
        for (let c = 0; c < wall.ring; c++) {
            for (let r = 0; r < wall.rows; r++) {
                if (!wall.obstacles.has(r * wall.ring + c)) continue;
                let n = 1;
                while (r + n < wall.rows && wall.obstacles.has((r + n) * wall.ring + c)) n++;
                const y = ry(r) + (n * ROW_H) / 2;
                const half = halfAt(S, y);
                const colW = (2 * half) / wall.cols;
                const w = Math.min(colW * VENT_FILL, VENT_W);
                const h = n * ROW_H + VENT_PAD;
                const d = 0.26;
                const p = surfacePoint(c + 0.5, half, wall.cols, wall.faces, GRID_OUT + d / 2);
                mb.box(p.x, y, p.z, w, h, d, COL.obstacle, p.yaw, COL.obstacleTop);
                // Louvre slats on the front face, about one every 0.15.
                const slats = Math.max(3, Math.round(h / 0.15) - 1);
                const f = surfacePoint(c + 0.5, half, wall.cols, wall.faces, GRID_OUT + d + 0.005);
                for (let i = 0; i < slats; i++) {
                    const sy = y - h / 2 + (h * (i + 1)) / (slats + 1);
                    mb.box(f.x, sy, f.z, w * 0.82, 0.045, 0.01, COL.louvre, f.yaw);
                }
                r += n - 1;
            }
        }
        const { node, mesh } = this.addMesh('Grid', mb);
        this.gridNode = node;
        this.gridMesh = mesh;
    }

    /** Spire levels: a ladder up the front (+Z) of the spire, rails and a rung every 2 rows. */
    private buildLadder(mb: MeshBuilder, rows: number): void {
        const y0 = this.baseY;
        const seg = 4;
        for (let r = 0; r < rows; r += seg) {
            const y = y0 + (r + seg / 2) * ROW_H;
            const z = this.half(y) + 0.12;
            for (const x of [-0.34, 0.34]) mb.box(x, y, z, 0.07, seg * ROW_H, 0.07, COL.ledge);
        }
        for (let r = 0; r <= rows; r += 2) {
            const y = y0 + r * ROW_H;
            mb.box(0, y, this.half(y) + 0.12, 0.7, 0.05, 0.06, r === rows ? COL.goal : COL.ruyi);
        }
    }

    /** Building half width at height y (sections, crown, spire). */
    half(y: number): number {
        return profileHalf(this.sections, this.rowsPerFloor, this.ladderRows, y);
    }

    /** Height of the needle's tip, for the mini map. */
    get totalHeight(): number {
        return summitY(this.rowsPerFloor, this.ladderRows) + SPIRE_TIP;
    }

    /** Feet height of the climber (last frame). */
    get climberY(): number {
        return this.feetY;
    }

    /** Bottom of the current level, for the mini map. */
    get levelBottomY(): number {
        return this.baseY;
    }

    // ------------------------------------------------------------ climber

    private buildPlayer(): void {
        this.player = new Node('Climber');
        this.player.layer = Layers.Enum.DEFAULT;
        this.root.addChild(this.player);
        this.player.setScale(PLAYER_SCALE, PLAYER_SCALE, PLAYER_SCALE);
        this.body = new Node('Body');
        this.body.layer = Layers.Enum.DEFAULT;
        this.player.addChild(this.body);

        // Robe, head and face, cape, arms and legs (facing -Z, i.e. into the wall; the camera
        // sees the back). Arms are modelled reaching up, legs hanging down, from their pivots.
        const swing: Record<string, number> = { ArmL: 1, ArmR: -1, LegL: -1, LegR: 1 };
        const nodes: Record<string, Node> = { Body: this.body };
        const uppers: [string, Node][] = [];
        for (const part of climberParts()) {
            const mb = MeshBuilder.from(part.positions, part.colors, part.indices);
            if (part.name === 'Torso') {
                this.addMesh('Torso', mb, this.body);
                continue;
            }
            const n = new Node(part.name);
            n.layer = Layers.Enum.DEFAULT;
            nodes[part.parent].addChild(n);
            n.setPosition(part.pivot[0], part.pivot[1], part.pivot[2]);
            this.addMesh('Mesh', mb, n);
            nodes[part.name] = n;
            if (part.name === 'Cape') this.cape = n;
            else if (part.parent === 'Body') uppers.push([part.name, n]);
        }
        for (const [name, n] of uppers) {
            const arm = name.startsWith('Arm');
            const lower = nodes[(arm ? 'Forearm' : 'Shin') + name.slice(-1)];
            this.limbs.push({ node: n, lower, sign: swing[name], side: name.endsWith('L') ? -1 : 1, arm });
        }
    }

    /** Cape sway: `lift` degrees out from the back plus a flutter; more while falling. */
    private swayCape(dt: number, lift: number, flutter: number): void {
        if (!this.cape) return;
        this.capeT += dt;
        const t = this.capeT;
        this.cape.setRotationFromEuler(-(lift + flutter * (Math.sin(t * 3.1) + 0.4 * Math.sin(t * 7.3))), 0, 0);
    }

    /**
     * Where the climber is: perimeter coordinate, feet height, distance out from the wall,
     * and how much they are standing on the start platform (1) rather than on the wall (0).
     * On the wall the feet are on the current row, so an obstacle in the row above blocks
     * the next step up.
     */
    climberPos(sim: ClimbSim, fallY: number | null): { s: number; y: number; out: number; stand: number } {
        const { wall } = sim;
        const t = sim.stepT < 0 ? 1 : sim.stepT * sim.stepT * (3 - 2 * sim.stepT);
        const dc = ringDelta(sim.fromCol, sim.col, wall.ring, wall.faces);
        const s = sim.fromCol + dc * t + 0.5;
        const row = sim.fromRow + (sim.row - sim.fromRow) * t;
        let stand = 0;
        if (sim.level.startPlatform && fallY === null) {
            if (sim.row === 0 && sim.fromRow === 0) stand = 1;
            else if (sim.stepping && sim.fromRow === 0 && sim.row === 1) stand = 1 - t;
            else if (sim.stepping && sim.fromRow === 1 && sim.row === 0) stand = t;
        }
        const wallY = this.baseY + row * ROW_H;
        const y = fallY ?? wallY + (this.standY - wallY) * stand;
        let out = PLAYER_OUT + (this.standOut - PLAYER_OUT) * stand;
        // On the wall, hang out round the entrance canopy instead of climbing through it.
        if (this.houseFloors === 0 && wall.faces > 1 && stand < 1) {
            const u = faceU(s, wall.cols, this.half(y + 1.2));
            out += (canopyClearance(u, y, HEAD, out) - out) * (1 - stand);
        }
        return { s, y, out, stand };
    }

    /** World y of the climber's feet for a fall that starts now. */
    fallStartY(sim: ClimbSim): number {
        return this.climberPos(sim, null).y;
    }

    /** Lowest the climber can fall to in this level: the plaza or the platform below. */
    floorY(): number {
        return this.standY;
    }

    /** Converts a fall height back to a level row for the HUD. */
    rowAtFeet(y: number): number {
        return Math.floor((y - this.baseY) / ROW_H);
    }

    /**
     * Places the climber and the camera. `orbitInput` is radians of manual orbit this frame
     * (drag or keys); `fallY` replaces the climber's height while falling; `tumble` is 0..1.
     */
    update(dt: number, sim: ClimbSim, opts: { elapsed: number; fallY: number | null; tumble: number; grip: boolean; orbitInput: number; shake: number; lift: number }): void {
        const { wall } = sim;
        const pos = this.climberPos(sim, opts.fallY);
        const { s, y } = pos;
        this.feetY = y;
        this.crowd?.update(dt, sim, opts.fallY !== null || sim.tier !== 'safe');
        // Distance from the axis measured at the hips, so a flared face doesn't swallow them.
        const half = this.half(y + 1.2);
        const out = pos.out + opts.tumble * 1.2;
        const p = surfacePoint(s, half, wall.cols, wall.faces, out);
        this.player.setPosition(p.x, y, p.z);
        this.playerYaw = p.yaw;

        // Standing on a platform: face the camera, or turn to walk along the ledge.
        const reach = sim.stepT >= 0 ? Math.sin(sim.stepT * Math.PI) : 0;
        const standing = pos.stand > 0.5;
        const walking = standing && sim.stepping && sim.fromRow === sim.row;
        if (walking) this.lastWalk = Math.sign(ringDelta(sim.fromCol, sim.col, wall.ring, wall.faces));
        let face = p.yaw;
        if (standing) face += walking ? -this.lastWalk * Math.PI / 2 : Math.PI;
        this.player.setRotationFromEuler(0, (face * 180) / Math.PI, 0);

        // Pose: lean in when gripping, swing limbs while stepping, tumble when falling.
        // Arms are modelled reaching up the wall and legs hanging down; +X tilt swings them out.
        if (standing) {
            this.body.setRotationFromEuler(0, 0, 0);
            for (const l of this.limbs) {
                const swing = walking ? l.sign * reach * 35 : 0;
                if (l.arm) {
                    l.node.setRotationFromEuler(180 - swing, 0, -l.sign * 8);
                    l.lower.setRotationFromEuler(walking ? -15 : -6, 0, 0);
                } else {
                    l.node.setRotationFromEuler(swing, 0, 0);
                    l.lower.setRotationFromEuler(walking ? -Math.max(0, swing) * 0.9 : 0, 0, 0);
                }
            }
        } else {
            // Wall: a spider-style crawl. Each step one arm reaches up the wall while the
            // opposite knee draws up, then they swap, so a run of steps reads as hand over hand.
            if (sim.stepT >= 0) {
                this.climbSide = (sim.fromRow + sim.fromCol) % 2 === 0 ? 1 : -1;
                this.climbT = sim.stepT * sim.stepT * (3 - 2 * sim.stepT);
            } else {
                this.climbT = 1;
            }
            const lead = this.climbSide;
            const k = this.climbT;
            const lean = opts.grip ? 14 : 9;
            const roll = lead * (k - 0.5) * 8;
            this.body.setRotationFromEuler(-lean + opts.tumble * 150, 0, roll + opts.tumble * 40);
            const flail = Math.min(1, opts.tumble * 2);
            const t = this.capeT;
            for (const l of this.limbs) {
                const xs = l.side;
                const leads = l.arm ? xs === lead : xs === -lead;
                let pose = wallPose(l.arm, xs, leads ? k : 1 - k);
                if (flail > 0) {
                    const wave = Math.sin(t * 14 + xs) * 25;
                    const out: LimbPose = l.arm ? [10, -xs * (70 + wave), 0, xs * 20] : [20 + wave, xs * 35, -30, 0];
                    pose = lerpPose(pose, out, flail);
                }
                l.node.setRotationFromEuler(pose[0], 0, pose[1]);
                l.lower.setRotationFromEuler(pose[2], 0, pose[3]);
            }
        }

        if (standing) this.swayCape(dt, walking ? 14 : 4, walking ? 4 : 2);
        else this.swayCape(dt, 8 + opts.tumble * 60, 3 + opts.tumble * 8);

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
        this.camHalf += (half - this.camHalf) * (1 - Math.exp(-dt * 3));
        const dist = this.camHalf * (1 + DIST_K) + DIST_C;
        const targetY = y + this.lookUp(dist, this.camHalf) + opts.lift;
        this.camY += (targetY - this.camY) * (1 - Math.exp(-dt * 6));
        const cy = this.camY + 1.2 + opts.shake;
        this.camera.node.setPosition(Math.sin(this.camYaw) * dist, cy, Math.cos(this.camYaw) * dist);
        this.camera.node.lookAt(this.tmp.set(0, this.camY, 0));

        this.eagle?.update(dt, sim, {
            feet: this.tmp2.set(p.x, y, p.z),
            yaw: p.yaw,
            aim: (col, row, out) => this.aimPoint(sim, col, row, out),
        });
    }

    /** Chest of a climber hanging on cell (col, row) of the current level: where the eagle dives. */
    private aimPoint(sim: ClimbSim, col: number, row: number, out: Vec3): Vec3 {
        const { wall } = sim;
        const y = this.baseY + row * ROW_H;
        const p = surfacePoint(col + 0.5, this.half(y + 1.2), wall.cols, wall.faces, PLAYER_OUT + 0.45);
        return out.set(p.x, y + HEAD * 0.55, p.z);
    }

    /**
     * Start-game cutscene (GDD §7): after `update` has placed the climber and the normal
     * camera, move the camera back out along the same line so it glides in to the base.
     */
    applyPushIn(t: number): void {
        const p = this.camera.node.position;
        const pose = pushInPose({ x: p.x, y: p.y, z: p.z, lookY: this.camY }, t);
        this.camera.node.setPosition(pose.x, pose.y, pose.z);
        this.camera.node.lookAt(this.tmp.set(0, pose.lookY, 0));
    }

    /** Snaps the camera onto the climber (new run). */
    snap(sim: ClimbSim): void {
        const { s, y } = this.climberPos(sim, null);
        const p = surfacePoint(s, this.half(y + 1.2), sim.wall.cols, sim.wall.faces);
        this.followYaw = p.yaw;
        this.userYaw = 0;
        this.camHalf = this.half(y + 1.2);
        this.camY = y + this.lookUp(this.camHalf * (1 + DIST_K) + DIST_C, this.camHalf);
    }

    /**
     * How far above the climber's feet the camera should look so their middle lands at
     * FRAME_AT of the screen height. Also widens the view on landscape screens, where a fixed
     * horizontal FOV would leave only a thin strip of wall round the climber.
     */
    private lookUp(dist: number, half: number): number {
        const vs = view.getVisibleSize();
        const aspect = vs.height > 0 ? vs.width / vs.height : 0.5;
        const hTan = Math.tan((FOV * Math.PI) / 360);
        let vTan = hTan / aspect;
        if (vTan < MIN_VTAN) {
            vTan = MIN_VTAN;
            const fov = (Math.atan(vTan * aspect) * 360) / Math.PI;
            if (Math.abs(this.camera.fov - fov) > 0.01) this.camera.fov = fov;
        } else if (this.camera.fov !== FOV) {
            this.camera.fov = FOV;
        }
        // Half the visible height at the climber's depth (they hang just in front of the face).
        const halfH = vTan * Math.max(4, dist - half);
        return HEAD / 2 + 2 * (0.5 - FRAME_AT) * halfH;
    }

    /**
     * Summit ending (about ENDING_SEC): the climber sits on the edge of the summit ring
     * facing the city; the camera eases in from a three-quarter view outside the ring,
     * then rises, pulls back and circles round, tilting down to the streets.
     */
    updateEnding(t: number): void {
        this.eagle?.reset();
        const top = summitY(this.rowsPerFloor, this.ladderRows);
        const seat = 1.15;
        // Hips (0.55 up the unscaled model) rest on the ring.
        this.player.setPosition(0, top - 0.55 * PLAYER_SCALE + 0.05, seat);
        this.player.setRotationFromEuler(0, 180, 0);
        this.feetY = top;
        this.playerYaw = 0;
        const breathe = Math.sin(t * 2) * 2;
        this.body.setRotationFromEuler(-14 + breathe, 0, 0);
        for (const l of this.limbs) {
            if (l.arm) {
                l.node.setRotationFromEuler(165, 0, -l.sign * 25);
                l.lower.setRotationFromEuler(0, 0, 0);
            } else {
                // Thighs forward along the ring, shins hanging over the edge, swinging a little.
                l.node.setRotationFromEuler(80, 0, l.sign * 6);
                l.lower.setRotationFromEuler(-80 + Math.sin(t * 1.5 + l.sign) * 14, 0, 0);
            }
        }
        // Wind at the top: the cape streams out behind.
        this.capeT = t;
        this.swayCape(0, 30, 6);

        const smooth = (x: number): number => {
            const k = Math.min(1, Math.max(0, x));
            return k * k * (3 - 2 * k);
        };
        // Orbit the seated climber from outside the ring (never over the needle side), so the
        // ring and spire stay behind or below the climber instead of in front of the lens.
        // 0–3.5 s: slow push from a side three-quarter view to a front three-quarter view.
        // 3.5 s–end: rise and pull out while circling, tilting down to the city below.
        const c = this.tmp2.set(0, top + 0.8, seat);
        const a = smooth(t / 3.5);
        const u = smooth((t - 3.5) / (ENDING_SEC - 3.5));
        const phi = 1.25 - 0.35 * a + u * Math.PI * 1.1;
        const r = 5.2 - 0.6 * a + (20 - 4.6) * u;
        const h = 1.5 + 0.3 * a + 8 * u;
        this.camera.node.setPosition(c.x + Math.sin(phi) * r, c.y + h, c.z + Math.cos(phi) * r);
        this.camera.node.lookAt(this.tmp.set(c.x, c.y - 0.2 - u * 3, c.z));
        this.camYaw = phi;
    }

    /**
     * False when the view is turned so far that the climber is round the back of the tower;
     * the 2D name tag would otherwise float on the wrong face.
     */
    get climberInView(): boolean {
        return Math.abs(angleDelta(this.camYaw, this.playerYaw)) < 1.45;
    }

    /** Between the eagle's eyes while it is locked on or diving (red-eye flare), else null. */
    eagleEyes(out: Vec3): Vec3 | null {
        return this.eagle ? this.eagle.glareEyes(out) : null;
    }

    /** Climber's head in world space, for the name tag and screen effects. */
    headWorld(out: Vec3): Vec3 {
        this.player.getWorldPosition(out);
        out.y += HEAD;
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
