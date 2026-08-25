/**
 * Every /api/* handler, implemented against plain `Request`/`Response`.
 *
 * The App Router files under src/app/api/ are thin wrappers over these, and the
 * Cloudflare Worker entrypoint dispatches them directly from API_ROUTES so that
 * Next is never initialized for an API call.
 *
 * That indirection exists purely because of the free plan's 10 ms CPU budget.
 * Next's server initializes lazily and bills whichever request triggers it:
 * measured at 129 ms for /api/download and 92 ms for /api/slideshow — and the
 * latter only ever returns "not supported here". Every new isolate pays it
 * again, so it is not a one-off cold-start cost. Dispatched from here, the same
 * handlers run in single-digit milliseconds.
 *
 * Keeping one implementation shared by both paths is what makes this safe:
 * `next dev` and any Node host exercise exactly the code Cloudflare runs.
 */

import { Downloader } from './downloader'
import { validateUrl, detectPlatform, extractFirstHttpUrl } from './validator'
import { getCached, setCached } from './responseCache'
import { readEdgeCache, writeEdgeCache, type WaitUntilContext } from './edgeCache'
import { slugify } from './filename'
import { nativeMediaAvailable, nativeMediaUnavailable } from './nativeMedia'
import { MEDIA_PROXY_HANDLERS } from './mediaProxy'
import { type TokenPayload, verifyToken } from './proToken'
import { handleWebhook } from './billing/webhook'
import { handleBmcWebhook } from './billing/bmc'
import { handlePortal } from './billing/portal'
import { handleCheckout } from './billing/checkout'
import { handleCancel } from './billing/cancel'
import {
  handleAccount,
  handleAuthCallback,
  handleAuthStart,
  handleLogout,
  handleRefresh,
} from './auth/routes'
import {
  handlePrivateLogin,
  handlePrivateLogout,
  handlePrivateStatus,
  PRIVATE_AUTH_HEADER,
  type PrivateAccessEnv,
} from './privateAccess'

// A scoped `import type`, not the ambient global from `wrangler types`.
//
// `pnpm cf-typegen` writes a git-ignored cloudflare-env.d.ts that redeclares
// the whole workerd runtime, including a `Body.json()` that resolves to
// `unknown` rather than `any` — which puts 26 type errors into files that have
// nothing to do with D1. CI never runs cf-typegen, so committing code that
// depends on those globals builds locally and fails in the pipeline.
//
// Importing the one type we actually need keeps the build identical in both
// places. It is erased at compile time, so it adds nothing to the Worker
// bundle and nothing to any request path.
import type { D1Database } from '@cloudflare/workers-types'

/**
 * D1 and any other binding live on the Worker's `env`, which is only available
 * to the Cloudflare entrypoint. The Next App Router wrappers under src/app/api
 * call these same functions with no `env`, so a handler that needs a binding
 * must degrade rather than throw — see `requireDb`.
 */
export interface WorkerEnv extends PrivateAccessEnv {
  DB?: D1Database
}

type Handler = (
  request: Request,
  ctx?: WaitUntilContext,
  env?: WorkerEnv,
) => Promise<Response> | Response

/**
 * The 503 a binding-backed route answers when it is running somewhere without
 * that binding — `next dev`, or a misconfigured deployment. Mirrors the shape
 * `nativeMediaUnavailable` uses for the same class of "not available here".
 */
export function requireDb(env?: WorkerEnv): D1Database | Response {
  if (!env?.DB) {
    return Response.json(
      { success: false, error: 'Accounts are not configured on this deployment.' },
      { status: 503 },
    )
  }
  return env.DB
}

/**
 * A resolve served from cache. `X-Cache` distinguishes the two tiers so the
 * smoke test can assert the edge cache is actually live — the Cache API is a
 * silent no-op on workers.dev, and a silent no-op is exactly the kind of thing
 * that looks fine until you check.
 */
function cachedResponse(body: string, tier: 'HIT' | 'EDGE'): Response {
  return new Response(body, {
    headers: { 'Content-Type': 'application/json', 'X-Cache': tier },
  })
}

