# BZ-Games Spieleplattform

[![Electron](https://img.shields.io/badge/Electron-v28+-blue)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-v3-green)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5-blue)](https://www.typescriptlang.org/)

[简体中文](./README.md) | [English](./README.en.md) | [日本語](./README.ja.md) | Deutsch | [繁體中文](./README.zh-TW.md) | [文言文](./README.lzh.md)

**BZ-Games** ist eine **lokal-zentrierte Spieleplattform** für Windows. Sie ermöglicht das Importieren lokaler Spiele und das Spielen mit Freunden über das integrierte P2P-Raumsystem. Unterstützt werden LAN-Erkennung, benutzerdefinierte frp-Direktverbindungen und offizielle Relay-Kurzadressen als Verbindungsoptionen, ergänzt durch GitHub OAuth-Login und Cloud-Datensynchronisation.

## ✨ Kernfunktionen

- **📂 Offene Spielebibliothek**: Import beliebiger spezifikationskonformer lokaler Spiele mit automatischer Versions- und Dateiverwaltung.
- **🔌 Lokale Datenpriorität**: Alle Daten werden lokal gespeichert, Konfigurationsdateien verschlüsselt – kein Cloud-Konto erforderlich. Optionaler GitHub OAuth-Login für Cloud-Synchronisation.
- **🎮 Einheitliche Online-Lobby**: Integriertes Raumsystem (Erstellen/Beitreten/Bereit/Chat/Kicken/Wiederverbindung). Spiele benötigen nur die lokale Game API für vollständige Mehrspielerfähigkeit.
- **🌐 Mehrere Verbindungsoptionen**: LAN-Erkennung, benutzerdefinierte frp-Direktverbindung und offizielle Relay-Server-Kurzadressen – je nach Situation umschaltbar. Raumentdeckungsseite klassifiziert nach physischem LAN / virtuellem LAN / Server.
- **☁️ GitHub Login & Cloud-Sync**: GitHub OAuth-Authentifizierung, Upload/Download von `config.json` und `play_sessions.db` in die Cloud, mit Fortschrittsbalken und Hash-Prüfung.
- **🏪 Spielmarkt**: Durchsuchen und Herunterladen von Community-Spielen aus mehreren Quellen. Download-Aufgaben mit Fortschritt, Pause, Fortsetzen, Abbrechen und schwebenden Benachrichtigungen. Automatische Prüfung und Import.
- **🏆 Erfolge & Statistiken**: Jedes Spiel kann Erfolgslisten und Statistiken definieren – automatisch von der Plattform verfolgt und angezeigt. Kalender-Heatmap und Spielberichte.
- **🪙 Wirtschaftssystem**: Tägliche Anmeldung für BZ-Münzen, automatische Belohnungen für kumulative Spielzeit. Avatar-Rahmen freischalten und ausrüsten, Spitznamenfarben/-schriftarten/-effekte personalisieren.
- **🚀 Prozessverwaltung**: Automatisches Starten/Beenden von Spielprozessen mit Behandlung abnormaler Beendigungen.
- **🔄 Versionsverwaltung**: Unterstützt Koexistenz und Wechsel mehrerer Versionen desselben Spiels.
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

- **Core**: Electron, TypeScript
- **Frontend**: Vue 3, Naive UI, Pinia, Vue Router
- **Build**: Electron-Vite, Electron-Builder
- **Storage**: electron-store (Lokales JSON)
- **Communication**: WebSocket (Room Server/Client), Electron IPC
- **Archive**: extract-zip (ZIP), 7zip-bin / 7za (7Z)
- **Update**: electron-updater (GitHub Releases)

## 🚀 Schnellstart

### Voraussetzungen

- Node.js 18+
- pnpm 8+
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
├── games/                 # Spieldaten-Verzeichnis (Portabler Modus)
├── src/
│   ├── main/              # Electron-Hauptprozess (Node.js)
│   │   ├── services/      # Kerngeschäftslogik (GameManager, RoomServer, CloudSyncService usw.)
│   │   └── ipc/           # IPC-Kommunikationshandler
│   ├── preload/           # Preload-Skripte (sichere API-Bereitstellung)
│   ├── renderer/          # Renderer-Prozess (Vue 3 UI)
│   └── shared/            # Gemeinsame Typdefinitionen für Haupt-/Renderer-Prozess
├── relay-server/          # Offizieller Relay-Server (Raum-Relay / GitHub OAuth / Cloud-Sync)
├── resources/             # App-Icons und statische Ressourcen
└── electron.vite.config.ts
```

> Die Markt-Indexdaten werden im unabhängigen [bz-games-market](https://github.com/baozha2023/bz-games-market)-Repository verwaltet und über eine zweistufige Marktarchitektur verteilt.

Weitere Details finden Sie in den Entwicklungsrichtlinien in `CLAUDE.md`.
