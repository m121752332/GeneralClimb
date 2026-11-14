import { Button, Color, Graphics, Label, Node, UITransform } from 'cc';
import { auth } from '../core/AuthService';
import { formatCloudCount, formatSyncAgo, playerTag } from '../core/CloudSummit';
import { t } from '../core/I18n';
import type { StorageLike } from '../core/Settings';
import { type ButtonStyle, STYLE, hex, makeButton, makeLabel, makeNode, openModal, roundRect } from './UiKit';

const W = 620;
const H = 860;
const RED = hex('#ff5a3c');
const DANGER: ButtonStyle = { fill: hex('#3a1420', 235), base: hex('#22080e', 235), text: hex('#ff8a7a'), fontSize: 28, stroke: hex('#ff5a3c', 200), radius: 18 };

/** Static pages next to index.html (build-templates/web-mobile). */
export const PRIVACY_URL = 'privacy.html';
export const TERMS_URL = 'terms.html';

function leftAlign(label: Label, x: number): Label {
    label.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    label.node.setPosition(x, label.node.position.y);
    return label;
}

function rightAlign(label: Label, x: number): Label {
    label.node.getComponent(UITransform)!.setAnchorPoint(1, 0.5);
    label.node.setPosition(x, label.node.position.y);
    return label;
}

export function openPage(url: string): void {
    (globalThis as { open?: (u: string, t: string) => unknown }).open?.(url, '_blank');
}

function makeLink(parent: Node, text: string, x: number, y: number, url: string): void {
    const label = makeLabel(parent, text, 22, hex('#8fa6ff'), { x, y });
    label.node.getComponent(UITransform)!.setContentSize(150, 44);
    const btn = label.node.addComponent(Button);
    btn.target = label.node;
    btn.transition = Button.Transition.SCALE;
    btn.zoomScale = 0.92;
    label.node.on(Button.EventType.CLICK, () => openPage(url));
}

/** 「隱私權政策 · 服務條款」 links at `y`. */
export function makePolicyLinks(parent: Node, y: number): void {
    makeLink(parent, t('account.privacy'), -85, y, PRIVACY_URL);
    makeLabel(parent, '·', 22, hex('#8fa6ff'), { y });
    makeLink(parent, t('account.terms'), 75, y, TERMS_URL);
}

export interface AccountPanelOptions {
    storage: StorageLike | null;
    toast: (text: string) => void;
    onClose?: () => void;
}

/**
 * Account panel for a signed-in player (GDD §7 / ADR-09): Google account card, sync status
 * with 立即同步, player name, sign-out, delete account, privacy and terms links.
 */
