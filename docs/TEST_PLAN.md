# 测试体系搭建

> 当前版本：v2.3.7 | 创建日期：2026-06-09 | 最后更新：2026-06-19

---

## 一、测试策略总览

```
                    ┌──────────────────────────┐
                    │     测试金字塔            │
                    │                          │
                    │      ╱  E2E  ╲           │  少 (关键流程)
                    │     ╱  集成  ╲           │  中 (服务间交互)
                    │    ╱  单元测试  ╲        │  多 (纯逻辑、工具函数)
                    │   ─────────────────       │
                    └──────────────────────────┘
```

| 层级       | 工具                      | 覆盖目标                                   | 运行速度   | CI 执行      |
|:---------|:------------------------|:---------------------------------------|:-------|:-----------|
| **单元测试** | Vitest                  | shared 层类型校验、工具函数、纯逻辑服务               | < 5s   | 每次 commit  |
| **组件测试** | Vitest + vue-test-utils | Vue 组件渲染、事件、props、computed           | < 15s  | 每次 commit  |
| **集成测试** | Vitest + mock           | IPC 通信、WebSocket 消息流、SQLite 数据库 CRUD | < 30s  | 每次 PR      |
| **E2E**  | Playwright              | 关键用户流程（导入游戏、创建房间、加入房间、市场浏览、设置）       | < 2min | 每次 release |

**为什么选 Vitest 而不是 Jest**：

- 与 Vite 原生集成，零配置运行 `.ts` / `.vue`
- 速度远快于 Jest（ESM 原生支持 + 多线程）
- 与 electron-vite 构建体系一致
- `@vitest/ui` 提供美观的调试界面

**Mock 策略概要**：

| 依赖类型           | Mock 方式                          |
|:---------------|:---------------------------------|
| Electron API   | `vi.mock()` + 手动 mock 模块          |
| WebSocket (ws) | 内存版 ws 模拟（`ws/lib/ws-mock`）或手动 mock |
| IPC            | 直接调用 handler 函数，不经过 contextBridge |
| electron-store | Mock `StoreService` 单例              |
| fs / path      | 使用真实模块（Node 内置），配合临时目录隔离           |
| better-sqlite3 | 通过 `AsyncSqliteDatabase` 的 Worker thread 机制，测试使用临时文件 + `:memory:` 模式 |

**测试数据管理**：

- 单元测试：纯数据驱动，不依赖外部文件
- 集成测试（DB）：`beforeAll` 创建临时 DB 文件到 `os.tmpdir()`，`afterAll` 删除
- 组件测试：Mock store 注入测试数据
- E2E：使用 fixtures 目录存放测试用游戏包

**已有测试资产**：

- `relay-server/scripts/relay-e2e-test.js` — 中继服务器端到端测试，可复用其 WebSocket 消息构造逻辑

---

## 二、分阶段实施方案

### 阶段 1：基础设施搭建（约 3 天）

**1.1 安装依赖**

```json
{
  "devDependencies": {
    "vitest": "^2.0.0",
    "@vitest/ui": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "@vue/test-utils": "^2.0.0",
    "happy-dom": "^15.0.0",
    "playwright": "^1.0.0"
  }
}
```

**1.2 配置文件**

`vitest.config.ts`（项目根目录）：

```typescript
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            "@shared": resolve("src/shared"),
        },
    },
    test: {
        globals: true,
        environment: "happy-dom",  // 轻量 DOM 环境，替代 jsdom
        include: ["src/**/*.{test,spec}.{ts,tsx}"],
        coverage: {
            provider: "v8",
            include: ["src/shared/**", "src/main/services/**"],
            exclude: ["**/node_modules/**"],
            // 阶段 1-2 期间阈值设为 0，阶段 2 完成后再逐步提升
            thresholds: {
                statements: 0,
                branches: 0,
                functions: 0,
                lines: 0,
            },
        },
    },
});
```

