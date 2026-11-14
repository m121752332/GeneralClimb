import { Color, Graphics, Node, UIOpacity, Vec3, tween } from 'cc';
import { hex, makeNode } from '../ui/UiKit';

/**
 * Original procedural art for the Home screen (ADR-08): dusk sky, stars, a generic
 * segmented skyscraper and a city skyline. Drawn wider / taller than the 720 × 1280
 * design so wide and tall screens never show an edge.
 */

const HALF_W = 1400;
const HALF_H = 1600;
/** Top of the horizon glow; the city skyline sits on it. */
const GROUND_Y = -470;

/** Small deterministic PRNG (mulberry32) so the backdrop looks the same every visit. */
function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const SKY_STOPS: [number, string][] = [
    [HALF_H, '#050816'],
    [640, '#0a1230'],
    [200, '#1c1f4e'],
    [-150, '#45296a'],
    [-380, '#a2496c'],
    [-520, '#f08a58'],
    [-HALF_H, '#f6a865'],
];

function skyColor(y: number): Color {
    for (let i = 0; i < SKY_STOPS.length - 1; i++) {
        const [y0, c0] = SKY_STOPS[i];
        const [y1, c1] = SKY_STOPS[i + 1];
        if (y <= y0 && y >= y1) {
            const out = new Color();
            Color.lerp(out, hex(c0), hex(c1), (y0 - y) / (y0 - y1));
            return out;
        }
    }
    return hex(SKY_STOPS[SKY_STOPS.length - 1][1]);
}

function drawSky(parent: Node): void {
    const g = makeNode('Sky', parent).addComponent(Graphics);
    const band = 12;
    for (let y = HALF_H; y > -HALF_H; y -= band) {
        g.fillColor = skyColor(y - band / 2);
        g.rect(-HALF_W, y - band - 1, HALF_W * 2, band + 1);
        g.fill();
    }
}

function drawMoon(parent: Node): void {
    const g = makeNode('Moon', parent, 0, 0, -250, 470).addComponent(Graphics);
    for (const [r, a] of [[96, 8], [72, 14], [54, 26]] as const) {
        g.circle(0, 0, r);
        g.fillColor = new Color(255, 236, 190, a);
        g.fill();
    }
    g.circle(0, 0, 42);
    g.fillColor = hex('#fff2cf');
    g.fill();
    g.circle(-12, 8, 9);
    g.circle(14, -12, 6);
    g.fillColor = hex('#efdcae');
    g.fill();
}

function drawStars(parent: Node): void {
    const rand = rng(101);
    for (let group = 0; group < 3; group++) {
        const node = makeNode(`Stars${group}`, parent);
        const g = node.addComponent(Graphics);
        for (let i = 0; i < 40; i++) {
            const x = (rand() * 2 - 1) * HALF_W;
            const y = 60 + rand() * (HALF_H - 60);
            const r = 1.2 + rand() * 2.2;
            g.fillColor = new Color(255, 250, 230, 140 + Math.floor(rand() * 115));
            g.circle(x, y, r);
            g.fill();
            if (r > 3) {
                // A few sparkles.
                g.lineWidth = 1.5;
                g.strokeColor = new Color(255, 250, 230, 150);
                g.moveTo(x - 8, y); g.lineTo(x + 8, y);
                g.moveTo(x, y - 8); g.lineTo(x, y + 8);
                g.stroke();
            }
        }
        const op = node.addComponent(UIOpacity);
        const d = 1.4 + group * 0.7;
        op.opacity = 255 - group * 60;
        tween(op).to(d, { opacity: 70 }).to(d, { opacity: 255 }).union().repeatForever().start();
    }
}

function drawClouds(parent: Node): void {
    const clouds: [number, number, number, number][] = [
        // x, y, scale, seconds to cross
        [-300, 250, 1.2, 90],
        [350, 80, 0.9, 120],
        [-100, -260, 1.5, 150],
    ];
    for (const [x, y, s, secs] of clouds) {
        const node = makeNode('Cloud', parent, 0, 0, x, y);
        const g = node.addComponent(Graphics);
        g.fillColor = new Color(255, 200, 220, y < 0 ? 40 : 26);
        for (const [cx, cy, r] of [[-70, 0, 34], [-25, 14, 46], [30, 8, 40], [75, -2, 30]]) {
            g.circle(cx * s, cy * s, r * s);
        }
        g.fill();
        g.roundRect(-100 * s, -26 * s, 200 * s, 34 * s, 16 * s);
        g.fill();
        const fromX = -HALF_W;
        const toX = HALF_W;
        const first = (secs * (toX - x)) / (toX - fromX);
        const end = new Vec3(toX, y, 0);
        tween(node).to(first, { position: end }).call(() => {
            node.setPosition(fromX, y);
            tween(node).to(secs, { position: end }).call(() => node.setPosition(fromX, y)).union().repeatForever().start();
        }).start();
    }
}

