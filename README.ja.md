# BZ-Games ゲームプラットフォーム

[![Electron](https://img.shields.io/badge/Electron-v40+-blue)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-v3.5-green)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5-blue)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-multiple--ciphers-orange)](https://www.npmjs.com/package/better-sqlite3-multiple-ciphers)

[简体中文](./README.md) | [English](./README.en.md) | 日本語 | [Deutsch](./README.de.md) | [繁體中文](./README.zh-TW.md)

**BZ-Games** は、Windows 向けに設計された**ローカルファーストのゲームプラットフォーム**です。ユーザーはローカルゲームをインポートし、内蔵の P2P ルームシステムを通じて友人とマルチプレイを楽しめます。LAN 自動検出、自前の frp ダイレクト接続、公式リレーショートアドレスの 3 つの接続方式をサポートし、オプションで GitHub OAuth ログインとクラウドデータ同期も利用できます。

## ✨ 主な機能

- **📂 オープンゲームライブラリ**：仕様準拠のローカルゲームをインポート可能、複数バージョンの共存と切り替えを自動管理。
- **🔌 ローカルファーストデータ**：設定はローカルで暗号化保存、登録不要。オプションで GitHub OAuth ログインによるクラウド同期が可能。
- **🎮 統合オンラインロビー**：ルームシステム（作成／参加／準備完了／チャット／キック／再接続）を内蔵。ゲームは Game API に統合するだけで完全なマルチプレイ機能を利用可能。
- **🌐 マルチ接続方式**：LAN 自動検出、自前 frp 直結、公式リレーサーバーショートアドレスの 3 方式。ルーム発見ページは物理 LAN／仮想 LAN（EasyTier）／サーバーの 3 タブで分類。
- **☁️ GitHub ログイン＆クラウド同期**：GitHub OAuth 認証、`config.json`・`bz_games.db` のクラウドアップロード／ダウンロード、進捗表示と整合性検証付き。
- **🏪 ゲームマーケット**：二層マーケットアーキテクチャ、マルチソースのコミュニティゲーム閲覧・ダウンロード・ワンクリックインストール。進捗・一時停止・再開・キャンセル・フローティング通知に対応。
- **🏆 実績・統計システム**：ゲーム毎に実績リストと統計指標を定義可能。カレンダーヒートマップ、日別／累計／連続プレイ統計、ワンクリックで画像として共有。
- **🪙 経済システム**：毎日チェックインで BZ コイン、累計プレイ時間で自動報酬。アバターフレーム解除・装備、ニックネームの色／フォント／エフェクトのパーソナライズ。
- **🚀 プロセス管理**：ゲームプロセスの自動起動／終了、クラッシュや異常終了にも対応。
- **🎨 ゲーム API**：ローカル Game API サービス（V1/V2 プロトコル）。ゲームは HTTP 経由でセーブデータの読み取り、統計や実績を報告可能。
- **🌍 国際化**：簡体中国語、繁体中国語、英語、日本語、ドイツ語、漢文に対応。

## 📸 スクリーンショット

<p align="center">
  <img src="docs/screenshots/game-library.png" alt="ゲームライブラリ" width="405">
  <img src="docs/screenshots/game-market.png" alt="ゲームマーケット" width="405">
</p>
<p align="center">
  <img src="docs/screenshots/achievements.png" alt="実績" width="405">
  <img src="docs/screenshots/game-statistics.png" alt="ゲーム統計" width="405">
</p>
<p align="center">
  <img src="docs/screenshots/personalization.png" alt="パーソナライズ" width="405">
  <img src="docs/screenshots/settings.png" alt="設定" width="405">
</p>

## 🛠️ 技術スタック

- **Core**: Electron 40, TypeScript 5
- **Frontend**: Vue 3.5, Naive UI, Pinia, Vue Router, Vue I18n
- **Build**: Electron-Vite, Electron-Builder
- **Database**: better-sqlite3-multiple-ciphers（ChaCha20 暗号化 SQLite）
- **Config**: electron-store（暗号化 JSON）
- **Communication**: WebSocket（ws ライブラリ）, Electron IPC
- **Archive**: 7zip-bin / 7za (7Z), adm-zip (ZIP)
- **Image**: html2canvas（ヒートマップ共有レンダリング）
- **Update**: electron-updater (GitHub Releases)

## 🚀 クイックスタート

### 環境要件

- Node.js 20+
- pnpm 9+
- Windows 10/11 x64

### 依存関係のインストール

```bash
pnpm install
```

### 開発モード

開発サーバーを起動（メインプロセスとレンダラープロセスのホットリロード付き）：

```bash
pnpm dev
```

### プロダクションビルド

Windows 用インストーラーとポータブルパッケージをビルド：

```bash
pnpm build:win
```

ビルド成果物は `dist` ディレクトリに生成されます。

## 📁 プロジェクト構成

```
bz-launcher/
├── resources/             # アプリアイコン、プレースホルダー画像等
├── src/
│   ├── main/              # Electron メインプロセス
│   │   ├── index.ts          # エントリ：ウィンドウ管理、アプリライフサイクル
│   │   ├── window.ts         # フローティングボールウィンドウ
│   │   ├── chat-window.ts    # チャットポップアウトウィンドウ
│   │   ├── ipc/              # IPC ハンドラー（game / room / market / stats / system / storage）
│   │   ├── services/         # コアビジネスロジック
│   │   │   ├── game/            # GameManager、GameLoader、GameAPI（V1/V2）
│   │   │   ├── room/            # RoomServer、RoomClient、LAN/UDP/リレー発見
│   │   │   ├── market/          # マーケットダウンロード・インストールタスク管理
│   │   │   ├── storage/         # 暗号化 SQLite（ゲーム、バージョン、セッション、実績、統計）
│   │   │   └── system/          # CloudSync、Update、Notification
│   │   └── utils/            # ロギング、ファイルユーティリティ、パス処理
│   ├── preload/           # Preload スクリプト（game.ts / index.ts + API ブリッジ）
│   ├── renderer/          # レンダラープロセス（Vue 3）
│   │   ├── src/
│   │   │   ├── views/         # ページ（Library / Market / Room / Statistics / Settings 等）
│   │   │   ├── components/    # 共通コンポーネント（game / room / settings / heatmap）
│   │   │   ├── stores/        # Pinia ストア（game / room / settings）
│   │   │   ├── composables/   # コンポーザブル
│   │   │   ├── locales/       # 6 言語 i18n
│   │   │   └── router/        # Vue Router
│   │   └── index.html
│   └── shared/            # メイン・レンダラー共有（型、定数、IPC チャンネル、プロトコル）
├── relay-server/          # 公式リレーサーバー（独立デプロイ）
├── bz-games-admin/        # 管理パネル（フィードバック審査）
└── electron.vite.config.ts
```

> マーケットインデックスデータは独立した [bz-games-market](https://github.com/baozha2023/bz-games-market) リポジトリで管理され、二層マーケットアーキテクチャで配信されます。

開発ガイドラインは `CLAUDE.md` を、ゲーム開発者向けガイドは `DEVELOPER_GUIDE.md` を、Game API ドキュメントは `docs/GAME_API_V1_V2_REFERENCE.md` を、将来計画は `docs/ROADMAP.md` を参照してください。
