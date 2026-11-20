import { Button, Color, EditBox, Graphics, Label, Node, UITransform } from 'cc';
import { auth, nameErrorText } from '../core/AuthService';
import { formatCloudCount, formatSyncAgo, playerTag } from '../core/CloudSummit';
import { lang, t } from '../core/I18n';
import { NAME_MAX, nameLength, normalizeName, validatePlayerName } from '../core/PlayerName';
import type { StorageLike } from '../core/Settings';
import { type ButtonStyle, STYLE, hex, makeButton, makeLabel, makeNode, openModal, roundRect } from './UiKit';

const W = 620;
const H = 860;
const RED = hex('#ff5a3c');
const DANGER: ButtonStyle = { fill: hex('#3a1420', 235), base: hex('#22080e', 235), text: hex('#ff8a7a'), fontSize: 28, stroke: hex('#ff5a3c', 200), radius: 18 };

/** Static pages next to index.html (build-templates/web-mobile). */
export const PRIVACY_URL = 'privacy.html';
export const TERMS_URL = 'terms.html';
/** Player guide (build-templates/web-mobile/guide), opened in the player's language. */
export const GUIDE_URL = 'guide/index.html';

export function guideUrl(): string {
    return `${GUIDE_URL}?lang=${lang() === 'en' ? 'en' : 'zh'}`;
}

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

