# 签到功能迁移至阿里云 FC + OTS — 完整实现流程

> 版本: 1.1 | 日期: 2026-05-15
> **前置依赖**: 需先完成 [登录/注册功能 (FC+OTS)](./fc-ots-login-design.md)，鉴权体系依赖于其中的 playerId 分配和 JWT token。

---

## 一、现状分析

### 1.1 当前签到架构（纯本地）

```
┌─ 渲染进程 ──────────────────────────────────────┐
│ CheckInModal.vue                                 │
│  → settingsStore.checkIn()                       │
│    → IPC: user.checkIn()                         │
└──────────────────────┬──────────────────────────┘
                       │ IPC invoke
┌─ 主进程 ────────────┴──────────────────────────┐
│ system.ipc.ts                                    │
│  → storeService.performCheckIn()                 │
│    1. 读取 config.json 中的 userData             │
│    2. 判断今天是否已签到（lastCheckInDate）       │
│    3. 计算连续天数（consecutiveDays）            │
│    4. 计算奖励（1-6天: 天数×10, 第7天: 100）     │
│    5. 写入 config.json                           │
│    → 返回 { success, coins, days }               │
└──────────────────────────────────────────────────┘
```

### 1.2 当前数据结构

```typescript
interface UserData {
  bzCoins: number;
  cumulativePlayTime: number;
  checkIn: {
    lastCheckInDate: string;   // "YYYY-MM-DD"
    consecutiveDays: number;   // 0-∞
  };
}
```

### 1.3 存在的问题

| 问题 | 说明 |
|------|------|
| **本地存储不可信** | 用户可以直接修改 `config.json` 篡改 BZ 币和签到数据 |
| **数据无备份** | 卸载或删除 `config.json` 后数据永久丢失 |
| **无法多人共用** | 同一台电脑切换用户时数据无法隔离 |
| **无社交能力** | 无法知道其他玩家的签到状态，无法做排行榜 |

---

## 二、目标架构

