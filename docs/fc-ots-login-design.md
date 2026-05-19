# 登录 / 注册功能 FC + OTS — 完整实现流程

> 版本: 1.0 | 日期: 2026-05-15
> 前置依赖: 本文档是签到功能迁移的前置实现，需先完成登录鉴权体系

---

## 一、当前 playerId 机制分析

### 1.1 生成与存储

```
首次启动
  StoreService.getSettings()
    → merged.playerId 为空
    → crypto.randomUUID() 生成 UUID v4  ← [StoreService.ts:549](file:///f:/IDEA/idea-workspace/bz-games/src/main/services/StoreService.ts#L549)
    → 写入 config.json (AES-256-GCM 加密)
    → 后续读取复用
```

没有用户选择的用户名/密码概念，**每个本地安装自动获得唯一 playerId**。

### 1.2 playerId 使用位置（全局扫描）

| 模块 | 用途 | 文件 |
|------|------|------|
| 房间创建 | 房主身份标识 `hostId: settings.playerId` | RoomServer.ts:109 |
| 房间加入 | 加入握手 `playerId: settings.playerId` | RoomClient.ts:110 |
| 聊天消息 | 发送者 `senderId: settings.playerId` | room.ipc.ts:87 |
| 游戏环境 | 注入 `BZ_PLAYER_ID` / `bz-config.js` | GameEnvironment.ts:24,47 |
| API Server | `auth` 响应返回 player | GameApiServer.ts:118,122 |
| 数据健康 | 检查 playerId 是否缺失 | StoreService.ts:779 |
| 签到数据 | `config.json` userData (本地) | StoreService.ts:330 |

### 1.3 核心问题

```
         电脑 A                      电脑 B
    playerId: "uuid-A"         playerId: "uuid-B"
           │                          │
           │  同一用户在两台电脑上      │
           │  是不同 playerId          │
           │  ────────────────────── │
           │  签到数据不同步           │
           │  BZ 币不互通             │
           │  无法云端统一管理         │
```

---

## 二、目标架构

### 2.1 登录后 playerId 流程

```
┌─ 首次使用 ────────────────────────────────────────────────────┐
│                                                                │
│  用户打开 BZ-Games → 登录页面                                   │
│  选择「注册」                                                   │
│    输入: 用户名 (username)                                       │
│          密码 (password)                                        │
│          昵称 (playerName)                                      │
│                                                                │
│  客户端 ──POST /auth────────────────► FC 函数                   │
│          { action: "register",       │                         │
│            username, passwordHash,    │                         │
│            playerName }               │                         │
│                                       │                         │
│                 ◄── 返回 ─────────────│                         │
│                 { playerId: "SVR-     │                         │
│                    UUID",             │                         │
│                   token: "eyJh..." }  │                         │
│                                                                │
│  客户端:                                                        │
│    1. 将 playerId 写入 config.json (覆盖旧的本地 UUID)           │
│    2. 将 token 写入 config.json                                │
│    3. playerName 也同步更新                                     │
│                                                                │
└────────────────────────────────────────────────────────────────┘

┌─ 登录（已有账号，新设备/重装）─────────────────────────────────┐
│                                                                │
│  输入: 用户名 + 密码                                             │
│                                                                │
│  客户端 ──POST /auth────────────────► FC 函数                   │
│          { action: "login",           │                         │
│            username, passwordHash }    │                         │
│                                       │                         │
│                 ◄── 返回 ─────────────│                         │
│                 { playerId: "SVR-     │                         │
│                    UUID",             │                         │
│                   playerName: "小明", │                         │
│                   token: "eyJh..." }  │                         │
│                                                                │
│  客户端:                                                        │
│    1. 用 SVR-UUID 覆盖本地 playerId                              │
│    2. 存储 token                                               │
│                                                                │
└────────────────────────────────────────────────────────────────┘

┌─ 已登录（有 token）───────────────────────────────────────────┐
│                                                                │
│  启动应用 → 检测 config.json 是否有 token                        │
│    有 token → 后台调用 action: "verifyToken"                    │
│       成功 → 直接进入主界面                                      │
│       失败 → 显示登录页                                          │
│    无 token → 显示登录页                                        │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 完整架构图

```
┌─ BZ-Games 客户端 ───────────────────────────────────────────┐
│                                                               │
│  LoginView.vue (新增)                                         │
│    注册: username + password → SHA256(password) → POST        │
│    登录: username + password → SHA256(password) → POST        │
│                                                               │
│  system.ipc.ts (改造)                                         │
│    IPC: auth:register / auth:login / auth:verifyToken         │
│    → StoreService 写入 playerId / token                       │
│    → 所有 checkIn 等请求携带 token (HMAC 签名)                 │
│                                                               │
│  StoreService (改造)                                           │
│    getSettings().playerId ← 首次注册时由 FC 分配               │
│    saveAuth({ playerId, token })                              │
│    getAuthToken() → token                                     │
│                                                               │
└───────────────────────┬───────────────────────────────────────┘
                        │ HTTPS
