import { BlockInputEvents, Button, Color, Graphics, Label, Node, UIOpacity, UITransform, Vec2, Vec3, tween } from 'cc';

/** Small helpers for building UI from code, so scene files stay minimal. */

export function hex(code: string, alpha = 255): Color {
    const c = new Color();
    Color.fromHEX(c, code);
    c.a = alpha;
    return c;
}

export function makeNode(name: string, parent: Node, w = 0, h = 0, x = 0, y = 0): Node {
    const node = new Node(name);
    node.layer = parent.layer;
    node.parent = parent;
    node.addComponent(UITransform).setContentSize(w, h);
    node.setPosition(x, y);
    return node;
}

export interface LabelOptions {
    x?: number;
    y?: number;
    bold?: boolean;
    outline?: Color;
    outlineWidth?: number;
    shadow?: Color;
    lineHeight?: number;
}

export function makeLabel(parent: Node, text: string, fontSize: number, color: Color, opt: LabelOptions = {}): Label {
    const node = makeNode('Label', parent, 0, 0, opt.x ?? 0, opt.y ?? 0);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = opt.lineHeight ?? Math.round(fontSize * 1.25);
    label.color = color;
    label.isBold = opt.bold ?? false;
    if (opt.outline) {
        label.enableOutline = true;
        label.outlineColor = opt.outline;
        label.outlineWidth = opt.outlineWidth ?? 3;
    }
    if (opt.shadow) {
        label.enableShadow = true;
        label.shadowColor = opt.shadow;
        label.shadowOffset = new Vec2(0, -4);
        label.shadowBlur = 2;
    }
    return label;
}

export function roundRect(g: Graphics, w: number, h: number, r: number, fill: Color, stroke?: Color, lineWidth = 3, dy = 0): void {
    g.roundRect(-w / 2, -h / 2 + dy, w, h, r);
    g.fillColor = fill;
    g.fill();
    if (stroke) {
        g.lineWidth = lineWidth;
        g.strokeColor = stroke;
        g.stroke();
    }
}

export interface ButtonStyle {
    fill: Color;
    /** Darker strip under the face, gives the button depth. */
    base: Color;
    text: Color;
    fontSize: number;
    stroke?: Color;
    radius?: number;
    textOutline?: Color;
}

export const STYLE = {
    primary: { fill: hex('#ff5a3c'), base: hex('#a8281a'), text: Color.WHITE, fontSize: 44, stroke: hex('#ffd7a8'), radius: 30, textOutline: hex('#7a1a10') },
    secondary: { fill: hex('#2a3a7a', 235), base: hex('#141c40', 235), text: Color.WHITE, fontSize: 32, stroke: hex('#8fa6ff', 200), radius: 22 },
    light: { fill: hex('#ffffff', 245), base: hex('#9aa3c0', 245), text: hex('#2b2f45'), fontSize: 30, stroke: hex('#ffffff'), radius: 22 },
    gold: { fill: hex('#ffc94a'), base: hex('#b07a12'), text: hex('#3a2400'), fontSize: 30, stroke: hex('#fff1c2'), radius: 18 },
    locked: { fill: hex('#3a3f5c', 235), base: hex('#22263a', 235), text: hex('#9aa0bf'), fontSize: 30, radius: 18 },
} satisfies Record<string, ButtonStyle>;

export interface UiButton {
    node: Node;
    label: Label;
    graphics: Graphics;
}

/** Rounded-rect button with a pressed (scale) feedback. */
export function makeButton(parent: Node, text: string, w: number, h: number, style: ButtonStyle, onClick: () => void, x = 0, y = 0): UiButton {
    const node = makeNode(`Btn ${text}`, parent, w, h, x, y);
    const graphics = node.addComponent(Graphics);
    drawButton(graphics, w, h, style);
    const label = makeLabel(node, text, style.fontSize, style.text, {
        bold: true, y: 3, outline: style.textOutline, outlineWidth: 3,
    });
    const button = node.addComponent(Button);
    button.target = node;
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.92;
    button.duration = 0.08;
    node.on(Button.EventType.CLICK, onClick);
    return { node, label, graphics };
}

export function drawButton(g: Graphics, w: number, h: number, style: ButtonStyle): void {
    const r = style.radius ?? 20;
    g.clear();
    roundRect(g, w, h, r, style.base, undefined, 0, -6);
    roundRect(g, w, h - 6, r, style.fill, style.stroke, 3, 3);
    // Soft highlight on the upper half.
    g.roundRect(-w / 2 + 8, 6, w - 16, h / 2 - 12, Math.max(4, r - 8));
    g.fillColor = new Color(255, 255, 255, 34);
    g.fill();
}

/** On/off switch; returns a setter so the owner can update it. */
export function makeSwitch(parent: Node, value: boolean, onChange: (v: boolean) => void, x = 0, y = 0): (v: boolean) => void {
    const w = 100;
    const h = 52;
    const node = makeNode('Switch', parent, w, h, x, y);
    const g = node.addComponent(Graphics);
    let current = value;
    const draw = (): void => {
        g.clear();
        roundRect(g, w, h, h / 2, current ? hex('#3fc37a') : hex('#5a5f78'), hex('#ffffff', 120), 2);
        g.circle(current ? w / 2 - h / 2 : -w / 2 + h / 2, 0, h / 2 - 6);
        g.fillColor = Color.WHITE;
        g.fill();
    };
    draw();
    const button = node.addComponent(Button);
    button.target = node;
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.94;
    node.on(Button.EventType.CLICK, () => {
        current = !current;
        draw();
        onChange(current);
    });
    return (v: boolean) => {
        current = v;
        draw();
    };
}

export interface Modal {
    panel: Node;
    close: () => void;
}

/**
 * Dimmed full-screen overlay with a centered panel. Taps outside the panel close it;
 * the overlay blocks input to the menu underneath.
 */
export function openModal(root: Node, title: string, w: number, h: number, onClose?: () => void): Modal {
    const overlay = makeNode('Modal', root, 6000, 6000);
    const dim = overlay.addComponent(Graphics);
    dim.rect(-3000, -3000, 6000, 6000);
    dim.fillColor = new Color(5, 8, 20, 170);
    dim.fill();
    overlay.addComponent(BlockInputEvents);
    const opacity = overlay.addComponent(UIOpacity);

    const panel = makeNode('Panel', overlay, w, h);
    panel.addComponent(BlockInputEvents);
    const g = panel.addComponent(Graphics);
    roundRect(g, w, h, 28, hex('#141a36'), hex('#8fa6ff', 220), 3);
    g.roundRect(-w / 2 + 3, h / 2 - 96, w - 6, 93, 26);
    g.fillColor = hex('#1f2a5c');
    g.fill();
    makeLabel(panel, title, 40, Color.WHITE, { y: h / 2 - 50, bold: true, outline: hex('#0a0f24'), outlineWidth: 3 });

    let closed = false;
    const close = (): void => {
        if (closed) return;
        closed = true;
        tween(opacity).to(0.12, { opacity: 0 }).call(() => {
            overlay.destroy();
            onClose?.();
        }).start();
    };
    overlay.on(Node.EventType.TOUCH_END, close);
    makeButton(panel, '✕', 64, 64, { ...STYLE.secondary, fontSize: 30, radius: 32 }, close, w / 2 - 50, h / 2 - 48);

    opacity.opacity = 0;
    panel.setScale(0.9, 0.9, 1);
    tween(opacity).to(0.15, { opacity: 255 }).start();
    tween(panel).to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
    return { panel, close };
}
