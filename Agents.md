# Agents.md — 霍將軍爬101大樓（GeneralClimb）

## 溝通
- 一律用**繁體中文**回覆；程式碼、識別字、commit 訊息用英文。
- 使用者是資深開發者（Java / TypeScript / Vue 3 / Oracle），說明直接、不必解釋基礎概念。

## 專案是什麼
垂直攀爬動作遊戲：紅衣攀爬者從台北 101 的 1F 徒手爬到塔尖，共 14 關。攀爬關卡是 3D（ADR-10）：以 101 為中心、四面環繞攀爬，鏡頭繞塔軸 360° 旋轉；Boot、Home 仍是 2D UI。
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
│  ├─ scenes/       Boot.scene（建置的起始場景）→ Home.scene（主畫面）
│  ├─ scripts/      config/（LevelConfig 驗證、LevelLoader）、core/（ScreenFit、GameSession、Settings、LocalBest、BootStages）、scenes/（Boot、Home、HomeBackdrop）、ui/（UiKit、Toast、面板）
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
目前做出 Boot（分段載入畫面：遊戲設定、帳號、天氣系統、NPC、音效、場景渲染，全部完成才進 Home；失敗可重試）與 Home（主畫面：開始遊戲、選擇關卡、練習模式、設定、Google 登入、最佳紀錄；UI 由程式建立，見 `assets/scripts/ui/`），以下為規劃。
金手指（設定頁）：`RUNGM` 開啟、`STOPGM` 關閉開發人員模式（`Settings.devMode` → `GameSession.devMode`），開啟時選關可選任一樓層關（尖塔 13–14 關仍鎖）；解析在 `core/CheatCodes.ts`、可選關卡規則在 `core/LevelAccess.ts`。開發人員模式在關卡左上有爬樓變速（`levels.json` 的 `dev.climbSpeeds`：×1／×1.5／×2／×3／×5，點擊或按 V 切換，存在 `Settings.devSpeed`），一般玩家固定 ×1。
音效與 BGM（M4）：`core/Audio.ts` 用 Web Audio 即時合成（原創、無音檔），音效表 `SOUNDS`、曲子 `TRACKS`；`core/Sound.ts` 的 `sound()` 是共用引擎，跟著設定的音量／靜音。瀏覽器要等第一次點擊或按鍵才會出聲。
窗內 NPC（M2）：`climb/CrowdPlan.ts`（純 TS：每關固定的窗位、種類、反應）＋`scenes/WindowCrowd.ts`（身體合成一個 mesh，只有手臂是節點）；只放在安全欄、整層無障礙的窗，尖塔不放。攀爬者靠近時揮手或拍照，有危險或墜落時擔心。共用網格工具在 `scenes/MeshKit.ts`。
練習模式（GDD §7）：主頁「練習模式」→ `GameSession.mode = 'practice'` → 同一個 Climb 場景。`ClimbCore.practiceLevel()` 產生三層樓平房關（`levels.json` 的 `practice`：樓層數、牆寬、`demoEvents`、`demoAt`、`intensity`），`demoRows()` 把 `demoAt`（房子高度的比例）換成觸發列（各一次、依序），示範還沒跑完前屋頂那一步會被擋住；練習時不跑計時事件，事件長度取 `durationSec` 最小值，`intensity` 只放寬懲罰（強風推移間隔、強風風險、雨天容許時間、老鷹發現時間 ÷ 或 × intensity）。`Tower3D` 傳入樓層數就改畫平房（屋頂女兒牆、樓梯間、水塔，遠方天際線有 101）。墜落回地面再練、登頂顯示「練習完成」，不寫任何紀錄。網址加 `?practice=1` 可直接進練習。
關卡中的「退出」（回主畫面，按 X 也可）只在該關起點（第 0 列）、暫停、墜落或結算畫面出現。
Scenes：Boot → Home（登入／開始遊戲／練習模式）→ Intro → Climb → Transition → Fall → Victory；Practice（三層樓平房）
Components：InputController、RiskSystem、EventScheduler、WeatherSystem、EagleSystem、WindowCrowd、LevelLoader、AuthService

## Cocos 專案位置與指令
- **repo 根目錄就是 Cocos Creator 3.8.8 專案**（不是 `game/` 子資料夾）。在 Cocos Dashboard 用「匯入」選 `D:\GITLocal\GeneralClimb`，不要用「新建」（會多一層資料夾）。
- 設計解析度 720 × 1280；`assets/scripts/core/ScreenFit.ts` 依螢幕比例切換 FIXED_WIDTH / FIXED_HEIGHT。
- 功能裁剪（`settings/v2/packages/engine.json`）：2D 模組加上 `3d`（MeshRenderer、程式產生網格）；要用物理、Spine、TiledMap、RichText 等再打開。3D 一律用頂點色 unlit 材質 `resources/materials/vertex-color.mtl`。
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