```
┌─ 用户 A ─────────────────────────────────────────────┐
│ BZ-Games 客户端                                       │
│  CheckInModal.vue                                     │
│    IPC → storeService → HTTP POST → ──────┐           │
│    同时更新本地缓存（乐观更新）              │          │
└────────────────────────────────────────────┼──────────┘
                                             │ HTTPS
┌─ 用户 B ──────────────┐                    │
│ 同上                   │                   │
└───────────────────────┼───────────────────┼──────────┐
                                             ▼           │
┌─ 阿里云 ───────────────────────────────────────────┐
│                                                    │
│  API 网关 (可选自定义域名)                           │
│  https://bz-api.your-domain.com/check-in             │
│     │                                              │
│     ▼                                              │
│  函数计算 FC                                        │
│  checkIn (Node.js 20)                               │
│     │                                              │
│     ├─► 表格存储 OTS                                │
│     │   表: bz_checkin                              │
│     │   主键: playerId                              │
│     │   字段: lastCheckInDate, consecutiveDays,      │
│     │         bzCoins, updatedAt, createdAt          │
│     │                                              │
│     └─► 返回 { success, coins, days, bzCoins }      │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

## 三、阿里云服务选型与定价

### 3.1 为什么选 FC + OTS

| 考量 | FC (函数计算) | OTS (表格存储) |
|------|--------------|---------------|
| **定位** | 无服务器计算，按需执行 | 分布式 NoSQL，KV + 宽表 |
| **签到场景匹配度** | 极佳 — 每次签到一次调用，无持续资源消耗 | 极佳 — 主键查询 playerId + 原子更新 |
| **弹性** | 自动扩缩，零请求时不计费 | 预留读写吞吐量 |
| **运维** | 零运维 | 零运维 |
| **Node.js 支持** | 原生支持 Node.js 20 | 官方 SDK `tablestore` |
| **费用** | 1 元 ≈ 100 万次调用 | 预留 0.1 CU ≈ ¥15/月（存 10 万用户足够） |

**为什么不选 RDS (关系型数据库)**：
- OTS 对于 "playerId → 签到记录" 这种 KV 模式更合适
- 无需建表语句，无需维护连接池
- Serverless 模式按量付费，零预留时为 0 费用

**为什么不选 Redis**：
- 签到数据需要持久化，不适合纯缓存
- Redis 成本高于 OTS（同样存储量）

### 3.2 费用估算（按 1000 日活）

| 资源 | 规格 | 月费用 |
|------|------|--------|
| FC 调用次数 | 1000次/天 × 30 = 3万次 | ≈ ¥0.03 |
| FC 执行时长 | 每次 ~200ms, 3万次 | ≈ ¥0.12 |
| OTS 预留吞吐 | 1 CU 预留（读） | ≈ ¥15 |
| OTS 存储 | 1万条 × ~200 bytes | ≈ ¥0.02 |
| API 网关 (可选) | 3万次/月 | ≈ ¥1.5 |
| **合计** | | **≈ ¥17/月** |

**注意**：如果使用 HTTP Trigger（函数 URL），可省去 API 网关费用。

---

## 四、OTS 表设计

### 4.1 主表: `bz_checkin`

| 字段 | 类型 | 说明 |
|------|------|------|
| `username` | String (**分区键**) | 用户登录名，与 `bz_accounts` 表关联 |
| `playerId` | String | 玩家唯一 ID（冗余存储，来自 `bz_accounts`） |
| `playerName` | String | 玩家昵称（冗余，方便排查） |
| `lastCheckInDate` | String | 最后签到日期 `"YYYY-MM-DD"` |
| `consecutiveDays` | Integer | 连续签到天数 |
| `bzCoins` | Integer | BZ 币余额（由签到 + 游玩时长累加） |
| `totalCheckIns` | Integer | 历史总签到次数 |
| `createdAt` | Integer | Unix 毫秒时间戳（首次） |
| `updatedAt` | Integer | Unix 毫秒时间戳（最后更新） |

### 4.2 建表步骤（阿里云控制台）

1. 登录 [表格存储控制台](https://otsnext.console.aliyun.com)
2. 创建实例 → 选择"高性能"或"容量型"（容量型更便宜，签到够用）
3. 创建数据表 `bz_checkin`：
   - 分区键：`username`（STRING）
   - 时间戳开关：关闭（不需要）
   - 预留读 CU：1
   - 预留写 CU：1

### 4.3 预留吞吐量说明

- 1 CU 读 = 每秒读 1 次（若行 ≤ 4KB），或每秒 4 次（若行 ≤ 1KB）
- 1 CU 写 = 每秒写 1 次
- 签到场景 QPS 极低（用户一天一次），1 CU 完全足够
- 如果未来有排行榜需求，按 `consecutiveDays` 倒序查询需要建**二级索引**

---

## 五、FC 函数开发

签到功能与登录/注册合并为一个 `bz-api` 函数，代码位于项目 `fc-api/` 目录。详见 [fc-ots-login-design.md §4.2](./fc-ots-login-design.md#42-项目结构)。

### 5.1 签到相关文件

| 文件 | 职责 |
|------|------|
| [fc-api/index.js](file:///f:/IDEA/idea-workspace/bz-games/fc-api/index.js) | `action: "checkIn"` / `"getStatus"` 路由到 `checkin.js` |
| [fc-api/checkin.js](file:///f:/IDEA/idea-workspace/bz-games/fc-api/checkin.js) | 签到/查询状态/Token 验证（JWT 鉴权） |
| [fc-api/ots.js](file:///f:/IDEA/idea-workspace/bz-games/fc-api/ots.js) | `getCheckinRecord()` / `putCheckinRecord()` |

### 5.2 鉴权方式

签到请求使用 JWT 鉴权：`auth.verifyTokenPayload(token)` 校验 token 中的 `playerId` 与请求 body 一致。未登录用户不调用 FC，走本地签到。

### 5.3 环境变量

签到与登录共用环境变量（见 [fc-ots-login-design.md §4.3](./fc-ots-login-design.md#43-环境变量)），无额外变量。`API_SECRET` 已移除。

### 5.4 RAM 权限

函数同时访问 `bz_accounts` 和 `bz_checkin` 两张表：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ots:GetRow", "ots:PutRow", "ots:UpdateRow"],
      "Resource": "acs:ots:*:*:instance/bz-games/table/bz_accounts"
    },
    {
      "Effect": "Allow",
      "Action": ["ots:GetRow", "ots:PutRow", "ots:UpdateRow"],
      "Resource": "acs:ots:*:*:instance/bz-games/table/bz_checkin"
    }
  ]
}
```

---

## 六、客户端改造

### 6.1 签到的两种模式

