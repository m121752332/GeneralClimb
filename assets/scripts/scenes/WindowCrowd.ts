import { Color, Layers, Node } from 'cc';
import type { ClimbSim } from '../climb/ClimbCore';
import { isObstacle, zoneOf } from '../climb/ClimbCore';
import { type CrowdTuning, type NpcKind, type NpcMood, type NpcSpot, npcMood, planCrowd } from '../climb/CrowdPlan';
import { ROW_H, type Section, halfAt, surfacePoint } from '../climb/TowerShape';
import { MeshBuilder, type V3 } from './MeshKit';

/**
 * Window crowd (GDD §9 窗內 NPC): low-poly people standing in lit windows of the current
 * level. They take photos, wave as the climber passes and look worried when the climber is in
 * danger. Bodies of all NPCs are one baked mesh; only the arms are separate nodes so they can
 * move. Purely cosmetic; who stands where comes from CrowdPlan.
 */

export type MakeMesh = (name: string, mb: MeshBuilder, parent: Node) => { node: Node; destroy(): void };

/** Distances out from the glass: window, body, details, arms (grid strips sit at 0.04). */
const OUT_WINDOW = 0.06;
const OUT_BODY = 0.075;
const OUT_DETAIL = 0.085;
const OUT_ARM = 0.095;

/**
 * People are drawn bigger than life (so faces read on a phone) and stand close to the glass:
 * scaled by FIG_SCALE about the floor and pushed down, so the legs drop below the sill and
 * we see them from the thighs up, like someone leaning on the window.
 */
const FIG_SCALE = 1.4;
const SHOULDER_V = 1.55;
const SHOULDER_U = 0.27;
const ARM_LEN = 0.55;

/** Seconds between camera flashes, and how long one lasts. */
const FLASH_EVERY = 1.4;
const FLASH_SEC = 0.09;

function hex(s: string): Color {
    return new Color().fromHEX(s);
}

const SKIN = ['#f1c9a5', '#d9a77c', '#b07a52', '#8a5a3c'].map(hex);
const HAIR = ['#2b2018', '#5a3a22', '#1a1a1a', '#a07040'].map(hex);
const SHIRT: Record<NpcKind, Color[]> = {
    passer: ['#4a7bd0', '#5bab6a', '#d08a3a', '#8a5ad0'].map(hex),
    staff: ['#2f3a5a', '#3a3a3a', '#41505a', '#2b3f3a'].map(hex),
    tourist: ['#f2c94c', '#56ccf2', '#eb5757', '#6fcf97'].map(hex),
};
/** Seen through tinted glass: every colour is pulled this far towards the glass. */
const GLASS_TINT = hex('#3f8f98');
const TINT = 0.18;

function tinted(c: Color): Color {
    return Color.lerp(new Color(), c, GLASS_TINT, TINT);
}

const C = {
    room: hex('#f1e6cc'),
    ceiling: hex('#fff6e2'),
    lamp: hex('#fff2c8'),
    pants: hex('#3a3f5c'),
    collar: hex('#f4f4f2'),
    tie: hex('#c0392b'),
    eye: hex('#1b1b22'),
    mouth: hex('#7a3a30'),
    hat: hex('#f4f0e2'),
    hatBand: hex('#e0605a'),
    phone: hex('#222428'),
    screen: hex('#bfe8ff'),
    flash: hex('#ffffff'),
};

interface Actor {
    spot: NpcSpot;
    root: Node;
    armL: Node;
    armR: Node;
    flash: Node | null;
    angL: number;
    angR: number;
    t: number;
}

export class WindowCrowd {
    private readonly parent: Node;
    private readonly sections: readonly Section[];
    private readonly rowsPerFloor: number;
    private readonly makeMesh: MakeMesh;
    private readonly tuning: CrowdTuning;
    private node: Node | null = null;
    private meshes: { destroy(): void }[] = [];
    private actors: Actor[] = [];

    constructor(parent: Node, sections: readonly Section[], rowsPerFloor: number, tuning: CrowdTuning, makeMesh: MakeMesh) {
        this.tuning = tuning;
        this.parent = parent;
        this.sections = sections;
        this.rowsPerFloor = rowsPerFloor;
        this.makeMesh = makeMesh;
    }

    get count(): number {
        return this.actors.length;
    }

    clear(): void {
        for (const m of this.meshes) m.destroy();
        this.meshes = [];
        this.actors = [];
        this.node?.destroy();
        this.node = null;
    }