┌─ 阿里云 ────────────┴───────────────────────────────────────┐
│                                                               │
│  FC 函数: bz-auth (Node.js 20)                                │
│    action: register → 校验用户名唯一 → 生成 playerId          │
│                      → bcrypt(passwordHash) → 写入 OTS        │
│                      → 生成 JWT token → 返回                   │
│                                                               │
│    action: login → 查询 OTS 获取 passwordHash                  │
│                   → bcrypt.compare → 生成 token → 返回         │
│                                                               │
│    action: verifyToken → jwt.verify → 返回 playerId            │
│                                                               │
│  ┌─ OTS: bz_accounts ────────────────────────────────────┐   │
│  │ 分区键: username (用户选择的登录名)                      │   │
│  │ 字段: passwordHash, playerId, playerName, token, ...   │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                               │
│  后续: 同一个 username 串联 bz_checkin 等所有游戏数据          │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

## 三、OTS 表设计

### 3.1 用户账户表: `bz_accounts`

| 字段 | 类型 | 说明 |
|------|------|------|
| `username` | String (**分区键**) | 用户选择的登录名，必须唯一 |
| `passwordHash` | String | bcrypt(password) 结果 |
| `playerId` | String | 服务器分配的全局唯一 ID（UUID v4） |
| `playerName` | String | 显示昵称 |
| `token` | String | 当前有效的 JWT（登录/注册后更新） |
| `tokenExpireAt` | Integer | Unix 秒时间戳，token 过期时间 |
| `createdAt` | Integer | Unix 毫秒，注册时间 |
| `updatedAt` | Integer | Unix 毫秒，最后修改时间 |

**为什么用 username 做分区键而不是 playerId**:
- 登录时用户输入的是 username，需要直接用 username 查询 OTS
- playerId 是登录成功后才拿到的，无法用于登录查询

### 3.2 playerId 唯一性保证

`playerId` 不是分区键，如何保证唯一？

**方案**：使用 UUID v4，碰撞概率 ≈ 2.7×10⁻¹⁷，无需 OTS 查重。`bz_checkin` 表改用 `username` 作为分区键后，不再依赖 `playerId` 做查询，因此 `playerId` 仅作为账户的属性字段存储，UUID v4 足够保证全局唯一。

---

## 四、FC 函数开发

### 4.1 函数配置

| 配置项 | 值 |
|--------|-----|
| 函数名 | `bz-api` |
| 运行时 | Node.js 20 |
| 内存 | 256 MB（bcrypt 需要稍多内存） |
| 超时 | 10 秒 |
| 触发器 | HTTP 触发器 |
| 代码方式 | 上传源代码（FC 控制台直接上传，无需 zip 打包） |

### 4.2 项目结构

FC 函数代码位于项目根目录 `fc-api/`，与登录、签到两个功能合并为一个函数：

```
fc-api/
├── package.json    # npm 依赖声明（tablestore, bcrypt, jsonwebtoken）
├── index.js        # FC 入口 — action 路由分发
├── auth.js         # 登录/注册逻辑
├── checkin.js      # 签到/查询/Token 验证
├── ots.js          # OTS 客户端初始化 + 表 CRUD
├── utils.js        # 工具函数 + 环境变量读取
└── .gitignore
```

