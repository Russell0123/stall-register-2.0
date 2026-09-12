攤位收銀台 — PWA 版
====================

這個資料夾裡有 5 個檔案，請「整包一起」上傳，不要只傳 index.html：

  index.html            主程式
  manifest.webmanifest  App 名稱、圖示、顏色設定
  sw.js                 離線功能（Service Worker）
  icon.svg              App 圖示
  icon-maskable.svg     Android 圓形/水滴圖示用

重點：
- 一定要透過「網址（https://）」開啟，直接用檔案總管點開 index.html 沒有離線與安裝功能。
- 5 個檔案要放在同一層資料夾。
- 之後如果我給你新版 index.html，記得把 sw.js 裡的 "stall-register-v1" 改成 v2、v3…，
  你手機下次連網開啟時才會更新到新版。

--------------------------------------------------
自訂 App 圖示（選用）
--------------------------------------------------
- 想用自己的 logo：把一張正方形 PNG 命名為 logo.png，跟其他檔案放同一層一起上傳。
  建議尺寸 512x512（正方形），背景不要透明。
- 有 logo.png → 安裝到桌面時會用它。
- 沒有 logo.png → 自動改用內建的收據圖示（不會壞）。
- 換了 logo.png 後：手機要「移除舊的 App 圖示再重新安裝」才會換圖示。

--------------------------------------------------
放到網路上的方法（擇一）
--------------------------------------------------

■ 方法 A：Netlify Drop（最快，約 2 分鐘）
  1. 手機或電腦瀏覽器開 https://app.netlify.com/drop
  2. 用 Email 或 Google 註冊 / 登入（免費）
  3. 把「pwa 這個資料夾」整個拖曳到網頁中間的框裡
     （手機的話用電腦做這步比較容易）
  4. 等幾秒，它會給你一個網址，像 https://xxxx-yyyy.netlify.app
  5. 用手機 Chrome 開那個網址 → 右上角 ⋮ → 「加到主畫面 / 安裝應用程式」
  ※ 之後要更新：回到同一個 site 的 Deploys 頁，再拖一次新的資料夾即可。

■ 方法 B：GitHub Pages（免費、永久、好更新）
  1. 到 https://github.com 註冊帳號（免費），記住帳號名稱（下面叫 <你的帳號>）
  2. 登入後點右上角「+」→ New repository
       - Repository name：打 stall-register（或任何名字）
       - 選 Public
       - 勾「Add a README file」
       - 按 Create repository
  3. 進到這個 repository，點「Add file」→「Upload files」
  4. 把 pwa 資料夾裡的 5 個檔案「全選」拖進去（不要拖資料夾本身，要拖「檔案」）
  5. 下方按「Commit changes」
  6. 點上方「Settings」→ 左邊「Pages」
       - Source 選「Deploy from a branch」
       - Branch 選「main」、資料夾選「/ (root)」→ Save
  7. 等 1–2 分鐘，重新整理 Pages 頁面，會出現網址：
       https://<你的帳號>.github.io/stall-register/
  8. 用手機 Chrome 開這個網址 → ⋮ → 「安裝應用程式 / 加到主畫面」
  ※ 之後要更新：回 repository → Add file → Upload files → 傳新的 index.html（覆蓋）→ Commit。

--------------------------------------------------
安裝到手機後
--------------------------------------------------
- 會像一般 App 一樣有圖示、全螢幕、沒有網址列。
- 沒有網路也能開、能用。
- 資料存在這支手機的瀏覽器內。若「清除瀏覽器資料」或移除 App，資料會消失，
  重要營業資料請自行截圖或另外記錄備份。
