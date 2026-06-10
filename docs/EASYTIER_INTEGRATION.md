# BZ-Games × EasyTier 集成方案文档

> 版本：v1.0 | 日期：2026-06-09

---

## 目录

1. [背景与目标](#1-背景与目标)
2. [EasyTier 简介](#2-easytier-简介)
3. [集成架构设计](#3-集成架构设计)
4. [具体实施步骤](#4-具体实施步骤)
5. [配置参数参考](#5-配置参数参考)
6. [状态监控与诊断](#6-状态监控与诊断)
7. [故障降级与回退](#7-故障降级与回退)
8. [安全与加密](#8-安全与加密)
9. [已知限制与应对](#9-已知限制与应对)
10. [与现有组件的兼容性矩阵](#10-与现有组件的兼容性矩阵)
11. [时间与工作量估算](#11-时间与工作量估算)

---

## 1. 背景与目标

### 1.1 当前问题

BZ-Games 的联机通信依赖中心化 Relay Server：

- **单点故障**：Relay 宕机 → 所有跨网络联机瘫痪
- **容量上限**：硬编码 80 房间、400 客户端
- **延迟不可控**：消息必经中心节点中转
- **运营成本**：自建服务器需要持续投入

### 1.2 集成目标

- 在 BZ-Games 中集成 EasyTier，实现**去中心化 P2P 联机**
- **RoomServer / RoomClient 代码零改动**（EasyTier 作为网络层对上层透明）
- LAN 直连、P2P/EasyTier、Relay 三种模式并存，自动降级
- 对最终用户完全透明，仅显示「P2P 直连」或「中继连接」状态

---

## 2. EasyTier 简介

[EasyTier](https://github.com/EasyTier/EasyTier)（GitHub 11.4k stars，LGPL-3.0）是一个用 Rust 编写的去中心化虚拟专用网络工具。

### 2.1 核心特性

| 特性 | 说明 |
|:---|:---|
| **去中心化** | 节点平等独立，无需中心服务器 |
| **NAT 穿透** | 自研穿透协议，支持 NAT4-NAT4 网络 |
| **高性能** | Rust + Tokio 异步，零拷贝全链路 |
| **智能路由** | OSPF 协议，延迟优先自动选路 |
| **安全加密** | AES-GCM / WireGuard 级加密 |
| **跨平台** | Win / Mac / Linux / FreeBSD / Android |

### 2.2 提供的二进制程序

| 程序 | 用途 |
|:---|:---|
| `easytier-core` | 虚拟组网守护进程。创建 TUN 虚拟网卡、管理 P2P 连接、NAT 穿透，默认监听 RPC 端口 `tcp://127.0.0.1:15888` |
| `easytier-cli` | 命令行管理工具。通过 RPC 连接 daemon，查询 peer / route / node 状态 |

### 2.3 为什么选 EasyTier 而不是 libp2p

| 维度 | EasyTier | libp2p (JS) |
|:---|:---|:---|
| 对现有代码侵入性 | **零** — 网络层透明 | **高** — 需重构 RoomClient transport 层 |
| NAT 穿透能力 | NAT4-NAT4 | Symmetric NAT 仍需中继 |
| 集成方式 | 外部进程 spawn | npm 依赖嵌入 |
| 性能 | Rust 零拷贝 | Node.js 事件循环 |
| 新增代码量 | ~300 行 | ~2000+ 行 |
| 安装包增量 | ~8 MB（独立二进制） | ~1 MB（npm 包） |
| 管理员权限 | 创建虚拟网卡需要 | 不需要 |

---

## 3. 集成架构设计

### 3.1 总体架构

```
                       BZ-Games (Electron)
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │             EasyTierService (新增 ~200 行)            │   │
│  │                                                      │   │
│  │  - spawn easytier-core.exe  (子进程管理)              │   │
│  │  - 虚拟 IP 分配 (10.144.144.x)                        │   │
│  │  - network-name / network-secret 生成                 │   │
│  │  - 状态监控 (stdout 解析 / RPC)                       │   │
│  │  - 进程生命周期 (启动 / 停止 / 重启)                   │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │ spawn (child_process)                 │
│  ┌────────────────────▼─────────────────────────────────┐   │
│  │         easytier-core.exe (独立进程)                   │   │
│  │                                                      │   │
│  │  虚拟网卡: 10.144.144.x                                │   │
│  │  NAT 穿透 / P2P 连接管理                               │   │
│  │  OSPF 智能路由                                        │   │
│  │  AES-GCM 端到端加密                                    │   │
│  │  RPC 管理接口: tcp://127.0.0.1:15888                 │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │   RoomServer  (零改动)                                │   │
│  │   监听: 0.0.0.0:38080                                │   │
│  │   对虚拟 IP 可见 ✓                                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │   RoomClient  (零改动)                                │   │
│  │   连接: ws://10.144.144.1:38080    ← 虚拟 IP ！       │   │
│  │   现有 WebSocket 连接逻辑完全不变                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 为什么 RoomServer / RoomClient 可以零改动

EasyTier 在操作系统层面创建了一个**虚拟网络适配器**（TUN 设备），分配虚拟 IP（如 `10.144.144.1`）。之后，操作系统就会像对待真实网卡一样对待这个虚拟 IP。

```
物理网卡          虚拟网卡 (EasyTier)
192.168.1.100    10.144.144.1
    │                  │
    │    ┌─────────────┤
    │    │  EasyTier 自动处理：    │
    │    │  - NAT 穿透             │
    │    │  - 加密隧道             │
    │    │  - 路由选择             │
    ▼    ▼                         │
  Internet ──── P2P 隧道 ──────→ 对方 10.144.144.2
```

对 BZ-Games 来说，`ws://10.144.144.1:38080` 只是一个普通的 WebSocket 连接。EasyTier 在操作系统网络栈层面截获发往 `10.144.144.1` 的流量，加密后通过 P2P 隧道发送到对方。这个过程中 **BZ-Games 的代码完全不感知**，RoomServer 不知道连接来自虚拟网络还是物理网络，RoomClient 不知道目标 IP 是虚拟的还是真实的。

### 3.3 联机连接优先级链

```
用户加入房间
    │
    ▼
┌──────────────┐
│ 1. LAN 直连  │  ← 最高优先级，零延迟
│ (目前已有)    │     RoomDiscoveryService UDP 广播发现
└──────┬───────┘
       │ 失败 (不在同一局域网)
       ▼
┌──────────────┐
│ 2. EasyTier  │  ← 新增！NAT4-NAT4 穿透
│ P2P 直连     │     easytier-core 虚拟组网
└──────┬───────┘
       │ 失败 (极端 NAT 环境)
       ▼
┌──────────────┐
│ 3. Relay     │  ← 保留，作为最终降级
│ 中心化中继   │     现有 relay-server
└──────┬───────┘
       │ 失败
       ▼
┌──────────────┐
│ 4. 提示失败  │
└──────────────┘
```

三种模式可并存，降级逻辑在 `useRoomJoin.ts` composable 中实现。BZ-Games 尝试顺序：
1. LAN 地址直连
2. EasyTier 虚拟 IP 连接
3. Relay 中继连接

---

## 4. 具体实施步骤

### 4.1 准备工作：捆绑 EasyTier 二进制

#### 4.1.1 下载二进制

从 [EasyTier Releases](https://github.com/EasyTier/EasyTier/releases) 下载 Windows x64 版本，解压得到 `easytier-core.exe`。

#### 4.1.2 放置位置

```
bz-games/
├── easytier-bin/
│   └── win/
│       └── x64/
│           └── easytier-core.exe    (~8 MB)
└── package.json
```

#### 4.1.3 配置 electron-builder

修改 `package.json` 的 `build.extraResources`：

```json
{
  "build": {
    "extraResources": [
      {
        "from": "node_modules/7zip-bin/win/x64",
        "to": "7za",
        "filter": ["7za.exe"]
      },
      {
        "from": "easytier-bin/win/x64",
        "to": "easytier",
        "filter": ["easytier-core.exe"]
      }
    ]
  }
}
```

#### 4.1.4 获取二进制路径

在 `main` 进程中通过 `app.getAppPath()` 获取：

```typescript
// src/main/services/p2p/EasyTierService.ts
import { app } from "electron";
import path from "path";
import fs from "fs";

function getEasyTierCorePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "easytier", "easytier-core.exe");
  }
  // 开发模式：从项目根目录下的 easytier-bin 读取
  return path.join(app.getAppPath(), "..", "easytier-bin", "win", "x64", "easytier-core.exe");
}
```

此项与现有的 `7za.exe` 路径获取方式完全一致。

---

### 4.2 新增文件清单

```
src/main/services/p2p/
└── EasyTierService.ts          # ~200 行，核心服务

src/main/ipc/
└── p2p.ipc.ts                  # ~40 行，IPC 注册

src/main/services/room/
└── RoomDiscoveryService.ts     # ~10 行，新增 virtualIp 字段

src/shared/
└── AppConstants.ts             # ~3 行，默认虚拟网段常量
└── types/room.types.ts         # ~5 行，DiscoveredRoom 扩展

src/renderer/src/
├── composables/useRoomJoin.ts  # ~15 行，连接优先级逻辑
└── views/RoomDiscoveryView.vue # ~10 行，UI 状态展示
```

**总计新增/改动约 280 行代码**。

---

### 4.3 核心服务实现

#### `src/main/services/p2p/EasyTierService.ts`

```typescript
import { ChildProcess, spawn } from "child_process";
import { app } from "electron";
import path from "path";
import crypto from "crypto";
import { logger } from "../../utils/logger";

type EasyTierStatus = "idle" | "starting" | "connected" | "error";
type ConnectionMode = "lan" | "easytier" | "relay" | "unknown";

interface EasyTierState {
  status: EasyTierStatus;
  virtualIp: string;
  connectionMode: ConnectionMode;
  peerCount: number;
  latencyMs: number | null;
  error: string | null;
}

const DEFAULT_VIRTUAL_NETWORK = "10.144.144.0/24";
const VIRTUAL_IP_START = 1;       // 房主从 .1 开始
const VIRTUAL_IP_MAX = 254;       // 最多 254 个节点
const RPC_PORT = 15888;
const STARTUP_TIMEOUT_MS = 15000;

export class EasyTierService {
  private process: ChildProcess | null = null;
  private started = false;
  private state: EasyTierState = {
    status: "idle",
    virtualIp: "",
    connectionMode: "unknown",
    peerCount: 0,
    latencyMs: null,
    error: null,
  };

  /**
   * 获取 easytier-core 可执行文件路径
   */
  private getBinaryPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "easytier", "easytier-core.exe");
    }
    return path.join(
      app.getAppPath(),
      "..",
      "easytier-bin",
      "win",
      "x64",
      "easytier-core.exe",
    );
  }

  /**
   * 房主模式：作为 EasyTier 网络的第一个节点启动
   * @param roomId 房间 ID，用作 network-name
   * @returns { virtualIp, networkSecret } 访客加入所需信息
   */
  async startAsHost(
    roomId: string,
  ): Promise<{ virtualIp: string; networkSecret: string }> {
    this.started = true;

    const virtualIp = `${DEFAULT_VIRTUAL_NETWORK.split("/")[0].replace(/0$/, "")}${VIRTUAL_IP_START}`;
    const networkSecret = crypto.randomBytes(16).toString("hex");

    this.state = {
      status: "starting",
      virtualIp,
      connectionMode: "lan", // 初始为 LAN，EasyTier 启动后可能切换
      peerCount: 0,
      latencyMs: null,
      error: null,
    };

    // easytier-core -i 10.144.144.1 --network-name <roomId> --network-secret <secret> --no-listener
    const args = [
      "-i", virtualIp,
      "--network-name", roomId,
      "--network-secret", networkSecret,
      "--no-listener",                // 房主不对外暴露监听端口（访客通过 BZ-Games 获取连接信息）
      "--rpc-portal", `tcp://127.0.0.1:${RPC_PORT}`,
    ];

    return new Promise((resolve, reject) => {
      const binaryPath = this.getBinaryPath();

      logger.info(`[EasyTier] Starting as host: ${binaryPath} ${args.join(" ")}`);

      this.process = spawn(binaryPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      const timeout = setTimeout(() => {
        reject(new Error("EasyTier host startup timeout"));
      }, STARTUP_TIMEOUT_MS);

      let resolved = false;

      this.process.stdout?.on("data", (data: Buffer) => {
        const output = data.toString();
        logger.info(`[EasyTier stdout] ${output.trim()}`);

        // EasyTier 启动成功的标志：输出中包含 "listening" 或 virtual IP
        if (!resolved && (output.includes("listening on") || output.includes(virtualIp))) {
          resolved = true;
          clearTimeout(timeout);
          this.state.status = "connected";
          resolve({ virtualIp, networkSecret });
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        logger.warn(`[EasyTier stderr] ${data.toString().trim()}`);
        // stderr 也可能是正常日志（Rust 程序有时把日志输出到 stderr）
        if (!resolved && data.toString().includes(virtualIp)) {
          resolved = true;
          clearTimeout(timeout);
          this.state.status = "connected";
          resolve({ virtualIp, networkSecret });
        }
      });

      this.process.on("error", (err) => {
        clearTimeout(timeout);
        this.state.status = "error";
        this.state.error = err.message;
        reject(err);
      });

      this.process.on("exit", (code) => {
        logger.info(`[EasyTier] Host process exited with code ${code}`);
        this.cleanup();
      });
    });
  }

  /**
   * 访客模式：加入现有的 EasyTier 网络
   * @param roomId 房间 ID
   * @param networkSecret 网络密钥
   * @param hostAddress 房主公网地址（如 1.2.3.4:11010）
   */
  async startAsGuest(
    roomId: string,
    networkSecret: string,
    hostAddress?: string,
  ): Promise<{ virtualIp: string }> {
    this.started = true;

    this.state = {
      status: "starting",
      virtualIp: "",
      connectionMode: "easytier",
      peerCount: 0,
      latencyMs: null,
      error: null,
    };

    // easytier-core -d --network-name <roomId> --network-secret <secret> [-p tcp://<hostAddr>]
    const args = [
      "-d",                              // DHCP 模式，自动分配虚拟 IP
      "--network-name", roomId,
      "--network-secret", networkSecret,
      "--rpc-portal", `tcp://127.0.0.1:${RPC_PORT}`,
    ];

    if (hostAddress) {
      args.push("-p", `tcp://${hostAddress}`);
    }

    return new Promise((resolve, reject) => {
      const binaryPath = this.getBinaryPath();

      logger.info(`[EasyTier] Starting as guest: ${binaryPath} ${args.join(" ")}`);

      this.process = spawn(binaryPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      const timeout = setTimeout(() => {
        reject(new Error("EasyTier guest startup timeout"));
      }, STARTUP_TIMEOUT_MS);

      let resolved = false;

      this.process.stdout?.on("data", (data: Buffer) => {
        const output = data.toString();
        logger.info(`[EasyTier stdout] ${output.trim()}`);

        if (!resolved && output.includes("assigned ip")) {
          const match = output.match(/assigned ip[:\s]+([\d.]+)/i);
          if (match) {
            resolved = true;
            clearTimeout(timeout);
            const virtualIp = match[1];
            this.state.virtualIp = virtualIp;
            this.state.status = "connected";
            resolve({ virtualIp });
          }
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        logger.warn(`[EasyTier stderr] ${data.toString().trim()}`);
      });

      this.process.on("error", reject);
      this.process.on("exit", (code) => {
        logger.info(`[EasyTier] Guest process exited with code ${code}`);
        this.cleanup();
      });
    });
  }

  /**
   * 获取当前 EasyTier 连接状态
   */
  getState(): EasyTierState {
    return { ...this.state };
  }

  /**
   * 获取房主的虚拟 IP（访客端使用）
   */
  getHostVirtualIp(): string {
    // 房主永远是 VIRTUAL_IP_START
    const networkBase = DEFAULT_VIRTUAL_NETWORK.split("/")[0];
    const parts = networkBase.split(".");
    parts[3] = String(VIRTUAL_IP_START);
    return parts.join(".");
  }

  /**
   * 停止 EasyTier 进程
   */
  stop(): void {
    this.cleanup();
  }

  /**
   * 进程清理
   */
  private cleanup(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.started = false;
    this.state = {
      status: "idle",
      virtualIp: "",
      connectionMode: "unknown",
      peerCount: 0,
      latencyMs: null,
      error: null,
    };
  }
}

export const easyTierService = new EasyTierService();
```

---

### 4.4 房主端流程

在 `RoomServer.start()` 之后（或 `RelayRoomService.enableHostRoom()` 之后），BZ-Games 调用 EasyTier：

```typescript
// 伪代码 — 融入现有的 createRoom 流程

async function createRoom(gameId: string, version?: string) {
  // 1. 正常启动 RoomServer（现有逻辑，不变）
  const port = await roomServer.start(gameId, version);

  // 2. 启动 EasyTier P2P 网络（新增）
  let easyTierInfo = null;
  try {
    easyTierInfo = await easyTierService.startAsHost(roomServer.room.id);
  } catch (err) {
    logger.warn("[EasyTier] Failed to start P2P network, falling back to relay only", err);
  }

  // 3. （可选）启动 Relay 作为降级
  if (relayEnabled) {
    await relayRoomService.enableHostRoom();
  }

  // 4. 将 EasyTier 信息注入到房间状态中，供访客获取
  if (easyTierInfo) {
    roomServer.room.easyTierVirtualIp = easyTierInfo.virtualIp;
    roomServer.room.easyTierNetworkSecret = easyTierInfo.networkSecret;
  }

  return port;
}
```

### 4.5 访客端流程

在 `RoomClient.connect()` 之前，BZ-Games 先尝试 EasyTier 连接：

```typescript
// 伪代码 — 融入现有的 joinRoom 流程

async function joinRoom(gameId: string, address: string, version?: string) {
  // 1. 获取房间信息，检查是否有 EasyTier 支持
  const roomInfo = await getRoomInfo(address);

  let connectAddress = address; // 默认使用原始地址

  // 2. 如果房间支持 EasyTier，尝试 P2P 连接
  if (roomInfo.easyTierVirtualIp && roomInfo.easyTierNetworkSecret) {
    try {
      await easyTierService.startAsGuest(
        roomInfo.id,
        roomInfo.easyTierNetworkSecret,
        extractHostPublicAddress(address),  // 可选：房主公网地址加速握手
      );
      // 成功！用虚拟 IP 替换连接地址
      connectAddress = `ws://${easyTierService.getHostVirtualIp()}:${roomInfo.port}`;
      logger.info(`[EasyTier] P2P connected, using virtual IP: ${connectAddress}`);
    } catch (err) {
      logger.warn("[EasyTier] P2P failed, falling back to relay", err);
      // 继续使用原始地址（relay 或 LAN）
    }
  }

  // 3. RoomClient 正常连接（使用 connectAddress，可能是虚拟 IP 或 relay 地址）
  const result = await roomClient.connect(connectAddress, gameId, version);
  return result;
}
```

### 4.6 退出流程

无论是房主还是访客，退出房间时都需要清理 EasyTier 进程：

```typescript
// 在现有的 leaveRoom / disconnect 方法末尾插入
easyTierService.stop();
relayRoomService.disconnect(); // 保留
```

---

### 4.7 房间信息协议扩展

`RoomInfo` 类型需要新增 EasyTier 相关字段：

```typescript
// src/shared/types/room.types.ts

export interface RoomInfo {
  // ... 现有字段保持不变 ...
  id: string;
  gameId: string;
  // ...

  /** EasyTier 虚拟 IP（房主端分配） */
  easyTierVirtualIp?: string;
  /** EasyTier 网络密钥（访客加入需要） */
  easyTierNetworkSecret?: string;
}
```

`DiscoveredRoom` 同理：

```typescript
export interface DiscoveredRoom {
  // ... 现有字段 ...
  easyTierVirtualIp?: string;
  easyTierNetworkSecret?: string;
}
```

---

### 4.8 管理员权限与提权方案

EasyTier 在 Windows 上创建 TUN 虚拟网卡需要**管理员权限**。

#### 方案 A：使用 `sudo-prompt` npm 包提权（推荐）

```typescript
import sudo from "sudo-prompt";

const options = {
  name: "BZ-Games P2P Network",
  icns: iconPath,
};

async function startWithElevation(): Promise<void> {
  const binaryPath = getEasyTierCorePath();
  const command = `"${binaryPath}" -i 10.144.144.1 --network-name ${roomId} --network-secret ${secret}`;
  return new Promise((resolve, reject) => {
    sudo.exec(command, options, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
```

`sudo-prompt` 零依赖，在 `electron-builder` 的 `extraResources` 中已广泛使用。

#### 方案 B：注册为 Windows 服务（更彻底）

如果用户频繁使用联机功能，可提供选项将 EasyTier 注册为 Windows 开机自启服务：

```bash
# 管理员权限下运行 sc 命令
sc create "BZGamesP2P" binPath= "C:\Users\...\easytier-core.exe ..."
sc start "BZGamesP2P"
```

此时 BZ-Games 不需要每次请求权限，通过 RPC 动态配置 EasyTier 参数即可。

---

## 5. 配置参数参考

### 5.1 房主端命令

```powershell
easytier-core.exe `
  -i 10.144.144.1 `                       # 指定虚拟 IP
  --network-name "room-abc123" `          # 网络标识（用房间 UUID）
  --network-secret "a1b2c3..." `          # 网络密钥（随机 32 位 hex）
  --no-listener `                         # 不暴露外部监听端口
  --rpc-portal "tcp://127.0.0.1:15888"   # 本地 RPC 管理端口
```

### 5.2 访客端命令

```powershell
easytier-core.exe `
  -d `                                    # DHCP 自动分配虚拟 IP
  --network-name "room-abc123" `          # 与房主相同
  --network-secret "a1b2c3..." `          # 与房主相同
  -p "tcp://22.1.1.1:11010" `            # 可选：房主公网地址，加速首次握手
  --rpc-portal "tcp://127.0.0.1:15888"   # 本地 RPC 管理端口
```

### 5.3 关键常量定义

```typescript
// src/shared/AppConstants.ts 新增

/** EasyTier 默认虚拟网段（CIDR 格式） */
export const EASYTIER_DEFAULT_NETWORK = "10.144.144.0/24";

/** EasyTier 默认 RPC 管理端口 */
export const EASYTIER_RPC_PORT = 15888;

/** EasyTier 启动超时 */
export const EASYTIER_STARTUP_TIMEOUT_MS = 15_000;

/** EasyTier 默认监听端口基址 */
export const EASYTIER_LISTEN_PORT_BASE = 11010;
```

---

## 6. 状态监控与诊断

### 6.1 通过 easytier-cli 查询（简单方案）

```powershell
# 查看已连接节点
easytier-cli peer

# 查看路由表
easytier-cli route

# 查看本节点信息
easytier-cli node
```

输出示例：

```
| ipv4         | hostname | cost  | lat_ms | loss_rate | tunnel_proto | nat_type |
|--------------|----------|-------|--------|-----------|--------------|----------|
| 10.144.144.1 | room-abc | Local | *      | *         | *            | FullCone |
| 10.144.144.2 | guest-1  | p2p   | 3.452  | 0         | udp          | FullCone |
```

BZ-Games 可以周期性（如每 5 秒）调用 `easytier-cli peer`，解析 stdout 表格获取延迟和连接质量指标，展示在房间面板上。

### 6.2 通过 Protobuf RPC 查询（高级方案）

EasyTier 的 `easytier-core` 在 `tcp://127.0.0.1:15888` 上暴露了 Protobuf RPC 接口，服务定义在 `easytier/src/proto/api_instance.proto` 中。

核心服务：

| RPC 服务 | 功能 |
|:---|:---|
| `PeerManageRpc` | 查询 peer 列表和路由信息 |
| `StatsRpc` | 性能指标、流量统计 |
| `ConfigRpc` | 运行时动态修改配置 |

如果未来需要更精细的监控，BZ-Games 可以通过 Node.js 的 `@protobuf-ts` 实现 RPC 客户端，直接调用这些服务获取结构化数据。BZ-Games 已有 `binary-protocol.ts` 和 protobuf 使用经验。

### 6.3 stdout 日志监控

`easytier-core` 输出的关键事件可以作为状态判断依据：

| stdout 输出 | 含义 |
|:---|:---|
| `listening on ...` | Daemon 启动成功 |
| `assigned ip ...` | DHCP 分配虚拟 IP 成功（访客端） |
| `peer connected ...` | P2P 连接建立 |
| `peer disconnected ...` | P2P 连接断开 |
| `hole punching success` | NAT 穿透成功 |
| `hole punching failed` | NAT 穿透失败，将使用 relay 降级 |

---

## 7. 故障降级与回退

### 7.1 连接尝试顺序

```typescript
// src/renderer/src/composables/useRoomJoin.ts 修改

async function tryConnectWithFallback(address: string, roomInfo: RoomInfo) {
  // 1. LAN 直连（如果有 LAN 地址）
  if (roomInfo.lanAddress) {
    const result = await tryConnect(roomInfo.lanAddress);
    if (result.success) return { ...result, mode: "lan" as const };
  }

  // 2. EasyTier P2P（如果房间支持）
  if (roomInfo.easyTierVirtualIp && roomInfo.easyTierNetworkSecret) {
    try {
      await easyTierService.startAsGuest(
        roomInfo.id,
        roomInfo.easyTierNetworkSecret,
      );
      const virtualAddress = `ws://${easyTierService.getHostVirtualIp()}:${roomInfo.port}`;
      const result = await tryConnect(virtualAddress);
      if (result.success) return { ...result, mode: "easytier" as const };
    } catch {
      // EasyTier 失败，继续尝试 relay
      easyTierService.stop();
    }
  }

  // 3. Relay 中继（最终降级）
  if (roomInfo.relayAddress) {
    const result = await tryConnect(roomInfo.relayAddress);
    if (result.success) return { ...result, mode: "relay" as const };
  }

  throw new Error("所有连接方式均失败");
}
```

### 7.2 连接模式展示

在房间面板中显示当前使用的连接方式：

| 模式 | 图标 | 说明 |
|:---|:---|:---|
| LAN | 🏠 局域网直连 | 最低延迟，零配置 |
| EasyTier | ⚡ P2P 直连 | 经过 NAT 穿透的 P2P 连接 |
| Relay | 🌐 中继转发 | 通过中心服务器中转 |

### 7.3 运行时切换

如果 EasyTier 连接在游戏过程中断开（罕见），可自动降级到 Relay 重连（现有 `RoomClient` 的 `reconnect` 机制完全兼容）。

---

## 8. 安全与加密

### 8.1 EasyTier 内置加密

EasyTier 默认使用 **AES-GCM** 对节点间所有流量进行加密。这意味着：

- 游戏消息在 P2P 隧道中自动加密
- 即使不启用端到端加密，网络层已经安全
- 密钥派生自 `network-secret`，只有知道密钥的节点才能加入网络

### 8.2 network-secret 生成

```typescript
// 每个房间生成唯一的 network-secret
const networkSecret = crypto.randomBytes(16).toString("hex");
// 例: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
```

### 8.3 传输层

EasyTier 网络中的 `network-secret` 通过 BZ-Games 现有的房间状态同步机制（`room:state:sync`）传输。这个传输通道本身通过 WebSocket 建立（LAN 或 Relay），所以初始密钥交换是安全的。

---

## 9. 已知限制与应对

| 限制 | 影响 | 应对 |
|:---|:---|:---|
| **需要管理员权限** | 初次使用需 UAC 弹窗 | 使用 `sudo-prompt` 提权；安装时可选注册为服务 |
| **增加安装包 ~8 MB** | 下载时间略增 | 当前安装包约 150MB，8MB 可接受 |
| **增加 CPU/内存 ~10-20 MB** | 极低负载 | EasyTier Rust 运行时极轻量 |
| **虚拟 IP 可能与本地网络冲突** | 部分企业网络使用 10.x.x.x | 支持自定义虚拟网段配置 |
| **不支持 iOS** | 移动端无法 P2P | 可降级到 WireGuard Portal 模式 |
| **首次握手可能需要公网可达节点** | 双方都是 Symmetric NAT 时 | 保留 Relay 降级；未来部署社区 bootstrap 节点 |

---

## 10. 与现有组件的兼容性矩阵

| 组件 | 文件 | 改动类型 | 改动行数 |
|:---|:---|:---|:---|
| `RoomServer` | `src/main/services/room/RoomServer.ts` | **无改动** | 0 |
| `RoomClient` | `src/main/services/room/RoomClient.ts` | **无改动** | 0 |
| `GameApiServer` | `src/main/services/game-api/GameApiServer.ts` | **无改动** | 0 |
| `GameManager` | `src/main/services/game/GameManager.ts` | **无改动** | 0 |
| `RelayRoomService` | `src/main/services/room/RelayRoomService.ts` | 保留作为降级 | 0 |
| `RoomDiscoveryService` | `src/main/services/room/RoomDiscoveryService.ts` | 扩展字段 | ~10 |
| `EasyTierService` | `src/main/services/p2p/EasyTierService.ts` | **新增** | ~200 |
| `p2p.ipc` | `src/main/ipc/p2p.ipc.ts` | **新增** | ~40 |
| `room.types` | `src/shared/types/room.types.ts` | 扩展字段 | ~5 |
| `AppConstants` | `src/shared/AppConstants.ts` | 新增常量 | ~3 |
| `RoomView` | `src/renderer/src/views/RoomView.vue` | 状态展示 | ~15 |
| `useRoomJoin` | `src/renderer/src/composables/useRoomJoin.ts` | 连接优先级 | ~15 |
| `package.json` | 根目录 | extraResources | ~6 |

**总计改动行数：~294 行（新增 ~246 行，修改 ~48 行）**

---

## 11. 时间与工作量估算

| 阶段 | 任务 | 预估工时 |
|:---|:---|:---|
| **1. 准备** | 下载 EasyTier 二进制，配置打包 | 0.5 天 |
| **2. 核心服务** | 编写 `EasyTierService.ts`（子进程管理） | 1 天 |
| **3. IPC 集成** | 注册 IPC handler，暴露给渲染进程 | 0.5 天 |
| **4. 房主流程** | 融入 `createRoom` 流程 | 0.5 天 |
| **5. 访客流程** | 融入 `joinRoom` 流程，降级链逻辑 | 1 天 |
| **6. UI 状态** | 连接模式展示、状态指示器 | 0.5 天 |
| **7. 权限提权** | `sudo-prompt` 集成，UAC 流程 | 0.5 天 |
| **8. 测试** | LAN / EasyTier / Relay 三模式切换测试 | 1 天 |
| **9. 文档** | 更新用户文档，说明 P2P 功能 | 0.5 天 |
| **总计** | | **约 6 个工作日** |

---

## 附录

### A. EasyTier 官方资源

| 资源 | 地址 |
|:---|:---|
| GitHub 仓库 | https://github.com/EasyTier/EasyTier |
| 官方文档 | https://easytier.cn |
| Releases 下载 | https://github.com/EasyTier/EasyTier/releases |
| 配置参数参考 | `easytier-core --help` |
| API 架构 (DeepWiki) | https://deepwiki.com/EasyTier/EasyTier |

### B. 许可证兼容性

| 项目 | 许可证 |
|:---|:---|
| BZ-Games | GPL-3.0 |
| EasyTier | LGPL-3.0 |

LGPL-3.0 与 GPL-3.0 完全兼容。EasyTier 作为独立进程运行（非静态链接），BZ-Games 无需以其许可证发布。

### C. 社区共享节点

EasyTier 官方提供了免费的共享公网节点，可在极端 NAT 环境下作为中继使用：

```bash
# 使用多个共享节点提高可用性
easytier-core -d --network-name my-net --network-secret xxx \
  -p tcp://public-node1:11010 \
  -p udp://public-node2:11010
```

BZ-Games 可以预置这些社区节点地址作为后备，进一步降低对自有 Relay Server 的依赖。
