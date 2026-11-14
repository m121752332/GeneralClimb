import { Camera, Color, Component, Graphics, Mesh, MeshRenderer, Node, Vec3, Widget, _decorator, view } from 'cc';
import { LevelLoader } from '../config/LevelLoader';
import { SPIRE_TIP, summitY } from '../climb/TowerShape';
import {
    BAND_COLORS, BAND_SHARE, cityPlan, DUSK_BASIN, DUSK_TOWER, HOME_FOV, HOME_LOOK, LIGHT_GROUPS, WINDOW_LIGHTS, WINDOW_SHARE, cityLights,
    duskSky, duskStreaks, homeCityCap, homeCloud, homeEye, homeYawShift, tipLightOn, twinkle,
} from '../climb/BasinShape';
import { hex, makeLabel, makeNode } from '../ui/UiKit';
import { MeshBuilder } from './MeshKit';
import { Tower3D } from './Tower3D';
import { buildBackdrop } from './HomeBackdrop';

const { ccclass } = _decorator;

const LOOK = new Vec3(HOME_LOOK[0], HOME_LOOK[1], HOME_LOOK[2]);
const CAPTION = '象山 · 臺北101 信義區 · ELEPHANT MTN · TAIPEI 101';

/**
 * Home screen backdrop: the 3D 101 at dusk from our Elephant Mountain (climb/DuskShape), with
 * lit windows, a blinking spire light, twinkling city lights and streaky clouds over the basin.
 * The 2D backdrop (HomeBackdrop) shows until the 3D scene is ready, and stays if it fails.
 */
@ccclass('HomeBackdrop3D')
export class HomeBackdrop3D extends Component {
    private tower: Tower3D | null = null;
    private flat: Node | null = null;
    private readonly meshes: Mesh[] = [];
    private lightRenderers: MeshRenderer[] = [];
    private tip: Node | null = null;
    private t = 0;
    private readonly look = new Vec3();

    /** Adds the backdrop behind everything else under the Home canvas. */
    static mount(canvas: Node): Node {
        const holder = makeNode('Backdrop3D', canvas);
        holder.setSiblingIndex(0);
        const view = holder.addComponent(HomeBackdrop3D);
        view.flat = buildBackdrop(canvas);
        view.flat.setSiblingIndex(0);
        return buildCaption(canvas);
    }

    start(): void {
        LevelLoader.load().then((cfg) => {
            if (!this.node.isValid) return null;
            this.tower = new Tower3D(cfg.player.rowsPerFloor, cfg.player.ladderRows, cfg.crowd, 0, {
                colors: DUSK_TOWER,
                basin: DUSK_BASIN,
                cityCap: homeCityCap,
                sky: { sky: duskSky, cloudFilter: homeCloud },
            });
            return this.tower.initShowcase().then(() => this.ready(cfg.player.rowsPerFloor, cfg.player.ladderRows));
        }).catch((err: unknown) => {
            console.warn('Home 3D backdrop not shown', err);
            this.tower?.destroy();
            this.tower = null;
        });
    }

    private ready(rowsPerFloor: number, ladderRows: number): void {
        const tower = this.tower;
        if (!tower || !this.node.isValid) return;
        const cam = tower.camera;
        cam.fovAxis = Camera.FOVAxis.VERTICAL;
        cam.fov = HOME_FOV;
        cam.near = 1;

        tower.addBands(BAND_SHARE, hex(BAND_COLORS[0]), hex(BAND_COLORS[1]));
        tower.addWindowLights(WINDOW_SHARE, WINDOW_LIGHTS.map((h) => hex(h)), 101);
        this.buildCityLights(tower);
        this.buildStreaks(tower);
        this.tip = this.buildTip(tower, summitY(rowsPerFloor, ladderRows) + SPIRE_TIP);

        this.place(0);
        tower.updateAtmosphere(0, 0, 0.15);
        // The 3D camera now clears the screen with the sky; the UI camera only draws on top.
        const uiCam = this.node.parent?.getComponentInChildren(Camera);
        if (uiCam && uiCam !== cam) uiCam.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
        this.flat?.destroy();
        this.flat = null;
        (globalThis as { __GC_HOME3D?: boolean }).__GC_HOME3D = true;
    }

    update(dt: number): void {
        if (!this.tower || this.flat) return;
        this.t += dt;
        this.place(this.t);
        this.tower.updateAtmosphere(dt, 0, 0.15);
        this.lightRenderers.forEach((r, g) => {
            const k = Math.round(twinkle(g, this.t) * 255);
            r.getMaterialInstance(0)?.setProperty('mainColor', new Color(k, k, k, 255));
        });
        if (this.tip) this.tip.active = tipLightOn(this.t);
    }

