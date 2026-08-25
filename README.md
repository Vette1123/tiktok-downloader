# 社交媒体解析下载器（中国平台增强版）

这是基于 [Vette1123/social-media-downloader](https://github.com/Vette1123/social-media-downloader) 的 Cloudflare Workers 分支。保留原项目对海外平台的解析能力，并新增抖音、快手、小红书和哔哩哔哩支持。

项目只负责解析公开作品并返回媒体直链或代理地址。实际文件由浏览器、手机或 NAS 下载，Worker 不会把整段视频保存到服务器。

## 支持的平台

| 平台 | 解析方式 | 是否需要 Cookie | 说明 |
| --- | --- | --- | --- |
| 抖音 | 分享页 → IF-PHP API → Cobalt 回退 | 否 | Cloudflare 数据中心经常拿不到抖音媒体数据，建议配置 `IFPHP_API_KEY` |
| 快手 | 移动分享页直解析 → IF-PHP API → Cobalt 回退 | 否 | 支持完整分享文案和短链接 |
| 小红书 | 分享页直解析 → IF-PHP 聚合 API → Cobalt 回退 | 否 | 风控页面可能需要后两种回退方式；Live Photo 优先返回静态原图 |
| 哔哩哔哩 | B站公开接口 | 否 | 返回单文件 MP4，避免 Worker 无法合并 DASH 音视频的问题 |
| Instagram | 上游原有 Embed → 媒体接口 → 原有 Cobalt 回退 | 否 | 完全沿用上游路由，不增加额外公共 Cobalt |
| TikTok、X、Facebook、YouTube 等 | 继承原项目解析链 | 否 | 仅支持公开可访问内容 |

> 私密作品、好友可见作品、付费内容、DRM 内容以及登录后才能访问的内容不在支持范围内。

## 中国平台解析流程

1. 从用户粘贴的完整分享文案中提取第一个 HTTP(S) 链接。
2. 自动识别平台。
3. 优先请求平台公开页面或公开接口。
4. 直接解析失败时，使用配置了 Key 的 IF-PHP API。
5. 仍然失败时，尝试 Cobalt 公共/自建实例。
6. 返回媒体直链；前端通过带正确 `Referer` 的同源代理进行预览和下载。

IF-PHP Key 只会通过 `X-API-Key` 请求头发送给 `api-new.ifphp.com`，不会写进链接、前端代码或日志。

## 一键部署到 Cloudflare Workers

### 1. Fork 仓库

在 GitHub 中 Fork 本仓库，然后打开 Fork 后仓库的设置。

### 2. 创建 Cloudflare API Token

在 Cloudflare 控制台创建有 Workers 编辑权限的 API Token，并记下：

- Cloudflare Account ID
- Cloudflare API Token

### 3. 配置 GitHub Actions Secrets

进入：

`Settings → Secrets and variables → Actions → Secrets`

添加：

| 名称 | 内容 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token |

### 4. 配置站点地址

进入：

`Settings → Secrets and variables → Actions → Variables`

添加：

| 名称 | 示例 |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://social-media-downloader-cn.你的子域.workers.dev` |

第一次不知道最终地址时可以先部署，部署完成后把实际地址填入变量，再重新运行工作流。

### 5. 运行部署工作流

推送到 `main` 后会自动部署。也可以进入 `Actions → Deploy to Cloudflare Workers → Run workflow` 手动执行。

Pull Request 只进行构建和检查，不会覆盖线上 Worker。

## 配置 IF-PHP API Key

抖音在 Cloudflare 数据中心环境中经常无法仅靠公开页面解析，因此建议配置你自己的 IF-PHP Key。

可在 Cloudflare 控制台中操作：

`Workers & Pages → social-media-downloader-cn → Settings → Variables and Secrets`

添加加密 Secret：

```text
名称：IFPHP_API_KEY
值：你的 API Key
```

也可以在本地登录 Wrangler 后执行：

```bash
pnpm exec wrangler secret put IFPHP_API_KEY
```

可选配置：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `IFPHP_API_BASE` | `https://api-new.ifphp.com/api` | 自定义兼容 API 地址 |
| `COBALT_API_URL` | 空 | 一个或多个自建 Cobalt 地址，使用逗号或空格分隔 |
| `COBALT_API_KEY` | 空 | 自建 Cobalt 的访问 Key |
| `CANONICAL_ORIGIN` | 空 | 配置自定义域名后，让 workers.dev 跳转到自定义域名 |

不设置 `CANONICAL_ORIGIN` 时，workers.dev 地址会直接提供服务，不会像上游项目那样跳转到原作者网站。

## 本地开发

要求：

- Node.js 22 或更高版本
- pnpm（版本以 `package.json` 为准）

安装并运行：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

运行测试：

```bash
pnpm test
pnpm exec tsc --noEmit
```

本地预览 Cloudflare Worker：

```bash
pnpm preview
```

## API 使用示例

请求：

```http
POST /api/download
Content-Type: application/json

{
  "url": "2.84 复制打开抖音，看看作品 https://v.douyin.com/xxxx/ 复制口令",
  "quality": "hd",
  "format": "video"
}
```

接口会自动从完整分享文案中提取链接。成功响应中：

- `downloadUrl`：同源媒体代理地址；
- `audioUrl`：可用时返回音频地址；
- `metadata.images`：图文作品的图片列表；
- `metadata.directVideoUrl`：Cobalt 隧道可直接下载时返回。

## 安全说明

- API Key 仅保存在 Cloudflare Secret 中，不提交到仓库。
- 页面不会要求用户提交平台 Cookie。
- 只解析公开链接，不绕过登录、付费或 DRM 限制。
- 公共 Cobalt 实例属于第三方服务，可能记录请求链接，也可能限流或停止服务；隐私敏感场景建议配置自建实例。
- 媒体链接通常有时效，解析后应尽快下载。

## 当前限制

- 抖音对数据中心 IP 的风控较强，不配置 `IFPHP_API_KEY` 时成功率无法保证。
- B站公开接口返回的单文件 MP4 清晰度通常低于需要 DASH 合并的最高画质；Cloudflare Workers 不能运行 ffmpeg。
- 小红书分享页可能只返回“请在 App 内打开”，这时会依赖 IF-PHP 或 Cobalt 回退。
- 小红书 Live Photo 暂不重建为苹果 Live Photo 文件；检测到静态原图时会按图片组提供下载，不再把运动片段伪装成普通视频。
- Instagram 完全沿用上游项目的解析顺序和原有 Cobalt 列表，本分支不额外增加公共实例。
- 公共第三方接口随时可能限流、改版或下线。

## 许可证与致谢

本项目沿用上游项目的 MIT License。

- 上游项目：[Vette1123/social-media-downloader](https://github.com/Vette1123/social-media-downloader)
- 中国平台增强分支：[cmbya/social-media-downloader](https://github.com/cmbya/social-media-downloader)

请遵守目标平台的服务条款、当地法律和内容版权要求，仅下载你有权保存的内容。