/** Same-origin paths are already local; only external media needs the proxy. */
function toMediaUrl(mediaUrl: string, proxyPath: string): string {
  if (mediaUrl.startsWith('/')) return mediaUrl
  return `${proxyPath}?url=${encodeURIComponent(mediaUrl)}`
}

/**
 * A cobalt tunnel streams from any IP with `Content-Disposition: attachment`,
 * so the browser can pull it directly instead of re-streaming every byte
 * through the Worker — which would both cost CPU and put video traffic through
 * Cloudflare, which the free plan does not permit.
 *
 * Forced to https: a self-hosted instance behind a TLS-terminating proxy can
 * report an http self-URL, and an https page navigating to that is a
 * mixed-content navigation which displays the file instead of downloading it.
 */
function asDirectTunnel(url: string | undefined): string | undefined {
  if (!url || url.startsWith('/')) return undefined
  return url.replace(/^http:\/\//i, 'https://')
}

/**
 * The verified token, or null for an absent, malformed or expired one.
 *
 * Every consumer reads a specific claim off it and checks that claim, never
 * merely that a signature verified: a signed-in account with no grants carries
 * a perfectly valid token that entitles nothing.
 */
async function readProToken(request: Request): Promise<TokenPayload | null> {
  const token = request.headers.get('X-Pro-Token')
  const secret = process.env.PRO_TOKEN_SECRET?.trim()
  if (!token || !secret) return null
  return verifyToken(token, secret, Date.now())
}

/**
 * The cache key for a resolve: everything that changes the payload, and
 * nothing that doesn't.
 *
 * There is deliberately no per-tier component. A resolve's result no longer
 * depends on who asked — Pro changes resolver *ordering* only — so every
 * request can safely share one entry, and the edge cache applies to all
 * traffic instead of being skipped for signed-in users. The `auth`/`anon`
 * split this used to carry existed to keep a credentialed Instagram result out
 * of a shared store; that entitlement is gone, and with it the reason to
 * fragment the cache. Extracted so the format is asserted by a test rather
 * than resting on an inline string literal — see apiRoutes.test.ts.
 */
export function resolveCacheKey(
  type: string,
  quality: 'hd' | 'sd',
  mode: 'auto' | 'audio',
  url: string,
): string {
  return `${type}|${quality}|${mode}|${url}`
}

/**
 * A failed resolve, with a status that says whose fault it was.
 *
 * Almost every failure here is a fact about the link, not a fault in this
 * Worker: the post is private, the account is login-only, the video was
 * deleted, the platform is rate-limiting us. Those were all answered with 500,
 * which meant Cloudflare's dashboard counted a perfectly healthy day of people
 * pasting private Instagram links as seventeen server errors — and buried any
 * real exception among them.
 *
 * The discriminator is the error's own constructor. Every "we could not get
 * this" throw in downloader.ts is a deliberate `new Error(message)`, and the
 * runtime's own faults are always subclasses: a TypeError from reading a
 * property of undefined, a ReferenceError from a typo. So a base Error, or the
 * one named extraction error, is content; anything else is a bug and keeps its
 * 500 so it still shows up as one.
 *
 * `AbortError` is neither: an upstream that never answered is a gateway
 * timeout, and reads as one in the logs.
 *
 * The response body is unchanged, and the client branches on `success` rather
 * than the status, so nothing about what a visitor sees changes.
 */
export function resolveFailure(error: unknown, fallback: string): Response {
  const body = {
    success: false,
    error: error instanceof Error ? error.message : fallback,
  }

  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return Response.json(body, { status: 504 })
  }
  // Matched by name rather than `instanceof`: importing the class would pull
  // pageScrape's whole module into every isolate that ever serves an /api/*
  // request, which is exactly the module-scope cost this file avoids elsewhere.
  if (error instanceof Error && (error.name === 'OriginBlockedError' || error.constructor === Error)) {
    return Response.json(body, { status: 422 })
  }
  return Response.json(body, { status: 500 })
}

