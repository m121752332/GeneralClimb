# Firebase 設定步驟（Google 登入＋登頂排行榜）

程式已經寫好，只差一個 Firebase 專案。`assets/scripts/core/FirebaseConfig.ts` 的 `FIREBASE_CONFIG` 還是 `null` 時，遊戲照常以訪客進行，Google 按鈕與排行榜會顯示「尚未開放」。

全程用免費的 Spark 方案即可，不需要綁信用卡。

## 1. 建立專案
1. 開 <https://console.firebase.google.com/> →「建立專案」（Create a project）。
2. 名稱例如 `general-climb`。Google Analytics 可以關掉（遊戲沒用到）。

## 2. 開啟 Google 登入
1. 開 Authentication：直接用網址 `https://console.firebase.google.com/project/<專案ID>/authentication/providers`，或左側選單「安全性（Security）→ Authentication」（找不到就點「所有產品」或在上方搜尋 `Authentication`；舊版選單叫「建構」）→「開始使用」。
2. 「登入方式（Sign-in method）」→「新增提供者」→ 選 **Google** → 啟用 → 選支援 Email（專案公開名稱可填 霍將軍爬101大樓）→ 儲存。

## 3. 加入授權網域
1. Authentication →「設定（Settings）」→「授權網域（Authorized domains）」。
2. 按「新增網域」加入 **`m121752332.github.io`**（只填網域，不要 `https://`，也不要 `/GeneralClimb`）。
3. `localhost` 預設已在清單內，本機 `npm run serve`（http://localhost:8101）可以直接測。

## 4. 建立 Firestore
1. 左側「資料庫與儲存空間（Databases & Storage）→ Firestore」（舊版選單是「建構 → Firestore Database」，或直接搜尋 `Firestore`）→「建立資料庫」。
2. 位置建議 `asia-east1`（台灣）；建立後不能改。
3. 模式選「正式版（production mode）」。

## 5. 貼上安全規則
1. Firestore →「規則（Rules）」分頁。
2. 把 repo 的 `config/firestore.rules` **整份**貼上 →「發布」。
   - 有安裝 Firebase CLI 的話，也可以在 repo 根目錄執行 `firebase deploy --only firestore --project <專案ID>`（`firebase.json` 已指向 `config/`）。

規則重點：
- `summits/{uid}`：任何人可讀（排行榜），只能寫自己的。
- 第一次上傳只能是 1 次；之後每增加 1 次，距離上次更新至少要 300 秒（`levels.json` 的 `cloud.minSummitSec`，一輪真實登頂的最短時間）。所以就算有人改程式，一天最多也只能加 288 次。
- 次數只能變大；只改名時次數與時間都不能動。
- 只能刪自己的（帳號面板的「刪除帳號」）。

## 6. 取得網頁設定並貼進程式
1. 專案總覽旁的齒輪 →「專案設定」→「一般」→ 下方「你的應用程式」→ 按 **`</>`（網頁）**。
2. 暱稱填 `web`，**不用**勾 Firebase Hosting →「註冊應用程式」。
3. 畫面會出現 `const firebaseConfig = { apiKey: ..., authDomain: ..., projectId: ..., ... }`。
4. 把這段的值貼進 `assets/scripts/core/FirebaseConfig.ts`：

```ts
export const FIREBASE_CONFIG: FirebaseWebConfig | null = {
    apiKey: 'AIza...',
    authDomain: 'general-climb.firebaseapp.com',
    projectId: 'general-climb',
    storageBucket: 'general-climb.firebasestorage.app',
    messagingSenderId: '1234567890',
    appId: '1:1234567890:web:abcdef',
};
```

這些值可以公開進 repo（ADR-09），安全靠第 5 步的規則。**服務帳戶金鑰（serviceAccount JSON）絕對不要 commit。**

## 7. 建置與發布
照平常流程：`npm test` → `npm run build:web` → `npm run serve` 本機測登入 → `npm run publish:site` → commit `site/` → push `master`。

## 測試清單
- 主畫面按「Google 登入」→ 跳出 Google 視窗 → 登入後按鈕變成你的名字，Boot 的「載入帳號」顯示名字。
- 點名字 → 帳號面板：Email、Google 標籤、「已同步・剛剛」、玩家名稱 `名字#六位數`。
- 「🏆 登頂排行榜」：未登入也看得到；登頂後自己的那列會亮金色。
- 擋彈出視窗的瀏覽器會提示「請允許彈出視窗」。
- 顯示「這個網域尚未加入 Firebase 授權網域」→ 回第 3 步。

## 之後可以加強（需要時再做）
- **App Check**（reCAPTCHA Enterprise）：只允許從正式網站呼叫 Firestore，擋直接打 API 的腳本。
- **Cloud Functions**（要升級 Blaze 方案）：由伺服器根據每局紀錄（種子、時間）驗證後才加次數，是真正的防作弊。