    /** Places the crowd for the sim's level; baseY is the world y of its row 0. */
    build(sim: ClimbSim, baseY: number): void {
        this.clear();
        const { wall, level } = sim;
        const spots = planCrowd(wall, this.rowsPerFloor, level.id, this.tuning,
            (c, r) => zoneOf(wall, c, r) === 'safe' && !isObstacle(wall, c, r));
        if (spots.length === 0) return;
        this.node = new Node('WindowCrowd');
        this.node.layer = Layers.Enum.DEFAULT;
        this.parent.addChild(this.node);

        const mb = new MeshBuilder();
        const floorH = this.rowsPerFloor * ROW_H;
        for (const spot of spots) {
            const yb = baseY + spot.floor * floorH;
            const s = spot.col + 0.5;
            const center = surfacePoint(s, halfAt(this.sections, yb + floorH / 2), wall.cols, wall.faces);
            const tx = Math.cos(center.yaw), tz = -Math.sin(center.yaw);
            // Local (u right along the face, v up from the floor, w out from the glass) to world,
            // following the face's lean so nothing sinks into flared glass.
            const P = (u: number, v: number, w: number): V3 => {
                const sp = surfacePoint(s, halfAt(this.sections, yb + v), wall.cols, wall.faces, w);
                return [sp.x + u * tx, yb + v, sp.z + u * tz];
            };
            const rect = (u0: number, v0: number, u1: number, v1: number, w: number, color: Color): void =>
                mb.quad(P(u0, v0, w), P(u1, v0, w), P(u1, v1, w), P(u0, v1, w), color, true);
            const colW = (2 * halfAt(this.sections, yb + floorH / 2)) / wall.cols;
            // The pane between two pillars (PILLAR_HALF = 0.06 of a column on each side).
            const half = colW * 0.43;
            const shift = 2.1 * FIG_SCALE - (floorH - 0.2);
            const fig = (v: number): number => v * FIG_SCALE - shift;
            this.bakeFigure(rect, P, mb, spot, half, floorH, fig);
            this.actors.push(this.makeActor(spot, P(0, fig(SHOULDER_V), OUT_ARM), center.yaw));
        }
        this.meshes.push(this.makeMesh('Crowd', mb, this.node));
    }

    private bakeFigure(
        rect: (u0: number, v0: number, u1: number, v1: number, w: number, c: Color) => void,
        P: (u: number, v: number, w: number) => V3, mb: MeshBuilder, spot: NpcSpot, half: number, floorH: number,
        fig: (v: number) => number,
    ): void {
        const top = floorH - 0.08;
        // A lit room behind the floor-to-ceiling glass: back wall, ceiling band, two downlights.
        // Warm white, so a lit room stands out against the teal glass.
        const warm = (c: Color): Color => Color.lerp(new Color(), c, GLASS_TINT, 0.08);
        rect(-half, 0.08, half, top, OUT_WINDOW, warm(C.room));
        rect(-half, top - 0.24, half, top, OUT_WINDOW + 0.004, warm(C.ceiling));
        for (const u of [-half * 0.5, half * 0.5]) rect(u - 0.16, top - 0.17, u + 0.16, top - 0.09, OUT_WINDOW + 0.008, C.lamp);
        // The figure, scaled about the floor; parts that end below the sill are cut off there.
        const SILL = 0.1;
        const K = FIG_SCALE;
        const room = rect;
        rect = (u0, v0, u1, v1, w, c) => {
            const a = Math.max(SILL, fig(v0)), b = fig(v1);
            if (b > a) room(u0 * K, a, u1 * K, b, w, c);
        };
        const skin = tinted(SKIN[spot.palette % SKIN.length]);
        const shirt = tinted(SHIRT[spot.kind][spot.palette % 4]);
        // Legs, torso.
        rect(-0.16, 0.25, -0.04, 0.95, OUT_BODY, C.pants);
        rect(0.04, 0.25, 0.16, 0.95, OUT_BODY, C.pants);
        rect(-0.24, 0.92, 0.24, 1.62, OUT_BODY, shirt);
        if (spot.kind === 'staff') {
            rect(-0.08, 1.5, 0.08, 1.6, OUT_DETAIL, C.collar);
            rect(-0.03, 1.15, 0.03, 1.52, OUT_DETAIL + 0.002, C.tie);
        }
        // Neck and round head (octagon fan), hair, eyes, mouth. Faces are simple, not a real person (ADR-08).
        rect(-0.05, 1.6, 0.05, 1.68, OUT_BODY, skin);
        const hc = fig(1.83), hr = 0.18 * K, n = 12;
        for (let i = 0; i < n; i++) {
            const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
            const c = P(0, hc, OUT_BODY);
            mb.quad(c, P(Math.cos(a0) * hr, hc + Math.sin(a0) * hr, OUT_BODY), P(Math.cos(a1) * hr, hc + Math.sin(a1) * hr, OUT_BODY), c, skin, true);
        }
        if (spot.kind === 'tourist') {
            rect(-0.26, 1.93, 0.26, 1.97, OUT_DETAIL, C.hat);
            rect(-0.15, 1.97, 0.15, 2.1, OUT_DETAIL, C.hat);
            rect(-0.15, 1.97, 0.15, 2.0, OUT_DETAIL + 0.002, C.hatBand);
        } else {
            rect(-0.17, 1.92, 0.17, 2.02, OUT_DETAIL, HAIR[spot.palette % HAIR.length]);
        }
        rect(-0.09, 1.82, -0.04, 1.87, OUT_DETAIL, C.eye);
        rect(0.04, 1.82, 0.09, 1.87, OUT_DETAIL, C.eye);
        rect(-0.05, 1.72, 0.05, 1.745, OUT_DETAIL, C.mouth);
    }

