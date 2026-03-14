# BZ-Games Future Plan（执行版）

## 1. 使用方式（给未来实现时用）

- 目标：这份文档不是“方向说明”，而是“按顺序执行的任务清单”。
- 执行规则：每次只做一个任务编号（如 `A-01`），做完后再做下一个。
- 完成标准：每个任务必须同时满足“代码改动 + 验收 + 回滚说明”。
- 优先级规则：先做 P0，再做 P1，最后 P2。
- 版本节奏：`v1.9.0 -> v2.0.0 -> v2.1.0 -> v2.2.0`，不得跳版本实现核心任务。

## 2. 全局约束（实现时必须遵守）

- 不改变核心定位：无服务器、本地优先、Windows 10/11 x64。
- 不新增后端依赖：允许本地服务增强，不引入云端强依赖。
- 协议改动必须类型化：`src/shared/types` 与 `src/shared/ipc-channels.ts` 同步更新。
- 任何数据路径变更都必须带迁移策略和失败回滚。
- 任意跨进程功能都必须经过 `preload` 暴露，不允许渲染进程直接访问 Node 能力。

## 3. 执行顺序总览

- 版本 1（稳定性）：A 组任务（A-01 ~ A-08）
- 版本 2（联机增强）：B 组任务（B-01 ~ B-08）
- 版本 3（接入生态）：C 组任务（C-01 ~ C-06）
- 版本 4（性能优化）：D 组任务（D-01 ~ D-05）

## 4. v1.9.0（稳定性优先）— A 组任务

### A-01 数据健康检查入口

- 优先级：P0
- 修改文件：
  - `src/main/services/StoreService.ts`
  - `src/main/ipc/system.ipc.ts`
  - `src/shared/ipc-channels.ts`
  - `src/preload/api.ts`
  - `src/renderer/src/stores/useSettingsStore.ts`
  - `src/renderer/src/views/SettingsView.vue`
- 实现步骤：
  - 在主进程增加健康检查函数，检查 `config.json`、`games/`、关键字段完整性。
  - 通过 IPC 暴露 `system:dataHealthCheck`。
  - 在设置页增加“数据自检”按钮和结果展示。
- 验收：
  - 点击后可得到结构化结果（通过/警告/失败）。
  - 失败项有明确错误原因。
- 回滚：
  - 若 UI 异常，仅保留主进程检查逻辑，暂时隐藏入口。

### A-02 迁移流程可回滚

- 优先级：P0
- 修改文件：
  - `src/main/services/StoreService.ts`
- 实现步骤：
  - 迁移前生成快照（配置与目录索引）。
  - 迁移后执行校验，不通过则回滚。
  - 写入迁移结果日志。
- 验收：
  - 人工构造异常迁移场景时可恢复到迁移前状态。
- 回滚：
  - 保留旧路径读取逻辑，关闭自动迁移开关。

### A-03 RoomClient 重连状态机

- 优先级：P0
- 修改文件：
  - `src/main/services/RoomClient.ts`
  - `src/shared/types/room.types.ts`
  - `src/renderer/src/stores/useRoomStore.ts`
  - `src/renderer/src/views/RoomView.vue`
- 实现步骤：
  - 增加状态：`connecting/retrying/failed/recovered`。
  - 渲染层显示状态和倒计时重试信息。
- 验收：
  - 断网后状态正确切换，恢复后能自动回到正常状态。
- 回滚：
  - 恢复旧重连逻辑，仅保留错误提示。

### A-04 游戏进程异常分级

- 优先级：P1
- 修改文件：
  - `src/main/services/GameManager.ts`
  - `src/main/utils/logger.ts`
- 实现步骤：
  - 按退出码分类：正常退出、可重试异常、严重异常。
  - 在日志中输出统一结构字段（gameId/version/exitCode/stage）。
- 验收：
  - 异常退出日志可直接定位到游戏与阶段。
- 回滚：
  - 仅降级为原有日志格式，不影响启动流程。

### A-05 更新错误码与诊断

- 优先级：P1
- 修改文件：
  - `src/main/services/UpdateService.ts`
  - `src/main/ipc/system.ipc.ts`
  - `src/renderer/src/views/SettingsView.vue`
