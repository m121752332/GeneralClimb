# Agents.md — 霍將軍爬101大樓（GeneralClimb）

## 溝通
- 一律用**繁體中文**回覆；程式碼、識別字、commit 訊息用英文。
- 使用者是資深開發者（Java / TypeScript / Vue 3 / Oracle），說明直接、不必解釋基礎概念。

## 專案是什麼
2D 垂直攀爬動作遊戲：紅衣攀爬者從台北 101 的 1F 徒手爬到塔尖，共 14 關。
遇到強風、下雨、老鷹要停下來（放開方向鍵＝抓牢），墜落一律回 1F 重來。

**權威文件（動手前先讀）**
- `docs/ADR.md` — 已接受的架構決策（2026-11-13）。**不要自行推翻 ADR 的決策**；需要改就先提出並更新 ADR。
- `docs/GDD.md` — 遊戲設計細節與數值。
- `docs/flowchart.html` — 整局流程圖與 14 關進度塔（用瀏覽器開）。

## 技術選型（ADR-01、ADR-09）
- 引擎：**Cocos Creator 3.8 LTS + TypeScript**
- 平台：先 Web Mobile / Web Desktop（手機與電腦瀏覽器）；Android / iOS 原生打包後期再決定
- 登入：Firebase Authentication（Google，**一律用 `signInWithPopup`，不用 redirect**）
- 資料：Firestore（`players/{uid}`、`players/{uid}/runs/{runId}`、`best/{uid}`）
- 部署：GitHub Pages（GitHub Actions）

## 目錄結構
```
GeneralClimb/
├─ CLAUDE.md        只匯入 Agents.md
├─ Agents.md        專案指引（本檔）
├─ README.md
├─ docs/            ADR.md、GDD.md、flowchart.html
├─ config/          levels.json（種子副本）、firestore.rules、firestore.indexes.json
├─ package.json     Cocos 專案資訊 + npm scripts（test / sync:levels / build:web / publish:site / serve / smoke）
├─ assets/          Cocos 專案內容
│  ├─ scenes/       Boot.scene（目前唯一場景，建置的起始場景）
│  ├─ scripts/      config/（LevelConfig 驗證、LevelLoader）、core/（ScreenFit）、scenes/（Boot）
│  └─ resources/config/levels.json   遊戲實際載入的數值檔
├─ settings/        Cocos 專案設定（設計解析度、功能裁剪）
├─ tests/           node --test 單元測試（只測不依賴 cc 的純 TS）
├─ tools/           build-web.mjs、publish-site.mjs、site-icons.mjs、serve.mjs、smoke-site.mjs、sync-levels.mjs、build-web-mobile.json
├─ site/            Web Mobile 建置輸出，push 後由 Actions 發布到 Pages
├─ build-templates/web-mobile/  favicon、apple-touch-icon（Cocos 建置時複製到輸出根目錄）
├─ branding/        原始 Logo（gcr-icon.png）
├─ .claude/launch.json  本機預覽設定（serve build/web-mobile，port 8101）
└─ .github/workflows/  deploy-pages.yml（master 發布）、pr-check.yml（PR 檢查）
```
`library/`、`temp/`、`local/`、`build/` 是 Cocos 編輯器／建置產生的，已在 `.gitignore`，不要 commit。

## 開發規則
1. **數值不寫死**：所有可調數值（速度、風險、事件計時、關卡寬度、強風機率）只能在 `levels.json`。
   以 `assets/resources/config/levels.json` 為準，`config/levels.json` 只是種子副本，兩者保持一致（`npm test` 會檢查，`npm run sync:levels` 由種子覆蓋）。
2. **一次只有一個危機事件**（ADR-04）：事件進行中到期的事件排隊，前一個結束 4 秒後才觸發；強風判定撞到其他事件就跳過。
3. 計時只算「攀爬中」，過場、暫停、墜落動畫不計；墜落重來全部歸零。
4. 事件與機率一律用本局**種子亂數**，種子要寫進成績，方便重現。
5. Cocos 場景與 Prefab 是編輯器產生的 JSON：**同一場景同時只一人改**；邏輯盡量寫在 TS 元件。
6. 素材全部原創（ADR-08）：角色無品牌 Logo、臉部不仿真人；不得使用真人照片。
7. Firebase 設定（apiKey 等）可以進 repo；**服務帳戶金鑰、`.env` 絕對不可 commit**。

