# BZ-Games 未来版本规划

> 当前版本：**v2.3.7** | 最后更新：2026-06-09

---

## 版本策略

BZ-Games 采用 **渐进式版本演进** 策略，每个大版本聚焦一个核心主题：

| 版本 | 代号 | 主题 | 预计跨度 |
|:---|:---|:---|:---|
| **v2.4** | *Polish* | 体验打磨与稳定性 | 1-2 个月 |
| **v2.5** | *Social* | 社区与社交系统 | 2-3 个月 |
| **v3.0** | *Horizon* | 跨平台与云端 | 3-5 个月 |
| **v3.5** | *Studio* | 创作者生态 | 4-6 个月 |
| **v4.0** | *Matrix* | 平台进化 | 6+ 个月 |

---

## v2.4 — Polish（体验打磨）

### 目标

在当前稳定架构之上，提升用户体验、性能和可靠性，为后续大版本打好地基。

### 2.4.0 核心特性

#### 1. 游戏存档云备份

**现状**：游戏存档完全本地存储，用户更换设备或重装系统后面临存档丢失风险。

**方案**：
- 在设置页新增「云备份」面板
- 支持绑定 WebDAV / S3 兼容存储（MinIO、阿里云 OSS 等）
- 手动备份 / 自动定时备份 / 游戏退出时自动备份
- 备份粒度：按游戏 + 版本自动扫描存档目录，打包为 `.bzsav` 归档
- 还原时支持版本匹配检查，避免版本不兼容覆盖

**可行性**：利用已有的 `StoreService` 和 `DatabaseService` 抽象层，新增 `CloudBackupService`。WebDAV 协议标准化程度高，`webdav` npm 包可直接集成。

#### 2. 游戏存档版本迁移

**现状**：游戏版本升级后，旧版本存档可能不被新版本识别，或用户想保留多个版本各自的存档。

**方案**：
- 每个版本独立存档目录：`{gameStoragePath}/{gameId}/{version}/saves/`
- 版本切换时自动检测并提示「是否迁移旧版本存档」
- 提供存档管理面板：查看各版本存档占用空间、手动清理

**可行性**：`GameEnvironment` 已管理版本隔离，只需在文件系统层面增加版本目录映射。

#### 3. 性能优化 — 大型游戏库

**现状**：游戏库超过 100 个游戏时，`LibraryView` 加载可能出现卡顿。

**方案**：
- 游戏封面图片懒加载 + 虚拟滚动（基于现有 `CachedImg` 组件增强）
- `loadGames()` 分页 / 增量加载
- IndexedDB 缓存游戏元数据，减少主进程 IPC 往返
- 大型游戏库搜索增加防抖和 Web Worker 模糊匹配

**可行性**：Vue 3 响应式系统天然支持细粒度更新，仅需在组件层面增加虚拟滚动和懒加载逻辑。

#### 4. 手柄支持增强

**现状**：平台本身不做手柄映射，完全依赖游戏自行处理。

**方案**：
- 新增全局手柄配置页：手柄按键映射、振动强度、死区设置
- 通过 HTML5 Gamepad API 在 Web 游戏中提供统一的手柄输入
- 为 Native 游戏提供可选的 XInput → DirectInput 桥接

**可行性**：Electron 支持 Gamepad API，`main` 进程可通过 `navigator.hid` 或 native addon 实现手柄输入转发。

#### 5. 市场详情页增强

**现状**：市场游戏详情仅展示基础信息和版本列表。

**方案**：
- 游戏详情页增加轮播截图区
- 版本更新日志（Release Notes）Markdown 渲染展示
- 「相关游戏」推荐（基于标签 / 分类的协同过滤）
- 下载队列可视化改进：并行下载数可配置、下载速度图表

**可行性**：`MarketGameVersionSchema` 已有 `releaseNotes` 字段，UI 层面增加 Markdown 渲染即可。

---

## v2.5 — Social（社区与社交）

### 目标

从单机 + 点对点联机，扩展为具备社区属性的轻社交游戏平台。

### 2.5.0 核心特性

#### 1. 好友系统