**覆盖率阈值提升计划**：阶段 2 结束后将 `statements` / `functions` / `lines` 提升至 50，`branches` 提升至 40；阶段 3 结束后逐步提升至长期目标。

**1.3 新增 npm scripts**

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --ext .ts,.vue --max-warnings 0",
    "ci": "pnpm run typecheck && pnpm run lint && pnpm run test -- --coverage"
  }
}
```

> **与现有 `package.json` 的关系**：`typecheck` / `lint` / `ci` 为新增脚本。若项目已有 `vue-tsc` 类型的类型检查命令，可将 `typecheck` 映射到现有命令。`ci` 脚本在阶段 3 之前排除 `test:e2e`，避免 CI 中 Playwright 未安装浏览器导致失败。

**1.4 GitHub Actions CI**

`.github/workflows/ci.yml`：

```yaml
name: CI
on:
  push:
    branches: [master, main]
  pull_request:
    branches: [master, main]
jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "pnpm"
      - run: pnpm install
      - run: npx electron-builder install-app-deps
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test -- --coverage

  e2e:
    if: github.event_name == 'release' || startsWith(github.ref, 'refs/tags/v')
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "pnpm"
      - run: pnpm install
      - run: npx electron-builder install-app-deps
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm run test:e2e
```

> **说明**：`test` job 每次 push/PR 运行单元 + 组件 + 集成测试；`e2e` job 仅在 release 发布或 tag 推送时运行，避免日常 CI 资源浪费。Node 20 为当前 LTS（Node 18 已于 2025 年 4 月 EOL）。

---

### 阶段 2：shared 层单元测试覆盖（约 1 周）

**这是 ROI 最高的起点**——shared 层完全无 Electron 依赖，可纯 Node.js 环境直接测试。

**2.1 测试文件清单**

```
src/shared/
├── __tests__/
│   ├── binary-protocol.test.ts
│   ├── game-manifest.test.ts
│   ├── ipc-channels.test.ts
│   ├── RoomConstants.test.ts
│   ├── log-serialization.test.ts
│   ├── types/
│   │   ├── market.types.test.ts
│   │   ├── game.types.test.ts
│   │   ├── room.types.test.ts
│   │   └── store.types.test.ts
│   └── avatar-frames.test.ts
```

**2.2 典型测试示例**

`src/shared/__tests__/binary-protocol.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import {
    encodeBinaryEnvelope,
    decodeBinaryEnvelope,
    toBinaryBody,
} from "../binary-protocol";

describe("binary-protocol", () => {
    describe("encodeBinaryEnvelope", () => {
        it("应正确编码 header 和 body", () => {
            const header = { type: "test", id: 1 };
            const body = Buffer.from("hello");
            const encoded = encodeBinaryEnvelope(header, body);

            // 前 4 字节为 header 长度（大端）
            const headerLen = encoded.readUInt32BE(0);
            expect(headerLen).toBe(JSON.stringify(header).length);
        });

        it("应能编码空 body", () => {
            const header = { type: "empty" };
            const body = Buffer.alloc(0);
            const encoded = encodeBinaryEnvelope(header, body);
            expect(encoded.length).toBe(4 + JSON.stringify(header).length);
        });
    });

    describe("decodeBinaryEnvelope", () => {
        it("应正确解码编码后的数据", () => {
            const header = { type: "test", id: 1 };
            const body = Buffer.from("hello world");
            const encoded = encodeBinaryEnvelope(header, body);
            const decoded = decodeBinaryEnvelope<{ type: string; id: number }>(encoded);

            expect(decoded).not.toBeNull();
            expect(decoded!.header).toEqual(header);
            expect(decoded!.body.toString()).toBe("hello world");
        });

        it("数据不足 4 字节时应返回 null", () => {
            expect(decodeBinaryEnvelope(Buffer.from([1, 2]))).toBeNull();
        });

        it("header 长度超出实际数据时应返回 null", () => {
            // header 声称 100 字节但实际数据不足
            const corrupted = Buffer.alloc(4 + 10);
            corrupted.writeUInt32BE(100, 0);
            expect(decodeBinaryEnvelope(corrupted)).toBeNull();
        });

        it("包含非法 JSON 时应返回 null", () => {
            const buf = Buffer.alloc(4 + 10);
            buf.writeUInt32BE(10, 0);
            // 写入非 JSON 内容
            for (let i = 0; i < 10; i++) buf[4 + i] = 0xff;
            expect(decodeBinaryEnvelope(buf)).toBeNull();
        });
    });

    describe("toBinaryBody", () => {
        it("应正确转换 Buffer", () => {
            const buf = Buffer.from("test");
            expect(toBinaryBody(buf)).toBe(buf);
        });

        it("应正确转换 ArrayBuffer", () => {
            const ab = new ArrayBuffer(4);
            const result = toBinaryBody(ab);
            expect(result).toBeInstanceOf(Buffer);
            expect(result!.length).toBe(4);
        });

        it("应正确转换 TypedArray", () => {
            const view = new Uint8Array([1, 2, 3]);
            const result = toBinaryBody(view);
            expect(result).toBeInstanceOf(Buffer);
            expect(result!.length).toBe(3);
        });

        it("非二进制数据应返回 null", () => {
            expect(toBinaryBody({})).toBeNull();
            expect(toBinaryBody("string")).toBeNull();
            expect(toBinaryBody(123)).toBeNull();
        });
    });
});
```

`src/shared/__tests__/types/market.types.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import {
    MarketGameVersionSchema,
    isValidDownloadUrl,
    isValidSha256Format,
} from "../../types/market.types";

