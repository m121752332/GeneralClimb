import { Color, EditBox, Graphics, Label, Node, Slider, Sprite, UITransform } from 'cc';
import { parseCheat } from '../core/CheatCodes';
import { t } from '../core/I18n';
import { settings } from '../core/Settings';
import { STYLE, hex, makeButton, makeLabel, makeNode, makeSwitch, openModal, roundRect } from './UiKit';

const W = 600;
const H = 800;
const TRACK_W = 300;

export interface SettingsPanelHooks {
    /** Any setting changed (sound icon, GM badge, GameSession.devMode). */
    onChange: () => void;
    toast: (text: string) => void;
    /** The panel is closing; Home dismisses any toast it raised. */
    onClose?: () => void;
}

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

function leftAlign(l: Label): Label {
    l.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    return l;
}

/** Text field for 金手指 codes; the background is a sibling Graphics since EditBox owns a Sprite. */
function makeCheatInput(parent: Node, w: number, h: number, x: number, y: number): EditBox {
    const bg = makeNode('CheatBg', parent, w, h, x, y).addComponent(Graphics);
    roundRect(bg, w, h, 14, hex('#0b1024'), hex('#8fa6ff', 200), 2);
    const node = makeNode('CheatInput', parent, w - 16, h, x, y);
    // Configure while inactive: the web implementation creates its DOM element (input vs textarea)
    // in onLoad from inputMode, so SINGLE_LINE must be set before the node activates.
    node.active = false;
    const box = node.addComponent(EditBox);
    box.inputMode = EditBox.InputMode.SINGLE_LINE;
    box.inputFlag = EditBox.InputFlag.INITIAL_CAPS_ALL_CHARACTERS;
    box.returnType = EditBox.KeyboardReturnType.DONE;
    box.maxLength = 16;
    box.placeholder = t('settings.cheatPlaceholder');
    for (const l of [box.textLabel, box.placeholderLabel]) {
        if (!l) continue;
        l.fontSize = 28;
        l.lineHeight = h;
        l.verticalAlign = Label.VerticalAlign.CENTER;
    }
    box.textLabel!.color = Color.WHITE;
    box.placeholderLabel!.color = hex('#6f78a8');
    // Codes are always shown in uppercase, whatever the keyboard / IME inserts.
    node.on(EditBox.EventType.TEXT_CHANGED, (b: EditBox) => uppercaseInPlace(b));
    node.active = true;
    // EditBox sizes its text label but leaves the placeholder at 0 × 0 when built from code;
    // give both labels the box's area, centered, so they line up.
    for (const l of [box.textLabel, box.placeholderLabel]) {
        if (!l) continue;
        const t = l.node.getComponent(UITransform)!;
        t.setAnchorPoint(0.5, 0.5);
        t.setContentSize(w - 24, h);
        l.node.setPosition(0, 0);
        l.overflow = Label.Overflow.CLAMP;
        l.horizontalAlign = Label.HorizontalAlign.CENTER;
        l.verticalAlign = Label.VerticalAlign.CENTER;
    }
    return box;
}

/**
 * INITIAL_CAPS_ALL_CHARACTERS only applies CSS text-transform on web, so the value itself stays
 * lowercase. Convert the value, and on web also the focused <input>, keeping the caret position.
 * Skipped while an IME composition is in progress; the engine fires TEXT_CHANGED again after it ends.
 */
function uppercaseInPlace(box: EditBox): void {
    const upper = box.string.toUpperCase();
    const doc = (globalThis as { document?: Document }).document;
    const el = doc?.activeElement as HTMLInputElement | HTMLTextAreaElement | null | undefined;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.value !== upper && el.value.toUpperCase() === upper) {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        el.value = upper; // same length, so the caret offsets stay valid
        if (start !== null && end !== null) el.setSelectionRange(start, end);
    }
    if (box.string !== upper) box.string = upper;
}

export function openSettings(root: Node, hooks: SettingsPanelHooks): void {
    const modal = openModal(root, t('settings.title'), W, H, hooks.onClose);
    const p = modal.panel;
    const s = settings().get();
    const labelX = -W / 2 + 56;
    const rowLabel = (text: string, y: number): Label => leftAlign(makeLabel(p, text, 32, Color.WHITE, { x: labelX, y, bold: true }));

    const yVol = H / 2 - 160;
    rowLabel(t('settings.volume'), yVol);
    const pct = makeLabel(p, `${Math.round(s.volume * 100)}%`, 28, hex('#ffc94a'), { x: W / 2 - 70, y: yVol, bold: true });
    makeVolumeSlider(p, s.volume, 30, yVol, (v) => {
        settings().set({ volume: v });
        pct.string = `${Math.round(v * 100)}%`;
        hooks.onChange();
    });

    const yVib = yVol - 100;
    rowLabel(t('settings.vibration'), yVib);
    makeSwitch(p, s.vibration, (v) => { settings().set({ vibration: v }); hooks.onChange(); }, W / 2 - 110, yVib);

    const yFlash = yVib - 100;
    rowLabel(t('settings.flash'), yFlash);
    makeSwitch(p, s.flashEffects, (v) => { settings().set({ flashEffects: v }); hooks.onChange(); }, W / 2 - 110, yFlash);
    leftAlign(makeLabel(p, t('settings.flashHint'), 20, hex('#9aa6d8'), { x: labelX, y: yFlash - 44 }));

    // 金手指: cheat code input + developer-mode status.
    const yCheat = yFlash - 130;
    const divider = makeNode('Divider', p, 0, 0, 0, yCheat + 58).addComponent(Graphics);
    divider.rect(-W / 2 + 40, 0, W - 80, 2);
    divider.fillColor = hex('#8fa6ff', 70);
    divider.fill();
    rowLabel(t('settings.cheat'), yCheat);
    const input = makeCheatInput(p, 220, 64, 10, yCheat);

    const yStatus = yCheat - 80;
    const status = makeNode('DevStatus', p, 0, 0, 0, yStatus);
    const statusLabel = leftAlign(makeLabel(status, t('settings.devOn'), 26, hex('#5fe39a'), { x: labelX, bold: true }));
    statusLabel.node.setPosition(labelX, 0);
    makeButton(status, t('settings.devOff'), 120, 56, { ...STYLE.secondary, fontSize: 26, radius: 16 }, () => setDevMode(false), W / 2 - 110, 0);

    const refreshStatus = (): void => {
        status.active = settings().get().devMode;
    };
    const setDevMode = (on: boolean): void => {
        settings().set({ devMode: on });
        refreshStatus();
        hooks.onChange();
        hooks.toast(t(on ? 'settings.devOnToast' : 'settings.devOffToast'));
    };
    const submit = (): void => {
        const action = parseCheat(input.string);
        if (action === 'empty') return;
        if (action === 'devModeOn') setDevMode(true);
        else if (action === 'devModeOff') setDevMode(false);
        else hooks.toast(t('settings.badCode'));
        input.string = '';
    };
    makeButton(p, t('settings.enter'), 120, 64, { ...STYLE.gold, fontSize: 28 }, submit, W / 2 - 110, yCheat);
    input.node.on(EditBox.EventType.EDITING_RETURN, submit);
    refreshStatus();

    makeButton(p, t('settings.done'), 240, 80, STYLE.primary, modal.close, 0, -H / 2 + 70).label.fontSize = 34;
}
