# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Codex 也讀這份文件：`AGENTS.md` 是指向本檔的 symlink，請把所有專案知識集中寫在 `CLAUDE.md`，不要兩邊各寫一份。

## Commands

純靜態網站，沒有 build / lint / test 流程。

- 本機預覽：`python3 -m http.server 5173`，開 `http://127.0.0.1:5173/`
- 部署：**正式站台是 Cloudflare Pages**（<https://stormcustom.pages.dev/>，專案 `stormcustom`、分支 `main`、account `b3319d3ef0aca7df085274d2f3f19f3e`）。push 到 `main` 由 [.github/workflows/cloudflare-pages.yml](.github/workflows/cloudflare-pages.yml) 自動部署（wrangler 把 `_site` 推上去，需 repo secret `CLOUDFLARE_API_TOKEN`，權限 Account→Cloudflare Pages→Edit）。手動部署：本機建 `_site` 後 `npx wrangler@3 pages deploy _site --project-name=stormcustom --branch=main`（Node 18 要固定 `wrangler@3`，v4 需要更新的 Node）。`_site` 打包規則同 [.github/workflows/pages.yml](.github/workflows/pages.yml)：只含 `index.html` / `styles.css` / `app.js` / `images/` / `.nojekyll`，並 `rm -rf "_site/images/實際色卡"`；README、workflow、`node_modules/` 不會上線。GitHub Pages（pages.yml）保留為備援；**Gitee Pages 已對個人用戶停服，不可用**。
- `node_modules/` 只有 `sharp`，用來離線產生 / 處理 `images/generated-masks/` 與 `images/materials/*.webp`，不是 runtime 相依，runtime 全靠 CDN（three.js、jsPDF、lucide）。

## Architecture

整個 app 是「一個 SVG 模板 + 一組 PNG mask + 一張參考圖」的合成器。理解這條 pipeline 比理解任何單一函式都重要。

### Files that matter
- [index.html](index.html) — DOM 結構、CDN script、表單欄位。所有 `data-field` / `data-model` / `id` 都被 [app.js](app.js) 直接抓取，改名要同步。
- [app.js](app.js) — 全部邏輯（~1900 行，單檔，無模組化、無 bundler）。
- [styles.css](styles.css) — 純 CSS、無前處理器。
- [images/materials/colors.json](images/materials/colors.json) — 色票真相來源（53 色，依實體色卡總表重建），`number` ↔ `image` (`NN.webp`) ↔ `color` 必須對齊；改動會直接影響 swatch、預覽、工廠表格。number 有跳號（總表上不供應 / 缺貨 / 空格的編號不收）。
- [images/實際色卡/](images/實際色卡/) — **build-time 來源檔，非 runtime**：`img0XX.jpg` 是單張皮料掃描（檔名 XX = colors.json 的 number），`色卡總表N.HEIC` 是實體樣本紙板的手機照（編號↔顏色↔供應狀態真相）。`NN.webp` 由這裡產：掃描檔用 sharp 裁中央方形 720px、webp q82；沒掃描的編號用「純色 + gaussian 微皮紋（soft-light）」模擬，色值是從總表照片估的（會有誤差）。這個資料夾 ~85MB，**不應部署**（見下方 Conventions）。
- [images/generated-masks/](images/generated-masks/) — 每個分區一張 luminance mask PNG（白=該區、黑=非該區），尺寸對齊 SHEET 2048×1448。改鞋型/分區邊界 = 重產這些 PNG。
- [images/競速鞋參考圖片/](images/競速鞋參考圖片/)、[images/速樁鞋參考圖片/](images/速樁鞋參考圖片/)、[images/短道鞋參考圖片/](images/短道鞋參考圖片/) — 工廠選色單底圖 JPG（中文資料夾名稱是刻意的，請保留）。短道（冰刀）底圖原檔是 1080×764，SVG 端以 `preserveAspectRatio="none"` 拉伸到 2048×1448，長寬比幾乎一致（誤差 <0.1%），mask 與座標都以 SHEET 座標系對位。
- [scripts/generate-ice-masks.js](scripts/generate-ice-masks.js) — 冰刀 mask 的產生腳本（兩階段：threshold flood fill 先取各區確定像素，再用多源 BFS watershed 把輪廓線暗像素「描邊」分給最近的分區，深度上限 4px，最後補內部封閉孔）。speed / slalom 的 mask 是歷史上手工產的、沒有留腳本；冰刀之後改分區邊界直接調整此腳本的種子點 / 門檻重跑。

