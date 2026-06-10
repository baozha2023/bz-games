# Relay 去中心化 + 测试体系搭建 规划文档

> 当前版本：v2.3.7 | 创建日期：2026-06-09

---

## 第一部分：联机架构去中心化改造

### 一、现状分析

#### 1.1 当前架构

```
┌──────────────┐                              ┌──────────────┐
│  房主 (Host)  │──── WebSocket ────┐  ┌───────│  访客 (Guest) │
│  RoomServer  │                   │  │       │  RoomClient  │
└──────────────┘                   ▼  ▼       └──────────────┘
                             ┌──────────────┐
                             │ Relay Server │  ← 单点瓶颈
                             │  (Node.js)   │
                             └──────────────┘
                                    ▲
                             ┌──────────────┐
                             │  访客 (Guest) │
                             │  RoomClient  │
                             └──────────────┘
```

**核心问题**：

| 问题 | 详情 |
|:---|:---|
| **单点故障** | Relay Server 宕机 → 所有跨网络联机瘫痪 |
| **容量上限** | 硬编码 80 房间、400 客户端、每房间 8 人 |
| **中心化信任** | 所有消息经过中心节点，无端到端加密 |
| **延迟不可控** | 消息必经 Relay 中转，无法 P2P 直连 |
| **运营成本** | 需自建服务器，大流量时带宽成本高 |
| **无 NAT 穿透** | 没有任何 STUN/TURN/UPnP/ICE 机制 |

#### 1.2 关键代码路径

| 文件 | 职责 | 改动影响 |
|:---|:---|:---|
| `relay-server/src/index.js` | 中心化 WebSocket 中继 | **将被降级为可选 bootstrap 节点** |
| `src/main/services/room/RelayRoomService.ts` | 房主端 relay 连接管理 | 重构为多 transport 管理器 |
| `src/main/services/room/RoomClient.ts` | 访客端连接/重连/消息收发 | 扩展支持多种连接方式 |
| `src/main/services/room/RoomServer.ts` | 本地房间服务（WebSocket server） | 接口保持，底层 transport 可替换 |
| `src/main/services/room/RoomDiscoveryService.ts` | LAN UDP 广播 + relay 房间发现 | 扩展为多协议房间发现 |
| `src/shared/RoomConstants.ts` | 房间相关常量 | 新增 P2P 相关超时/限制参数 |
| `src/shared/AppConstants.ts` | Relay server URL / host 配置 | 降级为可选项，新增 bootstrap 节点列表 |

---

### 二、目标架构

```
                     ┌─────────────────────────────────┐
                     │        DHT 网络 (Kademlia)       │
                     │  ┌─────┐  ┌─────┐  ┌─────┐     │
                     │  │Peer │  │Peer │  │Peer │ ...  │
                     │  └─────┘  └─────┘  └─────┘     │
                     └──────────┬──────────────────────┘
                                │ 房间发现 (pubsub)
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                  ▼
     ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
     │  房主 (Host)  │  │  访客 A       │  │  访客 B       │
     │  libp2p Node │  │  libp2p Node │  │  libp2p Node │
     │              │  │              │  │              │
     │  直连 ◄──────┼──┼──直连 ───────┼──┼──直连         │
     │  (TCP/WS)    │  │  (TCP/WS)    │  │  (TCP/WS)    │
     │  备选:       │  │  备选:       │  │  备选:        │
     │  Relay 降级  │  │  Relay 降级  │  │  Relay 降级   │
     └──────────────┘  └──────────────┘  └──────────────┘
```

**核心设计原则**：

1. **渐进迁移**：P2P 直连优先，Relay 作为降级方案，逐步弱化 Relay 角色
2. **协议兼容**：上层 Game API（`GameApiServer` / `V1GameApiProtocol` / `V2GameApiProtocol`）**完全不变**，对游戏开发者透明
3. **STUN 优先**：免费、无需部署、轻量的 NAT 穿透方案
4. **故障降级链**：P2P 直连 → STUN 穿透 → 中心化 Relay → 连接失败提示

---

### 三、分阶段实施方案

#### 阶段 1：STUN NAT 穿透（v2.5，约 2 周）