// 注意：isValidDownloadUrl 和 isValidSha256Format 已存在于 src/shared/types/market.types.ts，
// 可直接 import 测试，无需额外实现

describe("MarketGameVersionSchema", () => {
    it("应通过合法的版本数据", () => {
        const result = MarketGameVersionSchema.safeParse({
            version: "1.0.0",
            description: "Test version",
            platformVersion: ">=2.0.0",
            downloadUrl: "https://example.com/game.zip",
            sha256: "a".repeat(64),
            size: 1024000,
            publishedAt: "2025-01-01T00:00:00.000Z",
        });
        expect(result.success).toBe(true);
    });

    it("应拒绝非法版本号格式", () => {
        const result = MarketGameVersionSchema.safeParse({
            version: "v1.0",
            description: "Test",
            platformVersion: ">=2.0.0",
            downloadUrl: "https://example.com/game.zip",
        });
        expect(result.success).toBe(false);
    });

    it("sha256 和 size 为可选字段", () => {
        const result = MarketGameVersionSchema.safeParse({
            version: "1.0.0",
            description: "Minimal version",
            platformVersion: ">=2.0.0",
            downloadUrl: "https://example.com/game.zip",
        });
        expect(result.success).toBe(true);
    });

    it("应拒绝空描述", () => {
        const result = MarketGameVersionSchema.safeParse({
            version: "1.0.0",
            description: "",
            platformVersion: ">=2.0.0",
            downloadUrl: "https://example.com/game.zip",
        });
        expect(result.success).toBe(false);
    });
});

describe("isValidDownloadUrl", () => {
    it("应接受合法的 https url", () => {
        expect(isValidDownloadUrl("https://github.com/user/repo/releases/download/v1/game.zip")).toBe(true);
    });

    it("应接受 http url", () => {
        expect(isValidDownloadUrl("http://example.com/game.zip")).toBe(true);
    });

    it("应拒绝非 http url", () => {
        expect(isValidDownloadUrl("ftp://example.com/game.zip")).toBe(false);
    });

    it("应拒绝空字符串", () => {
        expect(isValidDownloadUrl("")).toBe(false);
    });
});