    private makeActor(spot: NpcSpot, at: V3, yaw: number): Actor {
        const root = new Node('Npc');
        root.layer = Layers.Enum.DEFAULT;
        this.node!.addChild(root);
        root.setPosition(at[0], at[1], at[2]);
        root.setRotationFromEuler(0, (yaw * 180) / Math.PI, 0);
        root.setScale(FIG_SCALE, FIG_SCALE, FIG_SCALE);
        const skin = tinted(SKIN[spot.palette % SKIN.length]);
        const shirt = tinted(SHIRT[spot.kind][spot.palette % 4]);
        const arm = (side: number): Node => {
            const n = new Node(side > 0 ? 'ArmR' : 'ArmL');
            n.layer = Layers.Enum.DEFAULT;
            root.addChild(n);
            n.setPosition(side * SHOULDER_U, 0, 0);
            const mb = new MeshBuilder();
            const r = (x0: number, y0: number, x1: number, y1: number, z: number, c: Color): void =>
                mb.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], c, true);
            r(-0.06, -ARM_LEN, 0.06, 0.04, 0, shirt);
            r(-0.055, -ARM_LEN - 0.1, 0.055, -ARM_LEN, 0, skin);
            // Tourists hold up a phone with a lit screen.
            if (side > 0 && spot.kind === 'tourist') {
                r(-0.09, -ARM_LEN - 0.2, 0.09, -ARM_LEN - 0.04, 0.004, C.phone);
                r(-0.07, -ARM_LEN - 0.18, 0.07, -ARM_LEN - 0.06, 0.006, C.screen);
            }
            this.meshes.push(this.makeMesh('Arm', mb, n));
            return n;
        };
        const armL = arm(-1);
        const armR = arm(1);
        let flash: Node | null = null;
        if (spot.kind === 'tourist') {
            flash = new Node('Flash');
            flash.layer = Layers.Enum.DEFAULT;
            armR.addChild(flash);
            const mb = new MeshBuilder();
            const y = -ARM_LEN - 0.12, k = 0.07;
            mb.quad([-k, y - k, 0.008], [k, y - k, 0.008], [k, y + k, 0.008], [-k, y + k, 0.008], C.flash, true);
            this.meshes.push(this.makeMesh('Flash', mb, flash));
            flash.active = false;
        }
        return { spot, root, armL, armR, flash, angL: -6, angR: 6, t: spot.phase * 10 };
    }

    /** Animates the arms for this frame. `alarmed`: the climber is at risk or falling. */
    update(dt: number, sim: ClimbSim, alarmed: boolean): void {
        if (this.actors.length === 0) return;
        const view = { col: sim.col, floor: sim.row / this.rowsPerFloor, alarmed };
        const k = 1 - Math.exp(-dt * 10);
        for (const a of this.actors) {
            a.t += dt;
            const mood = npcMood(a.spot, view, sim.wall.ring, sim.wall.faces, this.tuning);
            const [l, r] = armTargets(mood, a.t);
            a.angL += (l - a.angL) * k;
            a.angR += (r - a.angR) * k;
            a.armL.setRotationFromEuler(0, 0, a.angL);
            a.armR.setRotationFromEuler(0, 0, a.angR);
            if (a.flash) a.flash.active = mood === 'photo' && (a.t % FLASH_EVERY) < FLASH_SEC;
        }
    }
}

/** Arm angles (degrees about the face normal; 0 = hanging down, + raises the right arm outward). */
function armTargets(mood: NpcMood, t: number): [number, number] {
    switch (mood) {
        case 'wave': return [-8, 145 + Math.sin(t * 9) * 25];
        case 'worried': {
            const shake = Math.sin(t * 22) * 8;
            return [-165 + shake, 165 - shake];
        }
        case 'photo': return [-10, 95 + Math.sin(t * 1.3) * 4];
        default: {
            const sway = Math.sin(t * 1.6) * 3;
            return [-6 + sway, 6 + sway];
        }
    }
}