**方案**：
- 基于玩家 ID 的好友添加 / 删除 / 黑名单
- 好友在线状态（通过 Relay Server 订阅）
- 好友列表 UI：头像框、当前游戏、可快速邀请
- 好友间的快捷私聊（走 Relay 中继，不依赖房间）

**架构影响**：
- `StoreService` 新增 `friends` 存储字段
- `relay-server` 新增好友状态订阅/推送 channel
- 渲染进程新增 `FriendsView` 和 `useFriendStore`

**可行性**：Relay Server 已有 WebSocket 基础设施，新增好友状态 channel 只需扩展 `RoomMessageType` 类型和 relay 路由逻辑。

#### 2. LAN 游戏分享

**方案**：
- 同一局域网内的 BZ-Games 实例可互相发现
- 支持「一键发送游戏到好友」— 通过 LAN P2P 传输游戏文件
- 接收方自动校验 SHA256，无需手动导入
- 传输进度在通知中心展示

**可行性**：已有 `RoomDiscoveryService`（UDP 广播发现），可复用其发现机制。文件传输可直接用 TCP socket 或 HTTP Range 分片。

#### 3. 游戏截图与剪辑

**方案**：
- 全局快捷键截图（默认 `Ctrl+Shift+S`），自动保存到截图库
- 支持录制最近 N 秒的回放剪辑（类似 NVIDIA ShadowPlay）
- 截图/剪辑管理面板：按游戏分组、标签、分享
- 游戏中成就解锁时自动截图

**可行性**：Electron 的 `desktopCapturer` + `BrowserWindow.capturePage()` 可实现截图。回放录制可用 `MediaRecorder` API 结合循环缓冲区。

#### 4. 游戏动态与活动 Feed

**方案**：
- 首页新增动态 Feed 面板（可选）
  - 好友解锁了新成就
  - 好友开始玩某游戏
  - 市场有游戏更新
  - 自己获得的成就回顾（「1年前的今天你解锁了...」）
- 支持点赞、评论（轻量互动）
- 动态数据存储于本地 + relay 转发，无需中心服务器

**可行性**：事件驱动架构天然支持此特性。`AchievementNotifier` 已实现成就弹窗，扩展为 Feed 条目即可。

---

## v3.0 — Horizon（跨平台与云端）

### 目标

打破 Windows 桌面端边界，让 BZ-Games 成为真正跨平台、跨设备的游戏平台。

### 3.0.0 核心特性

#### 1. macOS 与 Linux 支持

**方案**：
- 主进程服务抽象化：`GameEnvironment`、`GameLoader` 中的平台相关代码用条件编译 / 策略模式分离
- macOS：`.app` 打包、DMG 分发、Sparkle 更新
- Linux：AppImage / Flatpak / deb 打包
- 7z 解压使用各平台对应二进制
- 窗口管理适配各平台托盘、菜单、快捷键规范

**架构影响**：
- 较大的重构工作，但不改变核心业务逻辑
- `electron-builder` 已支持多平台构建配置
- `GameLoader` 中 `spawn` 路径处理需要平台感知

**可行性**：Electron 本身就是跨平台框架，当前限制主要是 `better-sqlite3` 原生模块（支持三平台）、7z 路径硬编码和 NSIS 安装器。

#### 2. 移动端伴侣 App

**方案**：
- 轻量移动端 App（React Native / Flutter），不是完整游戏平台
- 核心功能：
  - 查看游戏库、成就、统计
  - 接收好友邀请通知
  - 远程管理下载队列
  - 聊天消息推送
- 通过 Relay Server 与桌面端通信
- 不运行游戏，仅作为遥控器和通知中心

**可行性**：Relay Server 作为通信桥梁已就绪。移动端本质上是 Relay Server 的另一个 WebSocket 客户端，复用现有的 room/chat 协议。

#### 3. 云端游戏存档同步

**方案**：
- 在 v2.4 云备份基础上，升级为实时同步
- 游戏存档目录使用文件系统 watch + 增量同步
- 冲突解决策略：最后写入胜出 + 手动合并
- 多设备间无缝切换游戏进度

**可行性**：已有 `CloudBackupService`（v2.4 引入），在此基础上增加 `chokidar` 文件监听和增量 diff 即可。

#### 4. Web 版游戏启动器

