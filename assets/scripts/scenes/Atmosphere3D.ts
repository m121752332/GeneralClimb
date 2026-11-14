import { Camera, Color, Material, Mesh, MeshRenderer, Node, Vec3 } from 'cc';
import { MeshBuilder } from './MeshKit';
import {
    CLOUD_LAYERS, HAZE, type RGB, clamp01, cloudPlan, cloudSpin, hazeAt, mix, rgb, skyColorAt, skyStops,
} from '../climb/BasinShape';

/**
 * Atmosphere over the basin (ADR-11): a sky dome with layered gradient colours that follows
 * the camera, and three banks of low-poly cumulus that drift round the tower at different
 * speeds. The sky deepens towards the summit and turns grey while it rains; clouds speed up in
 * strong wind. Everything is unlit vertex colour (the dome is rebuilt only when its colours
 * change by a visible step), so it adds four draw calls and no per-frame vertex work.
 */

export type AddMesh = (name: string, mb: MeshBuilder, parent: Node) => { node: Node; mesh: Mesh };

/** Dome radius; the camera's far plane must reach past it. */
export const DOME_RADIUS = 1900;
const DOME_SEGMENTS = 24;
/** Ring elevations in degrees, dense round the horizon where the colours change fastest. */
const DOME_RINGS = [-90, -30, -8, -2, 0, 1.5, 4, 8, 14, 22, 32, 45, 60, 75, 90];
/** Sky colours are quantised to this step before the dome is rebuilt. */
const SKY_STEP = 0.04;
/** How fast the sky follows the weather (per second). */
const GLOOM_RATE = 1.2;
const WIND_RATE = 0.8;

const CLOUD_TOP = rgb('#ffffff');
const CLOUD_BOTTOM = rgb('#b8c6d3');
/** Raining: clouds turn this grey (multiplied in through the material colour). */
const CLOUD_STORM = new Color(150, 156, 164, 255);

export class Atmosphere3D {
    private readonly dome: Node;
    private domeMesh: Mesh;
    private readonly layers: { node: Node; spin: number; renderer: MeshRenderer }[] = [];
    private readonly addMesh: AddMesh;
    private readonly camera: Camera;
    private readonly topY: number;
    private gloom = 0;
    private wind = 0;
    private key = '';
    private cloudTint = -1;
    private readonly tmp = new Vec3();

    /** `topY` is the summit height: the sky is at its deepest there. */
    constructor(parent: Node, camera: Camera, topY: number, addMesh: AddMesh) {
        this.addMesh = addMesh;
        this.camera = camera;
        this.topY = topY;
        const sky = this.buildDome(0, 0);
        this.dome = sky.node;
        this.domeMesh = sky.mesh;
        this.key = this.keyOf(0, 0);
        const clouds = cloudPlan();
        CLOUD_LAYERS.forEach((_, layer) => {
            const positions: number[] = [], colors: number[] = [], indices: number[] = [];
            for (const c of clouds) {
                if (c.layer !== layer) continue;
                addCloud(c.angle, c.dist, c.y, c.puffs, positions, colors, indices);
            }
            const built = MeshBuilder.from(positions, colors, indices);
            const holder = new Node(`Clouds${layer}`);
            holder.layer = parent.layer;
            parent.addChild(holder);
            const { node } = addMesh(`CloudMesh${layer}`, built, holder);
            const renderer = node.getComponent(MeshRenderer)!;
            this.layers.push({ node: holder, spin: 0, renderer });
        });
        this.setCloudTint(0);
    }

    /**
     * Per frame, after the camera is placed: keep the dome on the camera, drift the clouds and
     * ease the weather. `gloom` 0..1 (rain), `wind` 0..1.
     */
    update(dt: number, gloom: number, wind: number): void {
        const p = this.camera.node.getWorldPosition(this.tmp);
        this.dome.setPosition(p);
        this.gloom += (clamp01(gloom) - this.gloom) * (1 - Math.exp(-dt * GLOOM_RATE));
        this.wind += (clamp01(wind) - this.wind) * (1 - Math.exp(-dt * WIND_RATE));
        this.layers.forEach((l, i) => {
            l.spin += cloudSpin(i, this.wind) * dt;
            l.node.setRotationFromEuler(0, (l.spin * 180) / Math.PI, 0);
        });
        const altitude = clamp01(p.y / this.topY);
        const key = this.keyOf(altitude, this.gloom);
        if (key !== this.key) {
            this.key = key;
            const [a, g] = key.split(',').map(Number);
            for (const child of [...this.dome.children]) child.destroy();
            this.domeMesh.destroy();
            const sky = this.buildDome(a, g, this.dome);
            this.domeMesh = sky.mesh;
        }
        this.setCloudTint(Math.round(this.gloom / SKY_STEP) * SKY_STEP);
    }