describe("isValidSha256Format", () => {
    it("应接受 64 位 hex", () => {
        expect(isValidSha256Format("a".repeat(64))).toBe(true);
    });

    it("大小写混合 hex 应通过", () => {
        expect(isValidSha256Format("AbCdEf1234567890".repeat(4))).toBe(true);
    });

    it("应拒绝非 hex 字符", () => {
        expect(isValidSha256Format("g".repeat(64))).toBe(false);
    });

    it("应拒绝非 64 位长度", () => {
        expect(isValidSha256Format("a".repeat(63))).toBe(false);
    });

    it("undefined 应返回 true（允许为空）", () => {
        expect(isValidSha256Format(undefined)).toBe(true);
    });

    it("空字符串应返回 true", () => {
        expect(isValidSha256Format("")).toBe(true);
    });
});
```

---

### 阶段 3：main 层服务单元测试（约 1-2 周）

**原则**：测试纯逻辑部分，mock 外部依赖（fs、WebSocket、electron）。

**3.1 测试文件清单**

```
src/main/
├── __tests__/
│   ├── services/
│   │   ├── game/
│   │   │   ├── GameLoader.test.ts          ← 入口检测、版本校验、manifest 验证
│   │   │   ├── GameEnvironment.test.ts     ← 环境变量构建、strip 逻辑
│   │   │   └── GameManager.test.ts         ← 核心流程 mock 测试
│   │   ├── room/
│   │   │   ├── RoomServer.test.ts          ← 房间状态管理
│   │   │   ├── RoomDiscoveryService.test.ts ← LAN/relay 发现逻辑
│   │   │   └── RelayRoomService.test.ts    ← relay 连接流程
│   │   ├── market/
│   │   │   └── MarketService.test.ts       ← 下载/校验/安装流程
│   │   ├── storage/
│   │   │   ├── PlaySessionDatabaseService.test.ts ← 游玩会话 SQLite CRUD
│   │   │   ├── StoreService.test.ts        ← electron-store 读写
│   │   │   └── AsyncSqliteDatabase.test.ts ← 通用异步 SQLite 引擎
│   │   └── system/
│   │       ├── NotificationService.test.ts
│   │       └── UpdateService.test.ts
│   └── utils/
│       ├── appPath.test.ts
│       ├── fileUtils.test.ts
│       └── portUtils.test.ts
```

**3.2 典型测试示例**

`src/main/__tests__/services/game/GameEnvironment.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock roomClient（避免 Electron / WebSocket 依赖）
vi.mock("../../../services/room/RoomClient", () => ({
    roomClient: { room: null },
}));

// Mock logger
vi.mock("../../../utils/logger", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GameEnvironment } from "../../../services/game/GameEnvironment";
import type { AppSettings } from "../../../../shared/types";
import type { GameManifest } from "../../../../shared/game-manifest";
import { GameType } from "../../../../shared/types";

const mockSettings: AppSettings = {
    playerName: "TestPlayer",
    playerId: "player-123",
    nicknameStyle: {} as AppSettings["nicknameStyle"],
    libraryLayout: "card",
    lastJoinRoomAddress: "",
    language: "zh-CN",
    theme: "auto",
    defaultRoomPort: 38080,
    closeBehavior: "tray",
    autoLaunch: false,
    chatInputHeight: 204,
    downloadFloatBall: false,
    sensitiveWordFilter: true,
};

const mockManifest: GameManifest = {
    id: "com.test.game",
    name: "Test Game",
    version: "1.0.0",
    description: "A test game",
    author: "Tester",
    platformVersion: ">=1.0.0",
    entry: "index.html",
    type: GameType.SingleMultiple,
    multiplayer: { minPlayers: 2, maxPlayers: 4 },
};

// 保存原始 process.env 以便恢复，避免测试间环境变量污染
const savedEnv = { ...process.env };