**方案**：
- 纯 Web 版 BZ-Games（运行在浏览器中）
- 仅支持 `networkgame` 类型游戏（直接 URL 启动）
- 不支持本地游戏导入和联机房间（浏览器限制）
- 作为「轻量入口」，降低新用户体验门槛

**可行性**：`AppContent.vue` 和路由系统已是标准 Vue 3 SPA。将渲染进程独立构建 + 去掉 Electron 依赖即可作为纯 Web 应用部署。

---

## v3.5 — Studio（创作者生态）

### 目标

从游戏消费平台升级为游戏创作与分发平台，构建创作者经济闭环。

### 3.5.0 核心特性

#### 1. 可视化游戏编辑器

**方案**：
- 内置轻量级 2D 游戏编辑器（基于 Phaser 或 PixiJS）
  - 场景编辑器（拖拽精灵、碰撞体）
  - 事件系统编辑器（可视化脚本 / 蓝图节点）
  - 内置物理引擎集成
- 一键导出为标准 BZ-Games 格式（符合 `game.json` 规范）
- 内置 Game API 调试面板，实时查看/发送 WebSocket 消息
- 模板市场：官方和社区提供的游戏模板

**可行性**：平台已有完整的游戏包规范和 Game API，编辑器主要解决「生成合规游戏包」的问题。Phaser 编辑器开源方案成熟（如 Phaser Editor）。

#### 2. 创作者工坊

**方案**：
- 用户可上传自制游戏到创作者工坊
- 工坊游戏支持评分、评论、收藏
- 创作者激励：BZ 币打赏、下载量排行榜
- 工坊审核机制：自动扫描 + 社区举报
- 游戏可通过工坊直接安装到本地游戏库

**架构影响**：
- 需要独立的工坊后端服务（或复用市场 GitHub 仓库模式）
- `MarketService` 扩展工坊数据源
- 新增 `WorkshopView` 和 `useWorkshopStore`

**可行性**：市场系统已有完整的游戏元数据 Schema 和下载/安装流程。工坊本质上是「用户投稿的市场」，架构可高度复用。

#### 3. MOD 与插件系统

**方案**：
- 游戏可声明 `mod_support: true`，允许加载外部 MOD
- MOD 格式：`.bzmod` 归档包，包含覆盖文件和 `mod.json` 清单
- MOD 加载顺序和冲突检测
- 平台提供 MOD 管理面板：启用/禁用/排序 MOD
- MOD 工坊（复用创作者工坊基础设施）

**可行性**：`GameEnvironment` 负责游戏文件管理，MOD 加载本质是在游戏目录基础上叠加文件覆盖层，可通过符号链接或虚拟文件系统实现。

#### 4. 直播与录制集成

**方案**：
- 内置推流功能：选择游戏窗口 → 推流到 Bilibili / Twitch / YouTube
- 直播间浮窗：显示聊天弹幕、BZ 币打赏
- 观众可通过弹幕指令与游戏互动（Game API `event.chatCommand` 事件）
- 录制功能增强：多轨道（游戏画面 + 摄像头 + 麦克风）

**可行性**：Electron 的 `desktopCapturer` + `MediaStream` API 可获取游戏画面流。OBS Studio 的开源推流逻辑（RTMP）可参考实现。

---

## v4.0 — Matrix（平台进化）

### 目标

从游戏平台进化为可扩展的应用生态平台，引入 AI 和去中心化技术。

### 4.0.0 核心特性

#### 1. 插件架构

**方案**：
- 开放平台扩展 API，第三方开发者可创建 BZ-Games 插件
- 插件类型：
  - **UI 扩展**：新增侧边栏面板、右键菜单项
  - **服务扩展**：游戏启动前/后的钩子、自定义 IPC handler
  - **数据扩展**：自定义存储空间、新增统计维度
- 插件市场：集中分发和自动更新
- 沙箱隔离：插件运行在独立 context，限制文件系统和网络权限

**架构影响**：
- 定义 `BZPlugin` 接口规范（TypeScript 类型声明包）
- `PluginManager` 服务负责插件加载、生命周期、权限管理
- 渲染进程插件通过动态 `import()` + Vue `defineAsyncComponent` 加载

**可行性**：Vue 3 的组件系统天然支持动态加载，Electron 的 `contextBridge` 可用于安全暴露 API。VS Code 的插件模型值得参考。