    onDestroy(): void {
        for (const m of this.meshes) m.destroy();
        this.tower?.destroy();
        this.tower = null;
    }

    private place(t: number): void {
        const [x, y, z] = homeEye(t);
        const n = this.tower!.camera.node;
        n.setPosition(x, y, z);
        // Turn so the tower stands right of the left menu column.
        const size = view.getVisibleSize();
        const a = homeYawShift(size.width / Math.max(1, size.height));
        const dx = LOOK.x - x, dz = LOOK.z - z;
        const c = Math.cos(a), s = Math.sin(a);
        this.look.set(x + dx * c + dz * s, LOOK.y, z - dx * s + dz * c);
        n.lookAt(this.look);
    }

    /** City lights as camera-facing squares, in LIGHT_GROUPS meshes that twinkle out of step. */
    private buildCityLights(tower: Tower3D): void {
        const lights = cityLights(cityPlan({ tones: DUSK_BASIN.tones, cap: homeCityCap }));
        const [ex, , ez] = homeEye(0);
        for (let g = 0; g < LIGHT_GROUPS; g++) {
            const positions: number[] = [], colors: number[] = [], indices: number[] = [];
            for (const l of lights) {
                if (l.group !== g) continue;
                const dx = ex - l.x, dz = ez - l.z;
                const d = Math.hypot(dx, dz) || 1;
                // Across the line of sight, and up.
                const rx = (-dz / d) * l.size / 2, rz = (dx / d) * l.size / 2, h = l.size / 2;
                const i = positions.length / 3;
                positions.push(l.x - rx, l.y - h, l.z - rz, l.x + rx, l.y - h, l.z + rz, l.x + rx, l.y + h, l.z + rz, l.x - rx, l.y + h, l.z - rz);
                for (let k = 0; k < 4; k++) colors.push(l.color[0], l.color[1], l.color[2], 1);
                indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
            }
            if (!indices.length) continue;
            const { node, mesh } = tower.addMesh(`CityLights${g}`, MeshBuilder.from(positions, colors, indices));
            this.meshes.push(mesh);
            this.lightRenderers.push(node.getComponent(MeshRenderer)!);
        }
    }

    /** Streaky clouds: flat lens shapes facing the camera, low in the sky. */
    private buildStreaks(tower: Tower3D): void {
        const positions: number[] = [], colors: number[] = [], indices: number[] = [];
        const seg = 14;
        for (const s of duskStreaks()) {
            const base = positions.length / 3;
            positions.push(s.x, s.y, s.z);
            colors.push(s.color[0], s.color[1], s.color[2], 1);
            for (let i = 0; i <= seg; i++) {
                const a = (i / seg) * Math.PI * 2;
                const along = Math.cos(a) * s.len / 2;
                // Thicker in the middle, tapering to points at both ends.
                const up = Math.sin(a) * s.thick / 2 * (Math.sin(a) < 0 ? 0.5 : 1);
                positions.push(s.x + s.ax * along, s.y + up, s.z + s.az * along);
                colors.push(s.color[0], s.color[1], s.color[2], 1);
            }
            for (let i = 0; i < seg; i++) indices.push(base, base + 1 + i, base + 2 + i);
        }
        const { mesh } = tower.addMesh('SkyStreaks', MeshBuilder.from(positions, colors, indices));
        this.meshes.push(mesh);
    }

    /** Red aircraft-warning light on the spire tip (a little oversized so it reads on a phone). */
    private buildTip(tower: Tower3D, y: number): Node {
        const mb = new MeshBuilder();
        mb.box(0, y + 0.4, 0, 1.3, 1.3, 1.3, hex('#ff3b3b'), Math.PI / 4, hex('#ff7a6a'));
        const { node, mesh } = tower.addMesh('TipLight', mb);
        this.meshes.push(mesh);
        return node;
    }
}

/**
 * Bottom caption: a short red rule over the place name, pinned to the visible bottom edge.
 * Returned so Home can move it to the bottom-right corner on landscape screens.
 */
function buildCaption(canvas: Node): Node {
    const bar = makeNode('Caption', canvas, 600, 56);
    const w = bar.addComponent(Widget);
    w.isAlignBottom = true;
    w.bottom = 14;
    const g = makeNode('Rule', bar, 0, 0, 0, 14).addComponent(Graphics);
    g.fillColor = hex('#e0323c');
    g.rect(-36, -1.5, 72, 3);
    g.fill();
    makeLabel(bar, CAPTION, 19, hex('#f6dccf', 230), { y: -8, outline: hex('#2a1a2e', 200), outlineWidth: 2 });
    return bar;
}
