# 游戏市场防盗链设置分析

> 版本：基于 BZ-Games v2.1.2  
> 日期：2026-05-25  

---

## 一、当前防盗链设置一览

### 1.1 Referer 常量定义

[MarketService.ts:L40](file:///f:/IDEA/idea-workspace/bz-games/src/main/services/MarketService.ts#L40):

```typescript
const REFERER = "https://your-client-referer.example";
```

这是一个**虚构的本地域名**，不是真实可访问的网站。只要这个字符串在整个代码库中保持一致，它就充当了一个隐式的"密钥"——只有 BZ-Games 客户端才知道这个 Referer，第三方浏览器/下载工具无法伪造。

### 1.2 Referer 注入点

| 位置 | 请求类型 | 说明 |
|------|---------|------|
| [fetchJson() L369](file:///f:/IDEA/idea-workspace/bz-games/src/main/services/MarketService.ts#L369) | 市场目录/索引 JSON 获取 | GitHub Raw / OSS 上的 market.json |
| [getCachedImageDataUrl() L553](file:///f:/IDEA/idea-workspace/bz-games/src/main/services/MarketService.ts#L553) | 游戏封面/图标图片 | 远程图片资源 |
| [downloadArchive() L760](file:///f:/IDEA/idea-workspace/bz-games/src/main/services/MarketService.ts#L760) | **游戏安装包下载** | `.zip` / `.7z` 文件 |

### 1.3 主进程 WebRequest 拦截器

[index.ts:L13-L17](file:///f:/IDEA/idea-workspace/bz-games/src/main/index.ts#L13-L17):

```typescript
session.defaultSession.webRequest.onBeforeSendHeaders(
  { urls: ["https://cdn.example.com/*"] },
  (details, callback) => {
    details.requestHeaders["Referer"] = "https://your-client-referer.example";
    callback({ requestHeaders: details.requestHeaders });
  },
);
```

这个拦截器仅对私有 CDN 域名生效，且只影响 Chromium 渲染进程发出的请求（如 `<img>` 标签、`fetch()` 在渲染进程中的调用）。对于主进程 Node.js 侧的 `fetch()`（MarketService 的核心调用），**此拦截器完全无效**——Node.js 的 fetch 不经过 Chromium 网络栈。

---

## 二、问题分析：防盗链是否极其不开放？

### 2.1 结论：是的，对第三方游戏源非常不友好

当前防盗链设计是**只面向官方 bz-games-market 游戏源**的封闭方案：

| 下载源类型 | 是否兼容 | 原因 |
|------------|:---:|------|
| **官方市场（bz-games-market）** | ✅ | 官方服务器（GitHub/OSS）已将私有 Referer 配置为白名单 Referer |
| **第三方市场游戏** | ❌ | 第三方服务器不可能将平台私有 Referer 加入白名单，因为这是一个私有/虚构域名 |
| **无防盗链服务器** | ✅ | 不检查 Referer 的服务器（如大多数公共文件托管、未配置热链保护的 CDN）可正常下载 |
| **有防盗链服务器** | ❌ | 假设某游戏作者将 `.zip` 托管在阿里云 OSS 上并开启"Referer 白名单保护"，该下载将**必然失败** |

### 2.2 核心矛盾

```
BZ-Games 的设计追求          vs        当前防盗链实现
─────────────────────────────────────────────────
"开放式游戏管理"                      固定的虚构 Referer，只适配官方源
支持第三方市场源                      第三方游戏下载大概率无法通过防盗链检查
```

游戏市场设计允许添加第三方市场源（`MarketDirectory.sources` 数组），但 **`downloadUrl` 下载时的 Referer 是硬编码的**，第三方游戏文件若托管在带 Referer 白名单的 CDN 上则完全无法下载。这制造了一个**架构与实现之间的认知鸿沟**——理论上支持第三方生态，实际上只对官方源可用。

### 2.3 具体场景举例

```
场景A：第三方游戏作者将 .7z 托管在阿里云 OSS
  → OSS 开启了"防盗链"，Referer 白名单只包含作者自己的网站域名
  → BZ-Games 发送私有 Referer
  → 403 Forbidden → 用户看到"下载失败"

场景B：第三方游戏作者将 .zip 托管在 GitHub Releases
  → GitHub 不检查 Referer
  → 下载成功（但需要确认文件 URL 格式是否与 market.json 中的 downloadUrl 一致）
```

### 2.4 主进程拦截器是否多余？

- `session.defaultSession.webRequest.onBeforeSendHeaders` 只拦截私有 CDN 域名，这个域名在代码库中除此外没有其他引用
- MarketService 使用 Node.js `fetch()`（主进程），不经过 Chromium 网络栈
- 该拦截器可能用于早期版本中的渲染进程直接请求，但目前已无实际作用

---

## 三、改进建议

### 方案 A：让"市场源"携带 Referer 配置（推荐）

在 `MarketSource` 类型中增加可选字段，让每个市场源声明自己的 Referer：

```typescript
// market.types.ts
export const MarketSourceSchema = z.object({
  // ...existing fields
  requestReferer: z.string().optional(),  // ← 新增
});
```

在下载时优先使用市场源声明的 Referer，未声明时使用默认值或**不发送 Referer**。

```typescript
// MarketService.ts downloadArchive()
const sourceReferer = (await this.getSources()).sources[sourceIdx]?.requestReferer;
headers["Referer"] = sourceReferer || REFERER;
```

**优点**：灵活，官方源保持现有行为，第三方源自主声明  
**缺点**：需要修改市场索引格式（schema），需要协调第三方市场源更新

### 方案 B：去掉不必要 Referer，改为无 Referer + User-Agent（简单方案）

对于游戏安装包下载，Referer 在绝大多数场景下并无安全意义（文件已通过 SHA256 校验），可改为：

```typescript
const response = await fetch(targetVersion.downloadUrl, {
  signal: controller.signal,
  headers: {
    "Cache-Control": "no-cache",
    "User-Agent": "BZ-Games-Client/2.0",
  },
});
```

**优点**：最简单，完全兼容所有下载源  
**缺点**：如果官方 OSS 严格依赖 Referer 做防盗链（而非签名）+ 去除了 Referer 会导致 403  

### 方案 C：市场索引 JSON / 图片保留 Referer，游戏安装包去掉 Referer

- JSON 索引和图片（官方托管在 GitHub Raw / OSS）保留 Referer
- 游戏安装包下载（`downloadArchive`）不发送 Referer

这是最务实的折中方案。

---

## 四、总结

| 维度 | 评估 |
|------|------|
| **当前状态** | 防盗链设置为硬编码虚构域名，仅对官方 bz-games-market 源有效 |
| **对第三方开放性** | ❌ 极其不开放。第三方游戏下载大概率因防盗链失败 |
| **安全冗余** | 已有 SHA256 校验，Referer 的额外安全价值有限（对已校验的二进制文件） |
| **与架构理念一致性** | ⚠️ 市场系统设计上支持第三方源，但防盗链实现阻碍了此能力 |
| **推荐改进方向** | 方案 C：游戏安装包去掉 Referer，保留 JSON/图片的 Referer |

---

> 如需实施改进，建议优先采用方案 C（最小改动），后续再评估是否需要方案 A 的完整扩展。
