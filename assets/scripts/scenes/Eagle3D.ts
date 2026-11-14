import { Layers, Mat4, Node, Vec3 } from 'cc';
import type { ClimbSim } from '../climb/ClimbCore';
import { EYE, eagleParts } from '../climb/EagleShape';
import { MeshBuilder } from './MeshKit';
import type { MakeMesh } from './WindowCrowd';

/**
 * The eagle event in 3D (GDD §5, ADR-04): an original low-poly eagle (EagleShape) with wide
 * spread wings. While the event warns it spirals in from the side; while it runs it circles in
 * front of the climber. When ClimbSim starts a dive (the climber kept moving while watched),
 * it stoops at the aimed cell with wings raised and talons forward, sweeps past (knocking the
 * climber off if the rules say it hit) and climbs away. Presentation only: whether the dive
 * hits is decided in ClimbSim.
 */

/** Model is ~7 units tip to tip; the climber is ~3 units tall. */
const SCALE = 0.68;
/** Circling: this far out from the climber and this high above their feet. */
const CIRCLE_OUT = 4.6;
const CIRCLE_UP = 5.6;
const CIRCLE_R = 2.8;
/** Depth of the circle (towards / away from the wall); kept small so it never meets the glass. */
const CIRCLE_DEPTH = 1.6;
const CIRCLE_RATE = 1.7;
/** Spiral in from this much wider, over APPROACH_SEC. */
const APPROACH_R = 15;
const APPROACH_SEC = 1.1;
/** After a dive: sweep on for this long, then climb away. */
const EXIT_SEC = 1.3;
const LEAVE_SEC = 1.6;

type State = 'hidden' | 'circle' | 'glare' | 'dive' | 'exit' | 'leave';

export interface EagleFrame {
    /** Climber's feet (world). */
    feet: Vec3;
    /** Outward facing angle of the wall at the climber (radians about +Y; 0 = +Z). */
    yaw: number;
    /** World point the dive is aimed at: the chest of a climber on that cell. */
    aim(col: number, row: number, out: Vec3): Vec3;
}

export class Eagle3D {
    private readonly node: Node;
    private readonly wingL: Node;
    private readonly wingR: Node;
    private readonly legs: Node;
    private readonly glow: Node;
    private readonly meshes: { destroy(): void }[] = [];
    private state: State = 'hidden';
    private t = 0;
    /** Seconds in the current state. */
    private sec = 0;
    private phi = 0;
    private readonly pos = new Vec3();
    private readonly prev = new Vec3();
    private readonly from = new Vec3();
    private readonly to = new Vec3();
    private readonly vel = new Vec3();
    private readonly tmp = new Vec3();
    private readonly up = new Vec3();
    private readonly mat = new Mat4();
    private readonly eyeLocal = new Vec3(0, EYE[1], EYE[2]);

    constructor(parent: Node, make: MakeMesh) {
        this.node = new Node('Eagle');
        this.node.layer = Layers.Enum.DEFAULT;
        parent.addChild(this.node);
        this.node.setScale(SCALE, SCALE, SCALE);
        const nodes: Record<string, Node> = {};
        for (const part of eagleParts()) {
            let n = this.node;
            if (part.name !== 'Body') {
                n = new Node(part.name);
                n.layer = Layers.Enum.DEFAULT;
                this.node.addChild(n);
                n.setPosition(part.pivot[0], part.pivot[1], part.pivot[2]);
            }
            this.meshes.push(make('Mesh', MeshBuilder.from(part.positions, part.colors, part.indices), n));
            nodes[part.name] = n;
        }
        this.wingL = nodes.WingL;
        this.wingR = nodes.WingR;
        this.legs = nodes.Legs;
        this.glow = nodes.Glow;
        this.glow.active = false;
        this.node.active = false;
    }

    /** Gone (new run, new level, ending). */
    reset(): void {
        this.state = 'hidden';
        this.node.active = false;
    }

