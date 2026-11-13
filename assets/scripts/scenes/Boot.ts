import { _decorator, Color, Component, director, Label, Node } from 'cc';
import { LevelLoader } from '../config/LevelLoader';
import { applyScreenFit } from '../core/ScreenFit';

const { ccclass } = _decorator;

const HOME_SCENE = 'Home';
/** How long the "levels.json vN OK" status stays up before Home loads. */
const SHOW_STATUS_SEC = 0.8;

/** Boot scene: fit the screen, load and validate levels.json, then go to Home. Errors stay on screen. */
@ccclass('Boot')
export class Boot extends Component {
    start(): void {
        applyScreenFit();
        const status = this.createStatusLabel();
        status.string = '霍將軍爬101大樓\n載入中…';

        LevelLoader.load().then((cfg) => {
            status.string = `霍將軍爬101大樓\nlevels.json v${cfg.version} OK\n${cfg.levels.length} 關\n載入完成`;
            // tools/smoke-site.mjs reads this, since the label is gone once Home loads.
            (globalThis as { __GC_BOOT?: string }).__GC_BOOT = status.string;
            this.scheduleOnce(() => director.loadScene(HOME_SCENE), SHOW_STATUS_SEC);
        }).catch((err: unknown) => {
            console.error(err);
            status.color = Color.RED;
            status.string = `levels.json 載入失敗\n${err instanceof Error ? err.message : String(err)}`;
        });
    }

    private createStatusLabel(): Label {
        const node = new Node('Status');
        node.layer = this.node.layer;
        node.parent = this.node;
        const label = node.addComponent(Label);
        label.fontSize = 40;
        label.lineHeight = 56;
        return label;
    }
}
