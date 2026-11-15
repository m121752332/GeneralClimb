import { Color, Graphics, Node, UITransform } from 'cc';
import { auth } from '../core/AuthService';
import { formatCloudCount, playerTag } from '../core/CloudSummit';
import { t } from '../core/I18n';
import { formatRounds, formatRunTime } from '../core/RunTime';
import { STYLE, type UiButton, drawButton, hex, makeButton, makeLabel, makeNode, openModal, roundRect } from './UiKit';

const W = 620;
const ROW_H = 44;
const TAB_W = 250;
const TAB_H = 64;

type Tab = 'rounds' | 'time';

interface Row {
    uid: string;
    name: string;
    rank: number;
    value: string;
}

/**
 * 登頂排行榜 (ADR-09), two tabs; guests can look too.
 * - 總周目: summit count per player, shown as 「10周目」.
 * - 最快時間: fastest full run (level 1 to the tip without a fall), fastest first.
 */
export function openLeaderboard(root: Node, size: number, onClose?: () => void): void {
    const h = 320 + size * ROW_H;
    const modal = openModal(root, t('lb.title'), W, h, onClose);
    const p = modal.panel;
    const svc = auth();
    const me = svc.user;
    const tabY = h / 2 - 140;
    const top = tabY - 76;
    const x0 = -W / 2 + 40;
    const x1 = W / 2 - 40;

    const place = (parent: Node, text: string, x: number, y: number, anchor: number, color: Color, bold = false): void => {
        const l = makeLabel(parent, text, 24, color, { y, bold });
        l.node.getComponent(UITransform)!.setAnchorPoint(anchor, 0.5);
        l.node.setPosition(x, y);
    };

    let body: Node | null = null;
    let current: Tab = 'rounds';
    const cache = new Map<Tab, Promise<Row[]>>();
    const load = (tab: Tab): Promise<Row[]> => {
        let rows = cache.get(tab);
        if (!rows) {
            rows = tab === 'rounds'
                ? svc.leaderboard(size).then((rs) => rs.map((r) => ({ uid: r.uid, name: r.name, rank: r.rank, value: formatRounds(r.count) })))
                : svc.fastestRuns(size).then((rs) => rs.map((r) => ({ uid: r.uid, name: r.name, rank: r.rank, value: formatRunTime(r.bestRunMs) })));
            // A failed load is tried again the next time the tab is opened.
            rows.catch(() => cache.delete(tab));
            cache.set(tab, rows);
        }
        return rows;
    };

    const footer = (tab: Tab): string => {
        if (tab === 'rounds') {
            return me
                ? `${me.name}#${playerTag(me.uid)}${svc.cloudCount === null ? '' : ` · ${formatCloudCount(svc.cloudCount)}`}`
                : t('lb.signInHint');
        }
        if (!me) return t('lb.timeSignInHint');
        const best = svc.cloudBestRunMs === null ? t('lb.noRecord') : t('lb.myBest', { time: formatRunTime(svc.cloudBestRunMs) });
        return `${me.name}#${playerTag(me.uid)} · ${best}`;
    };

    const show = (tab: Tab): void => {
        current = tab;
        body?.destroy();
        const b = makeNode('Body', p, W, h);
        body = b;
        place(b, t('lb.rank'), x0, top, 0, hex('#9aa0bf'), true);
        place(b, t('lb.player'), x0 + 100, top, 0, hex('#9aa0bf'), true);
        place(b, tab === 'rounds' ? t('lb.count') : t('lb.time'), x1, top, 1, hex('#9aa0bf'), true);
        const status = makeLabel(b, t('common.loading'), 26, hex('#c9d3ff'), { y: top - 60 });
        if (tab === 'time') makeLabel(b, t('lb.timeRule'), 20, hex('#9aa0bf'), { y: -h / 2 + 86 });
        makeLabel(b, footer(tab), 22, hex('#ffe2a0'), { y: -h / 2 + 46, bold: true });

        load(tab).then((rows) => {
            if (!b.isValid || current !== tab) return;
            if (rows.length === 0) {
                status.string = tab === 'rounds' ? t('lb.empty') : t('lb.noRecord');
                return;
            }
            status.node.active = false;
            rows.forEach((r, i) => {
                const y = top - 50 - i * ROW_H;
                const mine = me?.uid === r.uid;
                if (mine || i % 2 === 0) {
                    const bg = makeNode('Row', b, W - 50, ROW_H - 4, 0, y).addComponent(Graphics);
                    roundRect(bg, W - 50, ROW_H - 4, 12, mine ? hex('#ffc94a', 60) : hex('#1f2a5c', 160), mine ? hex('#ffc94a', 200) : undefined, 2);
                }
                const color = r.rank <= 3 ? hex('#ffc94a') : Color.WHITE;
                place(b, String(r.rank), x0 + 14, y, 0, color, true);
                place(b, r.name, x0 + 100, y, 0, mine ? hex('#ffe2a0') : Color.WHITE, mine);
                place(b, r.value, x1, y, 1, color, true);
            });
        }).catch((err: unknown) => {
            console.warn('[Leaderboard]', err);
            if (status.isValid && current === tab) status.string = (err as { text?: string } | null)?.text ?? t('lb.failed');
        });
    };

    const tabStyle = (on: boolean) => (on ? { ...STYLE.gold, fontSize: 28 } : { ...STYLE.secondary, fontSize: 28, radius: 18 });
    const tabs: [Tab, UiButton][] = [];
    const select = (tab: Tab): void => {
        if (tab === current && body) return;
        for (const [id, btn] of tabs) {
            const style = tabStyle(id === tab);
            drawButton(btn.graphics, TAB_W, TAB_H, style);
            btn.label.color = style.text;
        }
        show(tab);
    };
    tabs.push(['rounds', makeButton(p, t('lb.tabRounds'), TAB_W, TAB_H, tabStyle(true), () => select('rounds'), -TAB_W / 2 - 10, tabY)]);
    tabs.push(['time', makeButton(p, t('lb.tabTime'), TAB_W, TAB_H, tabStyle(false), () => select('time'), TAB_W / 2 + 10, tabY)]);
    select('rounds');
}