签到功能根据登录状态自动选择路径：

```
用户点击签到
  │
  ├─ settings.authToken 存在？（已登录）
  │    → 调用 FC (action: checkIn)
│       body: { username, playerName, token }
  │    → 成功 → OTS 更新 bzCoins → 回写本地
  │    → 失败 → 降级本地签到
  │
  └─ settings.authToken 不存在？（未登录）
       → 本地签到 storeService.performCheckIn()
```

**无需新增 AppSettings 字段**，JWT token 复用 `authToken`。

### 6.2 主进程 IPC 处理器改造

```typescript
// src/main/ipc/system.ipc.ts — 改造 checkIn handler

import { AUTH_API_URL } from './auth.ipc';

ipcMain.handle(IPC.SYSTEM_CHECK_IN, async () => {
  const settings = storeService.getSettings();

  // 未登录 → 本地签到
  if (!settings.authToken) {
    return storeService.performCheckIn();
  }

  // 已登录 → 调用 FC
  try {
    const response = await fetch(AUTH_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: 'https://your-client-referer.example',
      },
      body: JSON.stringify({
        action: 'checkIn',
        username: settings.authUsername,
        playerName: settings.playerName,
        token: settings.authToken,
      }),
    });

    if (!response.ok) {
      logger.warn('[SystemIPC] FC checkIn failed, falling back to local');
      return storeService.performCheckIn();
    }

    const result = await response.json();

    if (result.success) {
      // OTS 更新成功后同步本地 bzCoins
      storeService.setRemoteUserData({
        bzCoins: result.bzCoins,
        checkIn: {
          lastCheckInDate: new Intl.DateTimeFormat('en-CA', {
            year: 'numeric', month: '2-digit', day: '2-digit',
          }).format(new Date()),
          consecutiveDays: result.days,
        },
      });
    }

    return result;
  } catch (error) {
    logger.error('[SystemIPC] FC checkIn error', error);
    return storeService.performCheckIn();
  }
});
```

### 6.3 StoreService 新增辅助方法

```typescript
// src/main/services/StoreService.ts

/** 云端签到成功后回写本地缓存 */
setRemoteUserData(data: Partial<UserData>): void {
  const store = this.getStore();
  const current = store.get("userData") || defaultUserData;
  const merged = { ...current, ...data };
  store.set("userData", merged);
}
```

### 6.4 应用启动时同步云端数据

```typescript
// src/main/index.ts — app.whenReady 中新增

import { syncUserDataFromCloud } from './services/SyncService';

// 启动时从云端同步一次签到数据（静默，失败不影响）
syncUserDataFromCloud().catch(() => {});
```

```typescript
// src/main/services/SyncService.ts (新文件)
import { AUTH_API_URL } from '../ipc/auth.ipc';

export async function syncUserDataFromCloud(): Promise<void> {
  const settings = storeService.getSettings();
  if (!settings.authToken) return;

  const response = await fetch(AUTH_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'getStatus',
      username: settings.authUsername,
      token: settings.authToken,
    }),
  });

  if (!response.ok) return;

  const data = await response.json();
  if (data.success) {
    storeService.setRemoteUserData({
      bzCoins: data.bzCoins,
      checkIn: {
        lastCheckInDate: data.lastCheckInDate || '',
        consecutiveDays: data.days || 0,
      },
    });
  }
}
```

### 6.5 无需新增设置页配置

签到切换为登录驱动的双模式后，无需用户在设置页填入任何密钥。登录状态由 `authToken` 自动判断，已登录则调用 FC 签到，未登录则本地签到。

---

## 七、安全设计

### 7.1 防伪造请求

```
客户端                          服务端 (FC)
  │                               │
  │  sign = HMAC-SHA256(          │
  │    key: API_SECRET,           │
  │    msg: "playerId:timestamp"  │
  │  )                            │
  │                               │
  │  POST { playerId,               │
  │         timestamp,            │
  │         sign }                │
  │ ──────────────────────────► │
  │                               │
  │                    验证:       │
  │                    1. |now - timestamp| < 30s  │
  │                    2. HMAC(API_SECRET, msg) === sign │
  │                               │
```

- **API_SECRET** 不暴露在前端代码中，存储在加密的 `config.json` 中
- **签名有效期 30 秒**，防止重放攻击
- **时间戳 + 签名**，每次请求签名不同

