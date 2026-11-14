import { Color, Graphics, Node, UITransform } from 'cc';
import { auth } from '../core/AuthService';
import { formatCloudCount, playerTag } from '../core/CloudSummit';
import { t } from '../core/I18n';
import { hex, makeLabel, makeNode, openModal, roundRect } from './UiKit';

const W = 620;
const ROW_H = 44;

/** 登頂排行榜 (ADR-09): top players by cloud summit count; guests can look too. */
export function openLeaderboard(root: Node, size: number, onClose?: () => void): void {
    const h = 250 + size * ROW_H;
    const modal = openModal(root, t('lb.title'), W, h, onClose);
    const p = modal.panel;
    const svc = auth();
    const top = h / 2 - 130;
    const status = makeLabel(p, t('common.loading'), 26, hex('#c9d3ff'), { y: top - 60 });
    const me = svc.user;
    makeLabel(p, me
        ? `${me.name}#${playerTag(me.uid)}${svc.cloudCount === null ? '' : ` · ${formatCloudCount(svc.cloudCount)}`}`
        : t('lb.signInHint'), 22, hex('#ffe2a0'), { y: -h / 2 + 46, bold: true });

    const place = (text: string, x: number, y: number, anchor: number, color: Color, bold = false, parent: Node = p): void => {
        const l = makeLabel(parent, text, 24, color, { y, bold });
        l.node.getComponent(UITransform)!.setAnchorPoint(anchor, 0.5);
        l.node.setPosition(x, y);
    };
    const x0 = -W / 2 + 40;
    const x1 = W / 2 - 40;
    place(t('lb.rank'), x0, top, 0, hex('#9aa0bf'), true);
    place(t('lb.player'), x0 + 100, top, 0, hex('#9aa0bf'), true);
    place(t('lb.count'), x1, top, 1, hex('#9aa0bf'), true);

    svc.leaderboard(size).then((rows) => {
        if (!p.isValid) return;
        if (rows.length === 0) {
            status.string = t('lb.empty');
            return;
        }
        status.node.active = false;
        rows.forEach((r, i) => {
            const y = top - 50 - i * ROW_H;
            const mine = me?.uid === r.uid;
            if (mine || i % 2 === 0) {
                const bg = makeNode('Row', p, W - 50, ROW_H - 4, 0, y).addComponent(Graphics);
                roundRect(bg, W - 50, ROW_H - 4, 12, mine ? hex('#ffc94a', 60) : hex('#1f2a5c', 160), mine ? hex('#ffc94a', 200) : undefined, 2);
            }
            const color = r.rank <= 3 ? hex('#ffc94a') : Color.WHITE;
            place(String(r.rank), x0 + 14, y, 0, color, true);
            place(r.name, x0 + 100, y, 0, mine ? hex('#ffe2a0') : Color.WHITE, mine);
            place(t('lb.times', { n: r.count }), x1, y, 1, color, true);
        });
    }).catch((err: unknown) => {
        console.warn('[Leaderboard]', err);
        if (status.isValid) status.string = (err as { text?: string } | null)?.text ?? t('lb.failed');
    });
}