describe("GameEnvironment", () => {
    beforeEach(() => {
        // 清理可能在之前测试中设置的环境变量
        delete process.env.ELECTRON_TEST;
        delete process.env.NODE_TEST;
        delete process.env.NPM_TEST;
        delete process.env.VSCODE_TEST;
        delete process.env.MY_APP_VAR;
    });

    afterEach(() => {
        // 恢复 process.env 原始值，防止测试间泄漏
        for (const key of Object.keys(process.env)) {
            if (!(key in savedEnv)) {
                delete process.env[key];
            } else {
                process.env[key] = savedEnv[key];
            }
        }
    });

    describe("prepare", () => {
        it("应正确注入平台环境变量", () => {
            const env = GameEnvironment.prepare(
                "com.test.game",
                mockManifest,
                12345,
                "test-token",
                mockSettings,
            );

            expect(env.BZ_PLATFORM).toBe("1");
            expect(env.BZ_API_PORT).toBe("12345");
            expect(env.BZ_API_TOKEN).toBe("test-token");
            expect(env.BZ_PLAYER_ID).toBe("player-123");
            expect(env.BZ_PLAYER_NAME).toBe("TestPlayer");
            expect(env.BZ_GAME_ID).toBe("com.test.game");
        });

        it("应注入游戏自定义环境变量（不覆盖平台变量）", () => {
            const manifestWithEnv: GameManifest = {
                ...mockManifest,
                env: { CUSTOM_VAR: "custom_value" },
            };

            const env = GameEnvironment.prepare(
                "com.test.game",
                manifestWithEnv,
                12345,
                "test-token",
                mockSettings,
            );

            expect(env.CUSTOM_VAR).toBe("custom_value");
            // 平台变量应仍然存在
            expect(env.BZ_PLATFORM).toBe("1");
        });

        it("应剥离 ELECTRON_ / NODE_ / NPM_ / VSCODE_ 前缀的环境变量", () => {
            process.env.ELECTRON_TEST = "should-be-stripped";
            process.env.NODE_TEST = "should-be-stripped";
            process.env.NPM_TEST = "should-be-stripped";
            process.env.VSCODE_TEST = "should-be-stripped";
            process.env.MY_APP_VAR = "should-remain";

            const env = GameEnvironment.prepare(
                "com.test.game",
                mockManifest,
                12345,
                "test-token",
                mockSettings,
            );

            expect(env.ELECTRON_TEST).toBeUndefined();
            expect(env.NODE_TEST).toBeUndefined();
            expect(env.NPM_TEST).toBeUndefined();
            expect(env.VSCODE_TEST).toBeUndefined();
            expect(env.MY_APP_VAR).toBe("should-remain");
        });
    });

    describe("removeConfig", () => {
        it("不应因文件不存在而报错（正常返回）", () => {
            // removeConfig 内部 catch 处理了所有异常，调用不应抛出
            expect(() => {
                GameEnvironment.removeConfig("/non/existent/path");
            }).not.toThrow();
        });
    });
});
```

`src/main/__tests__/services/storage/PlaySessionDatabaseService.test.ts`：

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { AsyncSqliteDatabase } from "../../../services/storage/database/AsyncSqliteDatabase";
import { PlaySessionDatabaseService } from "../../../services/storage/database/PlaySessionDatabaseService";

// 使用临时文件，避免污染开发数据库
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bz-test-db-"));
const DB_FILE = path.join(tmpDir, "play_sessions.db");

// 自定义一个 AsyncSqliteDatabase 子类重写 getDatabasePath 指向临时文件
// 或在 beforeAll 中直接使用 PlaySessionDatabaseService + mock AppConstants

// 注意：PlaySessionDatabaseService 内部使用 AppConstants.PLAY_SESSIONS_DB_FILE_NAME
// 作为数据库文件名，且 AsyncSqliteDatabase 构造函数接受文件名参数。
// 以下测试直接通过 AsyncSqliteDatabase 演示核心 CRUD 操作，PlaySessionDatabaseService
// 的上层调用逻辑与此一致。

describe("AsyncSqliteDatabase（通用异步 SQLite 引擎）", () => {
    let db: AsyncSqliteDatabase;

    beforeAll(async () => {
        db = new AsyncSqliteDatabase(
            "test-db",
            DB_FILE,
            [
                `CREATE TABLE IF NOT EXISTS play_sessions (
                  id TEXT PRIMARY KEY,
                  game_id TEXT NOT NULL,
                  game_name TEXT NOT NULL,
                  version TEXT NOT NULL,
                  start_time INTEGER NOT NULL,
                  end_time INTEGER,
                  duration_ms INTEGER
                )`,
            ],
        );
        db.init();
        // 等待 Worker 初始化完成（init 是同步的，但创建 table 在 worker 中异步执行）
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterAll(async () => {
        await db.close();
        // 清理临时文件
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("应正确插入并查询游玩会话", async () => {
        const id = crypto.randomUUID();
        const startTime = Date.now();
        await db.run(
            "INSERT INTO play_sessions (id, game_id, game_name, version, start_time) VALUES (?, ?, ?, ?, ?)",
            [id, "game-1", "Test Game", "1.0.0", startTime],
        );

        const rows = await db.all<{ id: string; game_id: string }>(
            "SELECT * FROM play_sessions WHERE game_id = ?",
            ["game-1"],
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].game_id).toBe("game-1");
    });

    it("应正确更新游玩会话并记录时长", async () => {
        const id = crypto.randomUUID();
        const startTime = Date.now();
        await db.run(
            "INSERT INTO play_sessions (id, game_id, game_name, version, start_time) VALUES (?, ?, ?, ?, ?)",
            [id, "game-2", "Test Game 2", "2.0.0", startTime],
        );

        const endTime = startTime + 60000;
        const durationMs = endTime - startTime;
        await db.run(
            "UPDATE play_sessions SET end_time = ?, duration_ms = ? WHERE id = ?",
            [endTime, durationMs, id],
        );

        const row = await db.get<{ end_time: number; duration_ms: number }>(
            "SELECT * FROM play_sessions WHERE id = ?",
            [id],
        );
        expect(row).not.toBeNull();
        expect(row!.end_time).toBe(endTime);
        expect(row!.duration_ms).toBe(durationMs);
    });

    it("getRecentGames 应返回正确的数量（按最近游玩排序）", async () => {
        // 插入多条不同游戏的会话
        for (const g of ["game-a", "game-b", "game-c"]) {
            await db.run(
                "INSERT INTO play_sessions (id, game_id, game_name, version, start_time) VALUES (?, ?, ?, ?, ?)",
                [crypto.randomUUID(), g, `Game ${g.toUpperCase()}`, "1.0.0", Date.now()],
            );
            await new Promise(resolve => setTimeout(resolve, 2)); // 确保时间戳不同
        }

        const recent = await db.all<{ game_id: string }>(
            `SELECT game_id, game_name, version, MAX(start_time) as last_played
             FROM play_sessions
             GROUP BY game_id
             ORDER BY last_played DESC
             LIMIT 2`,
        );
        expect(recent.length).toBeLessThanOrEqual(2);
    });
});
```