**目标**：让同一 NAT 后的设备以及简单 NAT 类型之间实现直连，减少 Relay 负载。

**技术方案**：

```
                   ┌──────────────────┐
                   │  STUN Server     │
                   │  (stun.l.google  │
                   │   .com:19302)    │
                   └──┬────────────┬──┘
                      │  UDP 探测  │
              ┌───────▼──┐   ┌────▼──────┐
              │  房主     │   │  访客      │
              │ 公网 IP  │   │ 公网 IP   │
              │ 端口映射  │   │ 端口映射  │
              └──────────┘   └───────────┘
                      │            │
                      └── UDP 直连 ─┘
```

**实现步骤**：

1. 新增 `src/main/services/room/NatTraversalService.ts`
   - 集成 `stun` npm 包（纯 JS，零原生依赖，仅 200 行代码）
   - 对外暴露 `getPublicEndpoint(): Promise<{ address: string; port: number }>`
   - NAT 类型检测：Full Cone / Restricted / Port Restricted / Symmetric

2. 改造 `RoomDiscoveryService`
   - LAN 发现包内附带 STUN 探测到的公网地址
   - `DiscoveredRoom` 类型新增 `publicEndpoints: string[]` 字段

3. 改造 `RoomClient`
   - `connect()` 方法新增 `preferDirect: boolean` 参数
   - 加入房间后，尝试向房主公网地址发起 UDP 直连
   - 直连成功 → 切换 transport 为 UDP，绕过 Relay
   - 直连失败 → 自动降级回 Relay（用户无感知）

4. 预计效果
   - 同一 WiFi 下：100% 可直连（已是 LAN 直连，不变）
   - Full Cone NAT：90%+ 可穿透
   - Symmetric NAT：无法穿透（需 Relay 降级）
   - 预期 **40-60% 的跨网络连接可绕过 Relay**

#### 阶段 2：libp2p 集成（v3.0，约 4-6 周）

**目标**：引入 `@libp2p/js-libp2p` 作为底层 P2P 网络栈，支持 DHT 房间发现和多种 NAT 穿透策略。

**技术方案**：

```
libp2p Node 配置
├── Transports
│   ├── @libp2p/tcp          ← TCP 直连
│   ├── @libp2p/websockets   ← WebSocket 备用
│   └── @libp2p/webrtc       ← NAT 穿透首选
├── Connection Encryption
│   └── @chainsafe/libp2p-noise  ← Noise 协议加密
├── Stream Multiplexing
│   └── @libp2p/mplex        ← 多路复用
├── Peer Discovery
│   ├── @libp2p/bootstrap    ← 启动节点（原 Relay Server 降级）
│   ├── @libp2p/kad-dht      ← DHT 房间发现
│   ├── @libp2p/mdns         ← LAN 自动发现
│   └── @libp2p/pubsub-peer-discovery  ← pubsub 辅助发现
├── Content Routing
│   └── @libp2p/kad-dht      ← Kademlia DHT
├── NAT Traversal
│   ├── @libp2p/autonat      ← 自动 NAT 检测
│   ├── @libp2p/upnp-nat     ← UPnP 端口映射
│   └── @libp2p/circuit-relay-v2  ← 中继降级
└── PubSub
    └── @chainsafe/libp2p-gossipsub  ← 房间内消息广播
```

**架构重构**：

```
新增文件：
src/main/services/p2p/
├── P2PNode.ts           # libp2p 节点生命周期管理
├── RoomProtocol.ts      # 房间协议适配层（映射到现有 RoomMessage）
├── PeerRegistry.ts      # Peer 发现/连接注册表
├── TransportRouter.ts   # 多 transport 路由器（直连 > STUN > Relay）
└── ConnectionMetrics.ts # 连接质量监控 & 切换决策

修改文件：
src/main/services/room/RelayRoomService.ts   → 改为调用 P2PNode
src/main/services/room/RoomClient.ts         → 扩展 P2P 连接路径
src/main/services/room/RoomDiscoveryService.ts → 新增 DHT/pubsub 发现
src/main/services/room/RoomServer.ts         → 保持不变（接口兼容）
```

**关键设计决策**：

