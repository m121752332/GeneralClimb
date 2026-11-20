# CHANGELOG：霍將軍爬101大樓

依 PR 編號列出修改歷程（日期為合併日，UTC）。每筆標出主要檔案與對應決策，細節看 PR 本文與 `docs/DEVELOPMENT.md`。
PR 連結格式：`https://github.com/m121752332/GeneralClimb/pull/<編號>`。

## 未合併

| PR | 內容 |
| --- | --- |
| #35 | 現實攀爬時間倍率 ×9 → **×9.5**（`core/RealTime.ts` 的 `REAL_TIME_FACTOR`），只影響顯示；測試期望值重算、重建 `site/`。ADR-16 |

## v1.0.0 之後

| PR | 日期 | 內容 |
| --- | --- | --- |
| #34 | 2026-11-15 | 遊戲時間換算現實攀爬時間（×9）：新增 `core/RealTime.ts`（`toRealMs`、`formatRealDuration`），套用到 HUD、主頁最佳紀錄、墜落／練習／登頂結算、排行榜最快時間；Firestore 仍存遊戲 ms。ADR-16 |
| #33 | 2026-11-15 | 主頁直式：語言／全螢幕膠囊單獨在右上，音量鈕移到帳號膠囊右邊；email 超過 26 字截斷（新增 `core/TextClip.ts`）；右上位置改具名常數。ADR-13 |

## v1.0.0（2026-11-15）

