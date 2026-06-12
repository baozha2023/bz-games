# BZ-Games 登录 / 云同步数据结构说明

## 概览

当前服务端采用混合存储：

- **MySQL**：保存用户基础资料、OAuth 临时状态、登录会话、云文件元数据
- **MongoDB GridFS**：保存云文件内容本体，目前是 `config.json` 和 `play_sessions.db` 对应的 SQL 逻辑备份

这样拆分的原因：

- 用户资料、会话、文件版本信息需要唯一约束和关系查询，适合 MySQL
- `play_sessions.db` 同步的是 SQLite 逻辑 SQL dump，未来表数量和记录量增长后仍适合用 MongoDB GridFS 保存整份备份文本

---

## MySQL 结构

数据库名默认是 `bz_games`。

### 1. users

**用途**

- 保存 GitHub 登录后的用户基础资料
- 一个平台账号对应一条记录

**主要字段**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | 自增主键 |
| `github_id` | `VARCHAR(64)` | GitHub 用户 ID，唯一 |
| `login` | `VARCHAR(255)` | GitHub 登录名 |
| `name` | `VARCHAR(255)` | GitHub 显示名 |
| `avatar_url` | `TEXT` | GitHub 头像地址 |
| `profile_url` | `TEXT` | GitHub 主页地址 |
| `email` | `VARCHAR(255)` | GitHub 邮箱，可能为空 |
| `created_at` | `DATETIME(3)` | 首次创建时间 |
| `updated_at` | `DATETIME(3)` | 最近资料更新时间 |
| `last_login_at` | `DATETIME(3)` | 最近一次登录时间 |

**示例数据**

```sql
id: 1
github_id: "123456789"
login: "baozha2023"
name: "Baozha"
avatar_url: "https://avatars.githubusercontent.com/u/123456789?v=4"
profile_url: "https://github.com/baozha2023"
email: "demo@example.com"
created_at: 2026-06-11 21:08:30.125
updated_at: 2026-06-11 21:08:30.125
last_login_at: 2026-06-11 21:08:30.125
```

### 2. auth_sessions

**用途**

- 保存登录会话
- 浏览器 Cookie 或未来桌面端 Bearer Token 都对应这里的一条会话

**主要字段**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | 自增主键 |
| `token_hash` | `CHAR(64)` | 会话 token 的 SHA-256 哈希，唯一 |
| `user_id` | `BIGINT UNSIGNED` | 关联 `users.id` |
| `created_at` | `DATETIME(3)` | 会话创建时间 |
| `updated_at` | `DATETIME(3)` | 最近使用时间 |
| `expires_at` | `DATETIME(3)` | 过期时间 |

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

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | 自增主键 |
| `state_hash` | `CHAR(64)` | OAuth state 的 SHA-256 哈希，唯一 |
| `return_to` | `TEXT` | 登录完成后要跳转的地址 |
| `created_at` | `DATETIME(3)` | 创建时间 |
| `expires_at` | `DATETIME(3)` | 过期时间 |

**示例数据**

```sql
id: 8
state_hash: "0cb1ab6fb05bb8e97d4f5b0dbe3d2a2f6e63e1b7a3c6d77a6ce5a1ec7a3f07e1"
return_to: "bzgames://oauth-complete"
created_at: 2026-06-11 21:08:20.511
expires_at: 2026-06-11 21:18:20.511
```

### 4. user_file_refs

**用途**

- 保存每个用户的云文件元数据
- 不存文件内容本体，只存“这个文件现在指向 MongoDB 的哪个 GridFS 文件”

