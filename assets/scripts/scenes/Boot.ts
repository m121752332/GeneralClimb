import { _decorator, Color, Component, director, Graphics, Label, Node, UITransform } from 'cc';
import { LevelLoader } from '../config/LevelLoader';
import type { LevelConfig } from '../config/LevelConfig';
import { type BootSnapshot, type BootStage, STAGE_MARK, describeWeather, runStages } from '../core/BootStages';
import { formatBest, readLocalBest } from '../core/LocalBest';
import { applyScreenFit } from '../core/ScreenFit';
import { AudioEngine } from '../core/Audio';
import { settings } from '../core/Settings';
import { STYLE, hex, loadBrandIcon, makeButton, makeLabel, makeNode, roundRect } from '../ui/UiKit';
import { buildBackdrop } from './HomeBackdrop';

const { ccclass } = _decorator;

const HOME_SCENE = 'Home';
/** UI timing, not gameplay values: how long each stage stays readable, and the pause before Home. */
const MIN_STAGE_MS = 250;
const DONE_HOLD_SEC = 0.5;

const BAR_W = 560;
const BAR_H = 28;
const ROW_H = 58;

const STATE_COLOR = {
    waiting: hex('#7f88b8'),
    loading: hex('#ffc94a'),
    done: hex('#5fe39a'),
    failed: hex('#ff6a5a'),
};

/** Staged loading screen: shows every stage's progress, then loads Home. Errors stay on screen with a retry. */
@ccclass('Boot')
export class Boot extends Component {
    private bar!: Graphics;
    private percent!: Label;
    private currentLabel!: Label;
    private rows: { mark: Label; title: Label; detail: Label }[] = [];
    private retry: Node | null = null;
    private config: LevelConfig | null = null;

    start(): void {
        applyScreenFit();
        buildBackdrop(this.node);
        this.buildUi();
        void this.run();
    }

    private stages(): BootStage[] {
        return [
            {
                title: '讀取遊戲設定',
                run: async () => {
                    const cfg = await LevelLoader.load();
                    this.config = cfg;
                    return `levels.json v${cfg.version} OK · ${cfg.levels.length} 關`;
                },
            },
            {
                title: '載入帳號',
                run: async () => {
                    settings();
                    let storage: Storage | null = null;
                    try { storage = globalThis.localStorage ?? null; } catch { storage = null; }
                    return `訪客模式 · ${formatBest(readLocalBest(storage)).replace('最佳紀錄：', '最佳 ')}`;
                },
            },
            {
                title: '天氣系統',
                run: async () => describeWeather(this.config!),
            },
            {
                title: 'NPC 載入',
                run: async () => '窗內 NPC：M2 開放',
            },
            {
                title: '音效',
                run: async () => {
                    const s = settings().get();
                    if (!AudioEngine.supported) return '此瀏覽器不支援音效';
                    return `合成音效 · 音量 ${Math.round(s.volume * 100)}%${s.muted ? '（靜音）' : ''}`;
                },
            },
            {
                title: '場景渲染',
                run: async (ctx) => {
                    // The logo is preloaded with the scene so Home draws it on its first frame.
                    // A missing logo is cosmetic: Home loads it again, so it does not fail Boot.
                    const icon = loadBrandIcon().then(() => true, (err: unknown) => {
                        console.warn('GCR icon not preloaded', err);
                        return false;
                    });
                    await new Promise<void>((resolve, reject) => {
                        director.preloadScene(HOME_SCENE, (done, total) => {
                            if (total > 0) ctx.report(done / total);
                        }, (err) => (err ? reject(err) : resolve()));
                    });
                    return (await icon) ? '主畫面與圖示就緒' : '主畫面就緒（圖示稍後載入）';
                },
            },
        ];
    }