### 4.3 环境变量

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `OTS_ACCESS_KEY_ID` | `<AccessKey ID>` | 建议子账号 |
| `OTS_ACCESS_KEY_SECRET` | `<AccessKey Secret>` | 同上 |
| `OTS_ENDPOINT` | `https://xxx.cn-beijing.ots.aliyuncs.com` | OTS 实例地址 |
| `OTS_INSTANCE` | `bz-games` | OTS 实例名 |
| `JWT_SECRET` | `<64位随机字符串>` | JWT 签名密钥 |
| `JWT_EXPIRES_IN` | `30d` | Token 有效期 |

### 4.4 完整代码

代码位于项目 `fc-api/` 目录，分模块组织：

| 文件 | 职责 | 代码量 |
|------|------|--------|
| `index.js` | FC 入口，按 `action` 分发到各 handler | ~40 行 |
| `auth.js` | `register` / `login` + JWT 生成 + playerId 唯一性校验 | ~150 行 |
| `checkin.js` | `checkIn` / `getStatus` / `verifyToken` — JWT 鉴权 | ~120 行 |
| `ots.js` | OTS 客户端初始化 + `bz_accounts` / `bz_checkin` 两表的 get/put | ~110 行 |
| `utils.js` | 日期格式化、响应封装、环境变量读取 | ~30 行 |

**入口 index.js 路由**：

```
action: register    → auth.js     handleRegister()
action: login       → auth.js     handleLogin()
action: checkIn     → checkin.js  handleCheckIn()
action: getStatus   → checkin.js  handleGetStatus()
action: verifyToken → checkin.js  handleVerifyToken()
```

> 签到请求使用 JWT 鉴权（`auth.verifyTokenPayload`），同时保留 HMAC 签名校验作为不依赖 JWT 场景的补充防护。两种方式可同时启用。

### 4.5 部署

FC 控制台 → 创建函数 `bz-api`（Node.js 20, 256MB）→ 上传代码 → 设置环境变量 → HTTP 触发器。

阿里云 FC 支持直接上传源代码，在控制台中 `npm install` 后点击"部署"即可，无需本地 zip 打包。

---

## 五、客户端改造

### 5.1 数据模型变更

```typescript
// src/shared/types/store.types.ts

interface AppSettings {
  playerName: string;
  playerId: string;           // ← 旧: 本地 UUID, 新: FC 分配
  avatar?: string;
  lastJoinRoomAddress?: string;
  language: "zh-CN" | "en-US" | "ja-JP";
  theme: "dark" | "light";
  defaultRoomPort: number;
  closeBehavior: "tray" | "exit";
  autoLaunch: boolean;
  ignoredUpdateVersion?: string;
  gameStoragePath?: string;
  gameStorageHistory?: string[];

  // ── NEW ──
  /** 登录用户名（持久化用于下次自动填写） */
  authUsername?: string;
  /** JWT token（持久化用于自动登录） */
  authToken?: string;
}
```

### 5.2 新增 IPC Channel

```typescript
// src/shared/ipc-channels.ts

export const IPC = {
  // ... 现有

  // ── 认证 ──
  AUTH_REGISTER: "auth:register",
  AUTH_LOGIN: "auth:login",
  AUTH_VERIFY_TOKEN: "auth:verifyToken",
  AUTH_LOGOUT: "auth:logout",
} as const;
```

### 5.3 主进程 IPC 处理器

