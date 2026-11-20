# 開發說明：霍將軍爬101大樓（GeneralClimb）

- 對象：接手的開發者。讀完這份就能知道每個畫面由哪些檔案負責、資料怎麼流、數值在哪裡、為什麼這樣設計。
- 依據：2026-11-20 的程式碼與 PR #1–#35 的歷史。現實攀爬時間倍率以 **×9.5** 為準（PR #35）。
- 搭配閱讀：`docs/ADR.md`（架構決策，**不要自行推翻**）、`docs/GDD.md`（設計數值）、`docs/CHANGELOG.md`（依 PR 的修改歷程）、`docs/firebase-setup.md`（Firebase 專案設定）、`Agents.md`（給 AI 代理的精簡規則）。
- 文件衝突時的優先順序：**程式碼與 `levels.json` > 本文件 > ADR > GDD**。GDD 部分章節停在 2D 時期，已在本次更新標註。

## 目錄

0. [總覽：架構、目錄、開發流程](#0-總覽)
1. [遊戲啟動：Boot 分段載入](#1-遊戲啟動boot-分段載入)
2. [主畫面：Home](#2-主畫面home)
3. [遊戲開始：開場、過場、解鎖與周目](#3-遊戲開始開場過場解鎖與周目)
4. [關卡內容：Climb](#4-關卡內容climb)
5. [爬完結束：尖塔段、登頂動畫、紀錄與排行榜寫入](#5-爬完結束尖塔段登頂動畫紀錄與排行榜寫入)
6. [練習模式](#6-練習模式)
7. [附錄：localStorage、Firestore、測試、常見陷阱](#7-附錄)

---

## 0. 總覽

### 0.1 一句話

紅衣攀爬者從台北 101 的 1F 徒手爬到塔尖，共 14 關。核心技巧是「該停就停」：放開方向鍵就是抓牢；遇到強風、下雨、老鷹要停下；任何一次墜落都回 1F 重來（ADR-06）。

### 0.2 技術選型（ADR-01、ADR-09、ADR-10）

| 項目 | 選擇 |
| --- | --- |
| 引擎 | Cocos Creator **3.8.8** + TypeScript（repo 根目錄就是 Cocos 專案） |
| 畫面 | 攀爬關卡 3D（程式產生的低多邊形網格，頂點色 unlit 材質）；Boot、Home 的 UI 是 2D，Home 背景是 3D |
| 平台 | Web Mobile / Web Desktop；原生 App 後期再定 |
| 登入／雲端 | Firebase Authentication（Google，`signInWithPopup`）＋ Firestore |
| 部署 | GitHub Pages：本機建置 → 提交 `site/` → push `master` → Actions 發布 |
| 音效 | Web Audio 即時合成，沒有任何音檔 |

### 0.3 程式分層

```
assets/scripts/
├─ config/   LevelConfig.ts（levels.json 驗證與推導，純 TS）、LevelLoader.ts（cc 載入）
├─ core/     不依賴 cc 的共用邏輯：Session、Settings、Progress、I18n、Auth、時間格式…
├─ climb/    不依賴 cc 的遊戲規則與幾何：ClimbCore（規則）、*Shape.ts（網格資料）、CrowdPlan
├─ scenes/   cc 元件：Boot、Home、Climb，以及 3D 繪製（Tower3D、Basin3D、Atmosphere3D…）
└─ ui/       cc UI：UiKit（按鈕／標籤工具）、各種面板、Toast、IntroOverlay
```

**最重要的慣例：規則寫在純 TS，cc 元件只負責輸入、繪製、流程。** `climb/`、`core/`、`config/LevelConfig.ts` 都不 import `cc`，可以直接用 `node --test` 測試（`tests/` 有 27 個測試檔）。改規則時先改純 TS 和測試，再接到場景。

### 0.4 場景與資料流

```mermaid
flowchart LR
  Boot["Boot.scene\n分段載入"] --> Home["Home.scene\n主畫面＋開場插畫"]
  Home -- "GameSession.levelIndex / mode / pushIn" --> Climb["Climb.scene\n攀爬、過場、墜落、登頂"]
  Climb -- "退出 / X" --> Home
  Climb -- "Progress / LocalBest" --> LS[(localStorage)]
  Climb -- "auth().syncSummits" --> FS[(Firestore summits/{uid})]
  Home -- "leaderboard / fastestRuns" --> FS
```

- 實際只有三個場景：`Boot`、`Home`、`Climb`（`tools/build-web-mobile.json` 的 scenes 清單，startScene 是 Boot）。ADR 裡的 Intro、Transition、Fall、Victory、Practice 都是 `Climb.ts` 內部的 **mode**，或 Home 上的疊層，不是獨立場景。
- 場景之間只透過 `core/GameSession.ts`（記憶體內的單例）傳值：`levelIndex`、`mode`（`normal` / `practice`）、`devMode`、`introPlayed`、`pushIn`。
- 永久資料都在 localStorage（見 [7.1](#71-localstorage-鍵)），雲端只有登頂次數、最快時間、玩家名稱。

### 0.5 數值放哪裡

| 種類 | 位置 | 說明 |
| --- | --- | --- |
| 玩法數值（速度、風險、事件、牆寬、機率、雲端規則秒數） | `assets/resources/config/levels.json` | 開發規則 1：**不得寫死在程式**。`config/levels.json` 是種子副本，`npm test` 檢查兩者一致，`npm run sync:levels` 由種子覆蓋 |
| 畫面比例、UI 尺寸、鏡頭參數、動畫秒數 | 各檔案頂端的具名常數 | 例：`Boot.ts` 的 `MIN_STAGE_MS`、`Climb.ts` 的 `TRANSITION_SEC`、`Tower3D.ts` 的 `FRAME_AT`。ADR-11 明訂這類不進 `levels.json` |
| 玩家看得到的文字 | `core/I18n.ts` | 中英文 key 與 `{佔位}` 必須一致（`tests/i18n.test.ts`） |
| 雲端安全限制 | `config/firestore.rules` | 規則裡的秒數必須等於 `levels.json` 的 `cloud.*`（測試檢查） |

### 0.6 開發與發布流程

```powershell
npm test
```

```powershell
npm run build:web
```

```powershell
npm run serve
```

```powershell
npm run publish:site
```

1. `npm test`：Node 22.18 以上（內建 type stripping），`tools/ts-resolve.mjs` 讓純 TS 間不帶副檔名的 import 能解析。
2. `npm run build:web`：Cocos CLI 依 `tools/build-web-mobile.json` 建到 `build/web-mobile`。**先關掉這個專案的編輯器**。CLI 成功結束碼是 36，失敗看 `temp/builder/log`。編輯器路徑可用環境變數 `COCOS_CREATOR` 覆蓋。
3. `npm run serve`：http://localhost:8101 本機確認（`node tools/serve.mjs site` 看 `site/`）。
4. `npm run publish:site`：清空 `site/` 複製建置結果，`tools/site-icons.mjs` 補網站圖示、插入 `<link>` 與防捲軸樣式 `NO_SCROLL_STYLE`。
5. commit `site/` → PR 到 `master`（`pr-check.yml` 跑 `npm test` ＋ `npm run smoke`）→ 合併後 `deploy-pages.yml` 發布。

**只改程式沒重建 `site/`，線上版不會變。** 多條分支同時改程式時，後合併的那條要在最新 master 上重建 `site/`（`site/` 檔名含 md5，必定衝突，以重建為準）。

---

## 1. 遊戲啟動：Boot 分段載入

| 項目 | 內容 |
| --- | --- |
| 檔案 | `scenes/Boot.ts`、`core/BootStages.ts`（純 TS）、`config/LevelLoader.ts`、`config/LevelConfig.ts` |
| 對應 | GDD §7、ADR-01；PR #5（分段載入）、#12（預載 Logo）、#13（音效列）、#14（NPC 列）、#26（帳號列）、#30（等名稱讀完） |
| 測試 | `tests/boot-stages.test.ts`、`tests/level-config.test.ts` |

### 1.1 六個階段

`BootStages.runStages()` 依序執行，每段回報進度；任一段丟例外就停下，畫面顯示紅字與「重試」鈕。

| # | 階段（I18n key） | 做什麼 | 完成時顯示 |
| --- | --- | --- | --- |
| 1 | 讀取遊戲設定 `boot.config` | `LevelLoader.load()` 讀 `resources/config/levels`，交給 `LevelConfig` 驗證、推導每關列數與樓層 | `levels.json v1 OK · 14 關` |
| 2 | 載入帳號 `boot.account` | 讀 Settings、LocalBest；`auth().init()` 從 gstatic 載 Firebase compat SDK（`FIREBASE_SDK_VERSION`），有登入就讀 `players/{uid}` 的自訂名稱 | 已登入名稱／訪客模式／雲端無法連線 ＋ 最佳紀錄 |
| 3 | 天氣系統 `boot.weather` | `describeWeather()` 檢查風／雨／鷹參數（長度短於間隔、機率在 0–1） | `風／雨／鷹 OK，強風 0%–70%` |
| 4 | NPC 載入 `boot.npc` | 目前只回報內容（NPC 在 Climb 依關卡產生） | `窗內 NPC：路人、員工、觀光客` |
| 5 | 音效 `boot.sound` | 檢查 `AudioEngine.supported`，顯示音量與靜音 | `合成音效 · 音量 80%` |
| 6 | 場景渲染 `boot.render` | `director.preloadScene('Home')` 帶動進度條，同時 `loadBrandIcon()` 預載 GCR 圖示；圖示失敗不擋 | `主畫面與圖示就緒` |

- 每段至少顯示 `MIN_STAGE_MS = 250` ms，全部完成再停 `DONE_HOLD_SEC = 0.5` 秒才進 Home。這是 UI 常數，不進 `levels.json`。
- Firebase 載入失敗一律以訪客繼續（`AuthState = 'error'`），不會卡在 Boot。`core/FirebaseConfig.ts` 的 `FIREBASE_CONFIG` 設成 `null` 就是純訪客版。
- `window.__GC_BOOT` 放階段摘要，`tools/smoke-site.mjs` 用它判斷 Boot 成功（要包含 `levels.json vN OK`）。

### 1.2 levels.json 驗證（`LevelConfig.ts`）

- 樓層關 `floors` 寫成 `"1-8F"`，必須從 1F 起連續銜接；尖塔關寫 `spire-lower` / `spire-upper`，排在樓層關之後。
- 每關列數：樓層關 = 樓層數 × `player.rowsPerFloor`（12），尖塔關 = `player.ladderRows`（48）。全程 1308 列。
- `tower.faces` 只接受 1 或 4；`dev.climbSpeeds` 第一個必須是 1 且遞增；`obstaclesPer12Rows` 可以是小數。
- 改結構時同步改 `tests/level-config.test.ts`。

### 1.3 螢幕適配

`core/ScreenFit.ts`：設計解析度 720 × 1280；比 9:16 長的螢幕固定寬度、比 9:16 寬的固定高度。Boot、Home、Climb 都在 `onLoad` 呼叫 `applyScreenFit()`。

---

## 2. 主畫面：Home

| 項目 | 內容 |
| --- | --- |
| 檔案 | `scenes/Home.ts`（版面與按鈕）、`scenes/HomeBackdrop.ts`（2D 備援背景）、`scenes/HomeBackdrop3D.ts`（黃昏 3D 背景）、`ui/*` 面板 |
| 對應 | GDD §7、ADR-07、ADR-09、ADR-12、ADR-13；PR #5、#24、#25、#26、#27、#30–#33 |

### 2.1 版面（PR #27、#33）

- **左上**：GCR Logo（`resources/branding/gcr-icon.png`）＋「霍將軍爬101大樓」＋「GENERAL CLIMB · GCR」。開發人員模式時加 **GM** 標章。
- **左側選單直欄**（深色面板，每項有英文副標）：開始遊戲（高亮）／選擇關卡／練習模式／登頂排行榜／設定；面板底部是「第 N 周目 · 已登頂 X 次」（`formatRound`）與最佳紀錄（`formatBest`）。
- **右上**：語言／全螢幕膠囊、帳號膠囊（未登入「Google 登入／登入後同步登頂紀錄」，登入後「雲端存檔已開啟」＋ email，超過 26 字以 `clipText` 截斷）、音量鈕。
  - 橫式：三者同一列。
  - 直式：膠囊單獨在右上；帳號膠囊與音量鈕在第二列，右緣與膠囊對齊（PR #33）。
- **底部**：左邊提示「放開方向鍵就是抓牢…」，右邊地點「象山 · 臺北101 信義區」；直式時兩者置中。
- **黑條**：`buildBars()`，橫式上下都有、直式只有底部。
- 直橫切換由 `relayout()` 換 Widget 位移；位置都用具名常數（`SOUND_SIZE`、`TOP_GAP`、`ROW1_TALL`、`ROW2_TALL`、`CHIP_H`、`BAR_TOP`、`BAR_BOTTOM`）。
- 網頁不出捲軸：`publish:site` 在 `index.html` 插入 `overflow: hidden`。

### 2.2 黃昏 3D 背景（PR #25、ADR-13）

- 重用攀爬用的 `Tower3D`、`Basin3D`、`Atmosphere3D`，傳入「黃昏外觀」：紫到桃色天空、玫瑰棕山脈、暗色城市與閃爍燈光、亮窗、金色泛光的竹節與塔冠、尖塔紅色閃燈。調色盤與鏡頭數學在 `climb/BasinShape.ts`（`tests/dusk-shape.test.ts`）。
- 視角是從塔東的象山看 101；鏡頭慢慢晃動；`homeYawShift` 讓 101 站在選單右側（直橫都是）。
- 3D 準備好之前先顯示 2D 的 `HomeBackdrop`（Graphics 畫的天空、星星、剪影），3D 失敗就一直用 2D。

### 2.3 語言與全螢幕（PR #24、ADR-12）

- `core/I18n.ts`：`t('key', { var })`，語言 `zh-TW`（預設）與 `en`。切換存到 `Settings.lang`，然後**重新載入 Home 場景**（所有標籤由程式建立，重載最簡單也最不會漏）。
- 關卡名稱在 `levels.json` 維持中文，英文由 `translateLevelName()` 對照。
- `core/Fullscreen.ts`：標準 Fullscreen API ＋ WebKit 前綴；`fullscreenSupport()` 回傳 `api` / `standalone` / `ios` / `none`。iPhone Safari 沒有元素全螢幕，提示「分享 → 加入主畫面」；已從主畫面開啟（standalone）時提示已是全螢幕。

### 2.4 帳號：Google 登入與帳號面板（PR #26、#30、ADR-09）

| 檔案 | 責任 |
| --- | --- |
| `core/FirebaseConfig.ts` | 網頁設定（可進 repo）。`null` = 只能訪客 |
| `core/AuthService.ts` | `auth()` 單例：`init`、`signIn`（**一律 `signInWithPopup`**，必須由玩家點擊觸發）、`signOut`、`rename`、`syncSummits`、`leaderboard`、`fastestRuns`、`deleteAccount`、`onChange` |
| `core/CloudSummit.ts` | 純 TS：與 `firestore.rules` 相同的上傳限制（`summitsAllowed`、`planSummitSync`）、排名 `rankRows`、名稱 `cloudName`、`#編號` `playerTag(uid)` |
| `core/PlayerName.ts` | 純 TS：名稱規則與本機快取 `gcr.profile.v1` |
| `ui/AccountPanel.ts` | 頭像、email（只顯示不儲存）、同步狀態＋立即同步、玩家名稱 `名字#六碼`＋修改、登出、刪除帳號、隱私權政策／服務條款 |

**改名**（PR #30）：去控制與零寬字元、合併空白、去頭尾空白後 2–12 字（中文一字算一），只允許中英文、數字、`_`、空白、`-`。`AuthService.rename` 用一個 transaction 寫 `players/{uid} = { name, nameUpdatedAt }`；若已在排行榜，同時改 `summits/{uid}.name`（次數與時間不動）。冷卻 `cloud.renameCooldownSec`（30 秒），必須等於規則裡的秒數（`tests/player-name.test.ts`）。`#編號` 由 uid 產生，不能改。

**刪除帳號**：再用 Google 確認一次（Firebase 要求近期登入），刪 `summits/{uid}`、`players/{uid}`，再刪 Auth 使用者；本機進度保留成訪客進度。

隱私權政策與服務條款在 `build-templates/web-mobile/privacy.html`、`terms.html`，Cocos 建置時複製到輸出根目錄。

### 2.5 登頂排行榜（PR #26、#31）

`ui/LeaderboardPanel.ts`，兩個分頁，訪客也能看：

| 分頁 | 查詢 | 顯示 |
| --- | --- | --- |
| 總周目 | `summits` 依 `count` 由高到低，取 `cloud.leaderboardSize`（20） | `10周目`（EN `N rounds`）；同次數先達成者在前 |
| 最快時間 | `summits` 依 `bestRunMs` 由小到大（單欄位索引，沒有該欄的文件自動排除） | 現實攀爬時間（`formatRealDuration`，×9.5） |

最快時間只收「從第 1 關一次爬到塔尖、中途不墜落」的正式玩法（見 [5.3](#53-紀錄寫入)）。

### 2.6 設定面板與金手指（PR #5、#10、#32）

`ui/SettingsPanel.ts`：音量滑桿、震動、閃光效果、金手指輸入框、版本號。

- 設定存在 `gcr.settings.v1`（`core/Settings.ts`）：`volume`（0.8）、`vibration`、`flashEffects`、`muted`、`devMode`、`devSpeed`、`lang`。損壞或無法存取時用預設值。
- **金手指**（`core/CheatCodes.ts`）：輸入 `RUNGM` 開、`STOPGM` 關開發人員模式；去頭尾空白、不分大小寫，輸入框自動轉大寫；`[RUNGM]` 之類算無效指令。`Settings.devMode` 即時同步到 `GameSession.devMode` 與 GM 標章。
- **開發人員模式的效果**：
  - 選關可選**全部 14 關**，尖塔也開放（`core/LevelAccess.ts`，PR #8 起；`Agents.md` 寫「尖塔仍鎖」是舊說法）。
  - 關卡左上出現爬樓變速鈕（點擊或按 V），`dev.climbSpeeds` ×1／×1.5／×2／×3／×5，存在 `Settings.devSpeed`；只縮短爬一格的時間，風險與事件計時不變。一般玩家固定 ×1（`core/ClimbSpeed.ts` 的 `effectiveSpeed`）。
  - **不寫任何紀錄**（不解鎖、不加周目、不上傳）。
- **版本號**（PR #32）：完成鈕下方「版本 v1.0.0」。`core/Version.ts` 的 `APP_VERSION` 必須等於 `package.json` 的 `version`（執行期讀不到 package.json；`tests/version.test.ts` 檢查）。發版時兩處一起改。

### 2.7 音效與 BGM（PR #13、ADR-14）

- `core/Audio.ts`：Web Audio 即時合成。音效表 `SOUNDS`（click、step、grip、warnWind、warnRain、warnEagle、eagleSpot、eagleDive、fall、land、levelUp、summit），曲子 `TRACKS`（home 92 BPM、climb 120 BPM，五聲音階）。音樂音量 `MUSIC_MIX = 0.6`，總音量是平方曲線（`masterGain`）。
- `core/Sound.ts` 的 `sound()` 是共用引擎，跟著設定的音量與靜音。瀏覽器要等第一次點擊或按鍵才會出聲。
- 右上音量鈕切換 `Settings.muted`。注意：不要在場景裡把節點變數取名 `sound`，會遮蔽 `sound()`（PR #13 修過的 bug）。

---

## 3. 遊戲開始：開場、過場、解鎖與周目

| 項目 | 內容 |
| --- | --- |
| 檔案 | `ui/IntroOverlay.ts`、`core/Cutscene.ts`（純 TS）、`Tower3D.applyPushIn`、`ui/LevelSelectPanel.ts`、`core/LevelAccess.ts`、`core/Progress.ts` |
| 對應 | ADR-06（修訂）、ADR-07；PR #16、#20 |
| 測試 | `tests/cutscene.test.ts`、`tests/progress.test.ts` |

### 3.1 3 秒開場插畫（PR #16）

- 在 Home 上疊 `IntroOverlay`：紅衣攀爬者背影站在屋頂舉手望向大樓＋夜景天際線，`INTRO_SEC = 3` 秒內慢慢放大（`INTRO_ZOOM`），最後 `INTRO_FADE_SEC` 淡出露出主畫面。
- **每次開網頁只播一次**（`GameSession.introPlayed`）；從關卡退回主畫面不再播。
- 點擊或按任意鍵略過，開頭 `SKIP_GRACE_SEC = 0.25` 秒內不接受（避免同一下點擊直接略過或誤觸選單）。
- smoke test 檢查 `window.__GC_INTRO === 'done'`。

### 3.2 開始遊戲與選關

| 入口 | 寫入 GameSession | 結果 |
| --- | --- | --- |
| 開始遊戲 | `levelIndex = 0`、`mode = 'normal'`、`pushIn = true` | 第 1 關，先播拉近過場 |
| 選擇關卡 → 第 N 關 | `levelIndex = N-1`、`mode = 'normal'`、`pushIn = true` | 從第 N 關開始（只能選已解鎖或開發人員模式） |
| 練習模式 | `mode = 'practice'` | 見 [6](#6-練習模式) |

網址參數（測試輔助）：`?level=6` 從第 6 關開始、`?practice=1` 直接進練習。兩者都不記錄紀錄。

### 3.3 拉近過場（Climb mode `intro`）

`Climb` 讀到 `GameSession.pushIn` 就清掉它並進入 `intro`：`Tower3D.applyPushIn(t)` 依 `Cutscene.pushInPose()` 讓鏡頭從遠處高空先拉近、再降到塔底第 1 關起點，`PUSH_IN_SEC = 2` 秒。過場中隱藏 HUD、**不計時**；同樣可略過（0.25 秒保護）。墜落重來不再播。`tests/cutscene.test.ts` 檢查鏡頭全程不穿進城市方塊。

### 3.4 解鎖與周目保存（PR #20、ADR-06 修訂）

`core/Progress.ts`，localStorage `gcr.progress.v1`：

```ts
interface Progress {
  unlocked: number;        // 已開到第幾關（0 起算，0 = 只有第 1 關）
  rounds: number;          // 完成的周目數，目前是第 rounds + 1 周目
  summits: number;         // 本機登頂總次數
  syncedSummits: number;   // 其中已加到雲端的次數
  lastSummitAt: string | null;
  bestRunMs: number | null; // 最快完整攀爬（毫秒）
}
```

| 事件 | 函式 | 變化 |
| --- | --- | --- |
| 破第 N 關 | `afterLevelCleared` | `unlocked` 開到 N+1（只開不關），退出或重新整理都保留 |
| 墜落 | `afterFall` | `unlocked = 0`（回 1F，只有第 1 關開）；周目與登頂不變 |
| 看完或略過登頂動畫 | `afterSummit` | `unlocked = 0`、`rounds + 1`、`summits + 1`、記 `lastSummitAt` |
| 一次爬完全程不墜落 | `afterFullRun` | 保留較快的 `bestRunMs` |

- `LevelAccess.levelAccess()`：第 1 關永遠開；`index <= unlocked` 開；開發人員模式全開。
- 練習與開發人員模式都不呼叫上述函式（`Climb.recording` 為 false）。

---

## 4. 關卡內容：Climb

| 項目 | 內容 |
| --- | --- |
| 規則 | `climb/ClimbCore.ts`（純 TS）：`buildWall`、`EventScheduler`、`ClimbSim`、輸入轉方向、時間與進度格式 |
| 場景 | `scenes/Climb.ts`：輸入、流程（mode）、音效、2D HUD、天氣特效 |
| 3D | `scenes/Tower3D.ts`（塔、攀爬格、角色、鏡頭）、`Entrance.ts`、`Eagle3D.ts`、`WindowCrowd.ts`、`Basin3D.ts`、`Atmosphere3D.ts`、`MeshKit.ts` |
| 幾何資料 | `climb/TowerShape.ts`、`ClimberShape.ts`、`EagleShape.ts`、`EntranceShape.ts`、`BasinShape.ts`、`CrowdPlan.ts` |
| 對應 | ADR-02～05、ADR-10、ADR-11、ADR-15；PR #4、#6～#11、#14、#17～#19、#21～#23、#28、#29、#34、#35 |
| 測試 | `climb-core`、`climb-speed`、`tower-shape`、`climber-shape`、`eagle-shape`、`entrance-shape`、`basin-shape`、`crowd-plan`、`real-time` |

### 4.1 Climb 的流程狀態（mode）

```
loading → intro（拉近，可略過） → ready（站在起點，第一次方向輸入進 play）
play ⇄ paused（Esc / 暫停鈕）
play → transition（過關，1.5 秒上捲）→ play（下一關）
play → falling（凍結 0.3 秒＋下墜，共 2.5 秒）→ fallen（結算，Space／點擊再爬）
play（第 14 關頂）→ ending（10 秒登頂動畫，可略過）→ cleared（結算）
error（levels.json 載入失敗）
```

- `update(dt)` 只在 `play` 把 `dt` 交給 `ClimbSim.update()`，所以**計時只算攀爬中**；暫停、過場、墜落、登頂動畫都不算（開發規則 3）。
- 一局共用同一個 `ClimbSim` 鏈：`sim.next()` 產生下一關，帶著同一個種子亂數、事件排程器、風險值、攀爬時間（`RunCarry`）。**風險值跨關不重置**（ADR-03）。
- 「退出」鈕（暫停鈕左邊，按 X 也可）只在起點第 0 列、暫停、墜落與結算出現，爬在牆上時隱藏以免誤觸（PR #10）。

### 4.2 3D 101 與四面環繞攀爬（ADR-10）

- **塔身**：`TowerShape.ts` 定輪廓（基座 1–26F 往上收窄、26F 圓形裝飾、27–90F 八節各自往外張開、91–101F 頂部、塔冠、尖塔），`Tower3D.ts` 產生網格。一列 0.2 單位高，攀爬格貼著斜面排列。
- **外牆**（PR #14）：每層一整片青綠落地玻璃（下暗上亮）、淺灰直柱、轉角柱較寬；目前關卡的安全欄／危險欄是青綠／偏紅的玻璃。
- **塔底大門**（PR #17）：四面中央各一座（玻璃門、通高石材門柱＋如意雲紋、弧形金屬雨遮），塔底是石板廣場；尺寸在 `EntranceShape.ts`。爬過雨遮高度時角色往外掛到雨遮前緣（`canopyClearance`）。練習平房不套用。
- **材質**：全部頂點色＋unlit（`resources/materials/vertex-color.mtl`），光影烘進頂點色，不用即時光影與後製；目標中階手機 60 fps。每個網格低於 65,536 頂點。
- **角色**（PR #11）：`ClimberShape.ts` 用低多邊形橢球與旋轉體組成 Q 版將軍（黑短髮、紅袍、金領金腰帶、披風、可彎的手肘膝蓋），約 3k 三角形，1.5 倍大小。爬牆是蜘蛛人式左右交替（`wallPose()`）。攀爬時鏡頭在背後，臉在平台、旋轉視角、登頂時看得到。
- **名牌**（PR #28）：頭上顯示 Google 名稱或自訂名稱（同排行榜 `cloudName`），訪客「霍將軍」；繞到塔背面時隱藏。

**鏡頭**：永遠看塔軸，跟著角色高度與所在面。拖曳畫面上半部、滑鼠拖曳或 Q／E 旋轉，放開 `RETURN_DELAY_SEC = 1.5` 秒後轉回。`lookUp()` 依畫面比例讓角色中心落在畫面高度約 `FRAME_AT = 42%`，寬螢幕時放寬 FOV（`MIN_VTAN`）（PR #9）。

### 4.3 攀爬格、牆寬與障礙物

| 牆寬 | 每面欄數 | 安全 | 每側危險 | 關卡 |
| --- | --- | --- | --- | --- |
| `wide` | 11 | 9 | 1 | 1–2 |
| `medium` | 9 | 7 | 1 | 3–6 |
| `mediumNarrow` | 7 | 5 | 1 | 7–8 |
| `narrow` | 5 | 3 | 1 | 9–11 |
| `xnarrow` | 4 | 2 | 1 | 12 |
| `ladder` | 1 | 1 | 0 | 13–14 |

- `tower.faces = 4`：每面仍是上表欄數，走過最外欄就轉角到下一面，**沒有邊可掉**；兩面的危險欄在轉角相接，形成 2 欄寬的危險區，風險累積到 100 一樣墜落（原因「太靠邊了…」）。`faces = 1` 是舊的單面牆，踏出最外欄即墜落（測試仍保留）。
- **竹節外張**（`pagodaFlare`）：第 4–11 關每節最上方 24 列，兩側危險欄各加 1。
- **障礙物**（通風口）：每 12 列每面 `obstaclesPer12Rows` 個（第 1–3 關 1、第 4–8 關 2、第 9–11 關 1.5、第 12 關 1），每塊實際數量 `round(值 × faces)`。`hasSafeRoute()` 用 BFS 保證從起點到頂有一條不經危險欄的路。
- **起點平台**（`startPlatform`）：第 1、4–13 關的第 0 列是平台（廣場、節與節之間的平台、屋頂）。在平台上站著走路、可繞塔、沒有危險區、風險只降不升、強風不推人；往上攀到牆上才恢復規則。
- 每關列數：第 1 關 96、第 2–3 關 108、第 4–11 關 96、第 12 關 132、尖塔各 48，全程 1308 列。

### 4.4 操作

| 裝置 | 移動 | 抓牢 | 其他 |
| --- | --- | --- | --- |
| 鍵盤 | 方向鍵 / WASD | 不按任何鍵 | Esc 暫停、X 退出、Q／E 旋轉、V 變速（開發人員） |
| 觸控 | 浮動搖桿（半徑 90，死區 20%） | 手指離開 | 拖曳上半部旋轉、右上暫停鈕 |

- 一次一格，每格 `player.cellSec = 0.35` 秒；無輸入 `gripDelaySec = 0.1` 秒後進入抓牢。
- 斜向輸入垂直優先；往上被擋才改走水平（`tryStep`）。
- 危機（風險 ≥ 70）時輸入延遲 `crisisInputDelaySec = 0.15` 秒。

### 4.5 風險值（ADR-03）

`ClimbSim.update()` 每幀計算，數值都在 `levels.json` 的 `risk`：

| 情況 | 每秒變化 |
| --- | --- |
| 在危險欄 | +`dangerPerSec`（15） |
| 安全欄抓牢 | `calmGripPerSec`（−20） |
| 安全欄攀爬 | `calmClimbPerSec`（−5） |
| 在起點平台 | −20（永遠視為抓牢） |
| 強風中移動 | 另加 +`windMovePerSec`（25），且每 `pushEverySec`（1 秒）被推往較近的邊（轉角）一格 |

| 門檻 | 狀態 | 表現 |
| --- | --- | --- |
| 0–39 | 安全 | — |
| 40（`tense`） | 緊張 | 邊緣淡紅、風險膠囊變色 |
| 70（`crisis`） | 危機 | 紅框閃爍、畫面微晃、輸入延遲 |
| 100（`max`） | 墜落 | 原因看最後的來源：強風中為「風大時要抓牢」，其他為「太靠邊了…」 |

直接墜落：雨中移動超過 `rainGraceSec`（0.3 秒）→「雨天手滑了」；老鷹撲中 →「被老鷹撲下來了」。墜落原因文字是 `I18n` 的 `fall.edge / wind / rain / eagle`。

### 4.6 天氣事件與排程（ADR-04）

`EventScheduler`：`idle → warning（1 秒）→ active → cooldown（4 秒）→ idle`。**同時只有一個危機事件**：雨、鷹到期時若有事件進行中就排隊；強風判定撞到任何事件就丟棄。

| 事件 | 第一次 | 間隔 | 持續 | 效果 |
| --- | --- | --- | --- | --- |
| 強風 | 60 秒判定 | 每 60 秒判定，機率 `windChance`（第 1 關 0% → 第 12–14 關 70%） | 10–20 秒 | 移動時風險 +25/秒，每秒被推一格；風向隨機 |
| 下雨 | 600 秒 | 每 600 秒 | 20–30 秒 | 移動超過 0.3 秒即墜落；天空轉灰、雲變灰、閃電 |
| 老鷹 | 90 秒 | 每 120 秒（PR #21，原 300／600） | 3 秒 | 見 4.7 |

- 計時用整局攀爬時間（跨關延續），墜落重來歸零。一局約遇到 3～4 次老鷹。
- 所有機率與持續時間都用本局**種子亂數**（mulberry32，`createRng(seed)`），種子顯示在結算畫面，可重現（開發規則 4）。
- HUD 左上事件圖示：預警時閃爍出現，進行中保留並顯示剩餘時間條。預警期間有弱提示（風線、轉暗、老鷹影子）。

### 4.7 老鷹俯衝（PR #18、#19、#21）

- 3D 原創展翅老鷹：`EagleShape.ts`（白頭、黃鉤嘴、棕身、展翅、伸爪）＋`Eagle3D.ts`。預警時從側面盤旋飛近，進行中在攀爬者前上方盤旋。
- 規則（`events.eagle`）：老鷹在場時**只要一移動就被鎖定**，紅眼（眼睛發光＋畫面紅閃＋尖嘯）持續 `spotSec`（0.6 秒）；接著朝玩家當下那格俯衝 `diveSec`（0.8 秒）。鎖定後停下也來不及，所以預警那 1 秒就要放手。
- 落點時玩家在 `hitCols`（1）欄、`hitRows`（6）列內（含擦身）就墜落；閃得更遠就撲空，老鷹拉起 `diveSec` 秒後才能再鎖定。
- 從頭到尾不動就安全。

### 4.8 窗內 NPC（PR #14、#22、ADR-15）

- `climb/CrowdPlan.ts`（純 TS）決定每關固定的窗位、種類（路人、員工、觀光客）、反應；用自己的固定雜湊（`hashRng`），不消耗本局種子亂數（純裝飾，不影響玩法）。
- 只放在安全欄、整層無通風口的窗；門、雨遮、石柱後面不放；尖塔不放。
- `scenes/WindowCrowd.ts`：身體合成一個 mesh，只有手臂是節點。攀爬者靠近時揮手或拍照（觀光客手機亮螢幕、偶爾閃光），風險升高或墜落時抱頭擔心。
- 第 9 關起塔變窄：只有 `cols / refCols`（refCols 7）比例的樓層放 NPC（`crowd.shrinkFromLevel = 9`）。其他參數在 `levels.json` 的 `crowd`。

### 4.9 台北盆地與大氣（PR #23、ADR-11）

- `BasinShape.ts` ＋ `Basin3D.ts`：極座標高度場畫城市平原與環山（北高、西北河口缺口），約 1,200 棟街廓靠塔密、往外疏，兩條河、三座公園、塔東小山（象山）。
- `Atmosphere3D.ts`：跟著鏡頭的天空穹頂，依仰角分層漸層，越接近塔尖越深；三層雲以不同速度繞塔漂移；下雨轉陰、強風雲加速（`Climb.ts` 把天氣傳進去）。
- 效能：地景約 6 個 draw call、天空與雲 4 個；穹頂只在顏色變化超過一階時重建。相機 far 2,400。
- 這些是畫面比例，放程式常數，不進 `levels.json`。

### 4.10 HUD（PR #4、#8、#28、#29、#34）

| 位置 | 元素 |
| --- | --- |
| 左上 | 事件圖示與剩餘時間條；開發人員模式下有 GM 標章與變速鈕 |
| 左側 | 風險量表（直向 0–100，40／70 刻度），上方深色膠囊兩行「風險 / N%」，依緊張／危機變色 |
| 上方 | 關卡與樓層（例「第 6 關 第3節 43–50F」、「47F」） |
| 右上 | 「現實時間 1小時39分」、暫停鈕、退出鈕（條件顯示） |
| 右側 | 101 小地圖：剪影、目前關卡範圍、紅點位置，旁邊「完成 32.1%」（練習不顯示） |
| 角色頭上 | 名牌 |
| 全畫面 | 危機紅暈、紅眼紅閃、天氣特效 |

- **完成百分比**：`climbProgress(levels, levelIndex, row)` ＝ 已爬列數 ÷ 1308；`formatProgress` 到頂前不會顯示 100%。
- **現實攀爬時間**（PR #34、#35、ADR-16）：`core/RealTime.ts` 的 `REAL_TIME_FACTOR = 9.5`（遊戲 1 分鐘 = 現實 9.5 分鐘，依霍將軍實際約 91 分鐘、遊戲約 10 分鐘推估）。`formatRealDuration(gameMs)` 顯示「1小時39分」／「1h 39m」，不滿 1 小時「47分」，分鐘無條件捨去，`withSeconds` 可加秒。用在 HUD、墜落／練習完成／登頂結算（登頂另附「遊戲時間 10分30.4秒」，`clockParts`）、主頁最佳紀錄、排行榜最快時間。**只改顯示**：紀錄、Firestore `bestRunMs`、排序、規則仍是原始遊戲毫秒。

### 4.11 墜落回 1F（ADR-06）

1. 風險到 100 或直接墜落條件成立 → `ClimbSim.phase = 'fallen'`。
2. `beginFall()`：停音樂、播 fall；凍結 `FALL_FREEZE_SEC = 0.3` 秒後以 `FALL_G` 下墜到地面（播 land），總長 `FALL_TOTAL_SEC = 2.5` 秒，不呈現撞擊。
3. 結算：墜落原因、本局最高樓層、現實時間、種子、「從 1F 再爬一次」。
4. 正式玩法時：`recordLocalBest(maxFloor)`、`afterFall()`（解鎖歸零），下一局從第 1 關開始（即使本局是從選關接著玩）。
5. Space／點擊開新的一局（新種子、計時歸零、風險歸零）；不再播拉近過場。

---

## 5. 爬完結束：尖塔段、登頂動畫、紀錄與排行榜寫入

| 項目 | 內容 |
| --- | --- |
| 檔案 | `Climb.ts`（`onCleared`、`tickEnding`、`finishEnding`）、`Tower3D.ts`（尖塔、結束鏡頭 `ENDING_SEC = 10`）、`core/LocalBest.ts`、`core/Progress.ts`、`core/RunTime.ts`、`core/AuthService.ts` |
| 對應 | ADR-07、ADR-09、ADR-10；PR #8、#20、#26、#31 |

### 5.1 尖塔段（第 13–14 關）

- 牆寬 `ladder`：1 欄、不繞面、不能橫移、沒有邊緣風險；從塔冠頂往上，第 14 關頂端是塔尖平台。
- 強風機率 70%，下雨與老鷹照常（老鷹撲中一樣墜落）。
- 第 13 關有起點平台（塔冠頂），第 14 關沒有。

### 5.2 登頂動畫

- 第 14 關最後一列 → `onCleared()` 發現沒有下一關 → mode `ending`：停音樂、播 summit。
- 約 10 秒：霍將軍坐在塔尖平台邊緣、小腿垂在外面晃，鏡頭先從肩後俯瞰，再升高、拉遠、環繞塔尖；5 秒後疊上簡短文字。點擊可略過（直接進結算）。
- 結算：現實攀爬時間＋遊戲時間、種子、「第 N 周目完成 · 已登頂 X 次」。

### 5.3 紀錄寫入

`finishEnding()`，只有正式玩法（`recording`：非練習、非開發人員模式）才寫：

1. `recordLocalBest({ maxFloor: 102, bestClearMs })`：`gcr.best.v1`，`102` 代表塔尖（`SPIRE_TIP_FLOOR`）。
2. `afterSummit()`：解鎖歸零、周目與登頂各 +1。
3. 若這局是**從第 1 關開始且沒有墜落**（`runFromStart`），`afterFullRun(runMsFromSec(climbSec))` 更新 `bestRunMs`。從選關接著玩、`?level=N`（N > 1）都不算。
4. `auth().syncSummits(storage)`：已登入就馬上同步；訪客在之後登入時同步（Home 也會觸發）。

### 5.4 雲端同步與防作弊（`firestore.rules`）

`summits/{uid} = { name, count, updatedAt, bestRunMs? }`，任何人可讀、只能寫自己的：

- 第一次建立 `count` 必須是 1。
- 之後每增加 k 次，`request.time` 必須比 `updatedAt` 晚 k × 300 秒（`cloud.minSummitSec`）。本機 `summits - syncedSummits` 依規則允許的量分次上傳（`planSummitSync`），不會遺失也不會重複；`CLOCK_MARGIN_MS` 預留時鐘誤差。
- 只改名或只更新最快時間時，`count` 與 `updatedAt` 都不能動。
- `bestRunMs`：int、≥ 420000（7 分鐘，`cloud.minRunSec`；理論最快 1308 × 0.35 ≈ 457.8 秒）、只能變小、有了不能刪。同步時在同一個 transaction 讀雲端值，比較快才上傳（`bestRunToUpload`）。
- 可刪自己的文件（刪除帳號）。
- `tests/cloud-summit.test.ts`、`tests/run-time.test.ts`、`tests/player-name.test.ts` 檢查規則裡的數字與 `levels.json` 一致。**改規則後要另外部署**：

```powershell
firebase deploy --only firestore:rules
```

---

## 6. 練習模式

| 項目 | 內容 |
| --- | --- |
| 檔案 | `ClimbCore.practiceLevel()`、`demoRows()`、`ClimbSim`（`practice`、`intensity`、`roofLocked`）、`Tower3D`（平房外觀）、`Climb.ts` |
| 對應 | GDD §7、ADR-06；PR #15、#18、#19 |
| 測試 | `tests/practice.test.ts` |

- 入口：主頁「練習模式」→ `GameSession.mode = 'practice'` → 同一個 Climb 場景。網址 `?practice=1` 也可。
- **關卡**：`levels.json` 的 `practice` — 3 層樓（36 列）、`wide` 牆寬、四面環繞、沒有障礙物、從地面起爬。
- **畫面**：`Tower3D` 收到樓層數就改畫平房（屋頂女兒牆、樓梯間、水塔、草地），遠方天際線有縮小的 101（盆地留了一條視線）。不顯示小地圖。
- **事件**：不跑計時事件，也沒有隨機強風。`demoEvents`（風 → 雨 → 鷹）各觸發一次，觸發列 = `demoAt`（0.1／0.4／0.7）× 房子高度；仍遵守一次一個事件＋冷卻。事件長度取 `durationSec` 最小值（風 10、雨 20、鷹 3 秒）。事件期間 HUD 下方顯示該怎麼做的提示（`tip.*`）。
- **低強度**：`intensity = 0.5` 只放寬懲罰：強風推移間隔 ÷ 0.5、強風風險 × 0.5、雨天容許時間 ÷ 0.5、老鷹鎖定時間 ÷ 0.5（1.2 秒）。
- **屋頂鎖**：示範事件還沒跑完（未觸發、排隊、預警、進行中）之前，爬上屋頂那一步會被擋住（`roofLocked`），並提示等待。
- **結束**：墜落回平房地面再練；登頂顯示「練習完成」與時間，沒有下一關、沒有登頂動畫。**不寫任何紀錄**。

---

## 7. 附錄

### 7.1 localStorage 鍵

| 鍵 | 模組 | 內容 |
| --- | --- | --- |
| `gcr.settings.v1` | `core/Settings.ts` | 音量、震動、閃光、靜音、devMode、devSpeed、lang |
| `gcr.progress.v1` | `core/Progress.ts` | unlocked、rounds、summits、syncedSummits、lastSummitAt、bestRunMs |
| `gcr.best.v1` | `core/LocalBest.ts` | maxFloor（102 = 塔尖）、bestClearMs |
| `gcr.profile.v1` | `core/PlayerName.ts` | 已登入玩家的自訂名稱快取（uid、name、改名時間） |

全部用 try/catch 包住；無痕模式或被封鎖時退回預設值，該次載入內有效。

### 7.2 Firestore 實際使用的集合

| 路徑 | 欄位 | 讀寫 |
| --- | --- | --- |
| `players/{uid}` | `name`、`nameUpdatedAt` | 只能讀寫自己的；名稱 regex、30 秒冷卻 |
| `summits/{uid}` | `name`、`count`、`updatedAt`、`bestRunMs` | 任何人可讀，只能寫自己的（見 5.4） |
| `players/{uid}/{sub}/…`、`best/{uid}` | — | 規則已預留（GDD §8 的每局紀錄與樓層排行榜），**目前程式沒有寫入** |

不存 email。Firebase 專案 `general-climb` 的設定步驟見 `docs/firebase-setup.md`。

### 7.3 測試與自動檢查

| 檢查 | 位置 |
| --- | --- |
| 單元測試 | `tests/*.test.ts`（`npm test`，只測不依賴 cc 的純 TS） |
| 兩份 levels.json 一致 | `tests/level-config.test.ts` |
| I18n 中英 key 與佔位一致 | `tests/i18n.test.ts` |
| 規則秒數 = levels.json | `cloud-summit`、`run-time`、`player-name` 測試 |
| 版本號一致 | `tests/version.test.ts` |
| 網站圖示 | `tests/site-icons.test.ts` |
| Boot／開場能跑完 | `npm run smoke`（無頭 Chromium 開 `site/`；需先 `npm i --no-save playwright` 並安裝 chromium） |

無頭 SwiftShader 偶爾會讓 Cocos 著色器編譯報 `console error: null` 或 16323/16324，smoke 偶發失敗，重跑即可；這是環境問題。

### 7.4 常見陷阱

1. **場景檔是編輯器產生的 JSON**：同一場景同時只一人改；UI 幾乎都由程式建立，場景只有 Canvas、Camera 與元件。
2. **新增 `.ts` 要有 `.meta`**：Cocos 編輯器開過會自動產生；沒開過就建置可能少檔。
3. **`site/` 衝突**：檔名含 md5，合併時一定衝突，以最新 master 重建為準。
4. **改 `levels.json` 兩份都要改**（或改種子後 `npm run sync:levels`）。
5. **新增玩家文字**一定進 `I18n.ts` 的中英兩邊。
6. **改雲端規則**：同步改 `levels.json` 的 `cloud.*` 與測試，並手動部署規則。
7. **改版本**：`package.json` 與 `core/Version.ts` 一起改。
8. **素材全部原創**（ADR-08）：不用真人照片、品牌 Logo、外部 3D 模型貼圖。
9. **不要用 `signInWithRedirect`**：在封鎖第三方儲存的瀏覽器會失效。
10. Firebase 網頁設定可以進 repo；**服務帳戶金鑰、`.env` 絕對不可 commit**。

### 7.5 尚未完成或待確認

- 設定頁的「震動」「閃光效果」目前只存進 `Settings`，關卡程式還沒有讀取（閃電、紅閃、觀光客閃光不受開關影響）。
- GDD §8 的 `players/{uid}/runs`、`best/{uid}`（樓層排行榜）尚未實作。
- 原生 App 打包、COCOS 4 / PinK 升級評估（ADR-01）。
- 上架前法務確認名稱與商標（ADR-08）。
- `docs/flowchart.html` 仍是早期流程圖，未包含排行榜與帳號面板。