    destroy(): void {
        this.domeMesh.destroy();
        this.dome.destroy();
        for (const l of this.layers) l.node.destroy();
    }

    private keyOf(altitude: number, gloom: number): string {
        const q = (v: number): string => (Math.round(v / SKY_STEP) * SKY_STEP).toFixed(2);
        return `${q(altitude)},${q(gloom)}`;
    }

    private setCloudTint(g: number): void {
        if (g === this.cloudTint) return;
        this.cloudTint = g;
        const c = Color.lerp(new Color(), Color.WHITE, CLOUD_STORM, g);
        for (const l of this.layers) l.renderer.getMaterialInstance(0)?.setProperty('mainColor', c);
    }

    /** Sky sphere coloured by elevation. Built under `holder` (created on first build). */
    private buildDome(altitude: number, gloom: number, holder?: Node): { node: Node; mesh: Mesh } {
        const stops = skyStops(altitude, gloom);
        const positions: number[] = [], colors: number[] = [], indices: number[] = [];
        const rings = DOME_RINGS.length;
        for (let i = 0; i <= DOME_SEGMENTS; i++) {
            const a = (i / DOME_SEGMENTS) * Math.PI * 2;
            for (const deg of DOME_RINGS) {
                const el = (deg * Math.PI) / 180;
                const ce = Math.cos(el), se = Math.sin(el);
                positions.push(Math.sin(a) * ce * DOME_RADIUS, se * DOME_RADIUS, Math.cos(a) * ce * DOME_RADIUS);
                const c = skyColorAt(stops, se);
                colors.push(c[0], c[1], c[2], 1);
            }
        }
        for (let i = 0; i < DOME_SEGMENTS; i++) {
            for (let j = 0; j + 1 < rings; j++) {
                const a = i * rings + j, b = a + 1, c = a + rings, d = c + 1;
                indices.push(a, b, c, b, d, c);
            }
        }
        const mb = MeshBuilder.from(positions, colors, indices);
        let node = holder;
        if (!node) {
            node = new Node('SkyDome');
            node.layer = this.camera.node.layer;
            this.camera.node.parent!.addChild(node);
        }
        const { mesh } = this.addMesh('SkyDomeMesh', mb, node);
        // Clear to the horizon colour so any gap reads as haze.
        const h = skyColorAt(stops, 0);
        this.camera.clearColor = new Color(h[0] * 255, h[1] * 255, h[2] * 255, 255);
        return { node, mesh };
    }
}

/** Ellipsoid puffs of one cloud, white on top, blue-grey underneath, faded by distance. */
function addCloud(angle: number, dist: number, y: number, puffs: { x: number; y: number; z: number; rx: number; ry: number; rz: number }[],
    positions: number[], colors: number[], indices: number[]): void {
    const cx = Math.sin(angle) * dist, cz = -Math.cos(angle) * dist;
    // Long side across the line of sight from the tower.
    const tx = Math.cos(angle), tz = Math.sin(angle);
    const haze = Math.min(0.7, hazeAt(dist) * 0.8);
    const sides = 8;
    const lats = [-0.35, 0, 0.45, 0.8, 1];
    for (const p of puffs) {
        const ox = cx + tx * p.x + -tz * p.z;
        const oz = cz + tz * p.x + tx * p.z;
        const oy = y + p.y;
        const base = positions.length / 3;
        for (let i = 0; i <= sides; i++) {
            const a = (i / sides) * Math.PI * 2;
            const ca = Math.cos(a), sa = Math.sin(a);
            for (const s of lats) {
                // s = sin(latitude); the bottom is cut flat at -0.35.
                const r = Math.sqrt(Math.max(0, 1 - s * s));
                const lx = ca * r, lz = sa * r;
                positions.push(ox + (tx * lx - tz * lz) * p.rx, oy + s * p.ry, oz + (tz * lx + tx * lz) * p.rz);
                const up = clamp01((s + 0.35) / 1.35);
                const c: RGB = mix(mix(CLOUD_BOTTOM, CLOUD_TOP, Math.pow(up, 0.7)), HAZE, haze);
                colors.push(c[0], c[1], c[2], 1);
            }
        }
        const n = lats.length;
        for (let i = 0; i < sides; i++) {
            for (let j = 0; j + 1 < n; j++) {
                const a = base + i * n + j, b = a + 1, c = a + n, d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }
        // Flat underside.
        const bottom = base;
        for (let i = 1; i + 1 < sides; i++) indices.push(bottom, bottom + i * n, bottom + (i + 1) * n);
    }
}
