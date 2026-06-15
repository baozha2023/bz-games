# 测试体系搭建

> 当前版本：v2.3.7 | 创建日期：2026-06-09

### 一、测试策略总览

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

| 层级       | 工具                      | 覆盖目标                          | 运行速度   | CI 执行      |
|:---------|:------------------------|:------------------------------|:-------|:-----------|
| **单元测试** | Vitest                  | shared/types 校验、工具函数、纯逻辑服务    | < 5s   | 每次 commit  |
| **组件测试** | Vitest + vue-test-utils | Vue 组件渲染、事件、props             | < 15s  | 每次 commit  |
| **集成测试** | Vitest + mock           | IPC 通信、WebSocket 消息流、数据库 CRUD | < 30s  | 每次 PR      |
| **E2E**  | Playwright              | 关键用户流程（导入游戏、创建房间、加入房间）        | < 2min | 每次 release |

**为什么选 Vitest 而不是 Jest**：

- 与 Vite 原生集成，零配置运行 `.ts` / `.vue`
- 速度远快于 Jest（ESM 原生支持 + 多线程）
- 与 electron-vite 构建体系一致
- `@vitest/ui` 提供美观的调试界面

---

### 二、分阶段实施方案

#### 阶段 1：基础设施搭建（约 3 天）

**1.1 安装依赖**

```json
{
  "devDependencies": {
    "vitest": "^2.x",
    "@vitest/ui": "^2.x",
    "@vitest/coverage-v8": "^2.x",
    "@vue/test-utils": "^2.x",
    "happy-dom": "^15.x",
    "playwright": "^1.x"
  }
}
```

**1.2 配置文件**

`vitest.config.ts`（项目根目录）：

```typescript
import {defineConfig} from "vitest/config";
import vue from "@vitejs/plugin-vue";
import {resolve} from "path";

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
            thresholds: {
                statements: 50,   // 初期目标，逐步提升
                branches: 40,
                functions: 50,
                lines: 50,
            },
        },
    },
});
```

**1.3 新增 npm scripts**

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "ci": "npm run typecheck && npm run lint && npm run test -- --coverage"
  }
}
```

**1.4 GitHub Actions CI**

`.github/workflows/ci.yml`：

```yaml
name: CI
on: [ push, pull_request ]
jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 18, cache: "pnpm" }
      - run: pnpm install
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test -- --coverage
```

---

#### 阶段 2：shared 层单元测试覆盖（约 1 周）

**这是 ROI 最高的起点**——shared 层完全无 Electron 依赖，可纯 Node.js 环境直接测试。

**2.1 测试文件清单**

```
src/shared/
├── __tests__/
│   ├── binary-protocol.test.ts
│   ├── game-manifest.test.ts
│   ├── ipc-channels.test.ts
│   ├── RoomConstants.test.ts
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
import {describe, it, expect} from "vitest";
import {
    encodeBinaryEnvelope,
    decodeBinaryEnvelope,
    toBinaryBody,
} from "../binary-protocol";

