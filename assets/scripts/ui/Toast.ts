import { Color, Graphics, Label, Node, Tween, UIOpacity, UITransform, tween } from 'cc';
import { hex, makeLabel, makeNode, roundRect } from './UiKit';

/** One short message at a time near the bottom of the screen; a new one replaces the old. */
export class Toast {
    private readonly node: Node;
    private readonly bg: Graphics;
    private readonly label: Label;
    private readonly opacity: UIOpacity;

    constructor(root: Node, y = -470) {
        this.node = makeNode('Toast', root, 0, 0, 0, y);
        this.bg = this.node.addComponent(Graphics);
        this.label = makeLabel(this.node, '', 30, Color.WHITE, { bold: true });
        this.opacity = this.node.addComponent(UIOpacity);
        this.opacity.opacity = 0;
    }

    show(text: string, seconds = 1.6): void {
        // Keep the toast above panels opened after it was created.
        this.node.setSiblingIndex(this.node.parent!.children.length - 1);
        this.label.string = text;
        this.label.updateRenderData(true);
        const w = Math.max(220, this.label.node.getComponent(UITransform)!.width + 64);
        this.bg.clear();
        roundRect(this.bg, w, 72, 36, hex('#0b1024', 230), hex('#ffc94a', 230), 2);

        Tween.stopAllByTarget(this.opacity);
        this.opacity.opacity = 255;
        tween(this.opacity).delay(seconds).to(0.3, { opacity: 0 }).start();
    }

    /** Dismiss right away, e.g. when the panel it belonged to closes. */
    hide(): void {
        Tween.stopAllByTarget(this.opacity);
        this.opacity.opacity = 0;
    }
}