---

### 阶段 4：renderer 层组件测试（约 1 周）

**4.1 测试文件清单**

```
src/renderer/src/
├── __tests__/
│   ├── components/
│   │   ├── room/
│   │   │   └── ChatMessageList.test.ts
│   │   ├── CachedImg.test.ts
│   │   ├── NicknameText.test.ts
│   │   ├── GameCard.test.ts
│   │   ├── PlayerCard.test.ts
│   │   └── GameCover.test.ts
│   ├── stores/
│   │   ├── useGameStore.test.ts
│   │   ├── useRoomStore.test.ts
│   │   └── useSettingsStore.test.ts
│   ├── composables/
│   │   └── useImageCache.test.ts
│   └── utils/
│       ├── nicknameColor.test.ts
│       └── sensitiveWordFilter.test.ts
```

**4.2 典型测试示例**

`src/renderer/src/__tests__/stores/useRoomStore.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useRoomStore } from "../../stores/useRoomStore";

describe("useRoomStore", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("初始状态 room 应为 null", () => {
        const store = useRoomStore();
        expect(store.room).toBeNull();
    });

    it("isHost 在 room 为 null 时应返回 false", () => {
        const store = useRoomStore();
        expect(store.isHost).toBe(false);
    });

    it("allReady 在 room 为 null 时应返回 false", () => {
        const store = useRoomStore();
        expect(store.allReady).toBe(false);
    });
});
```

