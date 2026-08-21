# BZ-Games 登录 / 云同步数据结构说明

## 概览

当前服务端采用混合存储：

- **MySQL**：保存用户基础资料、OAuth 临时状态、登录会话、云文件元数据
- **MongoDB GridFS**：保存单一平台快照和反馈图片；平台快照封装脱敏加密配置与业务 SQL dump

这样拆分的原因：

- 用户资料、会话、文件版本信息需要唯一约束和关系查询，适合 MySQL
- 平台快照中的 `databaseSql` 是 SQLite 逻辑 SQL dump，适合随配置一起作为一个不可拆分对象保存在 GridFS

---

## MySQL 结构

数据库名默认是 `bz_games`。

### 1. users

**用途**

- 保存 GitHub 登录后的用户基础资料
- 保存 Portal RBAC 角色，权限不依赖部署配置白名单
- 一个平台账号对应一条记录

**主要字段**

| 字段            | 类型              | 说明                                                          |
| --------------- | ----------------- | ------------------------------------------------------------- |
| `id`            | `BIGINT UNSIGNED` | 自增主键                                                      |
| `github_id`     | `VARCHAR(64)`     | GitHub 用户 ID，唯一                                          |
| `login`         | `VARCHAR(255)`    | GitHub 登录名                                                 |
| `name`          | `VARCHAR(255)`    | GitHub 显示名                                                 |
| `avatar_url`    | `TEXT`            | GitHub 头像地址                                               |
| `profile_url`   | `TEXT`            | GitHub 主页地址                                               |
| `email`         | `VARCHAR(255)`    | GitHub 邮箱，可能为空                                         |
| `role`          | `ENUM`            | `player`、`creator`、`administrator` 或 `super_administrator` |
| `created_at`    | `DATETIME(3)`     | 首次创建时间                                                  |
| `updated_at`    | `DATETIME(3)`     | 最近资料更新时间                                              |
| `last_login_at` | `DATETIME(3)`     | 最近一次登录时间                                              |

所有 OAuth 新用户统一创建为 `player`，登录只更新 GitHub 资料，不改变已有角色。服务端是管理 capability 的唯一策略源；桌面客户端 Bearer 接口不读取角色。`administrator` 不能修改角色或上传桌面客户端版本，`super_administrator` 拥有全部 capability，并可把其他非超级管理员调整为 `player`、`creator` 或 `administrator`；不能修改自己、修改其他超级管理员或通过接口授予新的超级管理员。GitHub ID `208792845` 由最新数据库初始化定义幂等设为初始超级管理员。

**示例数据**

```sql
id: 1
github_id: "208792845"
login: "baozha2023"
name: "Baozha"
avatar_url: "https://avatars.githubusercontent.com/u/123456789?v=4"
profile_url: "https://github.com/baozha2023"
email: ""
role: "super_administrator"
created_at: 2026-06-11 21:08:30.125
updated_at: 2026-06-11 21:08:30.125
last_login_at: 2026-06-11 21:08:30.125
```

### 2. auth_sessions

**用途**

- 保存登录会话
- 浏览器 Cookie 或未来桌面端 Bearer Token 都对应这里的一条会话

**主要字段**

| 字段         | 类型              | 说明                             |
| ------------ | ----------------- | -------------------------------- |
| `id`         | `BIGINT UNSIGNED` | 自增主键                         |
| `token_hash` | `CHAR(64)`        | 会话 token 的 SHA-256 哈希，唯一 |
| `user_id`    | `BIGINT UNSIGNED` | 关联 `users.id`                  |
| `created_at` | `DATETIME(3)`     | 会话创建时间                     |
| `updated_at` | `DATETIME(3)`     | 最近使用时间                     |
| `expires_at` | `DATETIME(3)`     | 过期时间                         |

**示例数据**

```sql
id: 15
token_hash: "3a9bb4c7b74f9bde3f0df9d67b46c73005b0d17e4cbdbb4dcf0b4dd0c50b8a8a"
user_id: 1
created_at: 2026-06-11 21:08:31.002
updated_at: 2026-06-11 21:20:05.441
expires_at: 2026-07-11 21:08:31.002
```

### 3. oauth_states

**用途**

- 保存 GitHub OAuth 登录流程中的临时 `state`
- 防止 CSRF，同时保存登录完成后的跳回地址 `return_to`

`return_to` 只允许 `bzgames://`、`http://127.0.0.1:` 和 `http://localhost:` 前缀。桌面端默认使用 `bzgames://oauth-complete`，由 Electron 主进程在协议回调里取出 `session_token` 并写入本地云同步配置。

**主要字段**