describe("binary-protocol", () => {
    describe("encodeBinaryEnvelope", () => {
        it("应正确编码 header 和 body", () => {
            const header = {type: "test", id: 1};
            const body = Buffer.from("hello");
            const encoded = encodeBinaryEnvelope(header, body);

            // 前 4 字节为 header 长度（大端）
            const headerLen = encoded.readUInt32BE(0);
            expect(headerLen).toBe(JSON.stringify(header).length);
        });

        it("应能编码空 body", () => {
            const header = {type: "empty"};
            const body = Buffer.alloc(0);
            const encoded = encodeBinaryEnvelope(header, body);
            expect(encoded.length).toBe(4 + JSON.stringify(header).length);
        });
    });

    describe("decodeBinaryEnvelope", () => {
        it("应正确解码编码后的数据", () => {
            const header = {type: "test", id: 1};
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

        it("损坏数据应返回 null", () => {
            const corrupted = Buffer.from([0, 0, 0, 100, 1, 2, 3]); // header 声称 100 字节但实际不足
            expect(decodeBinaryEnvelope(corrupted)).toBeNull();
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
import {describe, it, expect} from "vitest";
import {MarketGameVersionSchema, isValidDownloadUrl, isValidSha256Format} from "../../types/market.types";

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
});

describe("isValidDownloadUrl", () => {
    it("应接受合法的 https url", () => {
        expect(isValidDownloadUrl("https://github.com/user/repo/releases/download/v1/game.zip")).toBe(true);
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
    it("应拒绝非 hex", () => {
        expect(isValidSha256Format("g".repeat(64))).toBe(false);
    });
    it("undefined 应返回 true（允许为空）", () => {
        expect(isValidSha256Format(undefined)).toBe(true);
    });
});
```

---

#### 阶段 3：main 层服务单元测试（约 1-2 周）

**原则**：测试纯逻辑部分，mock 外部依赖（fs、WebSocket、electron）。

**3.1 测试文件清单**

```
src/main/
├── __tests__/
│   ├── services/
│   │   ├── game/
│   │   │   ├── GameLoader.test.ts       ← 入口检测、版本校验、manifest 验证
│   │   │   ├── GameEnvironment.test.ts  ← 环境变量构建、strip 逻辑
│   │   │   └── GameManager.test.ts      ← 核心流程 mock 测试
│   │   ├── room/
│   │   │   ├── RoomServer.test.ts       ← 房间状态管理
│   │   │   ├── RoomDiscoveryService.test.ts ← LAN/relay 发现逻辑
│   │   │   └── RelayRoomService.test.ts ← relay 连接流程
│   │   ├── market/
│   │   │   └── MarketService.test.ts    ← 下载/校验/安装流程
│   │   ├── storage/
│   │   │   ├── DatabaseService.test.ts  ← SQLite CRUD
│   │   │   └── StoreService.test.ts     ← electron-store 读写
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
import {describe, it, expect, vi} from "vitest";

// Mock roomClient（避免 Electron 依赖）
vi.mock("../../services/room/RoomClient", () => ({
    roomClient: {room: null},
}));

// Mock logger
vi.mock("../../utils/logger", () => ({
    logger: {info: vi.fn(), warn: vi.fn(), error: vi.fn()},
}));

import {GameEnvironment} from "../../services/game/GameEnvironment";
import type {AppSettings, GameManifest} from "../../../shared/types";
import {GameType} from "../../../shared/types";

const mockSettings: AppSettings = {
    playerName: "TestPlayer",
    playerId: "player-123",
    nicknameStyle: {} as any,
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
    multiplayer: {minPlayers: 2, maxPlayers: 4},
};

describe("GameEnvironment", () => {
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

        it("应注入游戏自定义环境变量", () => {
            const manifestWithEnv = {
                ...mockManifest,
                env: {CUSTOM_VAR: "custom_value"},
            };

            const env = GameEnvironment.prepare(
                "com.test.game",
                manifestWithEnv as any,
                12345,
                "test-token",
                mockSettings,
            );

            expect(env.CUSTOM_VAR).toBe("custom_value");
            // 平台变量应优先
            expect(env.BZ_PLATFORM).toBe("1");
        });

        it("应剥离 ELECTRON_ 和 NODE_ 前缀的环境变量", () => {
            process.env.ELECTRON_TEST = "should-be-stripped";
            process.env.NODE_TEST = "should-be-stripped";
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
            expect(env.MY_APP_VAR).toBe("should-remain");

            delete process.env.ELECTRON_TEST;
            delete process.env.NODE_TEST;
            delete process.env.MY_APP_VAR;
        });
    });
});
```

`src/main/__tests__/services/storage/DatabaseService.test.ts`：

```typescript
import {describe, it, expect, beforeAll, afterAll} from "vitest";
import {DatabaseService, PlaySession} from "../../services/storage/DatabaseService";

describe("DatabaseService", () => {
    let db: DatabaseService;

    beforeAll(() => {
        db = new DatabaseService();
        db.init();
    });

    afterAll(() => {
        db.close();
    });

    it("应正确创建游玩会话", () => {
        const sessionId = db.startSession("game-1", "Test Game", "1.0.0");
        expect(sessionId).toBeTruthy();

        const sessions = db.getSessions("game-1");
        expect(sessions.length).toBeGreaterThan(0);
        expect(sessions[0].game_name).toBe("Test Game");
    });

    it("应正确结束游玩会话并记录时长", () => {
        const sessionId = db.startSession("game-2", "Test Game 2", "2.0.0");
        db.endSession(sessionId);

        const sessions = db.getSessions("game-2");
        expect(sessions[0].end_time).not.toBeNull();
        expect(sessions[0].duration_ms).not.toBeNull();
    });

    it("getRecentGames 应返回正确的数量", () => {
        db.startSession("game-a", "Game A", "1.0.0");
        db.startSession("game-b", "Game B", "1.0.0");
        db.startSession("game-c", "Game C", "1.0.0");

        const recent = db.getRecentGames(2);
        expect(recent.length).toBeLessThanOrEqual(2);
    });
});
```

---

#### 阶段 4：renderer 层组件测试（约 1 周）

**4.1 测试文件清单**

```
src/renderer/src/
├── __tests__/
│   ├── components/
│   │   ├── room/
│   │   │   └── ChatMessageList.test.ts
│   │   ├── CachedImg.test.ts
│   │   └── NicknameText.test.ts
│   ├── stores/
│   │   ├── useGameStore.test.ts
│   │   ├── useRoomStore.test.ts
│   │   └── useSettingsStore.test.ts
│   ├── composables/
│   │   └── useImageCache.test.ts
│   └── utils/
│       ├── format.test.ts
│       ├── nicknameColor.test.ts
│       └── sensitiveWordFilter.test.ts
```

**4.2 典型测试示例**

`src/renderer/src/__tests__/utils/format.test.ts`：

```typescript
import {describe, it, expect} from "vitest";
// format.ts 中的纯函数
// 假设有 formatSize、formatPlaytime 等

describe("format utilities", () => {
    describe("formatSize", () => {
        it("应正确格式化字节", () => {
            // 测试用例
        });
    });
});
```

`src/renderer/src/__tests__/stores/useRoomStore.test.ts`：

```typescript
import {describe, it, expect, beforeEach} from "vitest";
import {setActivePinia, createPinia} from "pinia";
import {useRoomStore} from "../../stores/useRoomStore";

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

---

#### 阶段 5：E2E 关键流程测试（约 1 周）

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
import {test, expect, _electron as electron} from "@playwright/test";

test("应能导入游戏到游戏库", async () => {
    const app = await electron.launch({
        args: ["."],
        executablePath: "./out/main/index.js",
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

---

### 三、测试覆盖目标

| 阶段               | shared  | main/services | main/utils | renderer/components | renderer/stores | E2E         |
|:-----------------|:--------|:--------------|:-----------|:--------------------|:----------------|:------------|
| 阶段 1（基础设施）       | —       | —             | —          | —                   | —               | —           |
| 阶段 2（shared 层）   | **70%** | —             | —          | —                   | —               | —           |
| 阶段 3（main 层）     | 70%     | **50%**       | **60%**    | —                   | —               | —           |
| 阶段 4（renderer 层） | 70%     | 50%           | 60%        | **40%**             | **50%**         | —           |
| 阶段 5（E2E）        | 70%     | 50%           | 60%        | 40%                 | 50%             | **5 条核心流程** |
| 长期目标             | 90%     | 70%           | 80%        | 60%                 | 70%             | 10 条核心流程    |

---
