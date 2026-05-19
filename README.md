# STORM SKATES 客製鞋選色工具

純靜態客製鞋選色頁，可部署到 GitHub Pages。

## 本機預覽

```bash
python3 -m http.server 5173
```

開啟：

```text
http://127.0.0.1:5173/
```

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
