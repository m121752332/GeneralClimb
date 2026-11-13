import { _decorator, Color, Component, Label, Node } from 'cc';
import { LevelLoader } from '../config/LevelLoader';
import { applyScreenFit } from '../core/ScreenFit';

const { ccclass } = _decorator;

/** M0 boot scene: fit the screen, load levels.json, show the result. */
@ccclass('Boot')
export class Boot extends Component {
    start(): void {
        applyScreenFit();
        const status = this.createStatusLabel();
        status.string = '霍將軍爬101大樓\n載入中…';

        LevelLoader.load().then((cfg) => {
            status.string = `霍將軍爬101大樓\nlevels.json v${cfg.version} OK\n${cfg.levels.length} 關`;
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