**主要字段**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | 自增主键 |
| `user_id` | `BIGINT UNSIGNED` | 关联 `users.id` |
| `file_key` | `VARCHAR(64)` | 文件标识，目前支持 `config.json`、`play_sessions.db` |
| `file_storage_id` | `VARCHAR(64)` | 对应 MongoDB GridFS `files._id` |
| `version` | `BIGINT UNSIGNED` | 文件版本号，每次覆盖上传递增 |
| `size` | `BIGINT UNSIGNED` | 文件字节数 |
| `sha256` | `CHAR(64)` | 文件内容哈希 |
| `content_type` | `VARCHAR(255)` | MIME 类型 |
| `created_at` | `DATETIME(3)` | 首次上传时间 |
| `updated_at` | `DATETIME(3)` | 最近一次上传时间 |

**示例数据**

`config.json` 示例：

```sql
id: 21
user_id: 1
file_key: "config.json"
file_storage_id: "68498c67e6dcb0486b6f4a11"
version: 3
size: 18432
sha256: "f8b27e1a72f4fd7bfc3dbf5ea64d9f9f0592d67087d9bd8f6d3bb0488b9dc20d"
content_type: "application/json"
created_at: 2026-06-11 21:15:02.000
updated_at: 2026-06-11 21:25:48.000
```

`play_sessions.db` 示例（内容是 SQL dump，不是 SQLite 二进制文件）：

```sql
id: 22
user_id: 1
file_key: "play_sessions.db"
file_storage_id: "68498c9ae6dcb0486b6f4a12"
version: 7
size: 98304
sha256: "6d7f2b94d6298f03e6ab72b6e5a6f1d1af7de4dca6c519f1498c4d59f8a23310"
content_type: "application/sql; charset=utf-8"
created_at: 2026-06-11 21:15:10.000
updated_at: 2026-06-11 22:03:27.000
```

### 5. cloud_sync_limits

**用途**

- 保存每个用户的云同步限流状态
- 上传和下载分别限流，同一账号同一类型操作一小时只能完成一次
- `operation_id` 用于同一次完整同步中连续处理 `config.json` 和 `play_sessions.db`

**主要字段**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | 自增主键 |
| `user_id` | `BIGINT UNSIGNED` | 关联 `users.id` |
| `action_type` | `ENUM('upload','download')` | 操作类型 |
| `operation_id` | `VARCHAR(64)` | 本次完整同步操作 ID |
| `last_action_at` | `DATETIME(3)` | 最近一次同类型同步开始时间 |

### 6. cloud_sync_operation_files

**用途**

- 记录一次完整云同步中已处理过的文件
- 防止同一个 `operation_id` 重复上传或下载同一个文件

**主要字段**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | 自增主键 |
| `user_id` | `BIGINT UNSIGNED` | 关联 `users.id` |
| `action_type` | `ENUM('upload','download')` | 操作类型 |
| `operation_id` | `VARCHAR(64)` | 本次完整同步操作 ID |
| `file_key` | `VARCHAR(64)` | 已处理的云对象标识 |
| `created_at` | `DATETIME(3)` | 处理时间 |

---

## MongoDB 结构

数据库名默认也是 `bz_games`。

Bucket 名默认是 `userFiles`，所以 GridFS 会自动使用两张集合：

- `userFiles.files`
- `userFiles.chunks`

### 1. userFiles.files

**用途**

- 保存每个上传对象的文件级元数据
- 对应一个完整云端对象，例如某个用户的一份 `config.json` 或 `play_sessions.db` SQL dump

**主要字段**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | `ObjectId` | GridFS 文件主键 |
| `length` | `NumberLong` | 文件总字节数 |
| `chunkSize` | `NumberInt` | 分块大小 |
| `uploadDate` | `ISODate` | 上传时间 |
| `filename` | `String` | 文件名，这里是 `用户ID/file_key` |
| `contentType` | `String` | 文件类型 |
| `metadata.userId` | `Number` / `String` | 用户 ID |
| `metadata.fileKey` | `String` | 文件标识 |
| `metadata.uploadedAt` | `ISODate` | 业务上传时间 |

**示例数据**

