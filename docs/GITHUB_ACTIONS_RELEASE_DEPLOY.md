# GitHub Actions 最新安装包部署配置

正式版 GitHub Release 发布后，`.github/workflows/sync-latest-release.yml` 会先验证
`releases.stable.json`、其中引用的全部 Velopack full/delta 包以及唯一匹配的
`BZ-Games-Setup-X.Y.Z.exe` 均已上传。随后安装器会被上传到服务器，经过版本、大小、PE 文件头和 SHA-256 校验后原子发布。
草稿、预发布版和旧版本会被拒绝。同版本同文件按幂等成功处理；同版本不同文件完成校验后保留服务器当前文件，
并以成功状态返回 `desktop_release_same_version_different_sha256`。
工作流在传输安装器前非阻塞获取与管理端共用的发布锁；已有上传时立即失败，不排队也不在 `.incoming` 留下第二份文件。

创建 GitHub Release 时必须上传 `dist/velopack` 中的 `releases.stable.json` 及该文件引用的全部 `.nupkg`。工作流会逐项核对清单 SHA-256、大小与 GitHub Release 资产元数据；只上传自定义安装器会让官网安装仍然可用，但游戏内更新源不完整，因此工作流会拒绝发布。

## 1. GitHub Environment

进入仓库：`Settings → Environments → New environment → production-download`。

添加 Environment variables：

| 名称                  | 值                                                           |
| --------------------- | ------------------------------------------------------------ |
| `RELEASE_SERVER_HOST` | `39.106.221.85`                                              |
| `RELEASE_SERVER_PORT` | `22`                                                         |
| `RELEASE_SERVER_USER` | `bz-release-deploy`                                          |
| `RELEASE_PUBLIC_URL`  | `http://39.106.221.85:38090/api/v1/releases/latest/download` |

添加 Environment secrets：

| 名称                             | 内容                                          |
| -------------------------------- | --------------------------------------------- |
| `RELEASE_SERVER_SSH_PRIVATE_KEY` | 专用部署私钥的完整原文，包括 BEGIN/END 行     |
| `RELEASE_SERVER_KNOWN_HOSTS`     | 已人工核对的 `39.106.221.85` SSH 主机公钥记录 |

工作流只使用 GitHub 自动提供的只读 `GITHUB_TOKEN`，不创建 PAT。配置完成后可在 Actions 中手动运行
`Sync latest desktop release`，输入 `v3.2.0` 验证；以后正式 Release 的 `published` 事件会自动运行。

如果未来由另一个 Actions 工作流使用 `GITHUB_TOKEN` 创建 Release，应在同一发布流程中通过
`workflow_call` 调用本工作流。GitHub 不会为 `GITHUB_TOKEN` 触发的普通事件递归启动另一工作流。

## 2. 阿里云 ECS 管理密钥

阿里云控制台路径为：`云服务器 ECS → 网络与安全 → 密钥对`，并且必须先选择实例所在地域。选择“创建密钥对”后，
浏览器会自动下载一次 `.pem` 私钥。私钥遗失后不能从控制台重新下载，只能创建新密钥对或导入已有公钥。

在控制台给运行中的实例绑定或换绑密钥对通常需要重启实例才会生效，而且可能替换当前控制台绑定密钥。因此该流程适合
ECS 管理登录，不用于 GitHub Actions 专用账号。官方说明：
[实例登录凭证与密钥对管理](https://help.aliyun.com/zh/ecs/user-guide/instance-logon-credential-management)。

当前 ECS 管理私钥保存在本机：

```text
C:\Users\zhangxiaojie\.ssh\campusmate-deploy.pem
```

该 root 私钥只用于首次配置服务器，不得复制到 GitHub Secrets。

## 3. 创建 Actions 专用密钥

在 Windows PowerShell 生成无交互口令的独立 Ed25519 密钥：

```powershell
ssh-keygen -t ed25519 -f C:\Users\zhangxiaojie\.ssh\bz-games-release-deploy -C bz-games-release-deploy
```

私钥是无扩展名文件，公钥为同名 `.pub`。使用 ECS 管理密钥登录服务器，创建无 sudo 权限的
`bz-release-deploy` 用户，将公钥写入 `/home/bz-release-deploy/.ssh/authorized_keys`，并在公钥前添加：

```text
no-agent-forwarding,no-port-forwarding,no-pty,no-X11-forwarding
```

服务器目录权限固定为：

```text
/var/lib/bz-games-releases                 bz-release-deploy:bz-release-deploy 0750
/var/lib/bz-games-releases/.incoming       bz-release-deploy:bz-release-deploy 0750
/home/bz-release-deploy/.ssh               bz-release-deploy:bz-release-deploy 0700
/home/bz-release-deploy/.ssh/authorized_keys                               0600
```

把本地私钥完整内容保存为 `RELEASE_SERVER_SSH_PRIVATE_KEY`。不要把它提交到仓库、聊天记录、Issue、日志或构建产物。

## 4. 固定服务器主机指纹

先在 ECS 本机查看主机公钥指纹：

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

再在可信网络执行：

```powershell
ssh-keyscan -t ed25519 39.106.221.85
```

用 `ssh-keygen -lf` 检查扫描结果并与 ECS 本机指纹逐字核对。确认一致后，把完整 known_hosts 记录写入
`RELEASE_SERVER_KNOWN_HOSTS`。工作流强制启用 `StrictHostKeyChecking=yes`，禁止使用 `no` 绕过校验。

## 5. 故障处理

- `Expected exactly one asset`：Release 中缺少规范安装器或存在重名资产。
- `desktop_release_same_version_different_sha256`：上传文件校验成功，但同版本文件的 SHA-256 与服务器不同；服务器保留当前文件，工作流正常结束。
- `refusing to publish an older release`：手动选择了低于服务器当前版本的 tag。
- SSH 失败：检查 Environment、专用用户公钥、22 端口安全组和 known_hosts 指纹。
- 发布失败不会切换 `latest.json`；修正原因后重新运行同一 tag 即可。