export async function handleDownload(
  request: Request,
  ctx?: WaitUntilContext,
  _env?: WorkerEnv,
): Promise<Response> {
  try {
    const { url, type = 'video', quality, format } = await request.json()
    const preferredQuality: 'hd' | 'sd' = quality === 'sd' ? 'sd' : 'hd'
    const mode: 'auto' | 'audio' = format === 'audio' ? 'audio' : 'auto'

    if (!url) {
      return Response.json({ success: false, error: 'URL is required' }, { status: 400 })
    }

    // Chinese share sheets usually copy a full caption containing one URL.
    // Resolve/cache the URL itself so trailing share text never reaches an
    // upstream API and equivalent captions share the same cache entry.
    const sourceUrl = extractFirstHttpUrl(String(url)) ?? String(url).trim()

    if (!validateUrl(sourceUrl)) {
      return Response.json(
        {
          success: false,
          error:
            'Invalid URL. Please paste a link from Douyin, Kuaishou, Bilibili, Xiaohongshu, TikTok, X, Instagram, Facebook, YouTube, Pinterest, Reddit, Threads, Snapchat, Twitch, or Vimeo.',
        },
        { status: 400 },
      )
    }

    const platform = detectPlatform(sourceUrl)

    // An absent or stale token degrades silently to the normal anonymous path;
    // nothing here is gated in a way that errors.
    const claims = await readProToken(request)
    const priority = claims?.p === true
    /**
     * Whether this resolve may carry the operator's own Instagram session.
     *
     * Set only by the `ig` grant, which is written into a `users` row by hand
     * and is never offered for sale, bundled with Pro, or derivable from one.
     * `=== true` rather than a truthy check: an absent claim must read as false.
     */
    const privateAuth = request.headers.get(PRIVATE_AUTH_HEADER)
    const privateAuthenticated = privateAuth === 'web' || privateAuth === 'api'
    // The operator's Instagram session is never attached to anonymous traffic
    // or to another platform. The Worker adds the trusted internal header only
    // after web-session/API-key verification; external callers cannot mint it.
    const credentialed =
      platform === 'instagram' &&
      (privateAuthenticated || claims?.c === true)

    // Serve an identical recent resolve from cache — skips a full extractor
    // round-trip for repeats (double-tap, HD/SD/MP3 re-pick, Recent re-tap, or
    // simply a link several people paste). Keyed on everything that changes the
    // result.
    //
    // Two tiers, cheapest first: the per-isolate Map, then Cloudflare's colo-
    // wide edge cache. The Map only catches a repeat that happens to land on
    // the same warm isolate, which is a minority of them; the edge cache is
    // shared across every isolate in the colo and is what makes a popular link
    // essentially free to re-resolve.
    //
    // Neither tier is keyed on who asked, and neither is skipped for Pro:
    // ordering (priority) does not change the payload, and nothing else about
    // a request does either. The edge cache is a shared, externally-
    // addressable store keyed on a URL anyone can construct from the
    // open-source key format, which is harmless precisely because every entry
    // in it is now something a public resolve would have returned anyway.
    //
    // A credentialed resolve is the one exception, and it bypasses both tiers
    // in both directions rather than taking a key of its own. Reading is unsafe
    // because a public entry would answer a request that was meant to use the
    // session; writing is far worse, because a login-gated result would land in
    // a store any anonymous visitor can address and be served to them. Adding a
    // component to `resolveCacheKey` would have fixed the collision and left
    // that shared store holding credentialed payloads — the same mistake the
    // old `auth`/`anon` split made. Bypassing costs one uncached resolve for
    // the handful of rows that carry the grant.
    const cacheKey = resolveCacheKey(type, preferredQuality, mode, sourceUrl)
    const origin = new URL(request.url).origin

    if (!credentialed) {
      const cached = getCached(cacheKey)
      if (cached) return cachedResponse(cached, 'HIT')

      const edge = await readEdgeCache(origin, cacheKey)
      if (edge) {
        // Promote into this isolate so a second repeat skips even the edge
        // lookup, which is I/O and therefore latency the Map does not cost.
        setCached(cacheKey, edge)
        return cachedResponse(edge, 'EDGE')
      }
    }

    const downloader = new Downloader({
      quality: preferredQuality,
      mode,
      priority,
      credentialed,
    })
    const videoData = await downloader.downloadVideo(sourceUrl)

    // Accept the result if it yielded any downloadable media: a video stream, a
    // flagged photo carousel (TikTok), a plain image set (Instagram posts), or
    // an embed-only result (YouTube fallback: playable but not downloadable).
    const hasImages = (videoData?.images?.length ?? 0) > 0
    if (
      !videoData ||
      (!videoData.downloadUrl &&
        !videoData.musicUrl &&
        !videoData.isPhotoCarousel &&
        !hasImages &&
        !videoData.embedUrl)
    ) {
      // 422, not 500: the extractors ran and the link simply yielded nothing
      // downloadable. See resolveFailure.
      return Response.json(
        { success: false, error: 'Failed to extract download URL' },
        { status: 422 },
      )
    }

    // Video proxy forces video/mp4 so browsers render a real player; the audio
    // proxy re-serves the video stream, or slideshow music, as audio/mpeg.
    const videoProxyUrl = videoData.downloadUrl
      ? toMediaUrl(videoData.downloadUrl, '/api/video')
      : undefined

    // Prefer a dedicated music track (photo carousels), else re-serve the video.
    const audioSourceUrl = videoData.musicUrl || videoData.downloadUrl
    const audioProxyUrl = audioSourceUrl
      ? toMediaUrl(audioSourceUrl, '/api/audio')
      : undefined

    // These CDNs enforce platform referers. Serve their images through the
    // same-origin proxy, which adds the platform-specific Referer header.
    const imageProxyPlatforms = new Set([
      'instagram',
      'douyin',
      'kuaishou',
      'bilibili',
      'xiaohongshu',
    ])
    const proxyImage = (u: string) =>
      imageProxyPlatforms.has(platform) && u
        ? `/api/image?url=${encodeURIComponent(u)}`
        : u

    const directVideoUrl = videoData.tunnel
      ? asDirectTunnel(videoData.downloadUrl)
      : undefined
    const directAudioUrl = videoData.tunnel
      ? asDirectTunnel(videoData.musicUrl)
      : undefined

    const payload = {
      success: true,
      downloadUrl: videoProxyUrl,
      audioUrl: audioProxyUrl,
      metadata: {
        title: videoData.title,
        author: videoData.author,
        duration: videoData.duration,
        thumbnail: proxyImage(videoData.thumbnail),
        platform,
        isPhotoCarousel: videoData.isPhotoCarousel ?? false,
        embedUrl: videoData.embedUrl,
        musicTitle: videoData.musicTitle,
        musicAuthor: videoData.musicAuthor,
        // Raw (non-proxied) URL needed by the /api/slideshow renderer.
        rawMusicUrl: videoData.musicUrl,
        directVideoUrl,
        directAudioUrl,
        // Only ever set from a cobalt tunnel here, and a tunnel always answers
        // with Content-Disposition: attachment.
        directIsAttachment: true,
        images:
          videoData.images?.map((img) => ({
            ...img,
            url: proxyImage(img.url),
            thumbnail: proxyImage(img.thumbnail),
            selected: false,
          })) || [],
      },
    }

    // Serialised once, then reused for the response and both cache tiers —
    // rather than handing the object to Response.json() and stringifying it
    // again for storage.
    const body = JSON.stringify(payload)
    // Never store a credentialed result. See the bypass above: both stores are
    // shared, and one of them is externally addressable.
    if (!credentialed) {
      setCached(cacheKey, body)
      writeEdgeCache(origin, cacheKey, body, ctx)
    }

    return new Response(body, {
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
    })
  } catch (error) {
    return resolveFailure(error, 'Failed to process video')
  }
}