export function makeLink(parent: Node, text: string, x: number, y: number, url: string): void {
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
    const initial = makeLabel(avatar.node, Array.from(user.name)[0] ?? '霍', 44, Color.WHITE, { bold: true, y: 2 });
    const cardName = leftAlign(makeLabel(card, user.name, 30, Color.WHITE, { bold: true, y: 26 }), -W / 2 + 170);
    leftAlign(makeLabel(card, user.email || t('account.googleAccount'), 22, hex('#c9d3ff'), { y: -8 }), -W / 2 + 170);
    const badge = makeNode('Badge', card, 110, 34, -W / 2 + 225, -44);
    roundRect(badge.addComponent(Graphics), 110, 34, 17, hex('#ffffff', 235), undefined);
    makeLabel(badge, 'Google', 20, hex('#4285f4'), { bold: true });
    const total = leftAlign(makeLabel(card, '', 22, hex('#ffe2a0'), { bold: true, y: -44 }), -W / 2 + 295);

    // Sync status.
    y -= 120;
    const dot = makeNode('Dot', p, 0, 0, x0 + 8, y).addComponent(Graphics);
    const syncText = leftAlign(makeLabel(p, '', 24, hex('#e8ecff'), { y }), x0 + 26);
    let rowName: Label | null = null;
    const refresh = (): void => {
        if (!syncText.isValid) return;
        // A rename (here or on another device) shows everywhere in the panel at once.
        const u = svc.user;
        if (u) {
            initial.string = Array.from(u.name)[0] ?? '霍';
            cardName.string = u.name;
            if (rowName) rowName.string = `${u.name}#${playerTag(u.uid)}`;
        }
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
    // Name + tag, shrunk to fit between the caption and the 修改 button (12 Chinese characters + tag).
    rowName = rightAlign(makeLabel(row, `${user.name}#${playerTag(user.uid)}`, 24, Color.WHITE, { bold: true }), W / 2 - 150);
    rowName.overflow = Label.Overflow.SHRINK;
    rowName.node.getComponent(UITransform)!.setContentSize(330, 40);
    rowName.horizontalAlign = Label.HorizontalAlign.RIGHT;
    makeButton(row, t('account.rename'), 96, 50, { ...STYLE.secondary, fontSize: 22, radius: 14 }, () => openRename(root, opt), W / 2 - 88, 0);
    // The whole row is a tap target too.
    const rowBtn = row.addComponent(Button);
    rowBtn.transition = Button.Transition.NONE;
    row.on(Button.EventType.CLICK, () => openRename(root, opt));
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

/** Single-line name field; the background is a sibling Graphics since EditBox owns a Sprite. */
function makeNameInput(parent: Node, w: number, h: number, x: number, y: number, value: string): EditBox {
    const bg = makeNode('NameBg', parent, w, h, x, y).addComponent(Graphics);
    roundRect(bg, w, h, 14, hex('#0b1024'), hex('#8fa6ff', 200), 2);
    const node = makeNode('NameInput', parent, w - 16, h, x, y);
    // Configure while inactive: the web implementation picks <input> vs <textarea> in onLoad.
    node.active = false;
    const box = node.addComponent(EditBox);
    box.inputMode = EditBox.InputMode.SINGLE_LINE;
    box.inputFlag = EditBox.InputFlag.DEFAULT;
    box.returnType = EditBox.KeyboardReturnType.DONE;
    // Room for spaces the trim removes; validation enforces NAME_MAX.
    box.maxLength = NAME_MAX + 8;
    box.placeholder = t('rename.placeholder');
    for (const l of [box.textLabel, box.placeholderLabel]) {
        if (!l) continue;
        l.fontSize = 30;
        l.lineHeight = h;
    }
    box.textLabel!.color = Color.WHITE;
    box.placeholderLabel!.color = hex('#6f78a8');
    node.active = true;
    for (const l of [box.textLabel, box.placeholderLabel]) {
        if (!l) continue;
        const tr = l.node.getComponent(UITransform)!;
        tr.setAnchorPoint(0.5, 0.5);
        tr.setContentSize(w - 32, h);
        l.node.setPosition(0, 0);
        l.overflow = Label.Overflow.CLAMP;
        l.horizontalAlign = Label.HorizontalAlign.LEFT;
        l.verticalAlign = Label.VerticalAlign.CENTER;
    }
    box.string = value;
    return box;
}

/**
 * 「修改名稱」: only the name before 「#」 is editable, the tag stays. Errors show inside the
 * dialog; while saving the buttons are locked, and a failed save puts the old name back.
 */
function openRename(root: Node, opt: AccountPanelOptions): void {
    const svc = auth();
    const user = svc.user;
    if (!user) return;
    const w = 600;
    const h = 560;
    const modal = openModal(root, t('rename.title'), w, h);
    const p = modal.panel;

    makeLabel(p, t('rename.hint'), 21, hex('#c9d3ff'), { y: h / 2 - 160, lineHeight: 32 });
    const tag = `#${playerTag(user.uid)}`;
    const box = makeNameInput(p, 380, 76, -60, 30, user.name);
    leftAlign(makeLabel(p, tag, 30, hex('#9aa0bf'), { bold: true, y: 30 }), 150);
    const count = rightAlign(makeLabel(p, '', 22, hex('#9aa0bf'), { y: -38 }), 130);
    const error = makeLabel(p, '', 22, hex('#ff8a7a'), { y: -92, bold: true });

    const update = (): void => {
        const n = nameLength(normalizeName(box.string));
        count.string = t('rename.count', { n, max: NAME_MAX });
        count.color = n > NAME_MAX ? hex('#ff8a7a') : hex('#9aa0bf');
    };
    update();
    box.node.on(EditBox.EventType.TEXT_CHANGED, () => {
        error.string = '';
        update();
    });

    let busy = false;
    const save = makeButton(p, t('rename.save'), 220, 76, STYLE.primary, () => {
        if (busy) return;
        const check = validatePlayerName(box.string);
        if (!check.ok) {
            error.string = nameErrorText(check.error);
            return;
        }
        const wait = svc.renameWait();
        if (check.name !== user.name && wait > 0) {
            error.string = t('rename.tooSoon', { n: wait });
            return;
        }
        busy = true;
        error.string = '';
        save.label.string = t('rename.saving');
        box.enabled = false;
        void svc.rename(check.name).then((res) => {
            busy = false;
            if (!p.isValid) return;
            save.label.string = t('rename.save');
            box.enabled = true;
            if (res.ok) {
                modal.close();
                opt.toast(res.text);
                return;
            }
            // Nothing was saved: show why and put the current name back.
            error.string = res.text;
            box.string = svc.user?.name ?? user.name;
            update();
        });
    }, 125, -h / 2 + 76);
    save.label.fontSize = 32;
    makeButton(p, t('rename.cancel'), 220, 76, STYLE.secondary, () => {
        if (!busy) modal.close();
    }, -125, -h / 2 + 76);
    box.node.on(EditBox.EventType.EDITING_RETURN, () => {
        // Enter / 完成 on the keyboard saves too.
        save.node.emit(Button.EventType.CLICK);
    });
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