export function openAccountPanel(root: Node, opt: AccountPanelOptions): void {
    const svc = auth();
    const user = svc.user;
    if (!user) return;
    let unsubscribe: (() => void) | null = null;
    const modal = openModal(root, t('account.title'), W, H, () => {
        unsubscribe?.();
        opt.onClose?.();
    });
    const p = modal.panel;
    const x0 = -W / 2 + 40;
    const x1 = W / 2 - 40;

    // Red accent along the top edge.
    const accent = makeNode('Accent', p, W, 6, 0, H / 2 - 3).addComponent(Graphics);
    accent.roundRect(-W / 2 + 24, -3, W - 48, 6, 3);
    accent.fillColor = RED;
    accent.fill();

    // Google account card.
    let y = H / 2 - 190;
    const card = makeNode('Card', p, W - 60, 140, 0, y);
    roundRect(card.addComponent(Graphics), W - 60, 140, 20, hex('#1f2a5c'), hex('#8fa6ff', 120), 2);
    const avatar = makeNode('Avatar', card, 92, 92, -W / 2 + 100, 0).addComponent(Graphics);
    avatar.circle(0, 0, 46);
    avatar.fillColor = RED;
    avatar.fill();
    makeLabel(avatar.node, Array.from(user.name)[0] ?? '霍', 44, Color.WHITE, { bold: true, y: 2 });
    leftAlign(makeLabel(card, user.name, 30, Color.WHITE, { bold: true, y: 26 }), -W / 2 + 170);
    leftAlign(makeLabel(card, user.email || t('account.googleAccount'), 22, hex('#c9d3ff'), { y: -8 }), -W / 2 + 170);
    const badge = makeNode('Badge', card, 110, 34, -W / 2 + 225, -44);
    roundRect(badge.addComponent(Graphics), 110, 34, 17, hex('#ffffff', 235), undefined);
    makeLabel(badge, 'Google', 20, hex('#4285f4'), { bold: true });
    const total = leftAlign(makeLabel(card, '', 22, hex('#ffe2a0'), { bold: true, y: -44 }), -W / 2 + 295);

    // Sync status.
    y -= 120;
    const dot = makeNode('Dot', p, 0, 0, x0 + 8, y).addComponent(Graphics);
    const syncText = leftAlign(makeLabel(p, '', 24, hex('#e8ecff'), { y }), x0 + 26);
    const refresh = (): void => {
        if (!syncText.isValid) return;
        const synced = svc.lastSyncMs !== null;
        dot.clear();
        dot.circle(0, 0, 8);
        dot.fillColor = synced ? hex('#5fe39a') : hex('#ffc94a');
        dot.fill();
        syncText.string = formatSyncAgo(svc.lastSyncMs, Date.now());
        total.string = formatCloudCount(svc.cloudCount);
    };
    refresh();
    unsubscribe = svc.onChange(refresh);
    let busy = false;
    makeButton(p, t('account.syncNow'), 170, 60, { ...STYLE.secondary, fontSize: 24, radius: 18 }, () => {
        if (busy) return;
        busy = true;
        svc.syncSummits(opt.storage).then((added) => {
            opt.toast(added > 0 ? t('sync.added', { n: added }) : svc.lastSyncMs ? t('sync.upToDate') : t('sync.failed'));
            busy = false;
        });
    }, x1 - 85, y);

    // 帳號設定
    y -= 90;
    leftAlign(makeLabel(p, t('account.settings'), 24, hex('#9aa0bf'), { bold: true, y }), x0);
    y -= 60;
    const row = makeNode('NameRow', p, W - 60, 72, 0, y);
    roundRect(row.addComponent(Graphics), W - 60, 72, 16, hex('#1a2248'), undefined);
    leftAlign(makeLabel(row, t('account.name'), 24, hex('#c9d3ff'), {}), -W / 2 + 50);
    rightAlign(makeLabel(row, `${user.name}#${playerTag(user.uid)}`, 24, Color.WHITE, { bold: true }), W / 2 - 50);
    y -= 92;
    makeButton(p, t('account.signOut'), W - 60, 76, { ...STYLE.secondary, fontSize: 28 }, () => {
        modal.close();
        void svc.signOut().then(() => opt.toast(t('cloud.signedOut')));
    }, 0, y);

    // 危險區域
    y -= 90;
    leftAlign(makeLabel(p, t('account.danger'), 24, RED, { bold: true, y }), x0);
    y -= 66;
    const del = makeButton(p, t('account.delete'), W - 60, 88, DANGER, () => confirmDelete(root, opt, modal.close), 0, y);
    del.label.node.setPosition(0, 14);
    makeLabel(del.node, t('account.deleteSub'), 20, hex('#ffb3a8', 220), { y: -20 });

    makePolicyLinks(p, -H / 2 + 44);
}

function confirmDelete(root: Node, opt: AccountPanelOptions, closeAccount: () => void): void {
    const w = 560;
    const h = 420;
    const modal = openModal(root, t('account.confirmTitle'), w, h);
    makeLabel(modal.panel, t('account.confirmBody'), 22, hex('#e8ecff'), { y: 30, lineHeight: 32 });
    makeButton(modal.panel, t('account.cancel'), 220, 76, STYLE.secondary, () => modal.close(), -125, -h / 2 + 70);
    makeButton(modal.panel, t('account.confirm'), 220, 76, { ...DANGER, fill: hex('#c0392b'), text: Color.WHITE, base: hex('#7a1a10') }, () => {
        // deleteAccount opens the Google popup first, still inside this click.
        void auth().deleteAccount().then((text) => {
            modal.close();
            closeAccount();
            opt.toast(text);
        });
    }, 125, -h / 2 + 70);
}