```json
{
  "_id": { "$oid": "68498c67e6dcb0486b6f4a11" },
  "length": 18432,
  "chunkSize": 261120,
  "uploadDate": { "$date": "2026-06-11T13:25:48.000Z" },
  "filename": "1/config.json",
  "contentType": "application/json",
  "metadata": {
    "userId": 1,
    "fileKey": "config.json",
    "uploadedAt": { "$date": "2026-06-11T13:25:48.000Z" }
  }
}
```

### 2. userFiles.chunks

**用途**

- 保存文件的二进制分片内容
- 一个大文件会拆成多条 chunk，小文件通常只有 1 条

**主要字段**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | `ObjectId` | chunk 主键 |
| `files_id` | `ObjectId` | 关联 `userFiles.files._id` |
| `n` | `Int32` | 第几个分片，从 0 开始 |
| `data` | `Binary` | 实际二进制内容 |

**示例数据**

```json
{
  "_id": { "$oid": "68498c67e6dcb0486b6f4a21" },
  "files_id": { "$oid": "68498c67e6dcb0486b6f4a11" },
  "n": 0,
  "data": { "$binary": { "base64": "eyJzZXR0aW5ncyI6eyJsYW5n...", "subType": "00" } }
}
```

> `data` 里是真实云端对象内容。  
> 如果是 `config.json`，这里存的是 JSON 文件字节流；如果是 `play_sessions.db`，这里存的是平台从 SQLite 导出的 SQL dump 文本。

---

## 数据如何关联

一次完整的云文件上传关系如下：

1. 用户通过 GitHub 登录，MySQL `users` 里存在用户记录
2. 用户登录后产生会话，MySQL `auth_sessions` 里存在会话记录
3. 用户上传 `config.json`，或把本地 SQLite 表导出为 `play_sessions.db` 对应的 SQL dump 后上传
4. 文件内容写入 MongoDB：
   - `userFiles.files` 生成 1 条文件记录
   - `userFiles.chunks` 生成 1 条或多条分片记录
5. 文件元数据写入 MySQL `user_file_refs`
6. 后续下载时，先查 MySQL `user_file_refs`，再根据 `file_storage_id` 去 MongoDB 取文件

---

## 当前实际存哪些业务数据

### MySQL 里存

- GitHub 账号身份
- 用户基础资料
- 登录态
- OAuth 临时 state
- 云文件版本号
- 云文件哈希
- 云文件大小
- 云文件对应的 MongoDB 文件 ID

### MongoDB 里存

- `config.json` JSON 文件内容
- `play_sessions.db` 对应的 SQLite SQL dump 文本

### 不在云端 MySQL / MongoDB 里直接拆字段保存的内容

- `config.json` 内部的设置项、用户数据字段，目前仍然作为完整 JSON 文件存储
- `play_sessions.db` 内部的各业务表记录，目前作为 SQL dump 整体存储，不拆成云端 MySQL 业务表

也就是说，当前云同步方案是 **对象级同步**：`config.json` 是文件级同步，`play_sessions.db` 是 SQLite 逻辑 SQL 同步，不是“把本地配置和游玩记录拆成很多云端业务表”。

---

## 为什么不把所有东西都放 MySQL

主要原因是 `play_sessions.db` 对应的是本地 SQLite 业务数据，未来会越来越大：

- 放 MySQL BLOB 不利于版本覆盖和大对象处理
- 把每个客户端的 SQLite 表拆到云端 MySQL 业务表会引入复杂迁移、冲突合并和跨端 schema 兼容问题
- 放 MongoDB GridFS 更适合保存整份 SQL dump，并保留简单的覆盖式上传/下载语义
- MySQL 更适合保存结构化元数据和关系数据

所以现在的方案是：

- **MySQL 管结构**
- **MongoDB 管文件**

这个组合更适合后续做：

- 用户数据上传
- 云端数据下载
- 本地覆盖同步
- 版本冲突检测
- 文件哈希校验
