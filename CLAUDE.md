# CLAUDE.md — 霍將軍爬101大樓（GeneralClimb）

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
├─ CLAUDE.md
├─ README.md
├─ docs/            ADR.md、GDD.md、flowchart.html
├─ config/          levels.json（數值唯一來源）、firestore.rules、firestore.indexes.json
├─ game/            Cocos Creator 專案（尚未建立，見「下一步」）
├─ site/            Web Mobile 建置輸出，push 後由 Actions 發布到 Pages
└─ .github/workflows/deploy-pages.yml
```

## 開發規則
1. **數值不寫死**：所有可調數值（速度、風險、事件計時、關卡寬度、強風機率）只能在 `levels.json`。
   Cocos 專案建立後，以 `game/assets/resources/config/levels.json` 為準，`config/levels.json` 只是種子副本，兩者保持一致。
2. **一次只有一個危機事件**（ADR-04）：事件進行中到期的事件排隊，前一個結束 4 秒後才觸發；強風判定撞到其他事件就跳過。
3. 計時只算「攀爬中」，過場、暫停、墜落動畫不計；墜落重來全部歸零。
4. 事件與機率一律用本局**種子亂數**，種子要寫進成績，方便重現。
5. Cocos 場景與 Prefab 是編輯器產生的 JSON：**同一場景同時只一人改**；邏輯盡量寫在 TS 元件。
6. 素材全部原創（ADR-08）：角色無品牌 Logo、臉部不仿真人；不得使用真人照片。
7. Firebase 設定（apiKey 等）可以進 repo；**服務帳戶金鑰、`.env` 絕對不可 commit**。

## 主要元件（ADR-01）
Scenes：Boot → Home（登入／開始遊戲／練習模式）→ Intro → Climb → Transition → Fall → Victory；Practice（三層樓平房）
Components：InputController、RiskSystem、EventScheduler、WeatherSystem、EagleSystem、WindowCrowd、LevelLoader、AuthService

## 下一步（M0 專案骨架）
1. 使用者用 **Cocos Dashboard** 在 `D:\GITLocal\GeneralClimb\game` 建立 3.8 LTS 空白 2D 專案（Cocos 會自建資料夾，建立前 `game/` 不要存在）。
2. 建立後：把 `config/levels.json` 複製到 `game/assets/resources/config/levels.json`，寫 `LevelLoader` 讀取並驗證。
3. 設定 Web Mobile 建置輸出，寫一個腳本把 `game/build/web-mobile` 複製到 `site/`。
4. 建 GitHub repo、啟用 Pages（Source：GitHub Actions），push 後確認手機能開。
5. 接著做 M1：第 1 關 + 第 6 關、攀爬／抓牢、風險值、三種事件與左上圖示、墜落重來（色塊素材）。

## 待確認
- GitHub Actions 無法在雲端跑 Cocos 編輯器建置，目前採「本機建置 → 提交 `site/` → Actions 發布」。若要全自動，需自架 runner。
- GDD 新增、ADR 未記載的設計：牆面障礙物、每樓 12 列／每格 0.35 秒、破關動畫第二次起可跳過。