```typescript
// src/main/ipc/auth.ipc.ts (新文件)

import { ipcMain } from "electron";
import crypto from "crypto";
import { IPC } from "../../shared/ipc-channels";
import { storeService } from "../services/StoreService";
import { logger } from "../utils/logger";

/** FC 认证函数 HTTP 触发器地址（部署后由开发者填写此处） */
const AUTH_API_URL = "https://xxxxxxxxxxxxxxxx.cn-beijing.fc.aliyuncs.com/...";

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function authFetch(body: Record<string, unknown>) {
  const response = await fetch(AUTH_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: "https://bz-game-client.local",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`auth_request_failed:${response.status}:${text}`);
  }

  return response.json();
}

export function registerAuthIpc() {
  // ── 注册 ──
  ipcMain.handle(IPC.AUTH_REGISTER, async (_, username: string, password: string, playerName: string) => {
    try {
      const result = await authFetch({
        action: "register",
        username,
        passwordHash: sha256(password),
        playerName: playerName || username,
      });

      if (result.success) {
        storeService.applyAuth(result.playerId, result.playerName, result.token);
        storeService.saveAuthCredentials(username);
      }

      return result;
    } catch (error) {
      logger.error("[AuthIPC] register failed", error);
      return { success: false, error: "network_error" };
    }
  });

  // ── 登录 ──
  ipcMain.handle(IPC.AUTH_LOGIN, async (_, username: string, password: string) => {
    try {
      const result = await authFetch({
        action: "login",
        username,
        passwordHash: sha256(password),
      });

      if (result.success) {
        storeService.applyAuth(result.playerId, result.playerName, result.token);
        storeService.saveAuthCredentials(username);
      }

      return result;
    } catch (error) {
      logger.error("[AuthIPC] login failed", error);
      return { success: false, error: "network_error" };
    }
  });

  // ── 验证 Token ──
  ipcMain.handle(IPC.AUTH_VERIFY_TOKEN, async () => {
    const settings = storeService.getSettings();
    if (!settings.authToken) {
      return { success: false, error: "no_token" };
    }

    try {
      const result = await authFetch({
        action: "verifyToken",
        token: settings.authToken,
      });
      return result;
    } catch (error) {
      logger.error("[AuthIPC] verifyToken failed", error);
      return { success: false, error: "network_error" };
    }
  });

  // ── 登出 ──
  ipcMain.handle(IPC.AUTH_LOGOUT, async () => {
    storeService.clearAuth();
    return { success: true };
  });
}
```

### 5.4 StoreService 新增认证方法

```typescript
// src/main/services/StoreService.ts — 新增方法

/**
 * 登录/注册成功后，用云端数据替换本地 playerId
 */
applyAuth(playerId: string, playerName: string, token: string): void {
  const store = this.getStore();
  const settings = store.get("settings", defaultSettings);
  settings.playerId = playerId;
  settings.playerName = playerName;
  settings.authToken = token;
  store.set("settings", settings);
  logger.info(`[StoreService] Auth applied: playerId=${playerId}, playerName=${playerName}`);
}

/**
 * 保存用户名用于下次快速回填
 */
saveAuthCredentials(username: string): void {
  const store = this.getStore();
  const settings = store.get("settings", defaultSettings);
  settings.authUsername = username;
  store.set("settings", settings);
}

/**
 * 登出：清除 token 但保留 playerId 和 playerName
 * （离线仍然可用，只是无法访问云端服务）
 */
clearAuth(): void {
  const store = this.getStore();
  const settings = store.get("settings", defaultSettings);
  settings.authToken = "";
  store.set("settings", settings);
}

/**
 * 获取 token（供其他 IPC handler 使用）
 */
getAuthToken(): string {
  return this.getSettings().authToken || "";
}
```

### 5.5 主进程入口注册

```typescript
// src/main/ipc/index.ts — 新增一行
import { registerAuthIpc } from "./auth.ipc";

export function registerAllIpc() {
  // ... 现有
  registerAuthIpc();  // NEW
}
```

### 5.6 Preload API

```typescript
// src/preload/api.ts — 新增 auth 命名空间

auth: {
  register: (username: string, password: string, playerName: string) =>
    ipcRenderer.invoke(IPC.AUTH_REGISTER, username, password, playerName),
  login: (username: string, password: string) =>
    ipcRenderer.invoke(IPC.AUTH_LOGIN, username, password),
  verifyToken: () =>
    ipcRenderer.invoke(IPC.AUTH_VERIFY_TOKEN),
  logout: () =>
    ipcRenderer.invoke(IPC.AUTH_LOGOUT),
},
```

### 5.7 类型声明

```typescript
// src/renderer/src/types/electron-api.d.ts — auth 类型

auth: {
  register: (username: string, password: string, playerName: string) =>
    Promise<{ success: boolean; playerId?: string; playerName?: string; token?: string; error?: string; message?: string }>;
  login: (username: string, password: string) =>
    Promise<{ success: boolean; playerId?: string; playerName?: string; token?: string; error?: string; message?: string }>;
  verifyToken: () =>
    Promise<{ success: boolean; username?: string; playerId?: string; error?: string }>;
  logout: () => Promise<{ success: boolean }>;
};
```