/**
 * Image URLs may arrive already wrapped in our own `/api/image?url=<raw>`
 * display proxy (Instagram). Unwrap back to the raw CDN URL so it can be
 * re-wrapped cleanly rather than double-proxied.
 */
function toRawImageUrl(u: string): string {
  if (!u.startsWith('/api/image')) return u
  const marker = 'url='
  const index = u.indexOf(marker)
  if (index === -1) return u
  try {
    return decodeURIComponent(u.slice(index + marker.length))
  } catch {
    return u
  }
}

/**
 * Resolves a carousel's images to same-origin download URLs.
 *
 * Deliberately does no fetching. It used to build the ZIP here — pulling every
 * image into memory and running DEFLATE over already-compressed JPEGs, which a
 * 20-image post could push to ~100 MB inside a 128 MB isolate. Archiving now
 * happens in the browser, where the bytes are headed anyway, leaving this as a
 * pure mapping: no subrequests, constant time in the image count.
 */
export async function handleImages(request: Request): Promise<Response> {
  try {
    const { imageUrls, title } = await request.json()

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return Response.json({ success: false, error: 'No images provided' }, { status: 400 })
    }

    // Slug used for entry names so extracted files stay recognisable.
    const titleSlug = (typeof title === 'string' && slugify(title, 40)) || 'image'
    const pad = Math.max(2, String(imageUrls.length).length)

    return Response.json({
      success: true,
      images: imageUrls.map((url: string, index: number) => ({
        url: `/api/image?url=${encodeURIComponent(toRawImageUrl(url))}`,
        filename: `${titleSlug}_${String(index + 1).padStart(pad, '0')}.jpg`,
      })),
    })
  } catch {
    return Response.json(
      { success: false, error: 'Failed to process images' },
      { status: 500 },
    )
  }
}

