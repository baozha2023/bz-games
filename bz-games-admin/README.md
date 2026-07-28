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