1. **libp2p Node 为单例**：整个应用只启动一个 libp2p 节点，所有 P2P 通信复用同一个连接池
2. **协议适配层**：`RoomProtocol` 将现有 `RoomMessage` 格式映射到 libp2p stream protocol，现有的 `RoomServer` / `RoomClient` 消息处理逻辑**零改动**
3. **Relay Server 降级为 bootstrap**：原 `relay-server/src/index.js` 新增 Circuit Relay v2 支持，不再做房间状态管理，仅作为 P2P 网络的入口节点
4. **自建 Relay 可选**：用户可以在局域网内自建 bootstrap 节点（如树莓派），社区可贡献公共节点

#### 阶段 3：端到端加密（v3.5，约 2-3 周）

**目标**：游戏消息端到端加密，任何人（包括 Relay 节点运营者）无法窃听联机通信。

**方案**：

1. 利用 libp2p 已有的 Noise 协议做连接层加密（传输安全）
2. 新增可选的应用层端到端加密：
   ```
   房主生成 ECDH 密钥对 → 公钥通过房间状态同步分发给访客
   访客用公钥派生出共享密钥 → 使用 AES-256-GCM 加密游戏消息
   ```
3. 这是对 Game API 完全透明的，加密/解密在 `P2PNode` 层完成
4. 在 RoomChat 中显示「🔒 端到端加密」标识

#### 阶段 4：彻底去中心化（v4.0，约 6-8 周）

**目标**：移除对中心化服务器的所有硬依赖。

| 能力 | 现状 | v4.0 目标 |
|:---|:---|:---|
| NAT 穿透 | 无 | STUN + AutoNAT + UPnP + Circuit Relay v2 |
| 房间发现 | LAN UDP + Relay HTTP | DHT + mDNS + pubsub |
| 消息中继 | 中心化 Relay Server | 直连优先 + Circuit Relay 降级 |
| 节点发现 | 无 | Bootstrap 节点列表（含原 Relay Server） |
| 身份认证 | 无（playerId 明文） | PeerId（libp2p 内建） |

---

### 四、改造后的故障降级链

```
                    加入房间
                       │
              ┌────────▼────────┐
              │ 1. LAN 直连尝试  │ ← mDNS/UDP 广播，0ms 延迟
              └────────┬────────┘
                       │ 失败
              ┌────────▼────────┐
              │ 2. 公网直连尝试  │ ← DHT 查询 peer 地址 + TCP/WS 直连
              └────────┬────────┘
                       │ 失败
              ┌────────▼────────┐
              │ 3. STUN 穿透    │ ← UDP Hole Punching
              └────────┬────────┘
                       │ 失败 (Symmetric NAT)
              ┌────────▼────────┐
              │ 4. WebRTC 穿透  │ ← ICE + TURN (Google STUN + 内置 TURN)
              └────────┬────────┘
                       │ 失败
              ┌────────▼────────┐
              │ 5. Relay 降级   │ ← Circuit Relay v2，最高延迟
              └────────┬────────┘
                       │ 失败
              ┌────────▼────────┐
              │ 6. 提示无法连接  │
              └─────────────────┘
```

用户全程无感知，连接方式自动切换。高级设置中可查看当前使用的连接方式和延迟。

---

### 五、相关 npm 依赖

```json
{
  "dependencies": {
    "@libp2p/js-libp2p": "^2.x",
    "@libp2p/tcp": "^10.x",
    "@libp2p/websockets": "^9.x",
    "@libp2p/webrtc": "^5.x",
    "@libp2p/bootstrap": "^11.x",
    "@libp2p/kad-dht": "^14.x",
    "@libp2p/mdns": "^11.x",
    "@libp2p/autonat": "^2.x",
    "@libp2p/upnp-nat": "^3.x",
    "@libp2p/circuit-relay-v2": "^3.x",
    "@libp2p/mplex": "^11.x",
    "@chainsafe/libp2p-noise": "^16.x",
    "@chainsafe/libp2p-gossipsub": "^14.x",
    "stun": "^2.x"
  }
}
```

> 以上均为纯 JS 实现（除 `@libp2p/tcp` 可能依赖少量原生模块），与 Electron 兼容。
> 约增加安装包大小 **800KB ~ 1.2MB**，在可接受范围内。

---