/**
 * Shortcut-friendly resolver.
 *
 * This route accepts exactly one link and is intentionally API-key only. The
 * Worker authenticates `Authorization: Bearer …` / `X-API-Key`, strips any
 * caller-supplied internal header, then marks the request as `api`. Keys are
 * never accepted in the URL, where access logs and share sheets would expose
 * them.
 *
 * Returned media paths are absolute so iOS Shortcuts can fetch them directly.
 * Same-origin proxy URLs still require the same API Key on the subsequent GET;
 * direct Cobalt tunnels are already short-lived signed URLs.
 */
export async function handleShortcutResolve(
  request: Request,
  ctx?: WaitUntilContext,
  env?: WorkerEnv,
): Promise<Response> {
  if (request.headers.get(PRIVATE_AUTH_HEADER) !== 'api') {
    return Response.json(
      { success: false, error: '快捷指令接口必须使用 API Key。' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  let input: { url?: unknown; quality?: unknown; format?: unknown }
  try {
    input = (await request.json()) as typeof input
  } catch {
    return Response.json(
      { success: false, error: '请求必须是 JSON 格式。' },
      { status: 400 },
    )
  }

  const url = typeof input.url === 'string' ? input.url.trim() : ''
  if (!url) {
    return Response.json(
      { success: false, error: '缺少 url。' },
      { status: 400 },
    )
  }

  const origin = new URL(request.url).origin
  const headers = new Headers({ 'Content-Type': 'application/json' })
  headers.set(PRIVATE_AUTH_HEADER, 'api')
  const internal = new Request(`${origin}/api/download`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      url,
      quality: input.quality === 'sd' ? 'sd' : 'hd',
      format: input.format === 'audio' ? 'audio' : 'video',
    }),
  })
  const resolved = await handleDownload(internal, ctx, env)
  const payload = (await resolved.json()) as {
    success?: boolean
    error?: string
    downloadUrl?: string
    audioUrl?: string
    metadata?: {
      title?: string
      author?: string
      platform?: string
      thumbnail?: string
      directVideoUrl?: string
      directAudioUrl?: string
      images?: Array<{ url?: string; thumbnail?: string }>
    }
  }
  if (!resolved.ok || !payload.success) {
    return Response.json(
      { success: false, error: payload.error || '解析失败。' },
      { status: resolved.status, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const absolute = (value?: string) =>
    value ? new URL(value, origin).toString() : undefined
  const images = (payload.metadata?.images || [])
    .map((image) => absolute(image.url))
    .filter((value): value is string => Boolean(value))
  const video = absolute(
    payload.metadata?.directVideoUrl || payload.downloadUrl,
  )
  const audio = absolute(
    payload.metadata?.directAudioUrl || payload.audioUrl,
  )

  return Response.json(
    {
      success: true,
      platform: payload.metadata?.platform || 'unknown',
      type: images.length ? (images.length > 1 ? 'images' : 'image') : audio && !video ? 'audio' : 'video',
      title: payload.metadata?.title || '未命名媒体',
      author: payload.metadata?.author || '未知作者',
      thumbnail: absolute(payload.metadata?.thumbnail),
      video_url: video,
      audio_url: audio,
      image_urls: images,
      note:
        '以本站 /api/ 开头的媒体地址，下载时仍需携带相同的 X-API-Key 或 Bearer Key。',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * The three routes backed by yt-dlp/ffmpeg. workerd has neither subprocesses
 * nor a writable filesystem, so on Cloudflare they can only ever answer 501 —
 * which the Worker does here without loading Next or the route's own module.
 *
 * The guard is re-checked rather than assumed so the same table stays correct
 * if these are ever dispatched from a host that does have the binaries.
 */
function nativeMediaRoute(feature: string): Handler {
  return () => {
    if (!nativeMediaAvailable()) return nativeMediaUnavailable(feature)
    // Unreachable on Cloudflare. On a capable host the Next route serves it,
    // so this table entry is simply not consulted.
    return new Response(null, { status: 501 })
  }
}

/**
 * Pathname -> { method, handler }, consumed by cloudflare/worker.js.
 *
 * Any /api/* path absent from this table falls through to Next. Adding a route
 * without adding it here is therefore safe but slow — scripts/cf-smoke.mjs
 * asserts the CPU-sensitive ones are actually served from here.
 */
export const API_ROUTES: Record<string, { method: string; handler: Handler }> = {
  '/api/download': { method: 'POST', handler: handleDownload },
  '/api/shortcut/resolve': { method: 'POST', handler: handleShortcutResolve },
  '/api/images': { method: 'POST', handler: handleImages },
  '/api/slideshow': { method: 'POST', handler: nativeMediaRoute('Slideshow rendering') },
  '/api/tiktok': { method: 'GET', handler: nativeMediaRoute('Direct TikTok download') },
  '/api/youtube': { method: 'GET', handler: nativeMediaRoute('Direct YouTube download') },
  '/api/billing/webhook': { method: 'POST', handler: handleWebhook },
  '/api/billing/bmc': { method: 'POST', handler: handleBmcWebhook },
  '/api/billing/portal': { method: 'GET', handler: handlePortal },
  '/api/billing/checkout': { method: 'GET', handler: handleCheckout },
  '/api/billing/cancel': { method: 'POST', handler: handleCancel },
  '/api/auth/google': { method: 'GET', handler: handleAuthStart },
  '/api/auth/callback': { method: 'GET', handler: handleAuthCallback },
  '/api/auth/refresh': { method: 'POST', handler: handleRefresh },
  '/api/auth/logout': { method: 'POST', handler: handleLogout },
  '/api/account': { method: 'POST', handler: handleAccount },
  '/api/private/login': { method: 'POST', handler: handlePrivateLogin },
  '/api/private/status': { method: 'GET', handler: handlePrivateStatus },
  '/api/private/logout': { method: 'POST', handler: handlePrivateLogout },
  ...Object.fromEntries(
    Object.entries(MEDIA_PROXY_HANDLERS).map(([pathname, handler]) => [
      pathname,
      { method: 'GET', handler },
    ]),
  ),
}