### 5.8 登录页面 (LoginView.vue) — 新增

```html
<!-- src/renderer/src/views/LoginView.vue -->
<template>
  <div class="login-root">
    <n-card :title="t('auth.title')" style="width: 440px; max-width: 90vw;">
      <n-tabs v-model:value="tab" animated>
        <n-tab-pane name="login" :tab="t('auth.login')">
          <n-form>
            <n-form-item :label="t('auth.username')">
              <n-input v-model:value="loginForm.username" autocomplete="username" />
            </n-form-item>
            <n-form-item :label="t('auth.password')">
              <n-input v-model:value="loginForm.password" type="password" autocomplete="current-password"
                @keydown.enter="handleLogin" />
            </n-form-item>
            <n-button type="primary" block :loading="loading" @click="handleLogin">
              {{ t('auth.loginAction') }}
            </n-button>
          </n-form>
        </n-tab-pane>

        <n-tab-pane name="register" :tab="t('auth.register')">
          <n-form>
            <n-form-item :label="t('auth.username')">
              <n-input v-model:value="regForm.username" />
            </n-form-item>
            <n-form-item :label="t('auth.playerName')">
              <n-input v-model:value="regForm.playerName" />
            </n-form-item>
            <n-form-item :label="t('auth.password')">
              <n-input v-model:value="regForm.password" type="password" autocomplete="new-password" />
            </n-form-item>
            <n-form-item :label="t('auth.confirmPassword')">
              <n-input v-model:value="regForm.confirmPassword" type="password"
                @keydown.enter="handleRegister" />
            </n-form-item>
            <n-button type="primary" block :loading="loading" @click="handleRegister">
              {{ t('auth.registerAction') }}
            </n-button>
          </n-form>
        </n-tab-pane>
      </n-tabs>

      <n-divider />
      <n-button text block @click="handleSkip" :disabled="loading">
        {{ t('auth.skip') }}
      </n-button>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useMessage } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '../stores/useSettingsStore';

const { t } = useI18n();
const router = useRouter();
const message = useMessage();
const settingsStore = useSettingsStore();

const tab = ref('login');
const loading = ref(false);

const loginForm = ref({ username: '', password: '' });
const regForm = ref({ username: '', playerName: '', password: '', confirmPassword: '' });

onMounted(async () => {
  await settingsStore.loadSettings();
  // 回填上次登录的用户名
  if (settingsStore.settings?.authUsername) {
    loginForm.value.username = settingsStore.settings.authUsername;
    regForm.value.username = settingsStore.settings.authUsername;
  }
  // 尝试自动登录
  if (settingsStore.settings?.authToken) {
    loading.value = true;
    const result = await window.electronAPI.auth.verifyToken();
    loading.value = false;
    if (result.success) {
      router.replace({ name: 'library' });
    }
  }
});

async function handleLogin() {
  if (!loginForm.value.username || !loginForm.value.password) {
    message.warning(t('auth.fillAll'));
    return;
  }
  loading.value = true;
  try {
    const result = await window.electronAPI.auth.login(
      loginForm.value.username,
      loginForm.value.password,
    );
    if (result.success) {
      message.success(`${t('auth.welcome')}, ${result.playerName}!`);
      await settingsStore.loadSettings(); // 刷新 settings
      router.replace({ name: 'library' });
    } else {
      message.error(result.message || t('auth.loginFailed'));
    }
  } catch {
    message.error(t('auth.networkError'));
  } finally {
    loading.value = false;
  }
}

async function handleRegister() {
  if (!regForm.value.username || !regForm.value.password || !regForm.value.playerName) {
    message.warning(t('auth.fillAll'));
    return;
  }
  if (regForm.value.password !== regForm.value.confirmPassword) {
    message.warning(t('auth.passwordMismatch'));
    return;
  }
  loading.value = true;
  try {
    const result = await window.electronAPI.auth.register(
      regForm.value.username,
      regForm.value.password,
      regForm.value.playerName,
    );
    if (result.success) {
      message.success(t('auth.registerSuccess'));
      await settingsStore.loadSettings();
      router.replace({ name: 'library' });
    } else {
      message.error(result.message || t('auth.registerFailed'));
    }
  } catch {
    message.error(t('auth.networkError'));
  } finally {
    loading.value = false;
  }
}

function handleSkip() {
  router.replace({ name: 'library' });
}
</script>
```