## 第二部分：测试体系搭建

### 一、现状分析

| 维度 | 现状 |
|:---|:---|
| 测试框架 | **无**（package.json 无 jest/vitest/mocha 依赖） |
| 测试文件 | **0** 个 `*.test.ts` / `*.spec.ts` |
| 测试脚本 | **无**（无 `npm test` 等脚本） |
| CI/CD | **无** |
| 类型检查 | 有（`typecheck:node` + `typecheck:web`，但未在 CI 执行） |
| 代码规范 | 有（ESLint + Prettier） |
| 手动测试 | 依赖人工点击验证 |

**影响**：改动一行代码，无任何自动化安全保障，严重依赖开发者记忆和手动回归。

---

### 二、测试策略总览

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

| 层级 | 工具 | 覆盖目标 | 运行速度 | CI 执行 |
|:---|:---|:---|:---|:---|
| **单元测试** | Vitest | shared/types 校验、工具函数、纯逻辑服务 | < 5s | 每次 commit |
| **组件测试** | Vitest + vue-test-utils | Vue 组件渲染、事件、props | < 15s | 每次 commit |
| **集成测试** | Vitest + mock | IPC 通信、WebSocket 消息流、数据库 CRUD | < 30s | 每次 PR |
| **E2E** | Playwright | 关键用户流程（导入游戏、创建房间、加入房间） | < 2min | 每次 release |

**为什么选 Vitest 而不是 Jest**：
- 与 Vite 原生集成，零配置运行 `.ts` / `.vue`
- 速度远快于 Jest（ESM 原生支持 + 多线程）
- 与 electron-vite 构建体系一致
- `@vitest/ui` 提供美观的调试界面

---

### 三、分阶段实施方案

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
on: [push, pull_request]
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
import { describe, it, expect } from "vitest";
import { MarketGameVersionSchema, isValidDownloadUrl, isValidSha256Format } from "../../types/market.types";

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
import { describe, it, expect, vi } from "vitest";

// Mock roomClient（避免 Electron 依赖）
vi.mock("../../services/room/RoomClient", () => ({
  roomClient: { room: null },
}));

// Mock logger
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GameEnvironment } from "../../services/game/GameEnvironment";
import type { AppSettings, GameManifest } from "../../../shared/types";
import { GameType } from "../../../shared/types";

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
  multiplayer: { minPlayers: 2, maxPlayers: 4 },
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
        env: { CUSTOM_VAR: "custom_value" },
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
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseService, PlaySession } from "../../services/storage/DatabaseService";

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
import { describe, it, expect } from "vitest";
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
import { test, expect, _electron as electron } from "@playwright/test";

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

### 四、测试覆盖目标

| 阶段 | shared | main/services | main/utils | renderer/components | renderer/stores | E2E |
|:---|:---|:---|:---|:---|:---|:---|
| 阶段 1（基础设施） | — | — | — | — | — | — |
| 阶段 2（shared 层） | **70%** | — | — | — | — | — |
| 阶段 3（main 层） | 70% | **50%** | **60%** | — | — | — |
| 阶段 4（renderer 层） | 70% | 50% | 60% | **40%** | **50%** | — |
| 阶段 5（E2E） | 70% | 50% | 60% | 40% | 50% | **5 条核心流程** |
| 长期目标 | 90% | 70% | 80% | 60% | 70% | 10 条核心流程 |

---

### 五、总结：工作量预估

| 项目 | 阶段 | 预估工时 |
|:---|:---|:---|
| **Relay 去中心化** | STUN 穿透 | 2 周 |
| | libp2p 集成 | 4-6 周 |
| | 端到端加密 | 2-3 周 |
| | 彻底去中心化 | 6-8 周 |
| **测试体系** | 基础设施 | 3 天 |
| | shared 层 | 1 周 |
| | main 层 | 1-2 周 |
| | renderer 层 | 1 周 |
| | E2E | 1 周 |
| | CI 配置 | 1 天 |

**总结**：两个方向可并行推进。P2P 改造建议从 STUN 穿透小步快跑（2 周即可见到 Relay 负载下降），测试体系建议从 shared 层开始（1 周即可建立安全网），均不会对现有功能产生破坏性影响。
