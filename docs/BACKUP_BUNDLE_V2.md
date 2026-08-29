# `.bzgames` V2 备份格式

BZ-Games 4.x 永久支持 V2 导入和导出。归档是无压缩 7z 容器，扩展名固定为 `.bzgames`：

```text
backup-manifest.json
config.json
games/
db/
  bz_games.db
```

`backup-manifest.json` 的稳定字段如下：

```json
{
  "format": "bzgames-backup",
  "formatVersion": 2,
  "dataModelVersion": 4,
  "exportedAt": "ISO-8601",
  "sourceAppVersion": "4.0.0",
  "sourcePlatform": "win32",
  "sourceArch": "x64",
  "entries": ["config.json", "games", "db"],
  "totalFiles": 0,
  "totalBytes": 0,
  "externalLibraryCount": 0
}
```

V2 只复制内置 `games/` 和唯一的 `db/bz_games.db`；数据库目录中的 WAL、SHM、旧库、临时文件及其他残留都不进入归档。外部游戏库仅以数据库引用保留。归档配置会清空账号会话、账号身份与 `githubToken`，导入不会恢复任何凭据。导入语义是完整替换，不合并当前配置、数据库或内置游戏库，也绝不删除源 `.bzgames`。

导入器必须先执行 7z CRC 测试，严格校验 Manifest 与归档根目录，并拒绝白名单外条目、重复路径、路径穿越、ADS、硬链接、符号链接、目录联接、重解析点、特殊文件、异常展开比和空间不足。替换前逐项记录已备份的当前数据和已安装的新数据；失败时只撤销实际安装项并恢复已备份项，回滚自身失败必须保留现场。新数据重启并通过健康检查后才清理回滚目录。

V2 的 `formatVersion` 保持为 2。未来数据模型变化只提高 `dataModelVersion` 并在备份适配层转换，业务运行时不得增加旧结构兼容分支。
