import { Color, Graphics, Label, Node, Slider, Sprite, UITransform } from 'cc';
import { settings } from '../core/Settings';
import { STYLE, hex, makeButton, makeLabel, makeNode, makeSwitch, openModal, roundRect } from './UiKit';

const W = 600;
const H = 560;
const TRACK_W = 300;

function makeVolumeSlider(parent: Node, value: number, x: number, y: number, onChange: (v: number) => void): void {
    const node = makeNode('Volume', parent, TRACK_W, 48, x, y);
    const track = node.addComponent(Graphics);
    const draw = (p: number): void => {
        track.clear();
        roundRect(track, TRACK_W, 14, 7, hex('#3a4170'));
        track.roundRect(-TRACK_W / 2, -7, Math.max(14, TRACK_W * p), 14, 7);
        track.fillColor = hex('#ffc94a');
        track.fill();
    };

    // Slider needs a Sprite handle; the dot itself is drawn in a Graphics child.
    const handle = makeNode('Handle', node, 52, 52);
    const sprite = handle.addComponent(Sprite);
    const dot = makeNode('Dot', handle).addComponent(Graphics);
    dot.circle(0, 0, 20);
    dot.fillColor = Color.WHITE;
    dot.fill();
    dot.lineWidth = 4;
    dot.strokeColor = hex('#ff5a3c');
    dot.stroke();

    const slider = node.addComponent(Slider);
    slider.handle = sprite;
    slider.direction = Slider.Direction.Horizontal;
    slider.progress = value;
    draw(value);
    node.on('slide', (s: Slider) => {
        draw(s.progress);
        onChange(s.progress);
    });
}

export function openSettings(root: Node, onChange: () => void): void {
    const modal = openModal(root, '設定', W, H);
    const p = modal.panel;
    const s = settings().get();
    const labelX = -W / 2 + 56;
    const rowLabel = (text: string, y: number): Label => {
        const l = makeLabel(p, text, 32, Color.WHITE, { x: labelX, y, bold: true });
        l.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        return l;
    };

    const yVol = H / 2 - 160;
    rowLabel('音量', yVol);
    const pct = makeLabel(p, `${Math.round(s.volume * 100)}%`, 28, hex('#ffc94a'), { x: W / 2 - 70, y: yVol, bold: true });
    makeVolumeSlider(p, s.volume, 30, yVol, (v) => {
        settings().set({ volume: v });
        pct.string = `${Math.round(v * 100)}%`;
        onChange();
    });

    const yVib = yVol - 100;
    rowLabel('震動', yVib);
    makeSwitch(p, s.vibration, (v) => { settings().set({ vibration: v }); onChange(); }, W / 2 - 110, yVib);

    const yFlash = yVib - 100;
    rowLabel('閃光效果', yFlash);
    makeSwitch(p, s.flashEffects, (v) => { settings().set({ flashEffects: v }); onChange(); }, W / 2 - 110, yFlash);
    makeLabel(p, '對閃光敏感可關閉閃電與危機閃爍', 20, hex('#9aa6d8'), { x: labelX, y: yFlash - 44 }).node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);

    makeButton(p, '完成', 240, 80, STYLE.primary, modal.close, 0, -H / 2 + 70).label.fontSize = 34;
}