#### 2. AI 游戏助手

**方案**：
- 本地 LLM 集成（Ollama / llama.cpp），不依赖云端 AI
- 功能：
  - **游戏攻略助手**：基于游戏说明书的 RAG 问答
  - **智能 MOD 推荐**：分析游玩习惯推荐 MOD
  - **AI 游戏伙伴**：在单人游戏中模拟 AI 对手/队友（通过 Game API 注入）
  - **语音控制**：语音指令控制平台操作
- 所有 AI 推理在本地完成，保护隐私

**可行性**：Ollama 提供标准 REST API，`node-llama-cpp` 可在 Electron 主进程直接加载模型。RAG 可用 `langchain.js` + 本地向量数据库（如 `vectra`）。

#### 3. 去中心化 P2P 网络

**方案**：
- 基于 libp2p 的去中心化房间网络
  - 房间发现通过 DHT（Kademlia），不再依赖中心化 Relay Server
  - 游戏消息中继通过 libp2p pubsub（GossipSub）
  - NAT 穿透：libp2p 内置 Circuit Relay + AutoNAT + UPnP
- 可选运行本地 Relay Node，为网络做贡献并获得 BZ 币奖励
- Relay Server 降级为可选的 bootstrap 节点

**架构影响**：
- `RoomServer` / `RoomClient` 底层通信从纯 WebSocket 迁移到 libp2p transport
- 上层 `GameApiServer` 保持接口不变，对游戏完全透明
- 新增 `P2PService` 管理 libp2p 节点生命周期

**可行性**：`@libp2p/js-libp2p` 已足够成熟，支持 WebSocket、WebRTC、TCP 等多种 transport。渐进式迁移：先作为可选的 transport 层，与现有 Relay 模式并存。

#### 4. VR / AR 游戏支持

**方案**：
- 支持导入和启动 VR 游戏（SteamVR / OpenXR 兼容）
- 平台内 VR 大厅：虚拟空间中浏览游戏库、进入房间
- AR 伴侣模式：手机扫描桌面，在 AR 中查看游戏 3D 封面和成就
- WebXR 游戏类型（`type: "webxr"`）

**可行性**：Electron 可启动外部 VR 进程。WebXR 在 Chromium 中已原生支持。VR 大厅可用 Three.js + WebXR 构建。

#### 5. 游戏云串流

**方案**：
- 用户 A 的电脑作为串流主机，用户 B 可通过浏览器/客户端远程游玩
- 基于 WebRTC 的低延迟视频串流 + 输入回传
- 适合让朋友试玩游戏而无需对方安装
- 串流质量自适应带宽

**可行性**：WebRTC 的 `getDisplayMedia` + DataChannel 天然适合此场景。Sunshine + Moonlight 的架构可借鉴。

---

## 长期愿景（v4.x+）

| 方向 | 简述 |
|:---|:---|
| **游戏保存计划** | 老游戏/Flash 游戏归档与兼容层（DOSBox、Ruffle） |
| **AI 生成游戏** | 文字描述生成可玩的迷你游戏 |
| **元宇宙房间** | 3D 虚拟房间，角色可走动互动 |
| **数据可携** | 完整的游戏数据导入/导出标准（开放格式） |
| **无障碍** | 屏幕阅读器支持、色盲模式、单手操作模式 |

---

## 架构演进原则

所有版本规划遵循以下核心原则：

1. **渐进增强，不破坏**：新版本必须向后兼容旧版本游戏包和 API
2. **本地优先**：核心体验不依赖云端服务，离线可用
3. **用户数据主权**：用户数据始终存储在本地，云端功能为可选增强
4. **轻量高内聚**：避免依赖臃肿，保持安装包 < 200MB
5. **开放标准**：游戏包格式、Game API 协议、存档格式均文档化并开放

---

## 如何参与

BZ-Games 是一个开源项目（GPL-3.0），欢迎社区贡献。

- **GitHub**: [baozha2023/bz-games](https://github.com/baozha2023/bz-games)
- **市场数据**: [baozha2023/bz-games-market](https://github.com/baozha2023/bz-games-market)
- **反馈与建议**: 通过 GitHub Issues 提交