### State model
單一 `state` 物件（[app.js:90-105](app.js#L90)）：
- `model`: `"speed"` 競速鞋（A/B/C 三區）、`"slalom"` 速樁鞋（A/B 兩區，C 留在 state 但隱藏）或 `"ice"` 冰刀鞋（短道，A/B/C 三區）。
- `activeZone`: 目前選擇中的分區。
- `fields`: 表單值（日期、隊伍、選手、編號、腳長、加大、孔距、繡名、備註）。
- `zones.A/B/C`: 每區的材質快照 `{ number, code, name, color, image }`。
  - **init 時是空值**（`blankZoneMaterial()`：全部欄位為空 / null），代表「尚未選色」，不會在預覽畫色塊，工廠表格顯示 `--`，share URL 不會帶。
  - 選了 palette 顏色 → number 是 colors.json 的 `number`、code 是兩位數字串、image 指向對應 webp。
  - URL 帶 `?a=ff5500` 這類 hex 但不在 palette 裡 → `number = null`、`color = "#ff5500"`、`name = "自訂色"`，這是「自訂色」狀態，不是空值。
  - 區分空 vs 自訂色用 `isBlankZoneState(data)`：`number == null && !color`。

`activeZones()` 是 model→可見分區的單一真相，**所有 UI / SVG / 匯出邏輯都應該透過它，不要硬編 A/B/C**。

### Render pipeline（核心，別繞過）
1. 使用者改 state（點 swatch / 改表單 / 切鞋款）→ 觸發 `renderSheet()`。
2. `buildSelectionSheetSvg()` 拼一段 SVG 字串：
   - `sheetColorUnderlays()`：每個 zone 一個全幅 `<rect>`，用 `mask="url(#${model}-mask-${zone})"` 把顏色限定在該區。fill 是 `bootZoneFill(zone)` → 對應 zone 的 `<pattern>`（material webp 平鋪）或 hex color。
   - 上層蓋一張參考 JPG，`mix-blend-mode:multiply` 讓底色透出皮紋與陰影 → **這就是「2D 上色」的本質**，沒有真的對圖像做像素處理。
   - 固定不可改色區（speed: 黑碳纖維固定帶；slalom: 鞋口邊條 + A 區腳跟修正）走 `sheetFixedOverlays()`。
   - `includeValues:true` 時才畫表單文字、料號表（給工廠單），`false` 用於上方 2D 預覽。
3. 同一段 SVG 字串：左邊 `#render2dPreview`（裁切 viewBox 只看鞋）、下方 `#sheetPreview`（完整選色單）、匯出 PNG/PDF（`sheetSvgToPng` 把所有 `href` 換成 data URL 再畫到 1.5× canvas）。

**Magic numbers**：`SHEET_WIDTH = 2048` / `SHEET_HEIGHT = 1448` 是參考 JPG 與 mask PNG 的實際像素，整支程式都以它為座標系。`sheetValueOverlays()`、`materialValueOverlays()` 的 x/y 全是手動對齊到參考 JPG 上的欄位位置 — 換參考 JPG 必須重對這些座標。A/B/C 分區字樣由參考 JPG 自己印著，色塊覆蓋（multiply blend）後自然壓暗、不再額外畫文字。

### URL sharing
state 會即時寫回 URL query string（`updateShareUrlFromState` → `history.replaceState`）。`model`、`a` / `b` / `c`（料號或 6 碼 hex）、表單欄位都可分享。`buildShareParams` / `isDefaultFieldForShare` 會省略預設值（當天日期、預設孔距、空 zone）讓 URL 短一點。

reverse 流程在 `applyInitialUrlOverrides`（給 `init()` 與 `popstate` 共用）：**會先把 `state.zones` 重置回 blank**，再依 URL 套色。所以「上一頁回到無參數 URL」會還原成初始空狀態，不會留下殘影。修動這個函式時請維持「reset → 套用 URL」的順序。

### 3D path 目前停用
[app.js:3](app.js#L3) `ENABLE_3D_VIEW = false`。three.js 的 `initThree` / `buildSpeedBoot` / `buildSlalomBoot` / `addCurvedExtruded` 等等都還在但不會跑。要重啟先確認 CDN 上的 three.js 0.160 還在、`zoneMaterials` 與 `state.zones` 的 mapping 還對得起來。改 2D 流程時不必同步維護 3D 函式。

### 鞋款差異（容易踩雷）
- Speed 用 3 區（A/B/C），有黑碳纖維固定帶 overlay。
- Slalom 用 2 區（A/B），有固定鞋口邊條 + A 區腳跟修正 mask；`mount` 欄位被鎖成 `165` 且 disabled（見 `updateMountFieldState` 與 `FIXED_MOUNT_MODELS`）。
- Ice（冰刀 / 短道）用 3 區（A 主鞋面、B 三塊固定帶 / 後跟、C 鞋頭火焰區），沒有 fixed overlay（黑鞋底 / 刀架 / 深灰後跟楔本來就不在任何 mask 內）；`mount` 同 slalom 鎖 `165`（選色單上已預印）。選色單欄位座標與 speed/slalom 不同，見 `SHEET_FIELD_LAYOUTS.ice` 與 `materialTableLayout()`。
- 切 model 時：`activeZones()` 改變 → 需要重畫 `renderZoneTabs()`、`materialPatternDefs()`（mask defs 只為當前 model 產），且 `state.activeZone` 若不在新 model 的可見分區裡必須 reset。

## Conventions / things easy to break

- **改 zone 數量 / 分區語意**：同步改 `zoneLabels`（[app.js:10](app.js#L10)）、`activeZones()`、`initialZones()`、`buildSpeedBoot/buildSlalomBoot` 內的 SVG 顏色填充。
- **改材質檔名**：`images/materials/NN.webp` 是 numeric ID；commit `df07c68` / `e45a47a` 才把舊的中文檔名清掉，請維持純數字檔名 + colors.json 對照。
- **`images/實際色卡/` 不要部署**：~85MB 的原始掃描 / HEIC 是 build-time 來源。[pages.yml](.github/workflows/pages.yml) 目前 `cp -R images _site/images` 會整包打包上 Pages，需排除（或把來源移出 `images/`）。要重產材質貼圖才需要它，runtime 只吃 `images/materials/*.webp`。
- **改 SHEET 尺寸或換參考 JPG**：要重產 [images/generated-masks/](images/generated-masks/) 下所有 mask，並重對 `sheetValueOverlays` 與 `materialValueOverlays` 的座標。
- **font weight**：SVG 文字用 `font-weight="850"` / `"900"`，不是 typo，是要在工廠列印單上夠粗。
- **emoji / 圖示**：UI icon 來自 lucide CDN，新增 icon 用 `<i data-lucide="...">` 並確認 `window.lucide.createIcons()` 之後才出現。

## 文字 / 註解語言

UI 文案、commit message、issue 都用繁體中文。程式碼識別子用英文。本檔內混合中英文是刻意的（給 Claude 與 Codex 都好讀）。