- 实现步骤：
  - 统一更新错误码映射。
  - 设置页展示“失败原因 + 重试入口 + 诊断摘要”。
- 验收：
  - 更新失败时不再出现“未知错误”空提示。
- 回滚：
  - 保留检查更新能力，暂时隐藏诊断详情。

### A-06 房间结束后状态一致性修复

- 优先级：P1
- 修改文件：
  - `src/main/services/GameManager.ts`
  - `src/main/services/RoomServer.ts`
  - `src/renderer/src/stores/useRoomStore.ts`
- 实现步骤：
  - 统一 `room:game:end` 后清理顺序。
  - 防止主进程已结束但 UI 仍显示进行中。
- 验收：
  - 多人房间结束后所有端状态一致。
- 回滚：
  - 出现兼容问题时先恢复旧清理顺序。

### A-07 配置/路径问题可视化提示

- 优先级：P1
- 修改文件：
  - `src/renderer/src/views/SettingsView.vue`
  - `src/renderer/src/locales/*.ts`
- 实现步骤：
  - 对健康检查中的高风险项给出可理解提示。
- 验收：
  - 用户能在设置页看到明确处理建议。
- 回滚：
  - 关闭高风险提示，不影响主流程。

### A-08 v1.9.0 收口任务

- 优先级：P0
- 修改文件：
  - `src/shared/types/*`
  - `src/shared/ipc-channels.ts`
- 实现步骤：
  - 清理未使用类型与频道。
  - 保证 IPC、类型、UI 使用一致。
- 验收：
  - 类型检查通过；关键流程可回归。
- 回滚：
  - 保留旧类型别名兼容一版。

## 5. v2.0.0（联机体验增强）— B 组任务

### B-01 房间模板参数

- 优先级：P0
- 修改文件：
  - `src/shared/types/room.types.ts`
  - `src/main/services/RoomServer.ts`
  - `src/main/ipc/room.ipc.ts`
  - `src/renderer/src/views/RoomView.vue`
- 实现步骤：
  - 增加房间参数：人数上限、口令、是否允许中途加入。
  - 服务端入房校验并返回明确拒绝原因。
- 验收：
  - 参数生效且错误提示准确。

### B-02 Host 管理动作

- 优先级：P1
- 修改文件：
  - `src/main/services/RoomServer.ts`
  - `src/main/ipc/room.ipc.ts`
  - `src/renderer/src/views/RoomView.vue`
- 实现步骤：
  - 增加踢人、转移房主、房间锁定。
  - 仅 Host 可调用，服务端二次鉴权。
- 验收：
  - 非 Host 调用被拒绝并提示权限不足。

### B-03 消息 ACK 与超时重发

- 优先级：P1
- 修改文件：
  - `src/shared/types/room.types.ts`
  - `src/main/services/RoomClient.ts`
  - `src/main/services/RoomServer.ts`
  - `src/renderer/src/stores/useRoomStore.ts`
- 实现步骤：
  - 为关键消息引入 `messageId` + ACK 回执。
  - 超时自动重发并限制最大重试次数。
- 验收：
  - 抖动网络下消息成功率提升。

### B-04 频控与限流

- 优先级：P1
- 修改文件：
  - `src/main/services/RoomServer.ts`
  - `src/shared/types/room.types.ts`
- 实现步骤：
  - 按玩家和消息类型限流。
  - 触发限流时返回可读错误码。
- 验收：
  - 单客户端刷包不影响全房稳定。

### B-05 网络质量状态显示

- 优先级：P2
- 修改文件：
  - `src/renderer/src/stores/useRoomStore.ts`
  - `src/renderer/src/views/RoomView.vue`
  - `src/renderer/src/locales/*.ts`
- 实现步骤：
  - 展示延迟/重试/丢包趋势等级（低中高）。
- 验收：
  - 房间页可实时看到网络状态变化。

### B-06 IPC 与 Preload 收口

- 优先级：P0
- 修改文件：
  - `src/shared/ipc-channels.ts`
  - `src/preload/api.ts`
  - `src/preload/index.ts`
- 实现步骤：
  - 补全新增能力的 IPC 暴露与类型声明。
  - 统一错误转译格式。
