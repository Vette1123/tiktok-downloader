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
| Instagram | 服务端登录媒体接口 → 上游原有 Embed/媒体接口 → 原有 Cobalt 回退 | 部分内容需要 | Cookie 只发送给 Instagram，不会发送给前端或 Cobalt |
| Facebook | 官方插件页 → Facebook 原页面 → 原有 Cobalt 回退 | 年龄限制内容可能需要 | Facebook Cookie 只发送给 Facebook 官方页面，不会发送给 CDN、前端或 Cobalt |
| TikTok、X、YouTube 等 | 继承原项目解析链 | 否 | 仅支持公开可访问内容 |

> 私密作品、好友可见作品、付费内容和 DRM 内容不在支持范围内。Instagram 年龄限制内容只在你配置的专用账号本身有权访问时尝试解析。

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

## 必须配置私人访问

为防止陌生人直接消耗 Worker 请求额度，网页解析和所有媒体代理接口都默认拒绝匿名请求。请在 Cloudflare 控制台进入：

`Workers & Pages → social-media-downloader-cn → Settings → Variables and Secrets`

添加以下四个加密 Secret：

| 名称 | 建议内容 |
| --- | --- |
| `WEB_USERNAME` | 你登录网页使用的账号名 |
| `WEB_PASSWORD` | 独立的高强度密码，不要与其他网站共用 |
| `SESSION_SECRET` | 至少 32 字节的随机字符串，用于签名 HttpOnly 会话 |
| `SHORTCUT_API_KEY` | 至少 32 字节的另一条随机字符串，只给快捷指令使用 |

`SESSION_SECRET` 与 `SHORTCUT_API_KEY` 必须不同。不要把这些值写入 GitHub Actions Variable、仓库文件、网址参数或截图。网页密码登录连续失败 5 次会暂时锁定 10 分钟；解析接口每个来源地址每分钟最多 30 次。

## 安全配置 Instagram Cookie（可选）

仅当公开解析无法处理 Instagram 年龄限制内容时才需要配置。建议注册一个单独的成年 Instagram 账号，不要使用日常主账号。

在 Cloudflare 的“Variables and Secrets”中将下列值全部添加为 **Secret**：

| 名称 | 对应 Instagram Cookie 名称 | 必需性 |
| --- | --- | --- |
| `IG_SESSIONID` | `sessionid` | 必需 |
| `IG_CSRFTOKEN` | `csrftoken` | 建议 |
| `IG_DS_USER_ID` | `ds_user_id` | 建议 |
| `IG_MID` | `mid` | 建议 |
| `IG_DID` | `ig_did` | 建议 |
| `IG_DATR` | `datr` | 可选 |
| `IG_RUR` | `rur` | 可选 |
| `IG_WD` | `wd` | 可选 |

这些值必须来自同一个浏览器配置文件。实现中有四层保护：

1. Cookie 只在网页已登录或快捷指令 API Key 验证成功后启用；
2. 只对 Instagram 平台启用，绝不会附加到抖音、快手、IF-PHP 或 Cobalt 请求；
3. Cookie 不返回前端、不写日志、不进入缓存；
4. 使用 Cookie 的解析结果同时跳过内存缓存和 Cloudflare 边缘缓存。

## 安全配置 Facebook Cookie（可选）

Facebook 出现年龄限制、需要登录或登录后可见的公开内容时，可以配置一个单独的、符合年龄要求的 Facebook 账号 Cookie。建议使用专用账号，不要使用日常主账号，也不要把 Cookie 值发送给任何第三方解析站。

在 Cloudflare 的“Variables and Secrets”中将下列值添加为 **Secret**。最少建议配置 `FB_C_USER` 和 `FB_XS`；其余值来自同一个浏览器配置文件，能提高会话稳定性：

| 名称 | 对应 Facebook Cookie 名称 | 必需性 |
| --- | --- | --- |
| `FB_C_USER` | `c_user` | 建议 |
| `FB_XS` | `xs` | 建议 |
| `FB_DATR` | `datr` | 可选 |
| `FB_SB` | `sb` | 可选 |
| `FB_FR` | `fr` | 可选 |
| `FB_WD` | `wd` | 可选 |

如果浏览器的 Facebook 会话包含额外的 Meta Cookie，也可以只添加一个 Secret：

| 名称 | 值 |
| --- | --- |
| `FB_COOKIE_HEADER` | 浏览器 Cookie 请求头的完整值，不要包含 `Cookie:` 前缀 |

同时配置 `FB_COOKIE_HEADER` 和分项 Cookie 时，优先使用 `FB_COOKIE_HEADER`。不要在这个值中包含换行。Cookie 使用有四层保护：

1. 只有通过网页账号密码登录或快捷指令 API Key 鉴权的请求，才允许使用 Facebook Cookie；
2. 只附加到 `facebook.com`、`www.facebook.com`、`m.facebook.com` 的解析请求，不会发送给 `fbcdn.net`、媒体 CDN、IF-PHP 或 Cobalt；
3. Cookie 不返回前端、不写日志、不进入内存缓存或 Cloudflare 边缘缓存；
4. 解析出的媒体直链不包含 Facebook Cookie，手机或 NAS 下载媒体时也不会收到 Cookie。

Facebook Cookie 不能突破私密账号、好友可见、付费内容、DRM 或账号本身无权访问的内容。Facebook 可能要求重新验证设备或账号；出现异常时应立即撤销该专用账号会话并重新导出 Cookie。

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

## 快捷指令专用 API

快捷指令只能调用下面这个接口。API Key 必须放在请求头中，不能拼在网址后面。

```http
POST /api/shortcut/resolve
Content-Type: application/json
X-API-Key: 你的_SHORTCUT_API_KEY

{
  "url": "2.84 复制打开抖音，看看作品 https://v.douyin.com/xxxx/ 复制口令",
  "quality": "hd",
  "format": "video"
}
```

接口会自动从完整分享文案中提取链接。成功响应中常用字段：

- `type`：`video`、`audio`、`image` 或 `images`；
- `video_url`：视频地址；
- `audio_url`：音频地址；
- `image_urls`：图片地址数组；
- `title`、`author`、`thumbnail`：作品信息。

如果返回的是本站 `/api/` 媒体地址，快捷指令在下一步“获取 URL 内容”时也必须继续携带相同的 `X-API-Key` 请求头。否则媒体代理会返回 401。

## 安全说明

- 所有密码、API Key 和 Cookie 仅保存在 Cloudflare Secret 中，不提交到仓库。
- 浏览器只保存带 `HttpOnly; Secure; SameSite=Strict` 的签名会话，不保存网页密码。
- 快捷指令 API Key 不接受 Query 参数，只接受 `X-API-Key` 或 `Authorization: Bearer` 请求头。
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