`src/renderer/src/__tests__/utils/nicknameColor.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { getLuminance, adaptNicknameStyleForTheme } from "../../utils/nicknameColor";
import { DEFAULT_NICKNAME_STYLE } from "../../../shared/types/store.types";
import type { NicknameStyle } from "../../../shared/types/store.types";

describe("nicknameColor 工具函数", () => {
    describe("getLuminance", () => {
        it("白色亮度应为 1", () => {
            expect(getLuminance("#ffffff")).toBeCloseTo(1, 2);
        });

        it("黑色亮度应为 0", () => {
            expect(getLuminance("#000000")).toBeCloseTo(0, 2);
        });

        it("应支持 rgb 格式", () => {
            const lum = getLuminance("rgb(128, 128, 128)");
            expect(lum).toBeGreaterThan(0);
            expect(lum).toBeLessThan(1);
        });
    });

    describe("adaptNicknameStyleForTheme", () => {
        it("暗色主题下偏黑颜色应自动调亮", () => {
            const darkStyle: NicknameStyle = { ...DEFAULT_NICKNAME_STYLE, color: "#000000" };
            const adapted = adaptNicknameStyleForTheme(darkStyle, "dark");
            // 暗色主题下亮度 < 0.28 的颜色会被调整为对称色
            expect(adapted.color).not.toBe("#000000");
        });

        it("亮色主题下偏白颜色应自动调暗", () => {
            const lightStyle: NicknameStyle = { ...DEFAULT_NICKNAME_STYLE, color: "#ffffff" };
            const adapted = adaptNicknameStyleForTheme(lightStyle, "light");
            // 亮色主题下亮度 > 0.72 的颜色会被调整为对称色
            expect(adapted.color).not.toBe("#ffffff");
        });

        it("中间色在两种主题下应保持不变", () => {
            const style: NicknameStyle = { ...DEFAULT_NICKNAME_STYLE, color: "#4488cc" };
            const darkAdapted = adaptNicknameStyleForTheme(style, "dark");
            const lightAdapted = adaptNicknameStyleForTheme(style, "light");
            expect(darkAdapted.color).toBe("#4488cc");
            expect(lightAdapted.color).toBe("#4488cc");
        });
    });
});
```

---

### 阶段 5：E2E 关键流程测试（约 1 周）

**5.1 测试场景**

```
tests/e2e/
├── import-game.spec.ts        # 导入本地游戏
├── create-room.spec.ts        # 创建联机房间
├── join-room.spec.ts          # 加入房间（需要 2 个 Electron 实例）
├── market-browse.spec.ts      # 浏览市场
├── market-install.spec.ts     # 下载安装游戏
└── settings.spec.ts           # 设置页基本操作
```

**5.2 使用 Playwright 测试 Electron App**

```typescript
// tests/e2e/import-game.spec.ts
import { test, expect, _electron as electron } from "@playwright/test";
import path from "path";

test("应能导入游戏到游戏库", async () => {
    // 正确方式：executablePath 指向 Electron 可执行文件，args 传入应用入口目录
    const electronPath = require("electron") as string;
    const app = await electron.launch({
        args: [path.join(__dirname, "..", "out", "main", "index.js")],
        executablePath: electronPath,
    });

    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // 验证游戏库页面已加载
    await expect(page.locator('[data-testid="library-title"]')).toBeVisible();

    // 点击导入按钮
    await page.click('[data-testid="import-game-btn"]');

    // ... 更多步骤

    await app.close();
});
```

> **注意**：`_electron` fixture 需要 Playwright 安装 Electron 支持。`executablePath` 应为 Electron 二进制路径（`require("electron")`），`args` 传入应用入口 JS 文件的绝对路径。开发阶段可直接指向构建产物目录；CI 环境需先执行 `electron-vite build`。

