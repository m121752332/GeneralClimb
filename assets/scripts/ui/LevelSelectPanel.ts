import { Color, Node } from 'cc';
import type { LevelConfig, LevelDef } from '../config/LevelConfig';
import { levelName, t } from '../core/I18n';
import { levelAccess } from '../core/LevelAccess';
import { STYLE, hex, makeButton, makeLabel, openModal } from './UiKit';

const COLS = 4;
const CELL_W = 136;
const CELL_H = 128;
const GAP = 14;

function floorText(level: LevelDef): string {
    if (level.floorFrom !== null && level.floorTo !== null) return `${level.floorFrom}–${level.floorTo}F`;
    return t('floors.tip');
}

/**
 * Grid of the 14 levels from levels.json. Level 1 is always open; clearing a level opens the
 * next (`unlocked`, core/Progress) until the summit ending resets them. Developer mode (金手指)
 * opens every level, the spire included.
 */
export function openLevelSelect(
    root: Node,
    cfg: LevelConfig,
    devMode: boolean,
    onStart: (levelIndex: number) => void,
    onLocked: (message: string) => void,
    onClose?: () => void,
    unlocked = 0,
    roundText = '',
): void {
    const rows = Math.ceil(cfg.levels.length / COLS);
    const gridW = COLS * CELL_W + (COLS - 1) * GAP;
    const gridH = rows * CELL_H + (rows - 1) * GAP;
    const w = gridW + 64;
    const h = gridH + 200;
    const modal = openModal(root, t(devMode ? 'levels.titleGm' : 'levels.title'), w, h, onClose);

    const hint = devMode
        ? t('levels.hintDev')
        : unlocked > 0
            ? t('levels.hintUnlocked', { round: roundText, n: unlocked + 1 })
            : roundText ? t('levels.hintFreshRound', { round: roundText }) : t('levels.hintFresh');
    makeLabel(modal.panel, hint, 22, devMode ? hex('#5fe39a') : hex('#c9d3ff'), { y: h / 2 - 122 });

    const top = h / 2 - 150;
    cfg.levels.forEach((level, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = -gridW / 2 + CELL_W / 2 + col * (CELL_W + GAP);
        const y = top - CELL_H / 2 - row * (CELL_H + GAP);
        const access = levelAccess(level, i, devMode, unlocked);
        const open = access === 'open';
        const style = i === 0 ? STYLE.gold : open ? STYLE.secondary : STYLE.locked;
        const btn = makeButton(modal.panel, String(level.id), CELL_W, CELL_H, { ...style, fontSize: 46 }, () => {
            if (open) {
                modal.close();
                onStart(i);
            } else {
                onLocked(access === 'spire' ? t('levels.spireLocked') : t('levels.locked', { n: i }));
            }
        }, x, y);
        btn.label.node.setPosition(0, 26);
        const sub = i === 0 ? hex('#3a2400') : open ? hex('#e8ecff') : hex('#9aa0bf');
        makeLabel(btn.node, floorText(level), 22, sub, { y: -14, bold: true });
        makeLabel(btn.node, levelName(level.name), 18, sub, { y: -40 });
        if (!open) makeLabel(btn.node, '🔒', 22, Color.WHITE, { x: CELL_W / 2 - 22, y: CELL_H / 2 - 24 });
    });
}
