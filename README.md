# FoodLens 🍽️ 食物熱量辨識器

拍照或上傳食物圖片，AI 即時分析熱量與營養成分。

## ✨ 功能

- 📸 **拍照 / 上傳圖片** — 支援 JPG、PNG、WebP
- 🤖 **AI 食物辨識** — 使用 Google Gemini API 智能分析
- 🔢 **營養成分分析** — 熱量、蛋白質、碳水、脂肪、膳食纖維
- 📋 **每日紀錄** — 自動記錄今日所有分析結果與總熱量
- 🔐 **隱私安全** — API Key 僅存於瀏覽器 localStorage，不上傳伺服器

## 🚀 使用方式

1. 前往 [Google AI Studio](https://aistudio.google.com/apikey) 取得免費 API Key
2. 開啟 FoodLens，輸入 API Key
3. 拍照或上傳食物圖片
4. 點擊「分析熱量」，等待 AI 回覆

## 🛠️ 技術架構

- 純前端靜態網站（HTML + CSS + JavaScript）
- Google Gemini 2.0 Flash API
- GitHub Pages 部署
- 響應式設計，支援桌面與行動裝置

## 📦 部署

本專案為純靜態檔案，直接推送到 GitHub 並啟用 Pages 即可：

```bash
git init
git add .
git commit -m "init: FoodLens 食物熱量辨識器"
git remote add origin <your-repo-url>
git push -u origin main
```

在 GitHub Repo → Settings → Pages → Source 選擇 `main` branch → `/ (root)`

## 📄 License

MIT