### 5.9 路由变更

```typescript
// src/renderer/src/router/index.ts

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
  },
  {
    path: '/library',
    name: 'library',
    component: () => import('../views/LibraryView.vue'),
  },
  // ... 其他路由
];
```

### 5.10 应用启动流程改造

```typescript
// src/renderer/src/AppContent.vue — onMounted

onMounted(async () => {
  await settingsStore.loadSettings();

  // 有 token → 后台验证
  if (settingsStore.settings?.authToken) {
    const verifyResult = await window.electronAPI.auth.verifyToken();
    if (verifyResult.success) {
      return; // 验证通过，正常进入
    }
    // token 过期或无效 → 清除 → 跳转登录
    await window.electronAPI.auth.logout();
  }

  // 无 token 或验证失败 → 登录页
  router.replace({ name: 'login' });
});
```

### 5.11 设置页面新增登录状态展示

```html
<!-- SettingsView.vue -->
<n-divider>账号</n-divider>
<n-form-item v-if="settingsStore.settings?.authUsername" label="已登录用户">
  <n-space>
    <n-tag type="success">{{ settingsStore.settings?.authUsername }}</n-tag>
    <n-button size="small" secondary @click="handleLogout">登出</n-button>
  </n-space>
</n-form-item>
<n-form-item v-else label="登录状态">
  <n-text depth="3">未登录</n-text>
</n-form-item>
```

---

## 六、安全性设计

### 6.1 密码传输

```
客户端                                            服务端 (FC)
  │                                                  │
  │  用户输入 password                                │
  │  passwordHash = SHA256(password)                  │
  │  POST { passwordHash }  ──────────────────────► │
  │                                                  │  服务端:
  │      ┌─ 明文密码不离开客户端                       │     bcrypt.hash(passwordHash, 10)
  │      │─ 传输层 HTTPS 加密                          │     → 写入 OTS
  │      │─ bcrypt 再做 10 轮哈希                      │
```

**为什么客户端先 SHA256 再服务端 bcrypt**:
- 客户端 SHA256 确保原始密码不出客户端
- 服务端 bcrypt 防止 OTS 泄露后被暴力破解
- 双重哈希不存在彩虹表攻击

### 6.2 Token 安全

| 措施 | 说明 |
|------|------|
| JWT 签名 | HMAC-SHA256 + 64 位随机密钥 |
| 过期时间 | 30 天，过期后自动要求重新登录 |
| 存储位置 | 加密的 `config.json` 中 |
| 传输方式 | 仅在 HTTPS 请求 body 中传输 |

### 6.3 密码复杂度

**客户端校验**（注册时）:
- 长度 ≥ 6 位
- 允许任意字符（不强制大小写数字，减少用户摩擦）

**服务端校验**:
- username 格式: `/^[a-zA-Z0-9_\-\u4e00-\u9fff]{2,20}$/`
- 拒绝太短的密码哈希（`passwordHash` 长度 < 16）

---

## 七、与签到功能的衔接

登录完成后，playerId 由 FC 统一分配并存储于 OTS。签到时根据登录状态走不同路径：

```
┌─ 客户端 ───────────────────────────────────────┐
│                                                 │
│  点击签到                                        │
│    ├─ settings.authToken 存在？                  │
│    │   ├─ 是 → 调用 FC (action: checkIn)         │
│    │   │       body: { username, playerName,       │
│    │   │              token }                      │
│    │   │       → OTS 更新 bzCoins                  │
│    │   │       → 返回后同步本地 userData.bzCoins  │
│    │   │                                        │
│    │   └─ 否 → 本地签到 storeService.performCheckIn() │
│    │            → config.json 更新 bzCoins       │
│    │                                           │
│  启动时（已登录）                                 │
│    → 调用 FC (action: getStatus)                 │
│    → 以 OTS 的 bzCoins 为准覆盖本地               │
│                                                 │
└─────────────────────────────────────────────────┘
```