### 7.2 安全约束

| 约束 | 实现 |
|------|------|
| playerId 不可伪造 | 签名的 `msg` 包含 `playerId`，改 playerId 签名不匹配 |
| 不能替他人签到 | 同理，签名绑定 playerId |
| 不能重复签到 | FC 侧检查 `lastCheckInDate === today` |
| 时间戳防重放 | 30 秒窗口 |

---

## 八、数据迁移

### 8.1 迁移策略

采用**渐进式迁移**，分两个阶段：

**阶段 1 — 双写（运行 1-2 周）**：
- 客户端同时调用 FC 和本地存储
- FC 返回成功后回写本地
- 本地逻辑保留作为降级方案

**阶段 2 — 云端为主（稳定后）**：
- FC 为主数据源
- 本地仅作缓存和离线降级
- 启动时从云端同步（`getStatus`）

### 8.2 存量用户初始化

已安装用户更新到新版本后，首次调用 FC 签到时 OTS 中该 playerId 行不存在，代码自动创建（`getPlayerRecord` 返回 null 时触发初始化）。

---

## 九、控制台操作清单（按顺序执行）

### Step 1: 开通 OTS 实例

1. 登录 [表格存储控制台](https://otsnext.console.aliyun.com)
2. 创建实例 → 地域选"华北2（北京）"（与 OSS 同地域）
3. 实例名：`bz-games`
4. 实例规格：容量型（便宜）
5. 创建数据表 `bz_checkin`：
   - 分区键字段名：`username`，类型：STRING

### Step 2: 创建 RAM 子账号

1. 登录 [RAM 控制台](https://ram.console.aliyun.com)
2. 创建用户 `bz-fc-ots` → 勾选"OpenAPI 调用访问"
3. 授权策略：`AliyunOTSFullAccess`（或自定义最小权限）
4. 保存 AccessKey ID 和 Secret

### Step 3: 创建 FC 函数

签到与登录共用同一个 FC 函数 `bz-api`。若已按 [login 文档 §九 Step 3](./fc-ots-login-design.md#step-3-创建-fc-函数) 创建，跳过此步。

### Step 4: 客户端改造

1. 修改 `system.ipc.ts` 的 `checkIn` handler（未登录本地签到，已登录带 token 调 FC）
2. `StoreService` 新增 `setRemoteUserData()`
3. 新增 `SyncService.ts`（启动时以 OTS bzCoins 覆盖本地）
4. i18n 补充文案

### Step 5: 测试验证

1. 未登录状态 → 签到 → 验证 bzCoins 存入本地 config.json
2. 登录后 → 签到 → 验证 OTS 中记录更新
3. 登录后 → 签到 → 验证本地 bzCoins 同步为 OTS 值
4. 启动时（已登录）→ 验证本地 bzCoins 被 OTS 值覆盖

---

## 十、部署

FC 代码与登录功能合并，部署步骤见 [fc-ots-login-design.md §4.5](./fc-ots-login-design.md#45-部署)。

---

## 十一、监控与运维

| 监控项 | 手段 |
|--------|------|
| FC 调用量/错误率 | FC 控制台 → 监控大盘 |
| OTS 读写延迟 | OTS 控制台 → 监控指标 |
| bzCoins 异常增长 | 在 FC 中加 `if (reward > 1000) log.warn` 上限检查 |

---

## 十二、FAQ

**Q: 为什么不直接用 FC + OTS 替代整个 StoreService？**

A: 游戏记录、设置等涉及本地文件路径、版本目录等信息，不适合放云端。签到/BZ币这类"轻量状态数据"非常适合云端化，而游戏文件管理保持本地。

**Q: 已经签到的用户切换到云端后会丢数据吗？**

A: 不会。首次调用时 OTS 中无记录，会初始化新行。本地缓存中的 BZ 币和连续天数可以临时的——实际上云端模式启动前可以选择"初始化"（把本地数据首次上报到云端）。

**Q: 云端挂了对签到有影响吗？**

A: 有降级保护——FC 请求失败或超时，自动回退到本地 `performCheckIn()` 逻辑，用户无感。

**Q: 可以后续扩展到排行榜吗？**

A: 可以。在 OTS 上建一张 `bz_leaderboard` 表，按 `consecutiveDays` 做二级索引。FC 新增 `action: 'leaderboard'` 查询即可。