| PR | 日期 | 內容 |
| --- | --- | --- |
| #32 | 2026-11-15 | 設定頁顯示版本號「版本 v1.0.0」；`core/Version.ts` 的 `APP_VERSION` 與 `package.json` 一致（`tests/version.test.ts`）。合併後打 `v1.0.0` tag。ADR-17 |
| #31 | 2026-11-15 | 登頂排行榜分「總周目」「最快時間」兩頁；`Progress.bestRunMs`、`core/RunTime.ts`；規則允許 `summits/{uid}.bestRunMs`（只能變小、≥ 420000）；`levels.json` 新增 `cloud.minRunSec: 420`。ADR-09 修訂 |
| #30 | 2026-11-15 | 玩家改名（只改 `#` 前的名字）：`core/PlayerName.ts`、`AuthService.rename`（transaction 寫 `players/{uid}` 與 `summits/{uid}.name`）、帳號面板修改對話框；規則新增 `players/{uid}`、30 秒冷卻（`cloud.renameCooldownSec`）。ADR-09 修訂 |
| #29 | 2026-11-15 | 風險 HUD 改兩行「風險 / N%」，置中在量表上方的深色膠囊 |
| #28 | 2026-11-15 | 關卡 HUD 易讀化：風險膠囊依狀態變色、時間格式「03分03.4秒」、小地圖旁「完成 32.1%」（`climbProgress`、`formatProgress`）；角色名牌顯示 Google 名稱 |
| #27 | 2026-11-15 | 主畫面改版：左上 Logo＋標題、左側選單直欄、右上帳號膠囊、黑條；101 移到選單右側（`homeYawShift`）；`publish:site` 插入防捲軸樣式。ADR-13 |
| #26 | 2026-11-14 | Google 登入（Firebase Auth `signInWithPopup`，Boot 載入 compat SDK）、雲端登頂次數 `summits/{uid}`、排行榜與帳號面板（同步、`名字#編號`、登出、刪除帳號、隱私權／條款）；`config/firestore.rules`、`docs/firebase-setup.md`。ADR-09 修訂 |
| #25 | 2026-11-14 | 主畫面黃昏 3D 背景：從象山看 101＋盆地，紫桃色天空、城市燈光、金色泛光、尖塔紅燈；3D 失敗退回 2D 背景。ADR-13 |
| #24 | 2026-11-14 | 中文／EN 切換與全螢幕：`core/I18n.ts`、`core/Fullscreen.ts`、`Settings.lang`；`tools/ts-resolve.mjs` 讓測試解析無副檔名 import。ADR-12 |
| #23 | 2026-11-14 | 台北盆地地景（`BasinShape.ts`、`Basin3D.ts`）與大氣（`Atmosphere3D.ts`：天空穹頂、三層雲，隨高度與天氣變化）。ADR-11 |
| #22 | 2026-11-14 | 第 9 關起塔變窄：窗內 NPC 依 `cols / refCols` 減量、通風口密度降低（`obstaclesPer12Rows` 可為小數）。ADR-15 |
| #21 | 2026-11-14 | 老鷹改為第 90 秒起每 120 秒（原 300／600），一局約遇到 3～4 次。ADR-04 修訂 |
| #20 | 2026-11-14 | 關卡解鎖、周目、登頂次數保存（`core/Progress.ts`，`gcr.progress.v1`）；墜落與登頂寫入本機最佳紀錄。ADR-06 修訂 |
| #19 | 2026-11-14 | 老鷹一移動就紅眼鎖定，`spotSec` 1.2 → 0.6 秒後俯衝；鎖定後停下也來不及。ADR-04 修訂 |
| #18 | 2026-11-14 | 3D 展翅老鷹（`EagleShape.ts`、`Eagle3D.ts`）與俯衝規則（`diveSec`、`hitCols`、`hitRows`）；墜落原因「被老鷹撲下來了」 |
| #17 | 2026-11-14 | 101 四面塔底大門（玻璃門、石材門柱、如意雲紋、金屬雨遮）與石板廣場；角色爬過雨遮時外掛（`canopyClearance`）。`EntranceShape.ts`、`Entrance.ts` |
| #16 | 2026-11-14 | 3 秒開場插畫（`ui/IntroOverlay.ts`）與開始遊戲 2 秒鏡頭拉近（`Tower3D.applyPushIn`），皆可略過；`core/Cutscene.ts`。ADR-07 |
| #15 | 2026-11-14 | 練習模式：三層樓平房，風／雨／鷹各低強度示範一次（`practice`、`demoAt`、`intensity`），不記錄；`?practice=1` |
| #14 | 2026-11-13 | 落地玻璃外牆與窗內 NPC（`CrowdPlan.ts`、`WindowCrowd.ts`）；抽出共用 `scenes/MeshKit.ts`。ADR-15 |
| #13 | 2026-11-13 | 合成音效與 BGM（`core/Audio.ts`、`core/Sound.ts`），無音檔。ADR-14 |
| #12 | 2026-11-13 | Boot 預載主畫面 Logo，主畫面第一格就有圖示 |
| #11 | 2026-11-13 | 精細角色模型（臉、短髮、紅袍、披風，`ClimberShape.ts`）與蜘蛛人式爬牆動作 |
| #10 | 2026-11-13 | 關卡「退出」鈕（起點、暫停、墜落、結算才出現，X 鍵）；開發人員爬樓變速 ×1～×5（`dev.climbSpeeds`、`Settings.devSpeed`） |
| #9 | 2026-11-13 | 寬螢幕攀爬鏡頭保留角色下方空間（`lookUp()`、`FRAME_AT`、`MIN_VTAN`） |
| #8 | 2026-11-13 | 尖塔第 13–14 關爬梯、10 秒登頂結束動畫、起點平台（`startPlatform`）、角色放大 1.5 倍、右上小地圖；每側危險欄改 1 欄；開發人員模式可選全部 14 關。ADR-10 修訂 |
| #7 | 2026-11-13 | **攀爬關卡改 3D**：程式產生的 101（`TowerShape.ts`、`Tower3D.ts`）、四面環繞攀爬（`tower.faces`）、鏡頭繞塔軸旋轉；開啟引擎 `3d` 模組。ADR-10 |
| #6 | 2026-11-13 | 第 6 關、竹節外張（`pagodaFlare`）、關卡銜接上捲、強風推移（`events.wind.pushEverySec`）、天氣畫面；`?level=N` |
| #5 | 2026-11-13 | Boot 分段載入（`core/BootStages.ts`）與主畫面 Home（選關、設定、開始遊戲）；金手指 `RUNGM`／`STOPGM`（`core/CheatCodes.ts`、`core/LevelAccess.ts`） |
| #4 | 2026-11-13 | 第 1 關可玩原型：`climb/ClimbCore.ts`（種子亂數、牆面、`EventScheduler`、`ClimbSim`）、Climb 場景、HUD、觸控搖桿、墜落重來 |
| #3 | 2026-11-13 | GCR favicon 與 apple-touch-icon（`build-templates/web-mobile/`、`tools/site-icons.mjs`） |
| #2 | 2026-11-13 | PR 檢查 workflow（`npm test` ＋ 無頭 Chromium smoke test，`tools/smoke-site.mjs`） |
| #1 | 2026-11-13 | `Agents.md` 對齊實際 repo（目錄、14 關結構、指令、部署） |

## PR 之前（直接提交到 master）

- `b6b2758` 專案骨架：`docs/ADR.md`、`docs/GDD.md`、`config/levels.json`。
- `4410d41` Cocos Creator 專案放在 repo 根目錄（M0）。
- `77d462a` 專案指引移到 `Agents.md`，`CLAUDE.md` 只匯入它。
- `844ed30` GitHub Actions 從 `master` 發布 Pages（2026-11-13 首次部署成功）。
