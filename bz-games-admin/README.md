# BZ-Games 管理端

管理端是公开源码的 Vue 3 应用，生产环境通过中继服务的 `/admin/` 路径提供。

## 本地开发

开发服务器固定代理到本机 `http://127.0.0.1:38090`。生产构建使用同源
`/api` 和 `/auth`，不包含独立的服务器地址配置。
因此当前 `.env.example` 是零字段声明；从仓库根目录运行
`npm run check:config` 可校验管理端实际读取的环境变量与示例保持一致。

不要在源码、文档或其他受版本控制文件中填写真实公网地址、
管理员 ID、OAuth Secret、数据库密码或中继令牌。生产配置应由服务器环境变量提供。

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建产物位于 `dist/`，由中继服务配置的 `ADMIN_STATIC_DIR` 提供。

# 游戏托管

所有 GitHub 用户都可登录同一套创作者中心。管理端采用 RBAC：仅在客户端登录的新用户为 `player`，进入管理端后原子升级为 `creator`；`creator` 只能看到并维护自己的投稿，`administrator` 可查看全部投稿、审核、处理反馈并直接发布。角色只升级不降级，来自 MySQL `users.role`，不读取配置文件白名单。

管理员还可访问“用户列表”，分页检索平台注册用户并查看 GitHub 资料、邮箱、数据库角色、注册时间和最近登录时间；创作者不会获得该菜单和路由能力。

游戏托管使用唯一的 `GameHostingView` 和 `GameHostingForm`，布局、字段、构建和校验逻辑完全复用，仅按能力控制数据范围和操作。页面按游戏、版本、资源展示树，保留下载完整 `MarketGame` JSON，不提供剪贴板配置复制按钮。