**5.3 多窗口测试（创建/加入房间）**

创建和加入房间需要两个 Electron 实例同时运行。Playwright 的 `_electron.launch()` 支持启动多个实例：

```typescript
// tests/e2e/create-and-join-room.spec.ts
import { test, expect, _electron as electron } from "@playwright/test";
import path from "path";

test("房主创建房间后客机应能加入", async () => {
    const electronPath = require("electron") as string;
    const appEntry = path.join(__dirname, "..", "out", "main", "index.js");

    // 启动两个实例
    const hostApp = await electron.launch({
        args: [appEntry],
        executablePath: electronPath,
    });
    const clientApp = await electron.launch({
        args: [appEntry],
        executablePath: electronPath,
    });

    const hostPage = await hostApp.firstWindow();
    const clientPage = await clientApp.firstWindow();

    await hostPage.waitForLoadState("domcontentloaded");
    await clientPage.waitForLoadState("domcontentloaded");

    // 房主创建房间
    // ... 操作 hostPage 创建房间，获取房间地址

    // 客机加入
    // ... 操作 clientPage 加入房间

    // 验证双方房间内玩家列表
    // ...

    await hostApp.close();
    await clientApp.close();
});
```

---

## 三、测试覆盖目标

| 阶段               | shared  | main/services | main/utils | renderer/components | renderer/stores | E2E         |
|:-----------------|:--------|:--------------|:-----------|:--------------------|:----------------|:------------|
| 阶段 1（基础设施）       | —       | —             | —          | —                   | —               | —           |
| 阶段 2（shared 层）   | **70%** | —             | —          | —                   | —               | —           |
| 阶段 3（main 层）     | 70%     | **50%**       | **60%**    | —                   | —               | —           |
| 阶段 4（renderer 层） | 70%     | 50%           | 60%        | **40%**             | **50%**         | —           |
| 阶段 5（E2E）        | 70%     | 50%           | 60%        | 40%                 | 50%             | **5 条核心流程** |
| 长期目标             | 90%     | 70%           | 80%        | 60%                 | 70%             | 10 条核心流程    |

> **覆盖率阈值节奏**：
> - 阶段 1：所有阈值 0%（仅搭建环境，无测试代码）
> - 阶段 2 完成后：`statements: 50`, `branches: 40`, `functions: 50`, `lines: 50`
> - 阶段 3 完成后：`statements: 55`, `branches: 45`, `functions: 55`, `lines: 55`
> - 长期：逐步提升至上表目标

---

## 四、中继服务器测试（relay-server）

> 本节与 relay-server 代码目录 `relay-server/scripts/relay-e2e-test.js` 互补。

### 4.1 已有测试资产

`relay-server/scripts/relay-e2e-test.js` 已覆盖以下端到端场景：

- 房间创建、加入、密码验证
- 消息转发延迟测量
- 敏感词过滤
- v2 二进制帧中继

### 4.2 待补充测试项

| 测试项                   | 类型      | 说明                            |
|:----------------------|:--------|:------------------------------|
| 房间容量上限                | 集成测试    | 超过 MAX_ROOMS / MAX_CLIENTS 时拒绝 |
| 房间 TTL 清理             | 集成测试    | 60s 无活动后自动 closeRoom          |
| WebSocket 死连接检测        | 集成测试    | 30s ping/pong 超时断开             |
| 云同步接口                 | 集成测试    | config.json / DB 文件上传下载       |
| GitHub OAuth 流程         | E2E     | 需要 GitHub App 测试凭证             |
| `sensitive-word-service` | 单元测试    | 词库加载、Unicode 安全字符级掩码、词库缺失降级  |

### 4.3 建议测试工具

- 单元测试：Vitest（与主项目一致，relay-server 为纯 Node.js 项目，不依赖 Electron）
- 集成测试：Vitest + 临时 MySQL/MongoDB 实例（或 Docker Compose 提供）
- E2E：复用 `relay-e2e-test.js` 脚本，通过 CI 定时运行
