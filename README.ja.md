# BZ-Games ゲームプラットフォーム

[![Electron](https://img.shields.io/badge/Electron-v28+-blue)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-v3-green)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5-blue)](https://www.typescriptlang.org/)

[中文](./README.md) | [English](./README.en.md) | 日本語

**BZ-Games** は、Windows 向けに設計された**サーバーレス・ローカルゲームプラットフォーム**です。ユーザーはローカルゲームをインポートし、内蔵の P2P ルームシステムを通じて友人とマルチプレイを楽しめます。サードパーティのゲームサーバーに依存する必要はありません。

## ✨ 主な機能

- **📂 オープンゲームライブラリ**：仕様に準拠した任意のローカルゲームをインポート可能で、バージョンとファイルを自動管理します。
- **🔌 サーバーレスアーキテクチャ**：すべてのデータはローカルに保存され、クラウドアカウントシステムに依存しません。
- **🎮 統合オンラインロビー**：ルームシステム（作成/参加/準備完了）を内蔵しているため、ゲーム側で複雑なネットワークロビーを実装する必要がありません。
- **🌐 柔軟な NAT 越え**：標準 TCP ポートでルームを公開し、SakuraFrp などの任意の NAT 越えツールと互換性があります。
- **🚀 プロセス管理**：ゲームプロセスの起動/終了を自動化し、異常終了にも対応します。
- **🔄 バージョン管理**：同一ゲームの複数バージョンの共存と切り替えをサポートします。
- **🏪 ゲームマーケット**：リモートでのゲーム発見、閲覧、ダウンロード、インストールが可能。`.zip` と `.7z` 形式に対応。
- **🏆 実績・統計システム**：各ゲームで実績リストと統計データを定義可能、プラットフォームが自動追跡・表示します。
- **🪙 経済システム**：毎日のチェックインで BZ コインを獲得、累計プレイ時間に応じた自動報酬。
- **🌍 国際化**：中国語、英語、日本語に対応。

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

- **Core**: Electron, TypeScript
- **Frontend**: Vue 3, Naive UI, Pinia, Vue Router
- **Build**: Electron-Vite, Electron-Builder
- **Storage**: electron-store (ローカル JSON)
- **Communication**: WebSocket (Room Server/Client), Electron IPC
- **Archive**: extract-zip (ZIP), 7zip-bin / 7za (7Z)
- **Update**: electron-updater (GitHub Releases)

## 🚀 クイックスタート

### 環境要件

- Node.js 18+
- pnpm 8+
- Windows 10/11 x64

### 依存関係のインストール

```bash
pnpm install
```

### 開発モード

開発サーバーを起動します（メインプロセスとレンダラープロセスのホットリロード付き）：

```bash
pnpm dev
```

### プロダクションビルド

Windows 用のインストーラーとポータブルパッケージをビルドします：

```bash
pnpm build:win
```

ビルド成果物は `dist` ディレクトリに生成されます。

## 📁 プロジェクト構成

```
bz-launcher/
├── games/                 # ゲームデータ保存ディレクトリ (ポータブルモード)
├── src/
│   ├── main/              # Electron メインプロセス (Node.js)
│   │   ├── services/      # コアビジネスロジック (GameManager, RoomServer など)
│   │   └── ipc/           # IPC 通信ハンドラー
│   ├── preload/           # Preload スクリプト (安全な API の公開)
│   ├── renderer/          # レンダラープロセス (Vue 3 UI)
│   └── shared/            # メイン・レンダラー共有の型定義
├── resources/             # アプリアイコンと静的リソース
└── electron.vite.config.ts
```

> マーケットインデックスデータは独立した [bz-games-market](https://github.com/baozha2023/bz-games-market) リポジトリで管理され、二層マーケットアーキテクチャで配信されます。

詳細については、`CLAUDE.md` の開発ガイドラインを参照してください。