- 验收：
  - 前后端调用字段一致，无隐式 any。

### B-07 文案与 i18n 同步

- 优先级：P2
- 修改文件：
  - `src/renderer/src/locales/zh-CN.ts`
  - `src/renderer/src/locales/en-US.ts`
  - `src/renderer/src/locales/ja-JP.ts`
- 实现步骤：
  - 补齐新增交互文案键。
- 验收：
  - 三语无缺失键。

### B-08 v2.0.0 收口任务

- 优先级：P0
- 实现步骤：
  - 回归：建房、加房、重连、开始、结束、聊天、中继消息。
- 验收：
  - 以上流程均可稳定通过。

## 6. v2.1.0（开发者接入）— C 组任务

### C-01 SDK 最小可用能力定义

- 优先级：P1
- 修改文件：
  - `src/main/services/GameApiServer.ts`
  - `src/shared/types/game.types.ts`
- 实现步骤：
  - 定义首批稳定 action：`auth/player.getInfo/room.getInfo/message.send/message.broadcast/achievement.*`。

### C-02 协议版本协商

- 优先级：P1
- 修改文件：
  - `src/shared/types/game.types.ts`
  - `src/main/services/GameApiServer.ts`
- 实现步骤：
  - 增加协议版本字段与降级策略。

### C-03 Manifest 体检工具（平台侧）

- 优先级：P1
- 修改文件：
  - `src/main/services/GameLoader.ts`
  - `src/shared/game-manifest.ts`
- 实现步骤：
  - 在导入阶段输出结构化体检报告（错误/警告/建议）。

### C-04 示例接入模板

- 优先级：P2
- 修改文件：
  - `src/main/services/GameApiServer.ts`
  - `src/renderer/src/views/GameDetailView.vue`
- 实现步骤：
  - 提供可复制的最小接入提示与字段说明（不新增文档文件，先以内置展示为主）。

### C-05 i18n 键完整性检查

- 优先级：P2
- 修改文件：
  - `package.json`
  - `src/renderer/src/locales/*.ts`
- 实现步骤：
  - 增加键一致性检查脚本。

### C-06 v2.1.0 收口任务

- 优先级：P0
- 验收：
  - 新游戏接入流程可跑通，错误提示可定位。

## 7. v2.2.0（性能优化）— D 组任务

### D-01 游戏库渲染优化

- 优先级：P1
- 修改文件：
  - `src/renderer/src/views/LibraryView.vue`
  - `src/renderer/src/components/game/GameCard.vue`
- 实现步骤：
  - 列表渲染优化（优先虚拟化或分页渲染策略）。

### D-02 检索性能优化

- 优先级：P1
- 修改文件：
  - `src/renderer/src/stores/useGameStore.ts`
  - `src/renderer/src/views/LibraryView.vue`
- 实现步骤：
  - 索引缓存 + 防抖查询 + 结果缓存。

### D-03 详情页资源加载优化

- 优先级：P2
- 修改文件：
  - `src/renderer/src/views/GameDetailView.vue`
- 实现步骤：
  - 视频/封面分阶段加载与回退策略优化。

### D-04 构建拆分评估

- 优先级：P2
- 修改文件：
  - `electron.vite.config.ts`
- 实现步骤：
  - 按路由或功能拆分 chunk，减少首屏负载。

### D-05 v2.2.0 收口任务

- 优先级：P0
- 验收：
  - 大型游戏库场景下首屏时间与检索延迟有可感知下降。

## 8. 每次实现任务时的统一模板

- 任务编号：`A-01/B-03/...`
- 改动文件：列出绝对路径或仓库相对路径
- 目标行为：一句话描述“改完后用户可见结果”
- 实现步骤：3~6 条可执行步骤
- 验收方式：手工验证步骤 + 必跑命令
- 风险点：可能影响的旧流程
- 回滚方案：出现故障时如何快速撤回

## 9. 必跑校验命令（每次任务完成后）

- `npm run typecheck`
- `npm run lint`

## 10. 结论

- 这份文档已经改成可逐项执行版本。
- 后续实现时直接告诉我要做哪个任务编号，我会按本文件一步一步落地。