    private async run(): Promise<void> {
        this.retry?.destroy();
        this.retry = null;
        const result = await runStages(this.stages(), (s) => this.render(s), { minStageMs: MIN_STAGE_MS });
        const summary = this.rows.map((r) => `${r.mark.string} ${r.title.string} ${r.detail.string}`).join('\n');
        if (result.ok) {
            this.currentLabel.string = '載入完成';
            // tools/smoke-site.mjs reads this, since the labels are gone once Home loads.
            (globalThis as { __GC_BOOT?: string }).__GC_BOOT = summary;
            this.scheduleOnce(() => director.loadScene(HOME_SCENE), DONE_HOLD_SEC);
            return;
        }
        console.error(result.error);
        const title = this.rows[result.failedIndex ?? 0].title.string;
        this.currentLabel.color = STATE_COLOR.failed;
        this.currentLabel.string = `${title} 載入失敗`;
        (globalThis as { __GC_BOOT?: string }).__GC_BOOT = `${title} 載入失敗\n${summary}`;
        this.retry = makeButton(this.node, '重試', 240, 84, STYLE.primary, () => {
            this.currentLabel.color = Color.WHITE;
            void this.run();
        }, 0, -470).node;
    }

    private buildUi(): void {
        const panelH = 230 + this.stages().length * ROW_H;
        const panel = makeNode('LoadingPanel', this.node, 640, panelH, 0, -20);
        roundRect(panel.addComponent(Graphics), 640, panelH, 28, hex('#0b1024', 225), hex('#8fa6ff', 180), 2);

        makeLabel(this.node, '霍將軍爬101大樓', 60, Color.WHITE, {
            y: panelH / 2 + 90, bold: true, outline: hex('#2a0d3a'), outlineWidth: 5, shadow: hex('#ff5a3c', 200),
        });

        const top = panelH / 2;
        this.currentLabel = makeLabel(panel, '準備中…', 30, Color.WHITE, { y: top - 50, bold: true });
        const barNode = makeNode('Bar', panel, BAR_W, BAR_H, 0, top - 105);
        this.bar = barNode.addComponent(Graphics);
        this.percent = makeLabel(panel, '0%', 26, hex('#ffc94a'), { y: top - 150, bold: true });

        const x0 = -BAR_W / 2;
        this.stages().forEach((stage, i) => {
            const y = top - 210 - i * ROW_H;
            const left = (l: Label): Label => {
                l.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
                return l;
            };
            this.rows.push({
                mark: makeLabel(panel, STAGE_MARK.waiting, 30, STATE_COLOR.waiting, { x: x0 + 14, y, bold: true }),
                title: left(makeLabel(panel, stage.title, 28, hex('#e8ecff'), { x: x0 + 44, y, bold: true })),
                detail: left(makeLabel(panel, '', 21, hex('#9aa6d8'), { x: x0 + 236, y })),
            });
        });
        this.drawBar(0);
    }

    private drawBar(p: number): void {
        const g = this.bar;
        g.clear();
        roundRect(g, BAR_W, BAR_H, BAR_H / 2, hex('#26305e'), hex('#8fa6ff', 160), 2);
        if (p > 0) {
            g.roundRect(-BAR_W / 2 + 3, -BAR_H / 2 + 3, Math.max(BAR_H - 6, (BAR_W - 6) * p), BAR_H - 6, (BAR_H - 6) / 2);
            g.fillColor = hex('#ff7a45');
            g.fill();
        }
    }

    private render(s: BootSnapshot): void {
        this.drawBar(s.progress);
        this.percent.string = `${Math.round(s.progress * 100)}%`;
        s.stages.forEach((st, i) => {
            const row = this.rows[i];
            row.mark.string = STAGE_MARK[st.state];
            row.mark.color = STATE_COLOR[st.state];
            const detail = st.state === 'loading' ? '載入中…' : st.detail;
            row.detail.string = detail.length > 26 ? `${detail.slice(0, 25)}…` : detail;
            row.detail.color = st.state === 'failed' ? STATE_COLOR.failed : hex('#9aa6d8');
        });
        const cur = s.stages[s.current];
        if (cur) this.currentLabel.string = cur.state === 'failed' ? `${cur.title} 載入失敗` : `${cur.title}…`;
    }
}