/** Trapezoid centered on x = 0 from y0 (width w0) to y1 (width w1). */
function trapezoid(g: Graphics, y0: number, w0: number, y1: number, w1: number): void {
    g.moveTo(-w0 / 2, y0);
    g.lineTo(w0 / 2, y0);
    g.lineTo(w1 / 2, y1);
    g.lineTo(-w1 / 2, y1);
    g.close();
}

function drawTower(parent: Node): void {
    const node = makeNode('Tower', parent);
    const g = node.addComponent(Graphics);
    const body = hex('#1a2046');
    const edge = hex('#4a5aa8');
    const glow = new Color(255, 214, 140, 150);
    const rand = rng(7);

    const shape = (y0: number, w0: number, y1: number, w1: number): void => {
        trapezoid(g, y0, w0, y1, w1);
        g.fillColor = body;
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = edge;
        g.stroke();
    };
    const windows = (y0: number, y1: number, w: number): void => {
        for (let y = y0 + 10; y < y1 - 8; y += 14) {
            for (let x = -w / 2 + 14; x < w / 2 - 14; x += 16) {
                if (rand() < 0.45) continue;
                g.fillColor = glow;
                g.rect(x, y, 8, 6);
                g.fill();
            }
        }
    };

    // Podium and lower trunk.
    shape(-HALF_H, 260, -440, 210);
    windows(-900, -440, 210);
    shape(-440, 196, -380, 176);
    windows(-440, -380, 176);

    // Eight stacked sections that flare outward, like stacked boxes.
    const sectionH = 58;
    let y = -380;
    for (let i = 0; i < 8; i++) {
        shape(y, 150, y + sectionH, 196);
        windows(y, y + sectionH, 160);
        g.fillColor = edge;
        g.rect(-100, y + sectionH - 3, 200, 4);
        g.fill();
        y += sectionH;
    }

    // Crown, spire base and spire.
    shape(y, 132, y + 44, 108);
    windows(y, y + 44, 108);
    y += 44;
    shape(y, 60, y + 30, 40);
    y += 30;
    g.moveTo(-9, y);
    g.lineTo(9, y);
    g.lineTo(2, y + 120);
    g.lineTo(-2, y + 120);
    g.close();
    g.fillColor = body;
    g.fill();
    g.strokeColor = edge;
    g.stroke();

    // Blinking aircraft-warning light on the tip.
    const tip = makeNode('TipLight', node, 0, 0, 0, y + 124);
    const tg = tip.addComponent(Graphics);
    tg.circle(0, 0, 14);
    tg.fillColor = new Color(255, 60, 60, 70);
    tg.fill();
    tg.circle(0, 0, 6);
    tg.fillColor = hex('#ff4a4a');
    tg.fill();
    const op = tip.addComponent(UIOpacity);
    tween(op).to(0.6, { opacity: 40 }).to(0.6, { opacity: 255 }).union().repeatForever().start();
}

function drawSkyline(parent: Node, name: string, seed: number, color: Color, minH: number, maxH: number, windowAlpha: number, gapCenter: number): void {
    const g = makeNode(name, parent).addComponent(Graphics);
    const rand = rng(seed);
    const blocks: [number, number, number][] = [];
    let x = -HALF_W;
    while (x < HALF_W) {
        const w = 50 + rand() * 90;
        const h = minH + rand() * (maxH - minH);
        // Keep a gap around the center so the tower base stays visible.
        if (Math.abs(x + w / 2) > gapCenter) blocks.push([x, w, h]);
        x += w + 4 + rand() * 10;
    }
    const base = -HALF_H;
    for (const [bx, w, h] of blocks) {
        g.fillColor = color;
        g.rect(bx, base, w, GROUND_Y - base + h);
        g.fill();
        for (let wy = GROUND_Y + h - 22; wy > base + 20; wy -= 22) {
            for (let wx = bx + 10; wx < bx + w - 14; wx += 18) {
                if (rand() < 0.55) continue;
                g.fillColor = new Color(255, 210, 130, windowAlpha);
                g.rect(wx, wy, 8, 10);
                g.fill();
            }
        }
    }
}

/** Flat 2D backdrop; HomeBackdrop3D shows it until the 3D view is ready. Returns its root. */
export function buildBackdrop(parent: Node): Node {
    const root = makeNode('Backdrop', parent);
    drawSky(root);
    drawStars(root);
    drawMoon(root);
    drawClouds(root);
    drawSkyline(root, 'FarCity', 3, hex('#2b2452'), 40, 260, 90, 130);
    drawTower(root);
    drawSkyline(root, 'NearCity', 11, hex('#120f26'), -40, 110, 170, 170);
    return root;
}