## 14 關結構（ADR-05，數值在 `levels.json`）
- 基座 3 關（1–26F）＋ 竹節 8 關（27–90F）＋ 頂部 1 關（91–101F）＋ 尖塔 2 關（爬梯）。
- 樓層關的 `floors` 寫成 `"1-8F"`，必須從 1F 起連續銜接；尖塔關寫 `spire-lower` / `spire-upper`，且排在樓層關之後。
- 每關列數由程式推導：樓層關 = 樓層數 × `player.rowsPerFloor`（12），尖塔關 = `player.ladderRows`（48）。
- 牆寬分 `wide / medium / mediumNarrow / narrow / xnarrow / ladder` 六種（`widths` 定義欄數、安全區、危險區）；強風機率 `windChance` 從第 1 關 0% 逐關升到 70%。
- 驗證邏輯在 `assets/scripts/config/LevelConfig.ts`（純 TS，不依賴 cc），`LevelLoader` 從 `resources/config/levels` 載入後交給它驗證。改結構時同步改 `tests/level-config.test.ts`。

## 主要元件（ADR-01、GDD）
目前只做出 Boot 場景（套用 ScreenFit、載入並顯示 levels.json 驗證結果），以下為規劃。
Scenes：Boot → Home（登入／開始遊戲／練習模式）→ Intro → Climb → Transition → Fall → Victory；Practice（三層樓平房）
Components：InputController、RiskSystem、EventScheduler、WeatherSystem、EagleSystem、WindowCrowd、LevelLoader、AuthService

## Cocos 專案位置與指令
- **repo 根目錄就是 Cocos Creator 3.8.8 專案**（不是 `game/` 子資料夾）。在 Cocos Dashboard 用「匯入」選 `D:\GITLocal\GeneralClimb`，不要用「新建」（會多一層資料夾）。
- 設計解析度 720 × 1280；`assets/scripts/core/ScreenFit.ts` 依螢幕比例切換 FIXED_WIDTH / FIXED_HEIGHT。
- 功能裁剪只留 2D 需要的模組（`settings/v2/packages/engine.json`）；要用物理、Spine、TiledMap、RichText 等再打開。
- 像素素材匯入後 Filter Mode 一律設 Nearest。
- `npm test`：`node --test` 跑 `tests/`，直接執行 `.ts`，需要 Node 22.18 以上（內建 type stripping）。
- `npm run sync:levels`：用 `config/levels.json` 覆蓋 `assets/resources/config/levels.json`。
- `npm run build:web`：用 Cocos Creator CLI 依 `tools/build-web-mobile.json` 建置到 `build/web-mobile`（直式、md5Cache）。**先關閉這個專案的編輯器**。編輯器路徑預設 `C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe`，可用環境變數 `COCOS_CREATOR` 覆蓋；CLI 成功的結束碼是 36，失敗看 `temp/builder/log`。
- `npm run serve`：本機預覽 `build/web-mobile`，http://localhost:8101（`node tools/serve.mjs site` 可改看 `site/`）。
- `npm run publish:site`：清空 `site/` 後複製 `build/web-mobile`（略過 `.runtime-bridge`），補齊網站圖示並在 `index.html` 插入 `<link>`（`tools/site-icons.mjs`）。
- `npm run smoke`：用無頭 Chromium 開 `site/`，確認 Boot 場景載入 levels.json（需先 `npm i --no-save playwright` 並 `npx playwright install chromium`）。

## 部署（GitHub Pages）
- 預設分支是 **`master`**。Pages Source 設為 GitHub Actions。
- `.github/workflows/deploy-pages.yml`：push 到 `master` 且有改到 `site/**` 或 workflow 本身才會發布；也可手動 `workflow_dispatch`。Actions 只上傳 `site/`，不在雲端建置。
- PR 到 master 會跑 `.github/workflows/pr-check.yml`（`npm test` + `npm run smoke`），驗證的是已提交的 `site/`。
- 發布流程：`npm test` → `npm run build:web` → `npm run serve` 本機確認 → `npm run publish:site` → commit `site/` → push `master`。
- 只改程式沒重建 `site/` 時，線上版本不會變。

## 下一步（M0 專案骨架）
1. ~~建立 Cocos 專案、LevelLoader、建置與發布腳本~~（完成）
2. ~~建 GitHub repo、啟用 Pages、Actions 從 `master` 發布~~（完成，2026-11-13 首次部署成功）。剩下：用手機開 Pages 網址確認 Boot 畫面顯示「14 關」。
3. 接著做 M1：第 1 關 + 第 6 關、攀爬／抓牢、風險值、三種事件與左上圖示、墜落重來（色塊素材）。

## 待確認
- GitHub Actions 無法在雲端跑 Cocos 編輯器建置，目前採「本機建置 → 提交 `site/` → Actions 發布」。若要全自動，需自架 runner。
- GDD 新增、ADR 未記載的設計：牆面障礙物（`obstaclesPer12Rows`）、每樓 12 列／每格 0.35 秒（`rowsPerFloor`、`cellSec`，已進 `levels.json`）、破關動畫第二次起可跳過。
