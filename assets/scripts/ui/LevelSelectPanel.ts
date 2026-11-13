import { Color, Node } from 'cc';
import type { LevelConfig, LevelDef } from '../config/LevelConfig';
import { STYLE, hex, makeButton, makeLabel, openModal } from './UiKit';

const COLS = 4;
const CELL_W = 136;
const CELL_H = 128;
const GAP = 14;

function floorText(level: LevelDef): string {
    if (level.floorFrom !== null && level.floorTo !== null) return `${level.floorFrom}–${level.floorTo}F`;
    return '塔尖';
}

/**
 * Grid of the 14 levels from levels.json. ADR-06: a fall always restarts at 1F,
 * so only level 1 can be started; the rest are shown locked.
 */
export function openLevelSelect(root: Node, cfg: LevelConfig, onStart: () => void, onLocked: () => void): void {
    const rows = Math.ceil(cfg.levels.length / COLS);
    const gridW = COLS * CELL_W + (COLS - 1) * GAP;
    const gridH = rows * CELL_H + (rows - 1) * GAP;
    const w = gridW + 64;
    const h = gridH + 200;
    const modal = openModal(root, '選擇關卡', w, h);

    makeLabel(modal.panel, '墜落一律回 1F 重來，從第 1 關開始挑戰', 22, hex('#c9d3ff'), { y: h / 2 - 122 });

    const top = h / 2 - 150;
    cfg.levels.forEach((level, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = -gridW / 2 + CELL_W / 2 + col * (CELL_W + GAP);
        const y = top - CELL_H / 2 - row * (CELL_H + GAP);
        const unlocked = i === 0;
        const style = unlocked ? STYLE.gold : STYLE.locked;
        const btn = makeButton(modal.panel, String(level.id), CELL_W, CELL_H, { ...style, fontSize: 46 }, () => {
            if (unlocked) {
                modal.close();
                onStart();
            } else {
                onLocked();
            }
        }, x, y);
        btn.label.node.setPosition(0, 26);
        const sub = unlocked ? hex('#3a2400') : hex('#9aa0bf');
        makeLabel(btn.node, floorText(level), 22, sub, { y: -14, bold: true });
        makeLabel(btn.node, level.name, 18, sub, { y: -40 });
        if (!unlocked) makeLabel(btn.node, '🔒', 22, Color.WHITE, { x: CELL_W / 2 - 22, y: CELL_H / 2 - 24 });
    });
}