| 字段         | 类型              | 说明                              |
| ------------ | ----------------- | --------------------------------- |
| `id`         | `BIGINT UNSIGNED` | 自增主键                          |
| `state_hash` | `CHAR(64)`        | OAuth state 的 SHA-256 哈希，唯一 |
| `return_to`  | `TEXT`            | 登录完成后要跳转的地址            |
| `created_at` | `DATETIME(3)`     | 创建时间                          |
| `expires_at` | `DATETIME(3)`     | 过期时间                          |

**示例数据**

```sql
id: 8
state_hash: "0cb1ab6fb05bb8e97d4f5b0dbe3d2a2f6e63e1b7a3c6d77a6ce5a1ec7a3f07e1"
return_to: "bzgames://oauth-complete"
created_at: 2026-06-11 21:08:20.511
expires_at: 2026-06-11 21:18:20.511
```

### 4. user_platform_snapshots

Each user has one current platform snapshot pointer. `user_id` is the primary key; `file_storage_id` references GridFS; `snapshot_version`, `size`, `sha256`, `content_type`, `created_at`, and `updated_at` describe the current object.

Publication uploads the complete GridFS object first, then uses `SELECT ... FOR UPDATE` in a MySQL transaction to increment the version and switch the pointer. Old objects are deleted only after commit and a grace period.

### 5. cloud_sync_limits

Stores the most recent upload/download time by `user_id + action_type`. The single-snapshot protocol does not use operation IDs or a per-file operation table.

## MongoDB cloud object boundary

The shared GridFS bucket is isolated by `metadata.kind`:

- Platform snapshots use `kind=platform-snapshot` and filename `<userId>/platform-snapshot.json`.
- Feedback images use `kind=feedback-image`.
- Future game saves reserve `kind=game-save` and must not be embedded in platform snapshots.

A platform snapshot is one JSON object containing sanitized encrypted configuration and the SQL dump for `play_sessions`, `achievement_unlocks`, and `stats_reports`. It never contains `games`, `game_versions`, game directories, Web `gamedata.json`, or native save files.

Downloads read one MySQL pointer and one GridFS object. Cleanup deletes only the explicitly replaced platform snapshot object and never scans other kinds.

The legacy `user_file_refs`, `cloud_sync_operation_files`, and dual-object protocol are removed in v3.1.2 without cloud-data compatibility handling.

## Local database merge boundary

The SQL dump omits the local autoincrement implementation column `stats_reports.event_sequence` and merges by stable business keys in one SQLite transaction. `games` and `game_versions`, including favorites, ordering, `path`, and `is_present`, remain entirely device-local.

## 建言献策

### MySQL `feedback`

保存反馈正文、处理状态、面向用户的回复、管理备注、提交者类型、可选 GitHub 用户、
客户端版本、平台、图片数量和创建/更新时间。匿名 IP、`playerId`
和客户端 ID均不持久化。

### MySQL `feedback_images`

保存反馈图片的 GridFS `storage_id`、文件名、实际 MIME、大小和创建时间。
通过 `feedback_id` 与反馈关联。

两张表都由 `createMySqlService().ensureSchema()` 使用完整的
`CREATE TABLE IF NOT EXISTS` 自动初始化，不提供独立迁移脚本。

客户端不持久化反馈历史。打开历史记录时，客户端按当前登录用户从
`GET /api/v1/feedback` 查询反馈编号和提交时间；展开历史记录时，再通过用户反馈详情接口
读取正文、处理状态、回复和图片。管理备注不会返回给客户端。

### MongoDB GridFS

图片复用 `MONGODB_BUCKET_NAME` 指定的现有 Bucket，metadata 标记为
`kind=feedback-image`。GridFS集合由 MongoDB驱动自动维护。

# 游戏托管元数据

托管元数据使用所有权、修订、版本、资源结构：

- `hosted_games`：以 `game_id` 为主键，保存所有者、已发布公共配置和已通过最新版本；首次投稿审核前发布字段可为空。
- `hosted_game_metadata_revisions`：保存公共信息修订、投稿人、审核人、驳回原因和审核时间。
- `hosted_game_versions`：以 UUID 为主键，唯一键为 `game_id + version`，保存投稿/审核信息；状态只能是 `pending`、`approved`、`rejected`。
- `hosted_game_assets`：保存版本的 `package/icon/cover` 资源；同一版本每种角色最多一个。

首个普通用户投稿会原子建立游戏所有权、初始公共信息修订、首版本及资源。待审核资源不进入公开下载；管理员批准首版本时同时发布初始公共信息。已发布公共信息的普通用户修改只创建修订，审核通过前不影响市场配置。

物理文件存放于 `GAME_HOSTING_STORAGE_DIR/files/<gameId>/<version>/`，使用 `package.zip`、`icon.<ext>`、`cover.<ext>` 固定名称。UTF-8 原文件名仅用于展示、逻辑地址和 Content-Disposition，绝不参与磁盘路径拼接。大小、MIME 和 SHA-256 均由上传流计算；删除和失败回滚必须同时覆盖数据库与整个版本目录。
