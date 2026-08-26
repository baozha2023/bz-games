# BZ-Games Spieleplattform

[![Electron](https://img.shields.io/badge/Electron-v40+-blue)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-v3.5-green)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5-blue)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-multiple--ciphers-orange)](https://www.npmjs.com/package/better-sqlite3-multiple-ciphers)

[简体中文](./README.md) | [English](./README.en.md) | [日本語](./README.ja.md) | Deutsch | [繁體中文](./README.zh-TW.md)

**BZ-Games** ist eine **lokal-zentrierte Spieleplattform** für Windows. Sie ermöglicht das Importieren lokaler Spiele und das Spielen mit Freunden über das integrierte P2P-Raumsystem. Unterstützt werden LAN-Erkennung, benutzerdefinierte frp-Direktverbindungen und offizielle Relay-Kurzadressen als Verbindungsoptionen, ergänzt durch optionalen GitHub OAuth-Login und Cloud-Datensynchronisation.

## ✨ Kernfunktionen

- **📂 Offene Spielebibliothek**: Import beliebiger spezifikationskonformer lokaler Spiele mit automatischer Mehrversionen-Verwaltung.
- **🔌 Lokale Datenpriorität**: Konfigurationen werden lokal verschlüsselt gespeichert – kein Konto erforderlich. Optionaler GitHub OAuth-Login für Cloud-Synchronisation.
- **🎮 Einheitliche Online-Lobby**: Integriertes Raumsystem (Erstellen/Beitreten/Bereit/Chat/Kicken/Wiederverbindung). Spiele benötigen nur die Game API für vollständige Mehrspielerfähigkeit.
- **🌐 Mehrere Verbindungsoptionen**: LAN-Erkennung, benutzerdefinierte frp-Direktverbindung und offizielle Relay-Server-Kurzadressen. Raumentdeckungsseite nach physischem LAN / virtuellem LAN (EasyTier) / Server klassifiziert.
- **☁️ GitHub Login & Cloud-Sync**: GitHub OAuth-Authentifizierung, `config.json` und `bz_games.db` per Cloud-Upload/Download, mit Fortschrittsbalken und Integritätsprüfung.
- **🏪 Spielmarkt**: Zweistufige Marktarchitektur, Community-Spiele aus mehreren Quellen durchsuchen und mit einem Klick installieren. Download-Aufgaben mit Fortschritt, Pause, Fortsetzen, Abbrechen und schwebenden Benachrichtigungen.
- **🏆 Erfolge & Statistiken**: Spiele definieren Erfolgslisten und Statistiken — automatisch von der Plattform verfolgt. Kalender-Heatmap mit täglichen/kumulativen/aufeinanderfolgenden Statistiken, mit einem Klick als Bild teilen.
- **🪙 Wirtschaftssystem**: Tägliche Anmeldung für BZ-Münzen, automatische Belohnungen für kumulative Spielzeit. Avatar-Rahmen freischalten und ausrüsten, Spitzname-Farbe/Schriftart/Effekt personalisieren.
- **🚀 Prozessverwaltung**: Automatisches Starten/Beenden von Spielprozessen mit Behandlung von Abstürzen und abnormalen Beendigungen.
- **🎨 Game API**: Lokaler Game API-Dienst (V1/V2-Protokolle). Spiele können per HTTP Spielstände lesen, Statistiken melden und Erfolge freischalten.
- **🌍 Internationalisierung**: Unterstützt Chinesisch (Vereinfacht & Traditionell), Englisch, Japanisch, Deutsch und Klassisches Chinesisch.

## 📸 Screenshots

<p align="center">
  <img src="docs/screenshots/game-library.png" alt="Spielebibliothek" width="405">
  <img src="docs/screenshots/game-market.png" alt="Spielmarkt" width="405">
</p>
<p align="center">
  <img src="docs/screenshots/achievements.png" alt="Erfolge" width="405">
  <img src="docs/screenshots/game-statistics.png" alt="Spielstatistiken" width="405">
</p>
<p align="center">
  <img src="docs/screenshots/personalization.png" alt="Personalisierung" width="405">
  <img src="docs/screenshots/settings.png" alt="Einstellungen" width="405">
</p>

## 🛠️ Technologie-Stack

- **Core**: Electron 40, TypeScript 5
- **Frontend**: Vue 3.5, Naive UI, Pinia, Vue Router, Vue I18n
- **Build**: Electron-Vite, Electron-Builder
- **Database**: better-sqlite3-multiple-ciphers (ChaCha20-verschlüsseltes SQLite)
- **Config**: electron-store (verschlüsseltes JSON)
- **Communication**: WebSocket (ws-Bibliothek), Electron IPC
- **Archive**: 7zip-bin / 7za (7Z), adm-zip (ZIP)
- **Image**: html2canvas (Heatmap-Teilen-Rendering)
- **Update**: electron-updater (GitHub Releases)

## 🚀 Schnellstart

### Voraussetzungen

- Node.js 20+
- pnpm 9+
- Windows 10/11 x64

### Abhängigkeiten installieren

```bash
pnpm install
```

### Entwicklungsmodus

Entwicklungsserver starten (mit Hot-Reload für Haupt- und Renderer-Prozess):

```bash
pnpm dev
```

### Produktions-Build

Windows-Installer und portable Pakete erstellen:

```bash
pnpm build:win
```

Die Build-Artefakte befinden sich im `dist`-Verzeichnis.

## 📁 Projektstruktur

```
bz-launcher/
├── resources/             # App-Icons, Platzhalterbilder und statische Ressourcen
├── src/
│   ├── main/              # Electron-Hauptprozess
│   │   ├── index.ts          # Einstieg: Fensterverwaltung, App-Lebenszyklus
│   │   ├── window.ts         # Schwebendes Ball-Fenster
│   │   ├── chat-window.ts    # Chat-Popup-Fenster
│   │   ├── ipc/              # IPC-Handler (game / room / market / stats / system / storage)
│   │   ├── services/         # Kerngeschäftslogik
│   │   │   ├── game/            # GameManager, GameLoader, GameAPI (V1/V2)
│   │   │   ├── room/            # RoomServer, RoomClient, LAN/UDP/Relay-Erkennung
│   │   │   ├── market/          # Markt-Download- & Installationsaufgaben
│   │   │   ├── storage/         # Verschlüsseltes SQLite (Spiele, Versionen, Sitzungen, Erfolge, Statistiken)
│   │   │   └── system/          # CloudSync, Update, Benachrichtigungen
│   │   └── utils/            # Logging, Datei-Hilfsfunktionen, Pfadbehandlung
│   ├── preload/           # Preload-Skripte (game.ts / index.ts + API-Brücke)
│   ├── renderer/          # Renderer-Prozess (Vue 3)
│   │   ├── src/
│   │   │   ├── views/         # Seiten (Library / Market / Room / Statistics / Settings usw.)
│   │   │   ├── components/    # Gemeinsame Komponenten (game / room / settings / heatmap)
│   │   │   ├── stores/        # Pinia-Stores (game / room / settings)
│   │   │   ├── composables/   # Composables
│   │   │   ├── locales/       # 6-sprachige i18n
│   │   │   └── router/        # Vue Router
│   │   └── index.html
│   └── shared/            # Gemeinsam genutzt (Typen, Konstanten, IPC-Kanäle, Protokolle)
├── relay-server/          # Offizieller Relay-Server (eigenständige Bereitstellung)
├── bz-games-admin/        # Admin-Panel (Feedback-Prüfung)
└── electron.vite.config.ts
```

> Die Markt-Indexdaten werden im unabhängigen [bz-games-market](https://github.com/baozha2023/bz-games-market)-Repository verwaltet und über eine zweistufige Marktarchitektur verteilt.

Weitere Details: Entwicklungsrichtlinien `CLAUDE.md`, Spieleentwickler `DEVELOPER_GUIDE.md`, Game API `docs/GAME_API_V1_V2_REFERENCE.md`, Roadmap `docs/ROADMAP.md`.