登录与签到的 FC 代码已合并为一个 `bz-api` 函数，位于 `fc-api/` 目录。通过请求 body 中的 `action` 字段路由到不同 handler（参见 §4.4）。鉴权统一使用 JWT。

---

## 八、OTS 表总览

完成登录 + 签到两个功能后，OTS 结构如下：

| 表名 | 分区键 | 用途 |
|------|--------|------|
| `bz_accounts` | `username` | 用户登录鉴权（密码哈希、playerId、JWT） |
| `bz_checkin` | `username` | 签到记录（连续天数、BZ 币、签到日期），通过 username 查询 |

两表通过 `username` 关联。`bz_accounts.username` ↔ `bz_checkin.username`。

---

## 九、控制台操作清单

### Step 1: 创建 OTS 表

1. 登录 [OTS 控制台](https://otsnext.console.aliyun.com)
2. 在 `bz-games` 实例中创建数据表 `bz_accounts`：
   - 分区键字段名：`username`，类型：STRING
   - 预留读 CU：1，写 CU：1

### Step 2: 创建 RAM 子账号

（如已为签到功能创建，可复用同一个子账号）

### Step 3: 创建 FC 函数

1. 登录 [FC 控制台](https://fcnext.console.aliyun.com)
2. 创建函数 `bz-api`：
   - 运行时 Node.js 20，内存 256 MB
   - 上传代码（将 `fc-api/` 目录全部上传）
   - 控制台中 `npm install` 安装依赖
3. 配置环境变量（见 §4.3）
4. 创建 HTTP 触发器 → 拿到函数 URL
5. 将 URL 填入 `src/main/ipc/auth.ipc.ts` 的 `AUTH_API_URL` 常量

### Step 4: 客户端改造

1. `AppSettings` 新增 `authUsername`、`authToken`
2. 新增 `auth.ipc.ts` → 3 个 IPC handler，`AUTH_API_URL` 硬编码在文件顶部
3. `StoreService` 新增 `applyAuth()`、`clearAuth()`、`getAuthToken()`
4. 新增 `LoginView.vue`
5. 新增路由 `/login`
6. `AppContent.vue` 启动时检查登录状态
7. `SettingsView.vue` 新增登录状态展示区域
8. i18n 文案补充

### Step 5: 测试

1. 启动应用 → 自动进入登录页
2. 注册新用户 → 验证 OTS 中出现记录
3. 退出应用 → 检查 `config.json` 中 `playerId` 已变更为 FC 分配的 ID
4. 重新启动 → 自动验证 token → 进入主界面
5. 登录其他电脑 → 使用相同用户名/密码 → playerId 同步为同一个
6. 断网测试 → 点击「跳过登录」→ 使用本地 playerId 离线运行

---

## 十、客户端降级策略

```
应用启动
  │
  ├─ settings.authToken 为空？
  │    → 显示登录页
  │    → 用户可选择「跳过」→ 使用本地 playerId 进入（离线模式）
  │
  ├─ 有 token，但 verifyToken 失败（网络/过期）？
  │    → 清除 token
  │    → 显示登录页
  │    → 用户可「跳过」
  │
  └─ 有 token，verifyToken 成功？
       → 正常进入（playerId 为云端值）
```

**核心原则**：登录是增强功能，不影响离线使用。未登录用户仍可导入游戏、启动游戏、使用所有本地功能。网络异常时 AuthIPC 内部 catch 会返回 `{ success: false, error: "network_error" }`，前端据此展示友好提示。登录页始终提供「跳过登录」按钮。

---

## 十一、费用估算

| 资源 | 用量 | 月费用 |
|------|------|--------|
| FC 调用 (注册+登录+验证) | 1000 DAU × 平均 3 次/天 × 30 | ≈ ¥0.10 |
| FC 执行时长 | 每次 ~300ms (bcrypt), 9万次 | ≈ ¥0.50 |
| OTS 预留 | 2 表 × 1 CU | ≈ ¥30 |
| OTS 存储 | 10 万条账户 × ~400 bytes | ≈ ¥0.10 |
| **合计** | | **≈ ¥31/月** |

与签到服务合并部署可进一步降低 FC 侧的固定开销。
