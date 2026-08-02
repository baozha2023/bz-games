# BZ-Games 嬉遊臺

[![Electron](https://img.shields.io/badge/Electron-v40+-blue)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-v3.5-green)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5-blue)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-multiple--ciphers-orange)](https://www.npmjs.com/package/better-sqlite3-multiple-ciphers)

[簡體中文](./README.md) | [English](./README.en.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [繁體中文](./README.zh-TW.md) | 文言文

**BZ-Games** 者，**以本機為本之 Windows 嬉遊臺**也，專為 Windows 而作。允用者匯入本機之嬉，藉內置 P2P 聯機房舍與友朋共嬉。可通局域網自覓、用者自備 frp 直連、官府中繼短址三徑而入，兼有 GitHub OAuth 登入及雲端同步之能。

## ✨ 精粹

- **📂 無羈嬉庫**：凡嬉合式者，皆可匯入，多版共存切替自為理之。
- **🔌 本機為上**：設文加密而藏於本機，不假註冊。亦可 GitHub OAuth 登入以成雲端同步。
- **🎮 合轍聯機廳**：內置房舍之制（創房／入房／備戰／言語／逐客／斷而復續），嬉者但接 Game API 即可得全聯機之能。
- **🌐 三徑聯機**：局域網自覓、自備 frp 直達、官府中繼伺服短址中轉。覓房之頁以實體局域網／虛局域網（EasyTier）／伺服三欄而別。
- **☁️ GitHub 登入雲同步**：假 GitHub OAuth 授權而入，可將 `config.json`、`bz_games.db` 上傳至雲、下載歸本機，附進度條與雜湊校驗。
- **🏪 嬉市**：二級市集之構，可覽多源社群嬉作而下之、一鍵裝之，下載之功可進度、可暫、可續、可廢，懸浮球以警。
- **🏆 功績統計**：每嬉可定功績之錄與統計之標，嬉遊臺自為追蹤。觀日曆熱力圖、單日／累積／連綿嬉時之計，可一鍵分享為圖。
- **🪙 泉貨之制**：每日簽到得 BZ 幣，累嬉時長自獲賞賜。頭像之框可解鎖而佩，昵稱之色、字、效皆可自定。
- **🚀 程控之術**：嬉程啟閉自為之，崩潰異變亦為處置。
- **🎨 嬉界面**：本地 Game API 服務（V1/V2 約），嬉可假 HTTP 讀存檔、上報統計與功績。
- **🌍 萬邦語**：通簡體中文、繁體中文、英文、日文、德文、文言文。

## 📸 覽圖

<p align="center">
  <img src="docs/screenshots/game-library.png" alt="嬉庫" width="405">
  <img src="docs/screenshots/game-market.png" alt="嬉市" width="405">
</p>
<p align="center">
  <img src="docs/screenshots/achievements.png" alt="功績" width="405">
  <img src="docs/screenshots/game-statistics.png" alt="嬉統計" width="405">
</p>
<p align="center">
  <img src="docs/screenshots/personalization.png" alt="個性裝扮" width="405">
  <img src="docs/screenshots/settings.png" alt="設定" width="405">
</p>

## 🛠️ 工技

- **樞機**: Electron 40, TypeScript 5
- **前臺**: Vue 3.5, Naive UI, Pinia, Vue Router, Vue I18n
- **構策**: Electron-Vite, Electron-Builder
- **庫儲**: better-sqlite3-multiple-ciphers（ChaCha20 加密 SQLite）
- **設儲**: electron-store（加密 JSON）
- **通訊**: WebSocket（ws 庫）, Electron IPC
- **解囊**: 7zip-bin / 7za (7Z), adm-zip (ZIP)
- **圖繪**: html2canvas（熱力圖分享渲染）
- **新之**: electron-updater (GitHub Releases)

## 🚀 速啟

### 境求

- Node.js 20+
- pnpm 9+
- Windows 10/11 x64

### 裝諸依

```bash
pnpm install
```

### 開發態

啟開發伺服（主程與渲程皆可熱更）：

```bash
pnpm dev
```

### 產製構建

構 Windows 裝包與免裝包：

```bash
pnpm build:win
```

構物在 `dist` 錄中。

## 📁 項目之構

```
bz-launcher/
├── resources/             # 應用圖示、佔位圖等靜物
├── src/
│   ├── main/              # Electron 主程
│   │   ├── index.ts          # 入戶：窗管、應用命週
│   │   ├── window.ts         # 懸浮球窗
│   │   ├── chat-window.ts    # 言語彈窗
│   │   ├── ipc/              # IPC 處置（game / room / market / stats / system / storage）
│   │   ├── services/         # 樞機商務
│   │   │   ├── game/            # GameManager、GameLoader、GameAPI（V1/V2）
│   │   │   ├── room/            # RoomServer、RoomClient、局域網/UDP/中繼發現
│   │   │   ├── market/          # 市集下載與裝任管理
│   │   │   ├── storage/         # 加密 SQLite（戲、版本、會、成就、統計）
│   │   │   └── system/          # CloudSync、Update、Notification
│   │   └── utils/            # 誌記、檔具、徑處
│   ├── preload/           # Preload 策本（game.ts / index.ts + API 橋）
│   ├── renderer/          # 渲程（Vue 3）
│   │   ├── src/
│   │   │   ├── views/         # 頁面（Library / Market / Room / Statistics / Settings 等）
│   │   │   ├── components/    # 公共組件（game / room / settings / heatmap）
│   │   │   ├── stores/        # Pinia（game / room / settings）
│   │   │   ├── composables/   # 組合之函
│   │   │   ├── locales/       # 6 語萬邦語
│   │   │   └── router/        # Vue Router
│   │   └── index.html
│   └── shared/            # 前後共享（型別、常數、IPC 道、約）
├── relay-server/          # 官府中繼伺服（獨立部署）
├── bz-games-admin/        # 治事後臺（反饋審核）
└── electron.vite.config.ts
```

> 市集索引之資由獨立之 [bz-games-market](https://github.com/baozha2023/bz-games-market) 倉所轄，嬉遊臺假二級市集之構以取展之。

詳參 `CLAUDE.md` 中之開發繩墨，嬉者開發指南見 `DEVELOPER_GUIDE.md`，嬉界面約見 `docs/GAME_API_V1_V2_REFERENCE.md`，來日之規見 `docs/ROADMAP.md`。
