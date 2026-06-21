# STORM SKATES 客製鞋選色工具

純靜態客製鞋選色頁。正式站台部署在 **Cloudflare Pages**：<https://stormcustom.pages.dev/>（GitHub Pages 設定保留為備援）。

## 本機預覽

```bash
python3 -m http.server 5173
```

開啟：

```text
http://127.0.0.1:5173/
```

## Cloudflare Pages 部署（正式線上）

正式站台：<https://stormcustom.pages.dev/>（Cloudflare Pages 專案 `stormcustom`、production 分支 `main`）。

### 自動部署（推薦）

[.github/workflows/cloudflare-pages.yml](.github/workflows/cloudflare-pages.yml) 會在每次 push 到 `main` 時，用 Wrangler 把 `_site` 部署到 Cloudflare Pages。只需在 GitHub repo 設定**一個** secret：

1. `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`
2. 名稱 `CLOUDFLARE_API_TOKEN`，值為一組有 `Account` -> `Cloudflare Pages` -> `Edit` 權限的 Cloudflare API Token

（Account ID `b3319d3ef0aca7df085274d2f3f19f3e` 已寫在 workflow 裡，非機密、不需另設。）

### 手動部署（本機）

Node 18 請固定 `wrangler@3`：

```bash
rm -rf _site && mkdir -p _site
cp index.html styles.css app.js _site/
cp -R images _site/images
rm -rf "_site/images/實際色卡"
touch _site/.nojekyll

export CLOUDFLARE_API_TOKEN=<你的 token>
export CLOUDFLARE_ACCOUNT_ID=b3319d3ef0aca7df085274d2f3f19f3e
npx wrangler@3 pages deploy _site --project-name=stormcustom --branch=main --commit-dirty=true
```

> 中國大陸可訪問（走海外節點，速度不保證）；免費、免實名。Gitee Pages 已對個人停服，不可用。

## GitHub Pages 部署

1. 建立 GitHub repository，並把這個資料夾推到 `main` 分支。
2. 到 repository 的 `Settings` -> `Pages`。
3. 在 `Build and deployment` 的 `Source` 選擇 `GitHub Actions`。
4. 推送到 `main` 後，`.github/workflows/pages.yml` 會自動部署。
5. 部署完成後可在 Actions 頁面或 Pages 設定頁看到網址，通常是：

```text
https://<你的帳號>.github.io/<repository-name>/
```

## 部署內容

GitHub Actions 只會發布：

- `index.html`
- `styles.css`
- `app.js`
- `images/`
- `.nojekyll`

不會把 workflow 或 README 打包到公開網站裡。

## 材質顏色設定

色票由 `images/materials/colors.json` 控制：

```json
[
  {
    "Number": 1,
    "Name": "深紅色",
    "Image": "images/materials/01-deep-red.png"
  }
]
```

`Number` 會顯示為兩位數料號，例如 `01/深紅色`；`Image` 會直接作為 A / B / C 分區與工廠表格色塊的材質填充。