    update(dt: number, sim: ClimbSim, f: EagleFrame): void {
        this.t += dt;
        this.sec += dt;
        const s = sim.scheduler;
        const event = s.kind === 'eagle' && (s.state === 'warning' || s.state === 'active') && sim.phase === 'climbing';
        const dive = sim.eagleDive;
        const glaring = sim.eagleGlareSec > 0 && !dive && sim.phase === 'climbing';
        const n = this.tmp.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
        const nx = n.x, nz = n.z;
        this.prev.set(this.pos);

        if (dive && dive.t < 1 && this.state !== 'dive') {
            if (this.state === 'hidden') this.circlePoint(f, nx, nz, 1, this.pos);
            this.from.set(this.pos);
            f.aim(dive.col, dive.row, this.to);
            this.enter('dive');
        }
        if (glaring && this.state !== 'glare') {
            if (this.state === 'hidden') this.circlePoint(f, nx, nz, 1, this.pos);
            this.from.set(this.pos);
            this.enter('glare');
        }
        switch (this.state) {
            case 'hidden':
                if (event) this.enter('circle');
                break;
            case 'circle':
                if (!event) this.enter('leave');
                break;
            case 'glare':
                if (!glaring && !dive) this.enter(event ? 'circle' : 'leave');
                break;
            case 'dive':
                if (!dive || dive.t >= 1) {
                    // Sweep on past the aim point, never into the wall.
                    Vec3.subtract(this.vel, this.to, this.from).normalize();
                    const dn = this.vel.x * nx + this.vel.z * nz;
                    if (dn < 0.25) {
                        this.vel.x += nx * (0.25 - dn);
                        this.vel.z += nz * (0.25 - dn);
                    }
                    this.vel.normalize().multiplyScalar(16);
                    this.pos.set(this.to);
                    this.prev.set(this.from);
                    this.enter('exit');
                }
                break;
            case 'exit':
                if (this.sec > EXIT_SEC) {
                    if (event) this.enter('circle');
                    else this.enter('hidden');
                }
                break;
            case 'leave':
                if (event) this.enter('circle');
                else if (this.sec > LEAVE_SEC) this.enter('hidden');
                break;
        }
        this.node.active = this.state !== 'hidden';
        if (!this.node.active) return;

        let roll = 0;
        let sweep = 0;
        let legs = -65;
        const up = this.up.set(0, 1, 0);
        if (this.state === 'circle') {
            const k = Math.min(1, this.sec / APPROACH_SEC);
            this.phi += dt * CIRCLE_RATE * (1 + (1 - k) * 0.6);
            this.circlePoint(f, nx, nz, k, this.pos);
            // Bank into the turn.
            const cx = f.feet.x + nx * CIRCLE_OUT, cz = f.feet.z + nz * CIRCLE_OUT;
            up.set(cx - this.pos.x, 2.2, cz - this.pos.z).normalize();
            const flap = Math.sin(this.t * (k < 1 ? 9 : 6)) * (k < 1 ? 30 : 16 * (0.4 + 0.6 * Math.max(0, Math.sin(this.t * 0.9))));
            roll = 6 + flap;
        } else if (this.state === 'glare') {
            // Locked on: rear up and hang in the air glaring at the climber, beating hard.
            const k = Math.min(1, this.sec / 0.35);
            this.pos.set(this.from.x + nx * 0.6 * k, this.from.y + 0.8 * k + Math.sin(this.t * 9) * 0.12, this.from.z + nz * 0.6 * k);
            f.aim(sim.col, Math.min(sim.row, sim.wall.rows - 1), this.to);
            roll = 15 + Math.sin(this.t * 14) * 38;
            sweep = 6;
            legs = 30;
        } else if (this.state === 'dive') {
            const u = Math.pow(dive ? dive.t : 1, 1.5);
            // Bow outward towards the camera, so the stoop reads from the usual view.
            const mx = (this.from.x + this.to.x) / 2 + nx * 2.2;
            const my = (this.from.y + this.to.y) / 2 + 1.2;
            const mz = (this.from.z + this.to.z) / 2 + nz * 2.2;
            const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
            this.pos.set(
                a * this.from.x + b * mx + c * this.to.x,
                a * this.from.y + b * my + c * this.to.y,
                a * this.from.z + b * mz + c * this.to.z,
            );
            // Wings raised in a deep V and swept back, talons thrown forward at the target.
            roll = 38 + Math.sin(this.t * 32) * 3;
            sweep = -16;
            legs = -20 + 75 * Math.min(1, (dive ? dive.t : 1) * 1.6);
        } else if (this.state === 'exit') {
            this.vel.y += 20 * dt;
            this.pos.x += this.vel.x * dt;
            this.pos.y += this.vel.y * dt;
            this.pos.z += this.vel.z * dt;
            roll = 10 + Math.sin(this.t * 11) * 34;
            legs = 55 - 110 * Math.min(1, this.sec / 0.6);
        } else if (this.state === 'leave') {
            this.pos.x += nx * 9 * dt + Math.cos(f.yaw) * 7 * dt;
            this.pos.y += 7 * dt;
            this.pos.z += nz * 9 * dt - Math.sin(f.yaw) * 7 * dt;
            roll = 10 + Math.sin(this.t * 10) * 32;
        }
        this.node.setWorldPosition(this.pos);
        // Face the way it is flying (the model's beak is -Z, which lookAt points at the target).
        const look = this.state === 'dive' || this.state === 'glare'
            ? this.to
            : Vec3.add(new Vec3(), this.pos, Vec3.subtract(new Vec3(), this.pos, this.prev));
        if (Vec3.squaredDistance(look, this.pos) > 1e-8) this.node.lookAt(look, up);
        this.wingR.setRotationFromEuler(0, sweep, roll);
        this.wingL.setRotationFromEuler(0, -sweep, -roll);
        this.legs.setRotationFromEuler(legs, 0, 0);
        // Red eyes from the moment it locks on until the dive has struck.
        this.glow.active = this.state === 'glare' || (this.state === 'dive' && Math.floor(this.t * 16) % 3 !== 0);
    }

    /** World position of the eagle's eyes while it glares (for the 2D flare), else null. */
    glareEyes(out: Vec3): Vec3 | null {
        if (this.state !== 'glare' && this.state !== 'dive') return null;
        this.node.getWorldMatrix(this.mat);
        return Vec3.transformMat4(out, this.eyeLocal, this.mat);
    }

    destroy(): void {
        for (const m of this.meshes) m.destroy();
        this.node.destroy();
    }

    private enter(state: State): void {
        this.state = state;
        this.sec = 0;
    }

    /** Point on the circle in front of the climber; `k` 0..1 spirals in from far to the side. */
    private circlePoint(f: EagleFrame, nx: number, nz: number, k: number, out: Vec3): Vec3 {
        const tx = nz, tz = -nx; // along the wall, to the right as seen from outside
        const r = CIRCLE_R + (1 - k) * (1 - k) * APPROACH_R;
        const side = Math.cos(this.phi) * r;
        const depth = Math.sin(this.phi) * CIRCLE_DEPTH;
        const lift = CIRCLE_UP + (1 - k) * 3;
        return out.set(
            f.feet.x + nx * (CIRCLE_OUT + depth) + tx * side,
            f.feet.y + lift + Math.sin(this.phi * 2) * 0.4,
            f.feet.z + nz * (CIRCLE_OUT + depth) + tz * side,
        );
    }
}
