import {
    _decorator, BlockInputEvents, Color, Component, EventKeyboard, Graphics, Input, Node, UIOpacity, input,
} from 'cc';
import { lang, t } from '../core/I18n';
import { INTRO_SEC, SKIP_GRACE_SEC, introFrame } from '../core/Cutscene';
import { buildBackdrop } from '../scenes/HomeBackdrop';
import { hex, makeLabel, makeNode, roundRect } from './UiKit';

const { ccclass } = _decorator;

/**
 * Opening (GDD §7, ADR-07): an original illustration, the red-robed climber seen from behind
 * on a rooftop, looking up at the tower over the city skyline. It slowly zooms in for
 * INTRO_SEC and fades into Home, which has the same skyline behind it. Tap or any key skips.
 */

/** Zoom towards the tower's lower trunk, so the push reads as "heading for the base". */
const PIVOT_Y = -260;
const CLIMBER_X = -150;
const CLIMBER_Y = -600;
const CLIMBER_SCALE = 1.25;

const ROBE = hex('#d62c2c');
const ROBE_DARK = hex('#a01c1c');
const CAPE = hex('#b52020');
const TROUSERS = hex('#2a1418');
const SKIN = hex('#f0c090');
const HAIR = hex('#1c1416');
const GOLD = hex('#ffc94a');

function poly(g: Graphics, pts: number[], fill: Color): void {
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.close();
    g.fillColor = fill;
    g.fill();
}

/** Rooftop ledge in the foreground, wider than any screen. */
function drawRooftop(parent: Node): void {
    const g = makeNode('Rooftop', parent).addComponent(Graphics);
    poly(g, [-1400, CLIMBER_Y + 6, 1400, CLIMBER_Y + 6, 1400, -1700, -1400, -1700], hex('#0a0816'));
    g.fillColor = hex('#2a2550');
    g.rect(-1400, CLIMBER_Y - 4, 2800, 12);
    g.fill();
    // Parapet posts and a warning light on the corner.
    for (let x = -1380; x < 1400; x += 120) {
        g.fillColor = hex('#16132e');
        g.rect(x, CLIMBER_Y - 70, 14, 70);
        g.fill();
    }
    g.circle(260, CLIMBER_Y + 18, 7);
    g.fillColor = hex('#ff4a4a');
    g.fill();
}

/** The climber from behind (ADR-08: original, no logo, no face): short hair, robe, cape, one hand shading the eyes. */
function drawClimber(parent: Node): Node {
    const node = makeNode('Climber', parent, 0, 0, CLIMBER_X, CLIMBER_Y);
    node.setScale(CLIMBER_SCALE, CLIMBER_SCALE);
    const g = node.addComponent(Graphics);
    // Legs.
    g.fillColor = TROUSERS;
    g.roundRect(-30, 0, 24, 80, 8);
    g.roundRect(6, 0, 24, 80, 8);
    g.fill();
    g.fillColor = hex('#120a0c');
    g.roundRect(-34, -4, 30, 14, 6);
    g.roundRect(4, -4, 30, 14, 6);
    g.fill();
    // Robe.
    poly(g, [-52, 66, 52, 66, 40, 196, -40, 196], ROBE);
    // Hanging left arm.
    g.fillColor = ROBE_DARK;
    g.roundRect(-62, 104, 22, 92, 10);
    g.fill();
    g.circle(-51, 100, 11);
    g.fillColor = SKIN;
    g.fill();
    // Raised right arm, hand shading the eyes.
    g.lineCap = Graphics.LineCap.ROUND;
    g.lineJoin = Graphics.LineJoin.ROUND;
    g.lineWidth = 20;
    g.strokeColor = ROBE_DARK;
    g.moveTo(38, 186);
    g.lineTo(66, 236);
    g.lineTo(30, 262);
    g.stroke();
    g.circle(24, 264, 11);
    g.fillColor = SKIN;
    g.fill();
    // Cape over the back, flaring out at the hem.
    poly(g, [-40, 200, 40, 200, 70, 60, 46, 50, 20, 62, -8, 48, -36, 60, -66, 52], CAPE);
    g.lineWidth = 3;
    g.strokeColor = ROBE_DARK;
    g.moveTo(-12, 190); g.lineTo(-22, 70);
    g.moveTo(14, 190); g.lineTo(26, 72);
    g.stroke();
    // Gold collar.
    g.fillColor = GOLD;
    g.roundRect(-34, 194, 68, 10, 5);
    g.fill();
    // Head from behind: ears, short hair.
    g.fillColor = SKIN;
    g.circle(-28, 232, 7);
    g.circle(28, 232, 7);
    g.fill();
    g.circle(0, 236, 29);
    g.fillColor = HAIR;
    g.fill();
    g.fillColor = hex('#3a2a2e');
    g.roundRect(-10, 254, 6, 10, 3);
    g.roundRect(6, 256, 6, 9, 3);
    g.fill();
    return node;
}

@ccclass('IntroPlayer')
class IntroPlayer extends Component {
    private t = 0;
    private art!: Node;
    private opacity!: UIOpacity;
    private hint!: Node;
    private onDone: (() => void) | null = null;

    setup(art: Node, opacity: UIOpacity, hint: Node, onDone: () => void): void {
        this.art = art;
        this.opacity = opacity;
        this.hint = hint;
        this.onDone = onDone;
        input.on(Input.EventType.KEY_DOWN, this.onKey, this);
        this.node.on(Node.EventType.TOUCH_END, this.skip, this);
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKey, this);
    }

    private onKey(_e: EventKeyboard): void {
        this.skip();
    }

    private skip(): void {
        if (this.t < SKIP_GRACE_SEC) return;
        this.finish();
    }

    private finish(): void {
        if (!this.onDone) return;
        const done = this.onDone;
        this.onDone = null;
        this.node.destroy();
        done();
    }

    update(dt: number): void {
        this.t += dt;
        const f = introFrame(this.t);
        this.art.setScale(f.scale, f.scale);
        // Scale about (0, PIVOT_Y) instead of the centre.
        this.art.setPosition(0, PIVOT_Y * (1 - f.scale));
        this.opacity.opacity = Math.round(255 * f.opacity);
        this.hint.active = this.t >= SKIP_GRACE_SEC && this.t < INTRO_SEC - 0.5;
        if (f.done) this.finish();
    }
}

/**
 * Covers `root` with the opening and blocks input to what is underneath until it ends or is
 * skipped; then calls `onDone`.
 */
export function playIntro(root: Node, onDone: () => void): void {
    const overlay = makeNode('Intro', root, 4000, 4000);
    overlay.addComponent(BlockInputEvents);
    const opacity = overlay.addComponent(UIOpacity);
    const art = makeNode('Art', overlay);
    buildBackdrop(art);
    drawRooftop(art);
    drawClimber(art);

    makeLabel(overlay, t('intro.tagline'), 40, Color.WHITE, {
        y: 470, bold: true, outline: hex('#2a0d3a'), outlineWidth: 4, shadow: hex('#ff5a3c', 200),
    });
    // Bottom right, clear of the climber, on a dark pill so it reads over the rooftop.
    const pill = makeNode('SkipHint', overlay, 0, 0, 175, -575);
    roundRect(pill.addComponent(Graphics), 320, 52, 26, hex('#0b1024', 200), hex('#8fa6ff', 160), 2);
    makeLabel(pill, t('common.skip'), lang() === 'en' ? 20 : 24, hex('#e8ecff'), { y: 1 });
    pill.active = false;
    overlay.addComponent(IntroPlayer).setup(art, opacity, pill, onDone);
}
