# GitLanes 0.1.0 — First Public Release

🎉 GitLanes 的第一個正式版！一個給 macOS 的 Git GUI，內建互動式 terminal 與 AI 助手。

## Highlights

### Commit 線圖
- 互動式 DAG 視覺化，支援分支顯示與 commit 詳情
- 右鍵 commit：Checkout / Cherry-pick / Revert / Reset --soft|--hard / Create Tag / Create Branch here / Copy SHA / Copy message
- 右鍵 branch chip：Checkout / Merge into current / Rename / Copy / Delete / Force delete
- 右鍵 tag chip：Delete tag
- 所有破壞性操作含**自然語言確認對話框**，給不熟 git 的使用者也看得懂

### 同步
- Pull / Push / Fetch 按鈕（網路操作快速失敗、不卡住）
- 工具列分支名旁顯示 ↑n ↓n 領先/落後遠端

### 工作區
- 三段式 layout：Commit 線圖 / 工作區 / 內建 Terminal
- 可拖拉調整每段大小，記憶到 localStorage
- 內嵌 VSCode 等級的互動式 Terminal（基於 xterm.js + portable-pty），跟著系統 `$SHELL`、支援 vim/htop、Ctrl-C 中斷
- 切 repo 自動重啟 terminal 到新路徑

### AI 助手
- 可選 provider：Gemini / OpenAI / Anthropic / Ollama
- API key 存 OS keychain（不寫進磁碟、不外洩）
- AI 解釋 diff、AI 產生 commit message
- Markdown 渲染 + 跟隨 UI 語系（中/英）

### 自動更新
- 內建 Tauri updater：新版發佈後 app 啟動會自動探測並提示一鍵更新

### 其他
- 中英雙語介面
- Vitesse Dark Soft 主題
- 線圖列高、字級、配色等細節打磨

## 系統需求

- macOS 11+ (Apple Silicon)
- 已 notarize，雙擊 .dmg 即可使用

## 已知限制

- 目前只發 Apple Silicon (arm64)，Intel Mac 暫不支援
- AI 對話無歷史保留（每次重新提問）
- Terminal 為單一 session、無多分頁
