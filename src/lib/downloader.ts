import { http } from './httpClient'
import {
  decodeEntities,
  firstTagAttr,
  hasTag,
  metaContent,
  mp4Hrefs,
  pageTitle,
  scriptContaining,
  textOfFirstWithClass,
} from './htmlExtract'
import {
  extractMediaFromHtml,
  fetchThroughRelay,
  filenameTitle,
  isDirectMediaType,
  looksLikeBotWall,
  OriginBlockedError,
  readCappedText,
} from './pageScrape'
import { resolveByRule } from './siteRules'
import { VideoData, ImageData } from './types'
import {
  parseVideoId,
  detectPlatform,
  parseInstagramShortcode,
  parseInstagramStory,
  parseYouTubeId,
  type SupportedPlatform,
} from './validator'
import { htmlScrapingAvailable, nativeMediaAvailable } from './nativeMedia'
import { getMediaReferer } from './proxyHeaders'
import { tryYouTubeInnertube } from './youtubeInnertube'
import { ytdlpInfo } from './ytdlp'
import {
  preferXiaohongshuImages,
  resolveChinesePlatform,
  type ChinesePlatform,
} from './chinaPlatforms'

// Retry a flaky network op with exponential backoff + light jitter. Only retries
// errors the caller marks retryable (429 / 5xx / timeouts) — a hard 404/private
// post fails fast. Backoff is 400ms, 900ms, ~2s so a transient rate-limit or
// cold-start on a public instance is ridden out instead of surfacing to the user.
async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { retries?: number; isRetryable?: (e: unknown) => boolean } = {},
): Promise<T> {
  const retries = opts.retries ?? 2
  const isRetryable = opts.isRetryable ?? (() => true)
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt)
    } catch (e) {
      lastError = e
      if (attempt === retries || !isRetryable(e)) break
      const base = 400 * Math.pow(2.2, attempt)
      const jitter = base * 0.25 * ((attempt % 3) / 3)
      await new Promise((r) => setTimeout(r, Math.round(base + jitter)))
    }
  }
  throw lastError
}

// True for transient failures worth retrying: network timeouts/resets and HTTP
// 429 / 5xx. A definitive 4xx (bad/private/removed post) is NOT retried.
function isTransientError(e: unknown): boolean {
  const err = e as { code?: string; response?: { status?: number } }
  if (
    err?.code === 'ECONNABORTED' ||
    err?.code === 'ETIMEDOUT' ||
    err?.code === 'ECONNRESET' ||
    err?.code === 'ENOTFOUND'
  ) {
    return true
  }
  const status = err?.response?.status
  if (typeof status === 'number') return status === 429 || status >= 500
  // No response at all (network layer) — worth one more try.
  return err instanceof Error && !('response' in (err as object))
}

/**
 * Referer for the codec probe in `checkVideoCodecCompatible`.
 *
 * Intentionally not `getMediaReferer` from proxyHeaders: that one matches exact
 * hosts (`tiktokcdn.com`), whereas the probe matches the bare substring
 * `tiktok`, which also covers regional CDN hosts such as `tiktokcdn-us.com`.
 * Over-matching costs nothing here — an unnecessary Referer is ignored — while
 * under-matching turns the probe into a 403 and drops a perfectly good HD URL.
 *
 * tikwm is checked first because it is the more specific host.
 */
function codecProbeReferer(url: string): string {
  if (url.includes('tikwm.com')) return 'https://www.tikwm.com/'
  if (url.includes('tiktok')) return 'https://www.tiktok.com/'
  return ''
}

/**
 * tikwm returns some media URLs as site-relative paths (`/video/media/...`) and
 * others already absolute. Promotes the former, passes the latter through, and
 * preserves `undefined` so callers can keep distinguishing "absent" from
 * "present but empty".
 */
function tikwmAbsoluteUrl(path: string | undefined): string | undefined {
  if (!path) return undefined
  if (!path.startsWith('/')) return path
  return 'https://www.tikwm.com' + path
}

/**
 * Pick a cover image the *browser* can load on its own.
 *
 * tikwm answers with two flavours of URL depending on the `web` flag: paths on
 * its own host (`/video/cover/<id>.webp`) or the signed `*.tiktokcdn-*.com`
 * originals. The tikwm-hosted covers are hotlink-gated and answer 403 to every
 * client — including our own /api/image proxy sending `Referer: tikwm.com` —
 * so as a `<video poster>` they render a dead box. The tiktokcdn originals load
 * straight from the browser with no proxy hop at all.
 *
 * Measured 2026-07-30 against a live post: tikwm cover 403 (direct, and via the
 * deployed proxy); tiktokcdn cover 200 image/jpeg direct.
 *
 * A tikwm-hosted path is still returned as a last resort — a poster that might
 * 403 beats no poster, and the caller treats '' as "no thumbnail at all".
 */
function pickTikwmCover(
  data: { cover?: string; origin_cover?: string; ai_dynamic_cover?: string },
): string {
  const candidates = [data.origin_cover, data.cover, data.ai_dynamic_cover]
  for (const candidate of candidates) {
    const absolute = tikwmAbsoluteUrl(candidate)
    if (absolute && !absolute.includes('tikwm.com')) return absolute
  }
  return tikwmAbsoluteUrl(data.cover) || ''
}

// Discover a self-hosted resolver's *current* base URL from a shared key/value
// store. Some free hosts hand the resolver a rotating/temporary public URL with
// no API to read it back, so the resolver publishes its own live URL to this
// store and we read it here — rotation heals with no env changes. Credentials
// come from env (Vercel) only; nothing sensitive lands in the repo. The value is
// cached in-process briefly so a burst of requests doesn't hammer the store.
let _resolverCache: { url: string | null; at: number } = { url: null, at: 0 }
const RESOLVER_DISCOVERY_TTL_MS = 60_000

async function discoverResolverBase(): Promise<string | null> {
  const store = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/$/, '')
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!store || !token) return null

  const now = Date.now()
  if (now - _resolverCache.at < RESOLVER_DISCOVERY_TTL_MS) {
    return _resolverCache.url
  }

  const key = process.env.REGISTRY_KEY?.trim() || 'resolver_url'
  try {
    const res = await http.get(`${store}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 6000,
    })
    // Upstash REST returns { result: <value> | null }.
    const value = res.data?.result
    const url = typeof value === 'string' && value ? value : null
    _resolverCache = { url, at: now }
    return url
  } catch {
    // On a store hiccup, keep serving the last known value rather than dropping
    // the fallback entirely (staleness is better than no resolver at all).
    _resolverCache = { url: _resolverCache.url, at: now }
    return _resolverCache.url
  }
}

/**
 * The user agent every extractor sends unless a host demands otherwise. At
 * module scope because the helpers below the class need it too — the class
 * reads this same constant.
 */
const BROWSER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * What a browser sends when it navigates to a page, rather than the two
 * headers a fetch sends by default.
 *
 * Hosts that wall automated traffic check this set, and it costs nothing to
 * send. It is not a disguise — the address and the TLS handshake still say what
 * we are, and a host that fingerprints those is not fooled by headers.
 */
const BROWSER_PAGE_HEADERS: Record<string, string> = {
  'User-Agent': BROWSER_AGENT,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
}

/**
 * Read a recipe's page from wherever it will answer: the host itself first,
 * a relay only if that fails. See the call site in `tryPageScrape`.
 */
async function fetchPageDirectThenRelay(target: string): Promise<string | null> {
  try {
    const response = await fetch(target, {
      headers: BROWSER_PAGE_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    })
    if (response.ok) {
      const html = await readCappedText(response)
      // A stub is not the page; fall through to the relay rather than feeding
      // the recipe markup that cannot contain what it is looking for.
      if (html && !looksLikeBotWall(html)) return html
    }
  } catch {
    // Network failure is the same news as a wall here: try the relay.
  }
  return fetchThroughRelay(target)
}

/**
 * The first method to answer with a result, rather than the first in order.
 *
 * For candidates that are independent upstreams of comparable quality and are
 * both slow: trying them in turn makes every caller pay the first one's latency
 * even when the second would have answered sooner. A method that resolves null
 * or throws simply does not win the race; null comes back only when every one
 * of them has failed.
 *
 * The cost is one extra upstream call per resolve, which is why this is not the
 * default shape — it is worth it only where the alternative is a visitor
 * waiting on two sequential extractors.
 */
export async function firstResult<T>(
  methods: Array<() => Promise<T | null>>,
): Promise<T | null> {
  try {
    return await Promise.any(
      methods.map(async (method) => {
        const result = await method()
        // Promise.any counts only rejections as losses, so "answered null" has
        // to become one.
        if (!result) throw new Error('no result')
        return result
      }),
    )
  } catch {
    return null
  }
}

/**
 * Sent to hosts that serve their real markup only to a link crawler.
 *
 * Threads (and Meta's surfaces generally) answer a browser user agent with the
 * client-rendered app shell, which contains no media at all. The crawler view
 * is the same page the site publishes for link previews.
 */
const LINK_CRAWLER_AGENT =
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'

/**
 * The two link shapes Facebook's own share sheet produces — `fb.watch/<code>`
 * and `facebook.com/share/<v|r>/<code>`. Both answer a browser user agent with
 * 400 and only redirect for a crawler; see `resolveRedirect`, the only caller.
 *
 * Facebook only: Instagram's share links answer a browser normally (checked the
 * same day), so they keep the plain path rather than take a behaviour change
 * nothing asked for.
 */
export function isFacebookShortLink(url: string): boolean {
  return /facebook\.com\/share\/|fb\.watch\//i.test(url)
}

/**
 * A story link. Facebook redirects these to `login.php` for every client,
 * crawler included — there is no open surface to read, so the extractor says so
 * instead of trying four paths that cannot work.
 */
export function isFacebookStory(url: string): boolean {
  return /facebook\.com\/stories\//i.test(url)
}

/** A link that names a photo rather than a video. See `tryFacebookPhoto`. */
export function isFacebookPhotoLink(url: string): boolean {
  return /facebook\.com\/(?:photo(?:\.php)?\/?\?|[\w.-]+\/photos\/)/i.test(url)
}

/**
 * Facebook serves video thumbnails out of one CDN path segment, `/t15.`, which
 * is what separates a poster from the two other images on the same page: a
 * layout spacer on `static.xx.fbcdn.net` and the author's 40x40 avatar under
 * `/t39.`. Matching the segment rather than taking the first image is the
 * difference between a poster and a spacer gif.
 */
const FB_POSTER_URL = /https:\/\/[^"'\\\s]+\/t15\.[^"'\\\s]+/

/**
 * The poster for a Facebook video, from either page shape.
 *
 * A watch page publishes `og:image`. The plugin embed publishes no meta tags at
 * all and paints the poster as an ordinary `<img>` instead — the same file the
 * canonical page names in `og:image`, checked against a live reel — so reading
 * it out of the markup is what keeps a reel's card from rendering an empty
 * poster box. A page with neither yields '', which the card already handles.
 */
function facebookPoster(html: string): string {
  const og = metaContent(html, 'og:image')
  if (og) return og
  return decodeEntities(FB_POSTER_URL.exec(html)?.[0] ?? '')
}

/** Vimeo's config ships several thumbnail sizes under unpredictable keys. */
function vimeoThumb(thumbs: Record<string, string> | undefined): string {
  const t = thumbs ?? {}
  return t.base || t['1280'] || t['960'] || t['640'] || ''
}

/**
 * The `packaged-media-json` attribute of a reddit embed, parsed. Shortest
 * rendition first, so a caller picks by taking an end of the list.
 *
 * Read by locating the attribute rather than by scanning the page: it sits
 * past 300 KB of markup, and the value is one HTML-escaped JSON string with no
 * bare quote inside it, so the next `"` is reliably its end.
 */
function redditPackagedJson(html: string): {
  duration?: number
  permutations?: Array<{
    source?: { url?: string; dimensions?: { height?: number } }
  }>
} | null {
  const marker = 'packaged-media-json="'
  const start = html.indexOf(marker)
  if (start === -1) return null
  const end = html.indexOf('"', start + marker.length)
  if (end === -1) return null
  try {
    const parsed = JSON.parse(
      decodeEntities(html.slice(start + marker.length, end)),
    )
    return parsed?.playbackMp4s ?? null
  } catch {
    return null
  }
}

function redditPackagedMp4s(html: string): Array<{ url: string; height: number }> {
  const permutations = redditPackagedJson(html)?.permutations ?? []
  return permutations
    .map((p) => ({
      url: decodeEntities(p?.source?.url ?? ''),
      height: p?.source?.dimensions?.height ?? 0,
    }))
    .filter((r) => r.url)
    .sort((a, b) => a.height - b.height)
}

function redditPackagedDuration(html: string): number {
  return redditPackagedJson(html)?.duration ?? 0
}

/**
 * The slug of a Twitch *clip*, from either shape Twitch hands out. Everything
 * else on the domain — VODs, channels, collections — returns null: their media
 * is an HLS manifest, which is not a file this deployment can produce.
 */
export function parseTwitchClipSlug(url: string): string | null {
  const patterns = [
    /clips\.twitch\.tv\/([\w-]+)/,
    /twitch\.tv\/(?:[\w-]+\/)?clip\/([\w-]+)/,
  ]
  for (const pattern of patterns) {
    const slug = pattern.exec(url)?.[1]
    if (slug) return slug
  }
  return null
}

/**
 * A pin as the widget API describes it. Only the fields read here are typed;
 * `video_list` is a map of rendition name to file, not an array.
 */
interface PinterestRendition {
  url?: string
  width?: number
  height?: number
}
interface PinterestPin {
  grid_title?: string
  description?: string
  pinner?: { username?: string }
  images?: Record<string, PinterestRendition>
  videos?: { video_list?: Record<string, PinterestRendition> }
  story_pin_data?: {
    pages?: Array<{
      blocks?: Array<{ video?: { video_list?: Record<string, PinterestRendition> } }>
    }>
  }
}

/** Tallest rendition that is a file rather than a manifest. */
function tallestFile(
  list: Record<string, PinterestRendition> | undefined,
): string | null {
  const files = Object.values(list ?? {}).filter(
    (r): r is PinterestRendition & { url: string } =>
      Boolean(r?.url) && !/\.(m3u8|mpd)(\?|$)/i.test(r.url as string),
  )
  if (files.length === 0) return null
  return files.sort((a, b) => (a.height ?? 0) - (b.height ?? 0)).pop()!.url
}

/**
 * A video pin keeps its renditions in `videos`; an idea pin keeps one per page
 * block instead, which is why both are read before giving up.
 */
function bestPinterestVideo(pin: PinterestPin): string | null {
  const direct = tallestFile(pin.videos?.video_list)
  if (direct) return direct
  for (const page of pin.story_pin_data?.pages ?? []) {
    for (const block of page.blocks ?? []) {
      const fromBlock = tallestFile(block.video?.video_list)
      if (fromBlock) return fromBlock
    }
  }
  return null
}

/** `orig` when the pin has one, else the largest sized rendition. */
function bestPinterestImage(pin: PinterestPin): string | null {
  const images = pin.images ?? {}
  if (images.orig?.url) return images.orig.url
  return tallestFile(images)
}

// Loose shapes for Instagram's GraphQL / embed `shortcode_media` payload.
// Only the fields we actually read are typed; everything else is ignored.
interface IgMediaNode {
  __typename?: string
  is_video?: boolean
  video_url?: string
  display_url?: string
  thumbnail_src?: string
  display_resources?: Array<{ src: string }>
}

interface IgShortcodeMedia extends IgMediaNode {
  owner?: { username?: string; full_name?: string }
  edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> }
  edge_sidecar_to_children?: { edges?: Array<{ node?: IgMediaNode }> }
  video_duration?: number
}

/**
 * Minimal shape of one item from Instagram's private media APIs — the same
 * object comes back from `/api/v1/media/<id>/info/` (posts and reels) and from
 * `/api/v1/feed/reels_media/` (stories), which is why one interface covers
 * both. Only the fields we read are typed.
 */
interface IgMediaInfoItem {
  user?: { username?: string }
  caption?: { text?: string }
  video_versions?: Array<{ url?: string }>
  image_versions2?: { candidates?: Array<{ url?: string }> }
  video_duration?: number
  carousel_media?: IgMediaInfoItem[]
}

// A story item is a media item that also carries its position in the reel.
interface IgStoryItem extends IgMediaInfoItem {
  pk?: string | number
  id?: string
}

/**
 * A shortcode is base64 (URL alphabet) over the media's numeric id, which is
 * what the private media API is keyed on — so this conversion is pure
 * arithmetic and needs no lookup request.
 */
const IG_SHORTCODE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/**
 * BigInt rather than Number: a media id is ~19 digits and overflows a double
 * well before the last character. Written as `BigInt(64)` rather than the `64n`
 * literal because tsconfig targets ES2017 for the phones this site is built
 * for; the values themselves only ever exist server-side.
 */
export function instagramMediaId(shortcode: string): string | null {
  if (!shortcode) return null
  const base = BigInt(64)
  let id = BigInt(0)
  for (const char of shortcode) {
    const value = IG_SHORTCODE_ALPHABET.indexOf(char)
    if (value === -1) return null
    id = id * base + BigInt(value)
  }
  return id.toString()
}

/**
 * One media-API item as a `shortcode_media` node.
 *
 * The two APIs describe the same media in different vocabularies: the private
 * one lists renditions (`video_versions`, `image_versions2.candidates`, largest
 * first), the GraphQL one names a single URL per field. Translating rather than
 * writing a second parser is what keeps carousels, captions and the
 * poster-is-not-a-photo rule in `parseInstagramMedia` alone.
 */
function igInfoNode(item: IgMediaInfoItem): IgMediaNode {
  const video = item.video_versions?.[0]?.url
  return {
    is_video: Boolean(video),
    video_url: video,
    display_url: item.image_versions2?.candidates?.[0]?.url,
  }
}

function igInfoToShortcodeMedia(item: IgMediaInfoItem): IgShortcodeMedia {
  const children = item.carousel_media
  return {
    ...igInfoNode(item),
    owner: { username: item.user?.username },
    edge_media_to_caption: { edges: [{ node: { text: item.caption?.text } }] },
    video_duration: item.video_duration,
    ...(children && children.length > 0
      ? {
          edge_sidecar_to_children: {
            edges: children.map((child) => ({ node: igInfoNode(child) })),
          },
        }
      : {}),
  }
}
interface IgReel {
  user?: { username?: string }
  items?: IgStoryItem[]
}

/**
 * How long to stop sending the session after Instagram answers
 * `checkpoint_required`.
 *
 * The lock is cleared by a human in a browser, never by us, so every request we
 * keep sending in the meantime is a failed download that also deepens the
 * automation signature that caused the lock. Isolate-local and deliberately so:
 * a cooldown that outlived the isolate would need shared state, and being
 * approximately right in each isolate is the whole benefit here.
 */
const IG_LOCK_COOLDOWN_MS = 30 * 60 * 1000
let instagramLockedUntil = 0

function noteInstagramSessionLocked(): void {
  instagramLockedUntil = Date.now() + IG_LOCK_COOLDOWN_MS
}

function instagramSessionLocked(): boolean {
  return Date.now() < instagramLockedUntil
}

/** Test seam: the cooldown is module state, and a test must be able to clear it. */
export function resetInstagramSessionLock(): void {
  instagramLockedUntil = 0
}

/**
 * Why a private Instagram endpoint gave us nothing — the one line an operator
 * needs to tell three very different situations apart:
 *
 *   checkpoint_required  the account is LOCKED. Instagram wants a challenge
 *                        cleared in a browser before it answers anything, so
 *                        every credentialed call fails until someone signs in
 *                        as that account, clears it, and re-uploads the
 *                        cookies. No amount of retrying helps, and retrying is
 *                        what got it locked.
 *   HTML on a 200        the session was rejected outright (the ~600 KB login
 *                        wall) — the cookie is stale.
 *   anything else        Instagram refusing this particular media id.
 *
 * Distinguishing these took a full afternoon once; it should take one log line
 * from now on. See lessons/2026-08-15-instagram-logged-out-wall.md.
 */
function logInstagramRefusal(
  endpoint: string,
  subject: string,
  response: { status?: number; data?: unknown },
): void {
  const data = response.data as { message?: string } | string | undefined
  const message = typeof data === 'object' ? data?.message : undefined
  if (message === 'checkpoint_required') {
    noteInstagramSessionLocked()
    console.warn(
      `instagram ${endpoint}: the session's account is LOCKED (checkpoint_required). Every credentialed resolve fails until the challenge is cleared in a browser and IG_SESSIONID (plus its companion cookies) are re-uploaded. Holding the cookie back for ${IG_LOCK_COOLDOWN_MS / 60000} minutes.`,
    )
    return
  }
  console.warn(
    `instagram ${endpoint}: no item for ${subject}`,
    response.status,
    typeof data === 'string' ? 'html (login wall — session stale)' : 'json',
    message ?? '',
  )
}

/**
 * One story / highlight item mapped onto our shared shape. Both story routes
 * end here — the item fetched directly by its media id, and the one picked out
 * of a reel — so the two cannot drift apart. Null when the item carries neither
 * a video nor an image, which is the caller's cue to raise.
 */
function storyItemToVideoData(
  item: IgStoryItem,
  owner: string,
  originalUrl: string,
  fallbackId?: string,
): VideoData | null {
  const video = item.video_versions?.[0]?.url
  const image = item.image_versions2?.candidates?.[0]?.url
  const id = String(item.pk ?? fallbackId ?? Date.now())
  const common = {
    id,
    title: `Instagram story by @${owner}`,
    url: originalUrl,
    author: owner,
    description: '',
    isPhotoCarousel: false,
  }

  if (video) {
    return {
      ...common,
      thumbnail: image || '',
      duration: Math.round(item.video_duration || 0),
      downloadUrl: video,
    }
  }
  if (image) {
    return {
      ...common,
      thumbnail: image,
      duration: 0,
      downloadUrl: '',
      images: [{ id: `${id}_0`, url: image, thumbnail: image }],
    }
  }
  return null
}

// Instagram's GraphQL endpoint rejects requests that don't carry its anti-CSRF
// tokens (csrftoken + lsd) — it bounces them to a "Page Not Found" HTML page.
// The tokens are harvested from a homepage GET and cached briefly here to avoid
// an extra round-trip on every request. Keyed by the session cookie in use so
// switching IG_SESSIONID invalidates a stale (anonymous) token set.
let igTokenCache: {
  csrf: string
  lsd: string
  sessionKey: string
  expires: number
} | null = null

/**
 * The companion cookies a real Instagram session carries, and the env var each
 * is read from. See `Downloader.instagramCookie`.
 *
 * Roughly the order a browser sends them. `sessionid` is deliberately absent:
 * it comes from `IG_SESSIONID`, it is the one cookie that must exist for any of
 * this to run, and the getter appends it itself rather than letting it be
 * omitted by the same "blank means skip" rule as the rest.
 *
 * All of these are read out of devtools > Application > Cookies on the browser
 * that logged in. They are per-session and per-device, so they must come from
 * the *same* browser profile as the `sessionid` — mixing a `mid` from one
 * device with a `sessionid` from another is a worse signal than sending
 * neither.
 */
const IG_COOKIE_ORDER: readonly { name: string; env: string }[] = [
  // Meta's device cookie, set across facebook.com and instagram.com.
  { name: 'datr', env: 'IG_DATR' },
  // Instagram's own device id.
  { name: 'ig_did', env: 'IG_DID' },
  // Machine id. Stable per browser profile, and one of the oldest signals Meta
  // uses to tie requests together.
  { name: 'mid', env: 'IG_MID' },
  // Anti-CSRF token. Also sent as the X-CSRFToken header, and the two must
  // match — see instagramCsrf.
  { name: 'csrftoken', env: 'IG_CSRFTOKEN' },
  // The logged-in account's numeric id. Always present alongside a real
  // sessionid, which is exactly why sending sessionid without it stands out.
  { name: 'ds_user_id', env: 'IG_DS_USER_ID' },
  // Regional routing hint, tying the session to the region it was created in.
  { name: 'rur', env: 'IG_RUR' },
  // Viewport size, e.g. 1920x1080. Pure telemetry and worthless on its own; it
  // is here because a browser sends it and this list exists to look like one.
  { name: 'wd', env: 'IG_WD' },
]

/**
 * Facebook session cookies used by its logged-in HTML/plugin surfaces.
 * `FB_COOKIE_HEADER` is accepted for sessions with additional Meta cookies;
 * its value must be the header value only, without a literal `Cookie:` prefix.
 * Both forms remain server-side secrets and are never sent to a CDN or Cobalt.
 */
const FB_COOKIE_ORDER: readonly { name: string; env: string }[] = [
  { name: 'datr', env: 'FB_DATR' },
  { name: 'sb', env: 'FB_SB' },
  { name: 'c_user', env: 'FB_C_USER' },
  { name: 'xs', env: 'FB_XS' },
  { name: 'fr', env: 'FB_FR' },
  { name: 'wd', env: 'FB_WD' },
]

export class Downloader {
  // Preferred video quality for the extractors that expose a quality knob
  // (Cobalt's videoQuality, tikwm's hd flag). 'hd' = best available (default);
  // 'sd' = a smaller data-saver rendition. Extractors that only ever return a
  // single rendition ignore this.
  private readonly videoQuality: 'hd' | 'sd'

  // Extraction mode: 'auto' resolves the video (default), 'audio' pulls an
  // audio-only stream (MP3) — the "YouTube → MP3" flow, routed through Cobalt's
  // downloadMode:'audio' for every platform.
  private readonly mode: 'auto' | 'audio'

  // Pro requests try the operator's own instances first. See cobaltInstances.
  // Ordering is the whole of the entitlement: it changes which resolver is
  // asked first, never what a resolve is allowed to reach.
  private readonly priority: boolean

  // Whether this instance may attach IG_SESSIONID. See instagramSessionId.
  private readonly credentialed: boolean

  constructor(opts?: {
    quality?: 'hd' | 'sd'
    mode?: 'auto' | 'audio'
    priority?: boolean
    credentialed?: boolean
  }) {
    this.videoQuality = opts?.quality === 'sd' ? 'sd' : 'hd'
    this.mode = opts?.mode === 'audio' ? 'audio' : 'auto'
    this.priority = opts?.priority === true
    // Defaults to false, so every construction site that does not think about
    // this — the CLI, tests, any future caller — resolves anonymously.
    this.credentialed = opts?.credentialed === true
  }

  private readonly userAgent = BROWSER_AGENT

  // Browser-renderable video codecs (bvc2 / ByteDance proprietary codec is NOT in this list)
  private readonly supportedVideoCodecs = [
    'avc1',
    'avc2',
    'avc3', // H.264
    'hvc1',
    'hev1', // H.265/HEVC
    'vp08',
    'vp09', // VP8/VP9
    'av01', // AV1
  ]

  // Cobalt instances, tried in order. Cobalt tunnels the media, so the URL it
  // returns plays cross-origin (unlike a raw CDN URL) — which is what makes it
  // work from datacenter hosts (Vercel) for TikTok, and as a login-free source
  // for YouTube/Twitter/Instagram/Facebook.
  //
  // The public instance is tried FIRST (it's warm and fast); self-hosted
  // instances (set COBALT_API_URL — e.g. a free Render deploy, see deploy/cobalt/)
  // are the FALLBACKS, used only when the public one fails or rate-limits. This
  // keeps a free fallback's cold-start latency and bandwidth off the hot path.
  //
  // COBALT_API_URL accepts a COMMA- or space-separated LIST, so the operator can
  // chain several private instances for resilience (each tunnels the media, so
  // any one that resolves the URL works).
  //
  // The public list is short on purpose — a dead instance only adds a timeout to
  // every request — but one entry is too short: a single instance means one
  // shared rate limit, and `error.too_many_requests` on it is a failed download
  // for the user with nothing behind it. Every entry below was verified on
  // 2026-08-15 *from a Worker on Cloudflare's network*, not just from a dev box,
  // because that is where these run and several instances refuse datacenter
  // egress outright (both kittycat.boo endpoints answer 403 there while working
  // fine locally). Re-probe with cobalt.directory's /api/tests, which reports
  // per-service results and flags the instances behind Turnstile — those need a
  // challenge token and are useless to us regardless of what they support.
  //
  // A Pro request flips this order. The private instances are ours: not
  // rate-limited and not shared with the public internet, which is worth more
  // to someone who paid than the public instance's warm start is.
  private static readonly publicCobaltInstances = [
    'https://co.otomir23.me/',
    'https://rue-cobalt.xenon.zone/',
    'https://cobaltapi.cjs.nz/',
  ]

  private get cobaltInstances(): string[] {
    const public_ = Downloader.publicCobaltInstances
    const private_ = (process.env.COBALT_API_URL ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)

    if (this.priority && private_.length > 0) {
      return [...private_, ...public_]
    }
    return [...public_, ...private_]
  }

  // Public Instagram web app id — required by the GraphQL/web-API endpoints.
  // This is the same id Instagram's own web client sends and is not a secret.
  private readonly instagramAppId = '936619743392459'

  // Optional Instagram session cookie (the `sessionid` value). Public posts
  // work without it, and the extractor degrades gracefully when it's absent or
  // expired. Use a burner account: Instagram may flag an account for automated
  // access from datacenter (e.g. Vercel) IPs.
  //
  // Two conditions, both required. IG_SESSIONID must be set on the deployment,
  // *and* this instance must have been constructed credentialed — which happens
  // only for a request whose token carries the `c` claim, which is minted only
  // from an `ig` grant written into a `users` row by hand.
  //
  // The second condition is the one that was missing. The env var alone used to
  // be the whole gate, which meant setting it attached the operator's cookie to
  // every visitor's Instagram resolve — "we send our credentials on your
  // behalf", for the entire internet. Narrowing it to a listed account is
  // strictly less exposure than the env var by itself.
  //
  // What must never happen: this becoming something anyone can obtain by
  // paying. Unauthorised access to another party's data is the acceptable-use
  // clause every merchant of record refuses to underwrite, and selling it is
  // what ended the store. `ig` is deliberately a separate grant from `pro` so
  // that no supporter, and no future entitlement, can reach it — see
  // migrations/0007 and `hasGrant`.
  private get instagramSessionId(): string {
    if (!this.credentialed) return ''
    // A locked account rejects every private call, so continuing to attach the
    // cookie only fails slower and looks more like a bot. See IG_LOCK_COOLDOWN_MS.
    if (instagramSessionLocked()) return ''
    return process.env.IG_SESSIONID?.trim() || ''
  }

  /**
   * Whether a session exists on this deployment at all, ignoring whether *this*
   * request may use it.
   *
   * Only for log lines, and only so they stop lying. `instagramSessionId` is
   * empty for two completely different reasons — nobody configured a cookie, or
   * the caller is anonymous and must never be sent ours — and reporting both as
   * "IG_SESSIONID is not set" sends whoever reads the log to check a secret
   * that is already there.
   */
  private get instagramSessionConfigured(): boolean {
    return Boolean(process.env.IG_SESSIONID?.trim())
  }

  /**
   * The whole Cookie header to send Instagram, assembled from one env var per
   * cookie.
   *
   * Instagram's web client never sends `sessionid` on its own, so a lone one
   * arriving from a datacenter IP is an anomaly before anything else about the
   * request is examined. Sending the set a browser actually sends is the
   * cheapest thing that extends how long a session survives. It does not make
   * one permanent — the ASN is still wrong, and no header fixes that.
   *
   * One variable per cookie rather than a single pasted header, because the
   * values are read out of devtools' Application > Cookies table, which is a
   * name/value grid with no header string to copy. `IG_COOKIE_ORDER` below is
   * the only list; adding a cookie Meta introduces later is one entry.
   *
   * Everything is optional except `sessionid`, which is what decides whether a
   * session is configured at all — an absent companion is simply omitted rather
   * than sent empty, since `mid=` with no value is a worse signal than no `mid`.
   */
  private get instagramCookie(): string {
    const sessionId = this.instagramSessionId
    if (!sessionId) return ''
    const pairs = IG_COOKIE_ORDER.map(({ name, env }) => {
      const value = process.env[env]?.trim()
      return value ? `${name}=${value}` : ''
    }).filter(Boolean)
    return [...pairs, `sessionid=${sessionId}`].join('; ')
  }

  /** Attach Facebook Cookie only to a trusted, official Facebook request. */
  private get facebookCookie(): string {
    if (!this.credentialed) return ''
    const full = process.env.FB_COOKIE_HEADER?.trim()
    if (full && !/[\r\n]/.test(full)) return full

    return FB_COOKIE_ORDER.map(({ name, env }) => {
      const value = process.env[env]?.trim()
      return value ? `${name}=${value}` : ''
    })
      .filter(Boolean)
      .join('; ')
  }

  private facebookHeaders(
    url: string,
    headers: Record<string, string>,
  ): Record<string, string> {
    let official = false
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      official =
        hostname === 'facebook.com' ||
        hostname.endsWith('.facebook.com') ||
        hostname === 'fb.watch'
    } catch {
      official = false
    }
    const cookie = this.facebookCookie
    return official && cookie ? { ...headers, Cookie: cookie } : headers
  }

  /**
   * The cookie header for a request, with a freshly harvested `csrftoken`
   * folded in only when one was not configured.
   *
   * A configured `csrftoken` wins: it was minted by the same browser session as
   * the `sessionid` beside it, whereas the harvested one comes from our own
   * homepage GET. Sending both would put two `csrftoken` pairs in one header,
   * which is malformed and reads as automation on its own.
   */
  private instagramCookieWith(csrf: string): string {
    const base = this.instagramCookie
    if (!base) return ''
    if (!csrf || process.env.IG_CSRFTOKEN?.trim()) return base
    return `${base}; csrftoken=${csrf}`
  }

  /**
   * The CSRF token to put in `X-CSRFToken`, which must equal the one in the
   * cookie or Instagram rejects the POST. Same precedence as the cookie above.
   */
  private instagramCsrf(harvested: string): string {
    return process.env.IG_CSRFTOKEN?.trim() || harvested
  }

  // Main entry point: auto-detects platform and routes accordingly
  async downloadVideo(url: string): Promise<VideoData> {
    const platform = detectPlatform(url)

    // Audio-only mode (the "→ MP3" flow) short-circuits every platform through
    // Cobalt's audio tunnel — one path, MP3 out.
    if (this.mode === 'audio') {
      return this.downloadAudio(url, platform)
    }

    const chinesePlatforms: ChinesePlatform[] = [
      'douyin',
      'kuaishou',
      'bilibili',
      'xiaohongshu',
    ]
    if (chinesePlatforms.includes(platform as ChinesePlatform)) {
      try {
        const direct = await resolveChinesePlatform(
          url,
          platform as ChinesePlatform,
          this.videoQuality,
        )
        if (direct) return direct
      } catch (error) {
        console.warn(`${platform} direct resolver failed, trying Cobalt`, error)
      }

      // Cobalt does not guarantee support for every Chinese platform, but a
      // configured/private instance may support more than the public list. It
      // also remains a useful last resort for Xiaohongshu image pickers.
      const fallback = await this.tryCobaltInstances(url)
      if (fallback) {
        return platform === 'xiaohongshu'
          ? preferXiaohongshuImages(fallback)
          : fallback
      }
      throw new Error(
        `${platform} 解析失败。请确认作品公开可访问；抖音受风控时还需要在 Worker 中配置 IFPHP_API_KEY。`,
      )
    }

    if (platform === 'tiktok') {
      return this.downloadTikTok(url)
    }

    if (platform === 'twitter') {
      const methods = [
        () => this.tryVxTwitterMethod(url),
        () => this.tryCobaltInstances(url),
      ]
      for (const method of methods) {
        try {
          const result = await method()
          if (result) return result
        } catch (e) {
          console.warn('Twitter method failed, trying next...', e)
        }
      }
      throw new Error(
        'Could not download Twitter/X content. The post may be private, age-restricted, or unavailable.',
      )
    }

    if (platform === 'instagram') {
      return this.downloadInstagram(url)
    }

    if (platform === 'youtube') {
      return this.downloadYouTube(url)
    }

    if (platform === 'facebook') {
      return this.downloadFacebook(url)
    }

    // Pinterest, Reddit, Threads, Snapchat, Twitch, Vimeo — no bespoke
    // extractor; resolved generically through Cobalt (which tunnels the media
    // so it plays/downloads from any IP, including Vercel).
    const genericPlatforms: SupportedPlatform[] = [
      'pinterest',
      'reddit',
      'threads',
      'snapchat',
      'twitch',
      'vimeo',
      'generic',
    ]
    if (genericPlatforms.includes(platform)) {
      return this.downloadGeneric(url, platform)
    }

    throw new Error(
      'Unsupported URL. Please paste a link from Douyin, Kuaishou, Bilibili, Xiaohongshu, TikTok, X, Instagram, Facebook, YouTube, Pinterest, Reddit, Threads, Snapchat, Twitch, or Vimeo.',
    )
  }

  /**
   * Audio-only extraction (MP3). Cobalt's downloadMode:'audio' returns an audio
   * tunnel for every supported platform, so this is one path regardless of the
   * source. Metadata is sparse from an audio tunnel, so title/author/thumbnail
   * are enriched from the platform's public oEmbed where we have one (YouTube,
   * TikTok) — the Recent list and result card then read like content, not a
   * bare file. Throws a clear message when no audio stream can be produced.
   */
  private async downloadAudio(
    url: string,
    platform: SupportedPlatform,
  ): Promise<VideoData> {
    const result = await this.tryCobaltInstances(url)

    if (!result || !result.musicUrl) {
      // Cobalt is the only audio path for most platforms, and for YouTube it is
      // also the least dependable one — the same public instance already
      // refuses YouTube *video* with error.api.youtube.login, so treating its
      // continued willingness to serve YouTube audio as guaranteed would be
      // optimistic. Innertube gives us a real second option: an audio-only
      // adaptive stream needs no muxing, so unlike video it comes back at full
      // quality.
      const viaInnertube = await this.tryYouTubeInnertubeAudio(url, platform)
      if (viaInnertube) return viaInnertube

      throw new Error(
        'Could not extract audio from this link. The post may be private, region-locked, or the audio source may be unavailable (YouTube blocks audio extraction from some networks).',
      )
    }

    // Enrich sparse Cobalt metadata from the platform's public oEmbed.
    let meta: { title?: string; author?: string; thumbnail?: string } = {}
    if (platform === 'youtube') {
      const videoId = parseYouTubeId(url)
      const canonical = videoId
        ? `https://www.youtube.com/watch?v=${videoId}`
        : url
      meta = await this.fetchYouTubeMeta(videoId, canonical)
    } else if (platform === 'tiktok') {
      meta = await this.fetchTikTokMeta(url)
    }

    const baseTitle = meta.title || result.title || 'Audio track'
    return {
      ...result,
      title: baseTitle.endsWith(' (audio)') ? baseTitle : `${baseTitle} (audio)`,
      author: meta.author || result.author || 'Unknown',
      thumbnail: meta.thumbnail || result.thumbnail || '',
      downloadUrl: '',
      isPhotoCarousel: false,
    }
  }

  /**
   * YouTube audio via Innertube, used only when Cobalt could not supply a
   * track. Returns null for every other platform (Innertube is YouTube-only)
   * and for anything it cannot resolve, so the caller still raises its own
   * error message.
   */
  private async tryYouTubeInnertubeAudio(
    url: string,
    platform: SupportedPlatform,
  ): Promise<VideoData | null> {
    if (platform !== 'youtube') return null

    const videoId = parseYouTubeId(url)
    if (!videoId) return null

    const canonical = `https://www.youtube.com/watch?v=${videoId}`
    const result = await tryYouTubeInnertube(videoId, canonical, 'audio')
    if (!result?.musicUrl) return null

    // Matches the naming the Cobalt path applies, so the download filename is
    // the same whichever extractor answered.
    return { ...result, title: `${result.title} (audio)`, downloadUrl: '' }
  }

  /**
   * Generic extractor for platforms without a bespoke path. Cobalt tunnels the
   * media through its own server, so the returned URL isn't bound to a signed
   * CDN session and streams from any IP — the only extraction path that works
   * on a datacenter host (Vercel) for these sources. Handles single videos and
   * image/gallery pickers (Cobalt returns a picker for multi-image posts).
   */
  private async downloadGeneric(
    url: string,
    platform: SupportedPlatform,
  ): Promise<VideoData> {
    /**
     * The platform's own endpoint, tried before Cobalt.
     *
     * These used to be Cobalt's job, and it is the reason this list exists at
     * all — but the one open public instance now answers `api.fetch.fail` or
     * `api.fetch.critical` for most of them (its address is blocked by the
     * origins), and with no self-hosted instance configured that left these
     * platforms with no working path. Each of these reads the surface the
     * platform serves to an embedder, which is open in a way the app shell is
     * not. Cobalt stays behind them: when it does answer it tunnels the media,
     * which is still the better result.
     */
    const ownEndpoint: Partial<
      Record<SupportedPlatform, () => Promise<VideoData | null>>
    > = {
      vimeo: () => this.tryVimeo(url),
      twitch: () => this.tryTwitchClip(url),
      threads: () => this.tryThreadsEmbed(url),
      pinterest: () => this.tryPinterestPin(url),
      reddit: () => this.tryRedditEmbed(url),
    }

    const methods: Array<() => Promise<VideoData | null>> = []
    const own = ownEndpoint[platform]
    if (own) methods.push(own)
    methods.push(() => this.tryCobaltInstances(url))
    // Last resort, and the only extractor that runs with nothing configured.
    // Cobalt's public instance serves a fixed platform list, so before this a
    // `generic` link had no path at all unless the operator had stood up a
    // resolver. Reading the page's own og:video/JSON-LD costs one fetch and a
    // handful of bounded regexes, and it is the honest majority of the long
    // tail: small hosts, blogs, and news sites publish their media URL.
    methods.push(() => this.tryPageScrape(url))

    for (const method of methods) {
      try {
        const result = await method()
        // `embedUrl` counts: a video that can only be played (Vimeo without
        // progressive renditions) is still a better answer than an error.
        if (
          result &&
          (result.downloadUrl ||
            result.embedUrl ||
            (result.images?.length ?? 0) > 0)
        ) {
          return result
        }
      } catch (e) {
        // The one failure worth surfacing verbatim: it is a definite answer
        // about a specific site, not another extractor declining to guess.
        if (e instanceof OriginBlockedError) throw e
        console.warn(`${platform} method failed, trying next...`, e)
      }
    }
    throw new Error(
      `Could not download this ${platform} content. The post may be private, region-locked, unavailable, or not supported by our extractor.`,
    )
  }

  /**
   * Fetch the page and take the media URL it publishes about itself.
   *
   * Note this deliberately ignores `htmlScrapingAvailable()`, which is off on
   * Cloudflare. That gate exists for the TikTok/Facebook strategies, and both
   * of its reasons are specific to them: multi-megabyte state blobs (this reads
   * at most MAX_SCAN_BYTES and never unescapes a state tree), and origins that
   * bot-wall a datacenter IP (TikTok and Facebook do; they also never reach
   * here, having bespoke extractors). The long-tail hosts on this path serve
   * their markup to anyone who asks.
   *
   * A live stream (m3u8/mpd) is rejected rather than returned: turning one into
   * a file needs ffmpeg, which no deployment target here has.
   */
  private async tryPageScrape(url: string): Promise<VideoData | null> {
    const response = await fetch(url, {
      headers: BROWSER_PAGE_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') ?? ''
    const finalUrl = response.url || url

    // A direct media link pasted as-is: no page to scrape, and the URL is
    // already the answer. Nothing reads the body, so cancel it rather than
    // leaving a video streaming into a Worker that will never look at it.
    if (isDirectMediaType(contentType)) {
      await response.body?.cancel().catch(() => {})
      return {
        id: parseVideoId(url) || finalUrl.slice(-32),
        title: filenameTitle(finalUrl),
        url,
        thumbnail: '',
        duration: 0,
        author: new URL(url).hostname.replace(/^www\./, ''),
        description: '',
        downloadUrl: finalUrl,
      }
    }
    if (!contentType.includes('html')) return null

    const html = await readCappedText(response)
    // Redirects mean the final URL, not the pasted one, is what relative srcs
    // resolve against.
    let media = extractMediaFromHtml(html, finalUrl)

    // A page can advertise a URL that does not serve — one host publishes a
    // 2160p download link for every clip and answers it with an HTML error
    // page. Verified here rather than trusted, so the fallbacks below get their
    // turn instead of the visitor getting a dead player.
    if (
      media &&
      !media.isStream &&
      !(await this.verifyStreamReachable(media.mediaUrl, { rejectHtml: true }))
    ) {
      media = null
    }

    // Distinguish "this page has no video we can read" from "this site did not
    // show us the page at all", which are the same failure to the code above
    // and completely different news to the user.
    const walled = looksLikeBotWall(html)
    if (!media) {
      // The recipe first: it is host-specific (a no-op for any host without
      // one), it probes a ladder of renditions rather than trusting a link, and
      // it is the path that works on the hosts that wall hardest — those tend
      // to wall the watch page while leaving an embed open, and an embed is
      // enough to build the link.
      //
      // Its page is fetched DIRECTLY first, and only relayed if that comes up
      // empty. Handing it the relay alone was the bug: a walled host walls its
      // watch page, not its embed, so the direct fetch is the one that works —
      // while every free relay now refuses to fetch on behalf of a Worker at
      // all, which made the whole recipe path dead code.
      media = await resolveByRule(url, fetchPageDirectThenRelay)

      // Otherwise read the watch page itself from an address the site will
      // answer, and extract from that exactly as if we had fetched it. Only
      // worth a request when the page we did get was a wall.
      if (!media && walled) {
        const relayed = await fetchThroughRelay(url)
        if (relayed) media = extractMediaFromHtml(relayed, url)
      }

      if (!media && walled) {
        throw new OriginBlockedError(new URL(url).hostname.replace(/^www\./, ''))
      }
    }

    if (!media || media.isStream) return null

    return {
      id: parseVideoId(url) || media.mediaUrl.slice(-32),
      title: media.title,
      url,
      thumbnail: media.thumbnail,
      duration: 0,
      author: new URL(url).hostname.replace(/^www\./, ''),
      description: '',
      downloadUrl: media.mediaUrl,
    }
  }

  /**
   * Vimeo via the public player config (https://player.vimeo.com/video/<id>/
   * config). For public videos this returns direct progressive mp4 renditions
   * that stream from any IP — no login, no signed session. Honours the HD/SD
   * quality preference by picking the highest / lowest rendition.
   */
  private async tryVimeo(url: string): Promise<VideoData | null> {
    const id = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1]
    if (!id) return null
    const response = await http.get(
      `https://player.vimeo.com/video/${id}/config`,
      {
        headers: { 'User-Agent': this.userAgent, Referer: 'https://vimeo.com/' },
        timeout: 15000,
        validateStatus: () => true,
      },
    )
    if (response.status !== 200) return null
    const data = response.data as {
      video?: {
        title?: string
        duration?: number
        owner?: { name?: string }
        thumbs?: Record<string, string>
      }
      request?: {
        files?: {
          progressive?: Array<{ url?: string; height?: number }>
        }
      }
    }

    const v0 = data.video ?? {}
    const progressive = (data.request?.files?.progressive ?? []).filter(
      (f): f is { url: string; height?: number } => Boolean(f?.url),
    )

    // Vimeo has been retiring progressive renditions: many videos now ship only
    // DASH and HLS, which are manifests, and turning one into a file needs
    // ffmpeg. Rather than fail — or, as this used to do by falling through to
    // the page scraper, hand back the player page itself as if it were a video
    // — offer the embed. Playable, honestly not downloadable.
    if (progressive.length === 0) {
      return {
        id,
        title: v0.title || 'Vimeo Video',
        url,
        thumbnail: vimeoThumb(v0.thumbs),
        duration: Math.round(v0.duration || 0),
        author: v0.owner?.name || 'Vimeo',
        description: '',
        downloadUrl: '',
        embedUrl: `https://player.vimeo.com/video/${id}`,
        isPhotoCarousel: false,
      }
    }

    const sorted = [...progressive].sort(
      (a, b) => (a.height ?? 0) - (b.height ?? 0),
    )
    const chosen =
      this.videoQuality === 'sd' ? sorted[0] : sorted[sorted.length - 1]

    return {
      id,
      title: v0.title || 'Vimeo Video',
      url,
      thumbnail: vimeoThumb(v0.thumbs),
      duration: Math.round(v0.duration || 0),
      author: v0.owner?.name || 'Vimeo',
      description: '',
      downloadUrl: chosen.url,
      isPhotoCarousel: false,
    }
  }

  /**
   * Twitch clips, via the same public GraphQL endpoint the Twitch web player
   * uses. A clip's renditions are plain MP4s on CloudFront, so unlike a VOD
   * (HLS, which needs ffmpeg to save) a clip is downloadable as-is.
   *
   * The `sourceURL` alone answers 401 — it has to carry the signature and token
   * from the same response, which is why the access token is asked for in the
   * one query rather than assumed unnecessary.
   *
   * VOD and channel links return null: their media is a manifest, and this
   * deployment cannot mux one into a file.
   */
  private async tryTwitchClip(url: string): Promise<VideoData | null> {
    const slug = parseTwitchClipSlug(url)
    if (!slug) return null

    const response = await http.post(
      'https://gql.twitch.tv/gql',
      {
        query: `{ clip(slug: "${slug}") { title durationSeconds thumbnailURL broadcaster { displayName } videoQualities { quality sourceURL } playbackAccessToken(params: {platform:"web", playerBackend:"mediaplayer", playerType:"site"}) { signature value } } }`,
      },
      {
        // The web client's own id. Public, shipped in Twitch's own JS bundle,
        // and required on every unauthenticated GQL call.
        headers: { 'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko' },
        timeout: 15000,
        validateStatus: () => true,
      },
    )
    if (response.status !== 200) return null

    const clip = response.data?.data?.clip as
      | {
          title?: string
          durationSeconds?: number
          thumbnailURL?: string
          broadcaster?: { displayName?: string }
          videoQualities?: Array<{ quality?: string; sourceURL?: string }>
          playbackAccessToken?: { signature?: string; value?: string }
        }
      | undefined

    const renditions = (clip?.videoQualities ?? [])
      .filter((q): q is { quality: string; sourceURL: string } =>
        Boolean(q?.sourceURL),
      )
      .sort((a, b) => parseInt(a.quality, 10) - parseInt(b.quality, 10))
    if (renditions.length === 0) return null

    const chosen =
      this.videoQuality === 'sd'
        ? renditions[0]
        : renditions[renditions.length - 1]
    const token = clip?.playbackAccessToken
    if (!token?.signature || !token?.value) return null

    return {
      id: slug,
      title: clip?.title || 'Twitch clip',
      url,
      thumbnail: clip?.thumbnailURL || '',
      duration: Math.round(clip?.durationSeconds || 0),
      author: clip?.broadcaster?.displayName || 'Twitch',
      description: '',
      downloadUrl: `${chosen.sourceURL}?sig=${token.signature}&token=${encodeURIComponent(token.value)}`,
      isPhotoCarousel: false,
    }
  }

  /**
   * Reddit, via the embed view of a post.
   *
   * Reddit's own pages and its JSON API both refuse us, and the raw
   * `v.redd.it` renditions are DASH: video and audio in separate files, which
   * needs muxing this deployment cannot do. The embed carries the answer to
   * both problems — a `packaged-media-json` attribute listing pre-muxed MP4s at
   * several heights, signed and served to anyone.
   *
   * The attribute sits ~310 KB into the page, past the generic scraper's scan
   * window, which is why this reads it deliberately rather than leaving reddit
   * to `tryPageScrape`.
   */
  private async tryRedditEmbed(url: string): Promise<VideoData | null> {
    // Share links (/s/…), redd.it and v.redd.it all redirect to the canonical
    // permalink, which is the only shape the embed host answers.
    const isPermalink = /reddit\.com\/(?:r|user|u)\/[\w.-]+\/comments\//.test(url)
    const permalink = isPermalink ? url : await this.resolveRedirect(url)
    const path = /reddit\.com\/((?:r|user|u)\/[\w.-]+\/comments\/[\w]+)/.exec(
      permalink,
    )?.[1]
    if (!path) return null

    const response = await http.get(`https://embed.reddit.com/${path}/`, {
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'text/html,application/xhtml+xml',
        // The embed is meant to be framed by a third party, and answers as one.
        Referer: 'https://www.reddit.com/',
      },
      timeout: 20000,
      validateStatus: () => true,
    })
    if (response.status !== 200) return null

    const html = typeof response.data === 'string' ? response.data : ''
    const mp4s = redditPackagedMp4s(html)
    if (mp4s.length === 0) return null

    const chosen = this.videoQuality === 'sd' ? mp4s[0] : mp4s[mp4s.length - 1]
    const slug = /comments\/[\w]+\/([\w_]+)/.exec(permalink)?.[1] ?? ''
    const subreddit = /\/r\/([\w.-]+)/.exec(permalink)?.[1] ?? 'reddit'

    return {
      id: /comments\/([\w]+)/.exec(permalink)?.[1] ?? path,
      // The embed page's own <title> is the site's name on every post, so the
      // permalink slug — which is the title, lowercased and hyphenated — is the
      // better source.
      title: slug ? slug.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Reddit video',
      url,
      thumbnail: decodeEntities(
        /https:\/\/(?:preview|external-preview)\.redd\.it\/[^"'\s\\]+/.exec(html)?.[0] ?? '',
      ),
      duration: Math.round(redditPackagedDuration(html)),
      author: `r/${subreddit}`,
      description: '',
      downloadUrl: chosen.url,
      isPhotoCarousel: false,
    }
  }

  /**
   * Threads, via the `/embed` view of a post.
   *
   * The post URL itself answers with the app shell — a quarter-megabyte of
   * JavaScript and no media, which is why every scrape of it came up empty. The
   * embed view is server-rendered markup with a real `<video>` in it, and it is
   * only served to a client that identifies as a link crawler; a browser user
   * agent gets the shell here too.
   *
   * Extraction itself is `extractMediaFromHtml`, the same scorer the generic
   * page scrape uses — this method only knows which URL to ask for and how to
   * ask.
   */
  private async tryThreadsEmbed(url: string): Promise<VideoData | null> {
    const embedUrl = `${url.split(/[?#]/)[0].replace(/\/$/, '')}/embed`
    const response = await http.get(embedUrl, {
      headers: {
        'User-Agent': LINK_CRAWLER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      timeout: 15000,
      validateStatus: () => true,
    })
    if (response.status !== 200) return null

    const html = typeof response.data === 'string' ? response.data : ''
    const media = extractMediaFromHtml(html, embedUrl)
    if (!media || media.isStream) return null

    const author = /threads\.(?:net|com)\/@([\w.]+)/.exec(url)?.[1] ?? 'threads'
    return {
      id: /post\/([\w-]+)/.exec(url)?.[1] || media.mediaUrl.slice(-32),
      title: media.title === 'Threads' ? `Threads post by @${author}` : media.title,
      url,
      thumbnail: media.thumbnail,
      duration: 0,
      author,
      description: '',
      downloadUrl: media.mediaUrl,
      isPhotoCarousel: false,
    }
  }

  /**
   * Pinterest, via the widget API its own embed script calls.
   *
   * Pin pages are a megabyte of client-rendered markup with the media nowhere
   * in it; this endpoint answers with the pin as JSON — video renditions when
   * it is a video pin, image sizes when it is not. Both are useful: an image
   * pin becomes a one-image gallery rather than a failure.
   */
  private async tryPinterestPin(url: string): Promise<VideoData | null> {
    const id = /\/pin\/(\d+)/.exec(url)?.[1]
    if (!id) return null

    const response = await http.get(
      `https://widgets.pinterest.com/v3/pidgets/pins/info/?pin_ids=${id}`,
      {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        timeout: 15000,
        validateStatus: () => true,
      },
    )
    if (response.status !== 200) return null

    // The endpoint has answered with both shapes over its life; neither is
    // documented, so read both rather than betting on one.
    const pin = (response.data?.data?.[0] ?? response.data?.data?.pins?.[0]) as
      | PinterestPin
      | undefined
    if (!pin) return null

    const video = bestPinterestVideo(pin)
    const image = bestPinterestImage(pin)
    if (!video && !image) return null

    const title = pin.grid_title || pin.description?.trim() || 'Pinterest pin'
    return {
      id,
      title: title.slice(0, 100),
      url,
      thumbnail: image || '',
      duration: 0,
      author: pin.pinner?.username || 'Pinterest',
      description: pin.description?.trim() || '',
      downloadUrl: video || '',
      images: !video && image ? [{ id: `${id}_0`, url: image, thumbnail: image }] : undefined,
      isPhotoCarousel: false,
    }
  }

  /**
   * YouTube extraction, in order of reliability:
   *   1. yt-dlp — runs locally from a residential IP that YouTube doesn't
   *      bot-block, so it yields real video + audio downloads.
   *   2. Cobalt — login-free public instance; works when its server isn't
   *      currently bot-blocked. Sparse metadata, so title/author/thumbnail are
   *      enriched from YouTube's public oEmbed endpoint.
   *   3. Embed fallback — when no extractor can produce a stream (e.g. on a
   *      datacenter host like Vercel), return the official embed so the video
   *      is still viewable.
   */
  private async downloadYouTube(url: string): Promise<VideoData> {
    const videoId = parseYouTubeId(url)
    // Normalise to a canonical watch URL — short/shorts/embed links confuse
    // some extractors, and oEmbed expects a standard watch URL.
    const canonical = videoId
      ? `https://www.youtube.com/watch?v=${videoId}`
      : url

    // 1) yt-dlp — extracts from this process's IP. Run locally / self-hosted
    //    (residential IP), YouTube doesn't bot-block it, so it succeeds where
    //    the public datacenter instances fail, and unlike Innertube below it
    //    can mux, so it is the only path that yields full resolution.
    //    Unavailable on workerd (no Python, no ffmpeg), hence the guard — which
    //    also skips the oEmbed round-trip that only this branch needs.
    if (videoId && nativeMediaAvailable()) {
      const meta = await this.fetchYouTubeMeta(videoId, canonical)
      const viaYtDlp = await this.tryYtDlpYouTube(videoId, canonical, meta)
      if (viaYtDlp) return viaYtDlp
    }

    // 2) Innertube — YouTube's own player API, which (unlike Cobalt) answers a
    //    datacenter IP, and carries its own title/author/thumbnail so no
    //    separate metadata fetch is needed. Capped at 360p for video; see
    //    youtubeInnertube.ts for why, and why ANDROID_VR specifically.
    if (videoId) {
      const viaInnertube = await tryYouTubeInnertube(videoId, canonical, this.mode)
      if (viaInnertube) return viaInnertube
    }

    const meta = await this.fetchYouTubeMeta(videoId, canonical)

    const methods: Array<() => Promise<VideoData | null>> = [
      () => this.tryCobaltInstances(canonical),
    ]

    for (const method of methods) {
      try {
        const result = await method()
        if (result && result.downloadUrl) {
          // Reject dead/region-locked stream URLs so the UI never shows a
          // broken player — fall through to the next extractor instead.
          if (!(await this.verifyStreamReachable(result.downloadUrl))) {
            console.warn('YouTube candidate stream unreachable, trying next...')
            continue
          }
          // YouTube never yields a photo gallery.
          result.isPhotoCarousel = false
          result.images = undefined
          // Prefer the richer oEmbed metadata over the extractor's guesses.
          if (meta.title) result.title = meta.title
          if (meta.author) result.author = meta.author
          if (meta.thumbnail) result.thumbnail = meta.thumbnail
          if (videoId) result.id = videoId
          return result
        }
      } catch (e) {
        console.warn('YouTube method failed, trying next...', e)
      }
    }

    // No extractor could produce a downloadable stream — YouTube bot-blocks
    // extraction from datacenter IPs (the public Cobalt instance and the Vercel
    // deploy alike), and yt-dlp isn't available here. Rather than failing
    // outright, degrade gracefully to the official embed player so the video
    // stays viewable; the UI renders the embed and hides the (unavailable)
    // download/audio buttons. Real downloads need yt-dlp (run it locally).
    if (videoId) {
      return {
        id: videoId,
        title: meta.title || 'YouTube Video',
        url: canonical,
        thumbnail: meta.thumbnail || '',
        duration: 0,
        author: meta.author || 'YouTube',
        description: '',
        downloadUrl: '',
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
      }
    }

    throw new Error(
      'Could not process this YouTube link. Please double-check the URL and try again.',
    )
  }

  /**
   * Facebook: try the login-free extractors in order of reliability.
   *   1. The public video plugin page (`/plugins/video.php`) ships the stream
   *      config for any public video without a login wall.
   *   2. Direct scraping of the watch/reel page JSON (`browser_native_*_url`).
   *   3. Cobalt instances as the community fallback.
   *
   * fb.watch and /share/ links are resolved to their canonical URL first.
   *
   * A photo link takes a fourth path of its own — see `tryFacebookPhoto` — and
   * a story takes none at all: Facebook serves those only to a logged-in
   * session, so the honest answer is the reason rather than four failed
   * attempts and a generic error.
   */
  private async downloadFacebook(url: string): Promise<VideoData> {
    if (isFacebookStory(url)) {
      throw new Error(
        'This is a Facebook story — Facebook serves these only to a logged-in account, so they cannot be downloaded here. Public videos, reels and watch links work.',
      )
    }

    let resolvedUrl = url
    if (
      url.includes('fb.watch') ||
      url.includes('/share/') ||
      url.includes('fb.com')
    ) {
      resolvedUrl = await this.resolveRedirect(url)
    }

    // tryFacebookScrape pulls the whole post page and scans it; it is skipped
    // where that cannot work. See htmlScrapingAvailable().
    const methods: Array<() => Promise<VideoData | null>> = [
      () => this.tryFacebookPlugin(resolvedUrl, url),
      ...(htmlScrapingAvailable()
        ? [() => this.tryFacebookScrape(resolvedUrl, url)]
        : []),
      () => this.tryCobaltInstances(resolvedUrl),
      // Last, and only for a link that names a photo: every page here publishes
      // an `og:image`, so running this any earlier — or on any other link —
      // would answer a private *video* with its poster frame and call that a
      // success.
      () => this.tryFacebookPhoto(resolvedUrl, url),
    ]

    for (const method of methods) {
      try {
        const result = await method()
        if (result?.downloadUrl) {
          // A video answer is a video answer: whatever gallery an extractor
          // guessed at alongside it is dropped, as it always has been.
          result.isPhotoCarousel = false
          result.images = undefined
          return result
        }
        if (result?.images?.length) return result
      } catch (e) {
        console.warn('Facebook method failed, trying next...', e)
      }
    }

    throw new Error(
      'Could not download this Facebook video. The post may be private, age-restricted, or unavailable.',
    )
  }

  /**
   * A Facebook photo, from the `og:image` its page publishes to link crawlers.
   *
   * Only ever tried for a link that names a photo (`/photo/?fbid=`,
   * `/<page>/photos/…`); see the call site. The crawler view is used because
   * the same page answers a browser with a client-rendered shell.
   */
  private async tryFacebookPhoto(
    resolvedUrl: string,
    originalUrl: string,
  ): Promise<VideoData | null> {
    if (!isFacebookPhotoLink(originalUrl) && !isFacebookPhotoLink(resolvedUrl)) {
      return null
    }
    const response = await http.get(resolvedUrl, {
      headers: this.facebookHeaders(resolvedUrl, {
        'User-Agent': LINK_CRAWLER_AGENT,
        Accept: 'text/html',
      }),
      timeout: 15000,
      validateStatus: () => true,
    })
    const html = typeof response.data === 'string' ? response.data : ''
    const image = metaContent(html, 'og:image')
    if (!image) return null

    const id = parseVideoId(originalUrl) || Date.now().toString()
    return {
      id,
      title: (metaContent(html, 'og:title') || 'Facebook Photo').slice(0, 100),
      url: originalUrl,
      thumbnail: image,
      duration: 0,
      author: 'Facebook',
      description: metaContent(html, 'og:description') || '',
      downloadUrl: '',
      isPhotoCarousel: true,
      images: [{ id: `${id}_0`, url: image, thumbnail: image }],
    }
  }

  /**
   * Instagram: resolve any share/short link to its canonical post URL, then
   * use the upstream project's original extractor order:
   *   1. Instagram's public embed page
   *   2. Instagram's media API, only for an explicitly credentialed request
   *   3. The upstream project's original Cobalt instance list
   *
   * Instagram posts are mapped onto the same VideoData shape as everything
   * else: a single primary video goes in `downloadUrl`, while photos (and the
   * frames of a carousel) populate `images[]`. `isPhotoCarousel` is left false
   * on purpose — IG carousels are plain image sets, not music-backed TikTok
   * slideshows, so they should reuse the generic gallery, not the ffmpeg
   * slideshow renderer.
   */
  private async downloadInstagram(url: string): Promise<VideoData> {
    // Stories & highlights use a different (login-gated) endpoint than shortcode
    // posts — detect and route them out first. `/s/…` share links redirect to a
    // canonical /stories/highlights/… URL, so resolve those before parsing.
    let storyCandidate = url
    if (url.includes('/s/')) {
      storyCandidate = await this.resolveRedirect(url)
    }
    const story =
      parseInstagramStory(storyCandidate) || parseInstagramStory(url)
    if (story) return this.downloadInstagramStory(story, url)

    let resolvedUrl = url
    if (url.includes('/share/') || url.includes('instagr.am')) {
      resolvedUrl = await this.resolveInstagramUrl(url)
    }

    const shortcode =
      parseInstagramShortcode(resolvedUrl) || parseInstagramShortcode(url)

    // Order by reliability + cost:
    //   1. Embed page — fast, login-free, no authenticated hit; resolves public
    //      posts, reels and carousels (and bails rather than misrendering a
    //      video as a photo when its JSON doesn't parse). Verified 2026-08-15
    //      from Cloudflare's own network against four famous public posts.
    //      A post Instagram will not serve logged-out returns the same "the link
    //      to this photo or video may be broken" shell as a deleted one, with
    //      `contextJSON: null` — that shell is NOT evidence the surface is gone,
    //      which is exactly the trap in
    //      lessons/2026-08-15-instagram-logged-out-wall.md.
    //   2. The private media API — the only path that resolves what Instagram
    //      will not serve anonymously, and the only one the session buys
    //      anything on. No-ops (returns null, sends nothing) for an
    //      uncredentialed resolve, and tried after the embed so the burner
    //      account is only used when actually needed.
    //   3. Cobalt — keep the upstream project's original fallback and original
    //      instance list. Do not add fork-specific public instances here.
    const methods: Array<() => Promise<VideoData | null>> = [
      () =>
        shortcode
          ? this.tryInstagramEmbed(shortcode, url)
          : Promise.resolve(null),
      () =>
        shortcode
          ? this.tryInstagramMediaInfo(shortcode, url)
          : Promise.resolve(null),
      () => this.tryCobaltInstances(resolvedUrl),
    ]

    // Hold the first video result whose stream we couldn't confirm reachable, so
    // that if no method yields a verified-playable stream we still return
    // something (preserving prior behavior) rather than failing outright.
    let unverifiedVideo: VideoData | null = null

    for (const method of methods) {
      try {
        const result = await method()
        if (!result) continue
        // IG never uses the TikTok-style slideshow render path.
        result.isPhotoCarousel = false

        if (result.downloadUrl) {
          // Confirm the video stream actually serves bytes from THIS host before
          // committing to it. Instagram's signed CDN URLs often 500/403 when
          // re-fetched from a datacenter IP (Vercel) even though extraction
          // worked — which renders a dead player. If it's unreachable, fall
          // through to the next method (ultimately Cobalt, whose URL streams
          // from any IP). Mirrors the YouTube path's reachability guard.
          if (await this.verifyStreamReachable(result.downloadUrl)) return result
          if (!unverifiedVideo) unverifiedVideo = result
          console.warn(
            'Instagram video stream unreachable from here, trying next method...',
          )
          continue
        }

        if ((result.images?.length ?? 0) > 0) return result
      } catch (e) {
        // Never log an Axios error object here. It contains request.config,
        // including the credentialed request's Cookie header. A short error
        // name/message is enough to diagnose the fallback without exposing the
        // operator's Instagram session in Cloudflare logs.
        console.warn(
          'Instagram method failed, trying next...',
          e instanceof Error ? `${e.name}: ${e.message}` : 'unknown error',
        )
      }
    }

    // No method produced a verified-reachable stream. If we did extract a video
    // URL (just couldn't confirm it here), return it anyway — it may still play
    // for the client, and this is no worse than the prior behavior.
    if (unverifiedVideo) return unverifiedVideo

    // A credentialed request whose session is locked reached here as if it were
    // anonymous. Say so, rather than describing this post as the unusual one:
    // for a grant holder every login-gated post fails until the lock clears.
    if (this.credentialed && instagramSessionLocked()) {
      throw new Error(
        'Could not download this Instagram post. It needs a logged-in Instagram account, and this downloader’s account has been asked by Instagram to verify itself — that has to be done before login-only posts work again. Public posts, reels and carousels are unaffected.',
      )
    }

    // Every login-free path failed. The most common cause now is a login-gated
    // post (Instagram serves these only to authenticated users); resolving them
    // requires a valid IG_SESSIONID. Surface that distinctly so the operator
    // knows whether to configure/refresh the cookie.
    if (!this.instagramSessionId) {
      console.warn(
        this.instagramSessionConfigured
          ? 'Instagram extraction failed on an anonymous request. A session IS configured; it is withheld by design from requests without the `ig` grant. Public posts resolve without it, so this is a post Instagram will not serve logged-out — not a missing secret.'
          : 'Instagram extraction failed and IG_SESSIONID is not set — login-gated posts require it.',
      )
      throw new Error(
        'Available public Instagram resolvers could not extract this post. Instagram may be blocking logged-out datacenter requests, or the public fallback services may be temporarily rate-limited. Confirm the post opens publicly and try again.',
      )
    }
    throw new Error(
      'Could not download Instagram content. The post may be private or unavailable, or the configured Instagram session (IG_SESSIONID) may have expired.',
    )
  }

  /**
   * Instagram story / highlight extractor. Stories are only served to
   * authenticated accounts, so this REQUIRES a configured IG_SESSIONID — without
   * it we surface a clear, specific message rather than a generic failure. With
   * a session it resolves the user's (or highlight's) reel via the private
   * reels_media API and returns the matching item's video or image.
   *
   * Best-effort: Instagram rotates these endpoints, and stories expire after
   * 24h, so failures degrade to an explanatory error.
   */
  private async downloadInstagramStory(
    story: { username?: string; storyPk?: string; highlightId?: string },
    originalUrl: string,
  ): Promise<VideoData> {
    if (this.credentialed && instagramSessionLocked()) {
      throw new Error(
        'Instagram has asked this downloader’s Instagram account to verify itself, so story and highlight downloads are paused until that is done. Public posts, reels and carousels are unaffected.',
      )
    }

    if (!this.instagramSessionId) {
      if (this.instagramSessionConfigured) {
        console.warn(
          'Instagram story requested anonymously. A session IS configured but never attaches to a request without the `ig` grant.',
        )
      }
      throw new Error(
        'This is an Instagram story/highlight — Instagram only serves these to a logged-in account, so downloading them needs a configured Instagram session (IG_SESSIONID). Public posts and reels work without one.',
      )
    }

    const { csrf } = await this.getInstagramTokens()
    const cookie = this.instagramCookieWith(csrf)
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      'X-IG-App-ID': this.instagramAppId,
      Accept: '*/*',
      Referer: 'https://www.instagram.com/',
      Cookie: cookie,
    }

    // A /stories/<user>/<pk>/ link carries the item's OWN media id, so ask for
    // that item directly and skip resolving the account behind it. This is the
    // fast path and, more importantly, the reliable one: the username lookup
    // below answers 429 far more often than not, which is why story links
    // failed for a credentialed request while highlight links — which never
    // need a username — worked. See
    // lessons/2026-08-15-instagram-logged-out-wall.md.
    if (story.storyPk) {
      const direct = await this.instagramMediaItem(story.storyPk, headers)
      const parsed =
        direct &&
        storyItemToVideoData(
          direct,
          direct.user?.username || story.username || 'instagram',
          originalUrl,
          story.storyPk,
        )
      if (parsed) return parsed
    }

    // Resolve which reel to fetch: a highlight id directly, or the user id
    // behind a username.
    let reelId: string
    if (story.highlightId) {
      reelId = `highlight:${story.highlightId}`
    } else if (story.username) {
      const userId = await this.resolveInstagramUserId(story.username, headers)
      if (!userId) {
        throw new Error(
          'Could not resolve that Instagram account (it may be private, or the session has expired).',
        )
      }
      reelId = userId
    } else {
      throw new Error('Unrecognised Instagram story link.')
    }

    const reels = await http.get(
      `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${encodeURIComponent(
        reelId,
      )}`,
      { headers, timeout: 20000, validateStatus: () => true },
    )

    const reelMap = (reels.data?.reels ?? {}) as Record<string, IgReel>
    const reel: IgReel | undefined =
      reelMap[reelId] ?? (Object.values(reelMap)[0] as IgReel | undefined)
    const items = (reel?.items ?? []) as IgStoryItem[]
    if (items.length === 0) {
      logInstagramRefusal('reels_media', reelId, reels)
      throw new Error(
        'No story items are available — the story may have expired (stories last 24 hours) or the account has none right now.',
      )
    }

    // Prefer the exact item the link points at; otherwise take the first.
    const item =
      (story.storyPk &&
        items.find(
          (it) =>
            String(it.pk) === story.storyPk ||
            String(it.id ?? '').startsWith(story.storyPk as string),
        )) ||
      items[0]

    const parsed = storyItemToVideoData(
      item,
      reel?.user?.username || story.username || 'instagram',
      originalUrl,
      story.storyPk,
    )
    if (parsed) return parsed
    throw new Error('Could not extract media from that story item.')
  }

  /**
   * The numeric user id behind a username, via the same blended search the web
   * client's search box calls.
   *
   * NOT `web_profile_info`: that is the obvious endpoint and it rate-limits to
   * 429 under any real use, taking the whole story path down with it. Search
   * matches on substrings, so only an exact username counts — otherwise
   * `/stories/nasa/…` could resolve to `nasa_fanpage`.
   */
  private async resolveInstagramUserId(
    username: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const response = await http.get(
      `https://www.instagram.com/api/v1/web/search/topsearch/?context=blended&query=${encodeURIComponent(
        username,
      )}`,
      { headers, timeout: 15000, validateStatus: () => true },
    )
    const users = response.data?.users
    if (!Array.isArray(users)) return ''
    const wanted = username.toLowerCase()
    for (const entry of users) {
      const user = entry?.user
      if (String(user?.username ?? '').toLowerCase() === wanted) {
        return String(user?.pk ?? '')
      }
    }
    return ''
  }

  /**
   * Checks whether a video URL uses a browser-compatible codec.
   * TikTok's HDplay sometimes uses bvc2 (ByteDance proprietary codec) which browsers cannot render.
   * In that case we fall back to the standard play URL (H.264/avc1).
   */
  private async checkVideoCodecCompatible(url: string): Promise<boolean> {
    try {
      const referer = codecProbeReferer(url)
      const response = await http.get(url, {
        headers: {
          Range: 'bytes=0-65535',
          'User-Agent': this.userAgent,
          ...(referer ? { Referer: referer } : {}),
        },
        responseType: 'arraybuffer',
        // Short on purpose: this probe sits between the visitor and their
        // result, and its own failure path is "assume the codec is fine". A
        // slow CDN is therefore worth abandoning rather than waiting out —
        // measured, the probe answers in 0.2–1.4s when it answers at all.
        timeout: 2500,
        maxRedirects: 5,
      })
      const bytes = Buffer.from(response.data as ArrayBuffer)
      return this.supportedVideoCodecs.some((codec) =>
        bytes.includes(Buffer.from(codec)),
      )
    } catch {
      // If the check fails we optimistically assume the codec is fine
      return true
    }
  }

  /**
   * Confirms a candidate stream URL actually serves bytes before we hand it to
   * the client. Public Cobalt/Piped instances sometimes return dead or
   * region-locked URLs (e.g. an LBRY mirror that 401s); worse, a Cobalt
   * instance that failed to extract a video still answers its tunnel with
   * `200 Content-Length: 0` — a status check alone passes that empty tunnel
   * through and the user ends up downloading a 0 KB file.
   *
   * So we require the probe to actually yield bytes. We stream the response and
   * read only the FIRST chunk (then tear the connection down) — confirming the
   * stream is live without buffering the whole file. (Cobalt tunnels ignore the
   * Range header and would otherwise stream the entire video into memory here,
   * and then again when the client fetches it for real.)
   *
   * `rejectHtml` additionally refuses a response that is a web page. Bytes are
   * the right test for a tunnel (which declares no useful type), but a URL
   * scraped off a page can be answered with an error page, and an error page
   * has bytes too.
   */
  private async verifyStreamReachable(
    url: string,
    opts?: { rejectHtml?: boolean },
  ): Promise<boolean> {
    // Native fetch rather than axios: axios's `responseType: 'stream'` hands
    // back a Node Readable, which its fetch adapter cannot produce and which
    // does not exist on workerd. A web ReadableStream works identically on both
    // runtimes, and reading one chunk from it costs no meaningful CPU.
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 12000)
    try {
      const referer = getMediaReferer(url)
      const headers: Record<string, string> = {
        Range: 'bytes=0-1024',
        'User-Agent': this.userAgent,
      }
      if (referer) headers.Referer = referer

      const response = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: abort.signal,
      })

      const statusOk = response.status === 200 || response.status === 206
      const isPage = (response.headers.get('content-type') ?? '').includes(
        'text/html',
      )
      // An explicit Content-Length: 0 is the empty-tunnel signature — reject early.
      if (
        !statusOk ||
        response.headers.get('content-length') === '0' ||
        (opts?.rejectHtml && isPage)
      ) {
        await response.body?.cancel()
        return false
      }
      if (!response.body) return false

      // True on the first non-empty chunk; false if the body ends empty, errors,
      // or stalls. One chunk is enough — the rest of the file is never pulled,
      // and cancelling tears the connection down so the upstream stops sending.
      const reader = response.body.getReader()
      try {
        const { value, done } = await reader.read()
        return !done && (value?.byteLength ?? 0) > 0
      } finally {
        await reader.cancel().catch(() => {})
      }
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  private async downloadTikTok(url: string): Promise<VideoData> {
    const videoId = parseVideoId(url)
    if (!videoId) {
      throw new Error('Could not extract video ID from URL')
    }

    // tikwm and Cobalt are raced, not tried in turn.
    //   - tikwm gives the richest result (carousels, music, a non-IP-bound URL)
    //     when reachable, but it now queues every request: measured 2026-08-14,
    //     13.2s wall for one post against 2.1s of its own `processed_time`.
    //   - Cobalt *tunnels* the media through its own server, so the URL it
    //     returns isn't bound to TikTok's signed CDN session and plays from any
    //     IP (the raw playAddr that snaptik/direct-scrape hand back 403s when
    //     re-fetched from a different host — which is why TikTok broke on
    //     Vercel). Measured 8.3s for the same post.
    //
    // In sequence that was ~16s of cold resolve, because the visitor paid
    // tikwm's queue in full before Cobalt was even asked. Raced, the answer
    // arrives with the faster of the two, and tikwm still wins whenever it is
    // the faster — which is the only condition under which its richer payload
    // was worth waiting for.
    const raced = await firstResult([
      () => this.tryTikwmMethod(url),
      () => this.tryTikTokCobalt(url),
    ])
    if (raced) return raced

    // Everything below is a fallback for when both of those miss, and stays
    // sequential: each is either free (yt-dlp, absent on workerd) or expensive
    // and unlikely (the public scrapers).
    //   - yt-dlp — fast + reliable locally (residential IP), unavailable on
    //     Vercel/workerd, where it returns null.
    //   - the remaining public scrapers as last resorts (snaptik ships
    //     obfuscated JS, ssstik needs a rotating token). Skipped where page
    //     scraping cannot work — see htmlScrapingAvailable() — because they are
    //     the expensive half of this list and, on a datacenter IP, the half
    //     that always misses.
    const methods = [
      () => this.tryYtDlpTikTok(url),
      ...(htmlScrapingAvailable()
        ? [
            () => this.trySnaptikMethod(url),
            () => this.trySSSMethod(url),
            () => this.tryDirectTikTokScraping(url),
          ]
        : []),
    ]

    for (const method of methods) {
      try {
        const result = await method()
        if (result) {
          console.log('Successfully downloaded video using method')
          return result
        }
      } catch (error) {
        console.warn('Method failed, trying next...', error)
        continue
      }
    }

    throw new Error(
      'All download methods failed. TikTok might be blocking requests or the video is private.',
    )
  }

  /**
   * yt-dlp TikTok path. Used as the reliable fallback when the public scraper
   * services fail. Probes availability/reachability via a quick info fetch
   * (which also yields title/author/thumbnail/duration); on success returns a
   * result whose video/audio point at the same-origin /api/tiktok streaming
   * endpoint, which lets yt-dlp do the actual fetch server-side (TikTok's CDN
   * URLs are signed against the extracting session and can't be replayed by the
   * plain media proxy). Returns null when yt-dlp is unavailable (e.g. Vercel) or
   * the video can't be reached here, so the next method gets a turn.
   */
  private async tryYtDlpTikTok(url: string): Promise<VideoData | null> {
    const info = await ytdlpInfo(url)
    if (!info) return null

    const encoded = encodeURIComponent(url)
    return {
      id: parseVideoId(url) || Date.now().toString(),
      title: info.title || 'TikTok Video',
      url,
      thumbnail: info.thumbnail || '',
      duration: Math.round(info.duration || 0),
      author: info.uploader || 'Unknown',
      description: info.title || '',
      downloadUrl: `/api/tiktok?url=${encoded}&kind=video`,
      musicUrl: `/api/tiktok?url=${encoded}&kind=audio`,
      isPhotoCarousel: false,
    }
  }

  /**
   * TikTok via Cobalt — the reliable path on datacenter hosts (Vercel). Cobalt
   * tunnels the media through its own server, so the returned URL plays from any
   * IP, unlike TikTok's signed CDN URLs (which 403 when re-fetched elsewhere).
   * The tunnel serves browser-friendly H.264 with range support, so it drives
   * both the preview and the download through the existing /api/video proxy.
   *
   * Cobalt's metadata is sparse (it only names the file `tiktok_<author>_<id>`),
   * so title/author/thumbnail are enriched from TikTok's public oembed endpoint.
   */
  private async tryTikTokCobalt(url: string): Promise<VideoData | null> {
    const result = await this.tryCobaltInstances(url)
    if (!result) return null

    // Recover author + numeric id from Cobalt's `tiktok_<author>_<id>` filename
    // (the title is that filename minus extension). Falls back to the URL.
    const fnMatch = result.title.match(/^tiktok_(.+)_(\d+)$/)
    const fnAuthor = fnMatch?.[1]
    const videoId = fnMatch?.[2] || parseVideoId(url) || result.id
    result.id = videoId

    const canonical = fnAuthor
      ? `https://www.tiktok.com/@${fnAuthor}/video/${videoId}`
      : url
    const meta = await this.fetchTikTokMeta(canonical)

    if (meta.title) result.title = meta.title
    else if (fnAuthor) result.title = `TikTok by @${fnAuthor}`
    if (meta.author) result.author = meta.author
    else if (fnAuthor) result.author = fnAuthor
    if (meta.thumbnail) result.thumbnail = meta.thumbnail

    return result
  }

  /**
   * TikTok title/author/thumbnail from the public oembed endpoint (no login or
   * key required). Best-effort — returns an empty object on any failure so the
   * caller keeps whatever metadata it already had.
   */
  private async fetchTikTokMeta(
    url: string,
  ): Promise<{ title?: string; author?: string; thumbnail?: string }> {
    try {
      const response = await http.get(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
        {
          headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
          timeout: 12000,
        },
      )
      return {
        title: response.data?.title,
        author: response.data?.author_name,
        thumbnail: response.data?.thumbnail_url,
      }
    } catch {
      return {}
    }
  }

  // Try every cobalt instance in order.
  private async tryCobaltInstances(url: string): Promise<VideoData | null> {
    const errors: string[] = []
    // A self-hosted resolver that self-registers its (possibly rotating) URL is
    // discovered at request time and appended after the static list — so it's
    // reached even when its public URL has changed and no env was updated. Deduped
    // against the configured instances so a stable URL isn't tried twice.
    const discovered = await discoverResolverBase()
    const configured = new Set(
      this.cobaltInstances.map((i) => i.replace(/\/$/, '')),
    )
    const instances =
      discovered && !configured.has(discovered.replace(/\/$/, ''))
        ? [...this.cobaltInstances, discovered]
        : this.cobaltInstances
    // Prefer an instance that *tunnels* over one that hands back a raw CDN
    // redirect. Both are usable, but only a tunnel streams from any IP with
    // Content-Disposition set, which lets the browser pull the file straight
    // from the instance — a redirect has to be re-streamed through our own
    // proxy for referer/content-type, putting every byte of the download on our
    // host. So a redirect is held as a fallback and the remaining instances are
    // still tried; it is only used if nothing tunnels.
    // Only a raw-CDN redirect is deferred, identified by `tunnel === false`.
    // That flag is set explicitly on the tunnel/redirect branch alone, so a
    // `picker` result (photo carousel) leaves it undefined and is returned
    // immediately like any other terminal answer.
    let redirectFallback: VideoData | null = null
    for (const instance of instances) {
      try {
        const result = await this.tryCobaltInstance(instance, url)
        if (!result) continue
        if (result.tunnel === false) {
          redirectFallback ??= result
          continue
        }
        return result
      } catch (e) {
        errors.push(`${instance}: ${e}`)
      }
    }
    if (redirectFallback) return redirectFallback
    console.warn('All cobalt instances failed:', errors)
    return null
  }

  private async tryCobaltInstance(
    baseUrl: string,
    url: string,
  ): Promise<VideoData | null> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }
    // When the (self-hosted) instance requires auth, forward the key so only
    // this app can use it. No-op for the open public instance.
    if (process.env.COBALT_API_KEY) {
      headers.Authorization = `Api-Key ${process.env.COBALT_API_KEY}`
    }

    // Audio mode asks Cobalt for an audio-only MP3 tunnel (the "→ MP3" flow);
    // otherwise a normal video tunnel at the preferred quality.
    const body =
      this.mode === 'audio'
        ? {
            url,
            downloadMode: 'audio',
            audioFormat: 'mp3',
            filenameStyle: 'basic',
          }
        : {
            url,
            videoQuality: this.videoQuality === 'sd' ? '480' : 'max',
            filenameStyle: 'basic',
          }

    // Retry transient failures (429 / 5xx / cold-start timeouts) before giving
    // up on this instance and moving to the next.
    const response = await withRetry(
      () => http.post(baseUrl, body, { headers, timeout: 12000 }),
      { retries: 2, isRetryable: isTransientError },
    )

    const data = response.data

    if (data.status === 'error') {
      throw new Error(
        `Cobalt error: ${data.error?.code ?? JSON.stringify(data.error)}`,
      )
    }

    if (data.status === 'tunnel' || data.status === 'redirect') {
      const isAudio = this.mode === 'audio'
      return {
        id: Date.now().toString(),
        title: data.filename?.replace(/\.[^.]+$/, '') || 'Social Media Video',
        url,
        thumbnail: '',
        duration: 0,
        author: 'Unknown',
        description: '',
        // In audio mode the tunnel is an MP3 — hand it back as the music track
        // (no video), so the API serves it through the audio path.
        downloadUrl: isAudio ? '' : data.url,
        ...(isAudio ? { musicUrl: data.url } : {}),
        // A tunnel streams from any IP with Content-Disposition: attachment, so
        // the browser can download it directly (bypassing our proxy). A
        // `redirect` is a raw CDN URL — do NOT mark it direct-safe.
        tunnel: data.status === 'tunnel',
      }
    }

    if (data.status === 'picker') {
      const items = data.picker as Array<{
        type: string
        url: string
        thumb?: string
      }>
      const videos = items?.filter((p) => p.type === 'video') || []
      const photos = items?.filter((p) => p.type === 'photo') || []
      const downloadUrl = videos[0]?.url || items?.[0]?.url || ''

      const images: ImageData[] = photos.map(
        (img: { url: string; thumb?: string }, i: number) => ({
          id: `img_${i}`,
          url: img.url,
          thumbnail: img.thumb || img.url,
        }),
      )

      return {
        id: Date.now().toString(),
        title: data.filename?.replace(/\.[^.]+$/, '') || 'Social Media Content',
        url,
        thumbnail: items?.[0]?.thumb || '',
        duration: 0,
        author: 'Unknown',
        description: '',
        downloadUrl,
        images: images.length > 0 ? images : undefined,
        isPhotoCarousel: images.length > 0,
      }
    }

    console.warn('Cobalt unexpected status:', data.status, data)
    return null
  }

  // Twitter/X: use vxtwitter API (open source, no auth required)
  private async tryVxTwitterMethod(url: string): Promise<VideoData | null> {
    // Extract username and tweet ID from URL
    const match = url.match(/(?:twitter|x)\.com\/([^/]+)\/status\/(\d+)/)
    if (!match) throw new Error('Could not parse Twitter URL')
    const [, username, tweetId] = match

    const response = await http.get(
      `https://api.vxtwitter.com/${username}/status/${tweetId}`,
      {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        timeout: 20000,
      },
    )

    const data = response.data

    // Find best video media
    const mediaItems = (data.media_extended ?? data.media ?? []) as Array<{
      type: string
      url: string
      thumbnail_url?: string
      altText?: string
    }>

    const videoItem = mediaItems.find(
      (m) => m.type === 'video' || m.type === 'gif',
    )
    const photoItems = mediaItems.filter((m) => m.type === 'image')

    if (!videoItem && photoItems.length === 0) {
      throw new Error('No downloadable media found in tweet')
    }

    const downloadUrl = videoItem?.url || ''
    const images: ImageData[] = photoItems.map((img, i) => ({
      id: `tw_img_${i}`,
      url: img.url,
      thumbnail: img.thumbnail_url || img.url,
    }))

    return {
      id: tweetId,
      title: data.text
        ? data.text.slice(0, 80).replace(/\s+/g, ' ')
        : `Tweet by @${username}`,
      url,
      thumbnail: videoItem?.thumbnail_url || photoItems[0]?.url || '',
      duration: 0,
      author: data.user_name || username,
      description: data.text || '',
      downloadUrl,
      images: images.length > 0 ? images : undefined,
      isPhotoCarousel: images.length > 0 && !videoItem,
    }
  }

  private async trySnaptikMethod(url: string): Promise<VideoData | null> {
    try {
      // Step 1: Get the main page to extract necessary tokens
      await http.get('https://snaptik.app/', {
        headers: { 'User-Agent': this.userAgent },
      })

      // Step 2: Submit the URL
      const formData = new URLSearchParams()
      formData.append('url', url)

      const response = await http.post(
        'https://snaptik.app/abc2.php',
        formData,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': this.userAgent,
            Referer: 'https://snaptik.app/',
            Origin: 'https://snaptik.app',
          },
          timeout: 30000,
        },
      )

      if (response.data && typeof response.data === 'string') {
        // Look for download links
        const downloadLinks = mp4Hrefs(response.data)

        if (downloadLinks.length > 0) {
          const videoId = parseVideoId(url) || 'unknown'
          return {
            id: videoId,
            title: 'TikTok Video (Snaptik)',
            url: url,
            thumbnail: '',
            duration: 0,
            author: 'Unknown',
            description: 'Downloaded via Snaptik',
            downloadUrl: downloadLinks[0], // Use the first (usually highest quality) link
          }
        }
      }
    } catch {
      throw new Error('Snaptik method failed')
    }
    return null
  }

  private async trySSSMethod(url: string): Promise<VideoData | null> {
    try {
      const response = await http.post(
        'https://ssstik.io/abc',
        {
          id: url,
          locale: 'en',
          tt: 'RFBiZ3Bi',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': this.userAgent,
            Accept: 'application/json, text/plain, */*',
            Origin: 'https://ssstik.io',
            Referer: 'https://ssstik.io/en',
          },
          timeout: 30000,
        },
      )

      if (response.data && response.data.url) {
        const videoId = parseVideoId(url) || 'unknown'
        return {
          id: videoId,
          title: response.data.title || 'TikTok Video (SSSt)',
          url: url,
          thumbnail: response.data.cover || '',
          duration: response.data.duration || 0,
          author: response.data.author || 'Unknown',
          description: response.data.title || 'Downloaded via SSSTik',
          downloadUrl: response.data.url,
        }
      }
    } catch {
      throw new Error('SSSTik method failed')
    }
    return null
  }

  private async tryTikwmMethod(url: string): Promise<VideoData | null> {
    try {
      const response = await http.post(
        'https://www.tikwm.com/api/',
        {
          url: url,
          count: 12,
          cursor: 0,
          // NO `web: 1`. That flag switches every URL in the response over to
          // tikwm's own host: the cover becomes a hotlink-gated path that 403s
          // for everyone (killing the preview poster) and `origin_cover` /
          // `ai_dynamic_cover` come back empty, so there is no absolute cover
          // left to fall back to. Without the flag we get the signed tiktokcdn
          // originals, which the browser loads directly (200) and which our
          // /api/video proxy can still range-fetch — verified against the
          // deployed Worker: 206 with a correct Content-Range.
          hd: this.videoQuality === 'sd' ? 0 : 1,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': this.userAgent,
            Accept: 'application/json, text/plain, */*',
            Origin: 'https://www.tikwm.com',
            Referer: 'https://www.tikwm.com/',
          },
          timeout: 30000,
        },
      )

      if (response.data && response.data.code === 0 && response.data.data) {
        const data = response.data.data
        const videoId = parseVideoId(url) || 'unknown'

        const thumbnail = pickTikwmCover(data)

        // Check if this is a photo carousel (slideshow)
        const isPhotoCarousel =
          data.images && Array.isArray(data.images) && data.images.length > 0

        let images: ImageData[] = []
        if (isPhotoCarousel) {
          images = data.images.map((img: string, index: number) => ({
            id: `${videoId}_img_${index}`,
            url: img,
            thumbnail: img,
          }))
        }

        let downloadUrl: string | undefined

        // Photo carousels: skip tikwm's `play` URL — for slideshow posts it
        // points to an audio-only MP4 with no image frames. The /api/slideshow
        // route renders a proper images+music MP4 on demand instead.
        if (!isPhotoCarousel) {
          const hdplayUrl = tikwmAbsoluteUrl(data.hdplay)
          const playUrl = tikwmAbsoluteUrl(data.play)
          const wmplayUrl = tikwmAbsoluteUrl(data.wmplay)

          if (hdplayUrl) {
            // Verify the HD URL uses a browser-renderable codec.
            // TikTok sometimes encodes with bvc2 (ByteDance proprietary) which no browser supports,
            // causing the video element to render audio-only ("shows as mp3").
            const hdCompatible = await this.checkVideoCodecCompatible(hdplayUrl)
            if (hdCompatible) {
              downloadUrl = hdplayUrl
            } else {
              console.log(
                `[tikwm] hdplay uses unsupported codec for ${videoId} — falling back to play (H.264)`,
              )
              downloadUrl = playUrl || wmplayUrl || hdplayUrl
            }
          } else {
            downloadUrl = playUrl || wmplayUrl
          }
        }

        // Slideshow soundtrack (TikTok photo carousels always have a music track)
        const musicUrl =
          tikwmAbsoluteUrl(data.music_info?.play) || tikwmAbsoluteUrl(data.music)
        const musicTitle = data.music_info?.title
        const musicAuthor = data.music_info?.author

        return {
          id: videoId,
          title: data.title || 'TikTok Video',
          url: url,
          thumbnail,
          duration: data.duration || 0,
          author: data.author?.nickname || 'Unknown',
          description: data.title || '',
          downloadUrl: downloadUrl ?? '',
          images,
          isPhotoCarousel,
          musicUrl,
          musicTitle,
          musicAuthor,
        }
      }
    } catch (e) {
      throw new Error(
        `Tikwm method failed: ${e instanceof Error ? e.message : e}`,
      )
    }
    return null
  }

  private async tryDirectTikTokScraping(
    url: string,
  ): Promise<VideoData | null> {
    try {
      // First resolve any shortened URLs
      const resolvedUrl = await this.resolveUrl(url)

      const response = await http.get(resolvedUrl, {
        headers: {
          'User-Agent': this.userAgent,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          Connection: 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 30000,
      })

      // Pull the state blob TikTok inlines into the page. Only the one script
      // carrying the marker is materialised — the page ships megabytes of
      // markup, so building a DOM to find it would cost orders of magnitude
      // more CPU than locating the marker directly.
      const content = scriptContaining(response.data, 'webapp.video-detail')
      if (content) {
        // Extract video URLs from the script content
        const videoUrlMatch = content.match(/"playAddr":"([^"]+)"/)
        const downloadUrlMatch = content.match(/"downloadAddr":"([^"]+)"/)

        if (videoUrlMatch || downloadUrlMatch) {
          const videoId = parseVideoId(url) || 'unknown'
          const downloadUrl = (
            downloadUrlMatch?.[1] ||
            videoUrlMatch?.[1] ||
            ''
          ).replace(/\\u002F/g, '/')

          return {
            id: videoId,
            title: 'TikTok Video (Direct)',
            url: url,
            thumbnail: '',
            duration: 0,
            author: 'Unknown',
            description: 'Downloaded via direct scraping',
            downloadUrl: downloadUrl,
          }
        }
      }
    } catch {
      throw new Error('Direct scraping method failed')
    }
    return null
  }

  // Follow redirects on Instagram share/short links to the canonical post URL.
  private async resolveInstagramUrl(url: string): Promise<string> {
    return this.resolveRedirect(url)
  }

  /**
   * Generic redirect follower — resolves short/share links (fb.watch,
   * facebook.com/share/…, instagram share links) to their canonical URL.
   *
   * A Meta share link is asked for as a link crawler, and with HEAD. Measured
   * 2026-08-14 against a live reel share link — the shape the mobile app's
   * "Copy link" produces, so most of what visitors paste:
   *
   *   browser user agent  -> 400, and the link stays a /share/ URL, which the
   *                          video plugin answers with an error page
   *   crawler user agent  -> 302 to https://www.facebook.com/reel/<id>, which
   *                          the plugin answers with hd_src + sd_src
   *
   * HEAD because only the final URL is wanted and the share page is half a
   * megabyte of markup that nothing here reads.
   */
  private async resolveRedirect(url: string): Promise<string> {
    const share = isFacebookShortLink(url)
    try {
      const send = share ? http.head : http.get
      const response = await send(url, {
        maxRedirects: 5,
        validateStatus: () => true,
        headers: this.facebookHeaders(url, {
          'User-Agent': share ? LINK_CRAWLER_AGENT : this.userAgent,
        }),
        timeout: 12000,
      })
      return response.request?.res?.responseUrl || url
    } catch {
      return url
    }
  }

  /**
   * yt-dlp YouTube path. Probes availability via a quick info fetch (which also
   * confirms the video is reachable from here); on success returns a result
   * whose video/audio point at the same-origin /api/youtube streaming endpoint
   * and whose embedUrl drives a lightweight preview (so previewing doesn't
   * trigger a full download). Returns null to fall back to the public
   * extractors when yt-dlp is unavailable or blocked.
   */
  private async tryYtDlpYouTube(
    videoId: string,
    canonical: string,
    meta: { title?: string; author?: string; thumbnail?: string },
  ): Promise<VideoData | null> {
    const info = await ytdlpInfo(canonical)
    if (!info) return null
    return {
      id: videoId,
      title: meta.title || info.title || 'YouTube Video',
      url: canonical,
      thumbnail: meta.thumbnail || info.thumbnail || '',
      duration: Math.round(info.duration || 0),
      author: meta.author || info.uploader || 'YouTube',
      description: '',
      downloadUrl: `/api/youtube?id=${videoId}&kind=video`,
      musicUrl: `/api/youtube?id=${videoId}&kind=audio`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    }
  }

  /**
   * Fetch YouTube title/author/thumbnail from the public oEmbed endpoint.
   * No login or API key required. Falls back to the deterministic ytimg
   * thumbnail (always available for public videos) when oEmbed is unavailable.
   */
  private async fetchYouTubeMeta(
    videoId: string | null,
    canonicalUrl: string,
  ): Promise<{ title?: string; author?: string; thumbnail?: string }> {
    const fallbackThumb = videoId
      ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      : ''
    try {
      const response = await http.get(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(
          canonicalUrl,
        )}&format=json`,
        {
          headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
          timeout: 12000,
        },
      )
      const data = response.data
      return {
        title: data?.title,
        author: data?.author_name,
        thumbnail: data?.thumbnail_url || fallbackThumb,
      }
    } catch {
      return { thumbnail: fallbackThumb }
    }
  }

  /**
   * Facebook's public video plugin embed. It is designed to be embedded on
   * third-party sites, so it renders the stream config for any public video
   * without a login wall. We parse the same `*_url` keys the watch page ships.
   */
  private async tryFacebookPlugin(
    resolvedUrl: string,
    originalUrl: string,
  ): Promise<VideoData | null> {
    const embedUrl = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(
      resolvedUrl,
    )}`
    const response = await http.get(embedUrl, {
      headers: this.facebookHeaders(embedUrl, {
        'User-Agent': this.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      }),
      timeout: 20000,
    })
    const html = typeof response.data === 'string' ? response.data : ''
    return this.parseFacebookHtml(html, originalUrl)
  }

  /**
   * Direct scrape of the public Facebook watch/reel page. The page embeds the
   * video config JSON containing the HD/SD source URLs.
   */
  private async tryFacebookScrape(
    resolvedUrl: string,
    originalUrl: string,
  ): Promise<VideoData | null> {
    const response = await http.get(resolvedUrl, {
      headers: this.facebookHeaders(resolvedUrl, {
        'User-Agent': this.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
      }),
      timeout: 20000,
    })
    const html = typeof response.data === 'string' ? response.data : ''
    return this.parseFacebookHtml(html, originalUrl)
  }

  /**
   * Pull a playable video URL + metadata out of Facebook page/plugin HTML.
   * Facebook ships several source keys; we prefer HD, then SD, then the
   * generic playable_url. Values are JSON-escaped (%, \/, \uXXXX), so we
   * decode them before use.
   */
  private parseFacebookHtml(
    html: string,
    originalUrl: string,
  ): VideoData | null {
    if (!html) return null

    const pickUrl = (...keys: string[]): string => {
      for (const key of keys) {
        // Match "key":"<value>" capturing up to the next unescaped quote.
        const re = new RegExp(`"${key}":"(.*?)"(?:,|\\})`)
        const m = html.match(re)
        if (m && m[1]) {
          const decoded = this.decodeFacebookString(m[1])
          if (decoded.startsWith('http')) return decoded
        }
      }
      return ''
    }

    const downloadUrl = pickUrl(
      'browser_native_hd_url',
      'playable_url_quality_hd',
      'hd_src_no_ratelimit',
      'hd_src',
      'browser_native_sd_url',
      'playable_url',
      'sd_src_no_ratelimit',
      'sd_src',
    )

    if (!downloadUrl) return null

    // The plugin page carries no og tags at all and titles itself "Facebook",
    // which is worse than the generic name — so a bare host name is discarded
    // rather than shown as the video's title.
    const pageName = pageTitle(html) || ''
    const ogTitle =
      metaContent(html, 'og:title') ||
      (/^facebook$/i.test(pageName.trim()) ? '' : pageName)
    const ogDescription = metaContent(html, 'og:description') || ''

    const title =
      (ogTitle || ogDescription || 'Facebook Video')
        .slice(0, 100)
        .replace(/\s+/g, ' ')
        .trim() || 'Facebook Video'

    return {
      id: parseVideoId(originalUrl) || Date.now().toString(),
      title,
      url: originalUrl,
      thumbnail: facebookPoster(html),
      duration: 0,
      author: 'Facebook',
      description: ogDescription,
      downloadUrl,
    }
  }

  // Decode the JSON-string escaping Facebook ships in its embedded config.
  private decodeFacebookString(raw: string): string {
    return raw
      .replace(/\\u0025/g, '%')
      .replace(/\\u002F/gi, '/')
      .replace(/\\\//g, '/')
      .replace(/\\u0026/gi, '&')
      .replace(/\\u003D/gi, '=')
      .replace(/\\u003F/gi, '?')
      .replace(/\\u([\dA-Fa-f]{4})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16)),
      )
      .replace(/\\/g, '')
  }

  /**
   * Harvest the anti-CSRF tokens (csrftoken + lsd) the GraphQL endpoint
   * requires, from a homepage GET. When IG_SESSIONID is configured the GET is
   * authenticated, so the returned csrftoken is bound to that session (required
   * for login-gated posts). Cached briefly to avoid an extra round-trip on
   * every request. Returns empty strings on failure — the caller still tries
   * the request (it simply won't succeed for gated posts).
   */
  private async getInstagramTokens(): Promise<{ csrf: string; lsd: string }> {
    const now = Date.now()
    if (
      igTokenCache &&
      igTokenCache.sessionKey === this.instagramSessionId &&
      igTokenCache.expires > now
    ) {
      return { csrf: igTokenCache.csrf, lsd: igTokenCache.lsd }
    }

    let csrf = ''
    let lsd = ''
    try {
      const response = await http.get('https://www.instagram.com/', {
        headers: {
          'User-Agent': this.userAgent,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          // The full set here too, not just the session. This GET is the first
          // request of every credentialed resolve, so a bare `sessionid` on it
          // would be the anomaly the rest of the header work exists to avoid.
          ...(this.instagramCookie ? { Cookie: this.instagramCookie } : {}),
        },
        timeout: 12000,
        validateStatus: () => true,
      })
      const html: string =
        typeof response.data === 'string' ? response.data : ''
      // csrftoken is set via Set-Cookie; fall back to the inline copy in the
      // page's shared-data blob.
      const setCookie = (response.headers['set-cookie'] as string[]) || []
      for (const cookie of setCookie) {
        const m = /csrftoken=([^;]+)/.exec(cookie)
        if (m) {
          csrf = m[1]
          break
        }
      }
      if (!csrf) csrf = html.match(/"csrf_token":"([^"]+)"/)?.[1] || ''
      lsd =
        html.match(/"LSD",\[\],\{"token":"([^"]+)"/)?.[1] ||
        html.match(/name="lsd"\s+value="([^"]+)"/)?.[1] ||
        ''
    } catch {
      // network error — return whatever we have (likely empty); the GraphQL
      // call will fail and the caller falls through to the next method.
    }

    igTokenCache = {
      csrf,
      lsd,
      sessionKey: this.instagramSessionId,
      expires: now + 5 * 60 * 1000,
    }
    return { csrf, lsd }
  }

  /**
   * The credentialed Instagram extractor: the private media API the logged-in
   * web client itself calls, keyed on the numeric media id the shortcode
   * encodes (`instagramMediaId`, no lookup request needed).
   *
   * This exists because the GraphQL extractor below stopped resolving posts —
   * Instagram now answers its `doc_id` with `{"errors":[{"message":"execution
   * error"}],"data":null}` whether or not a session is attached, which left a
   * credentialed resolve with nothing the anonymous path did not already have.
   * That is what made the session look broken: it was valid, and every path
   * that could have used it was dead.
   *
   * Session-only by design, and not merely as a policy: without cookies the
   * same endpoint answers 200 with a ~600 KB login wall carrying no media, so
   * for an anonymous resolve this is a large download that cannot succeed.
   * Returning null up front keeps it off the free path entirely.
   */
  /**
   * One item from `/api/v1/media/<id>/info/`, the endpoint Instagram's own web
   * client calls. Posts, reels and story items all live behind it and all come
   * back in the same `items[0]` shape, which is why both the post extractor and
   * the story extractor route through here.
   *
   * A rejected session answers with HTML (or JSON with no items); both become
   * null so the caller falls through to its next method — the graceful
   * degradation the credential gate promises.
   */
  private async instagramMediaItem(
    mediaId: string,
    headers: Record<string, string>,
  ): Promise<IgStoryItem | null> {
    const response = await http.get(
      `https://www.instagram.com/api/v1/media/${encodeURIComponent(mediaId)}/info/`,
      { headers, timeout: 20000, validateStatus: () => true },
    )
    const item = response.data?.items?.[0] as IgStoryItem | undefined
    if (!item) logInstagramRefusal('media/info', mediaId, response)
    return item ?? null
  }

  private async tryInstagramMediaInfo(
    shortcode: string,
    originalUrl: string,
  ): Promise<VideoData | null> {
    if (!this.instagramSessionId) return null
    const mediaId = instagramMediaId(shortcode)
    if (!mediaId) return null

    const { csrf } = await this.getInstagramTokens()
    const item = await this.instagramMediaItem(mediaId, {
      'User-Agent': this.userAgent,
      'X-IG-App-ID': this.instagramAppId,
      Accept: '*/*',
      Referer: `https://www.instagram.com/p/${shortcode}/`,
      Cookie: this.instagramCookieWith(csrf),
    })
    if (!item) return null

    const parsed = this.parseInstagramMedia(
      igInfoToShortcodeMedia(item),
      shortcode,
      originalUrl,
    )
    if (!parsed.downloadUrl && (parsed.images?.length ?? 0) === 0) return null
    return parsed
  }

  // REMOVED 2026-08-15: the web GraphQL extractor (`/graphql/query/` with
  // doc_id 8845758582119845). Instagram retired the persisted query — the
  // endpoint answers every request with
  //   {"errors":[{"message":"execution error","severity":"CRITICAL"}],"data":null}
  // and it is the *query id* that is refused, not the post: it fails identically
  // for a live post, a deleted one, anonymously, and with a valid session. A
  // doc_id harvested fresh from Instagram's own bundle that same day
  // (PolarisPostRootQuery_instagramRelayOperation = 28067070969622724) is refused
  // the same way for a logged-out caller, so re-pointing it buys nothing either.
  // It only cost two round-trips per Instagram resolve. See
  // lessons/2026-08-15-instagram-logged-out-wall.md.

  /**
   * Primary Instagram extractor: the public embed page. It is designed to be
   * publicly embeddable, so it serves a full `shortcode_media` graph (photos,
   * reels/videos and multi-item carousels) without a login. The browser-like
   * `Sec-Fetch-*` headers matter — Instagram returns 403 without them.
   *
   * First parses the rich JSON the page ships (handles carousels); otherwise
   * falls back to scraping the rendered single image/video element.
   */
  private async tryInstagramEmbed(
    shortcode: string,
    originalUrl: string,
  ): Promise<VideoData | null> {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`
    const response = await http.get(embedUrl, {
      headers: {
        'User-Agent': this.userAgent,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
      timeout: 20000,
    })

    const html = typeof response.data === 'string' ? response.data : ''
    if (!html) return null

    // 1) Best case: the embed page ships the full shortcode_media JSON.
    const media = this.extractEmbeddedShortcodeMedia(html)
    if (media) {
      const parsed = this.parseInstagramMedia(media, shortcode, originalUrl)
      // The embed JSON marks a reel/video as is_video=true but ships NO video_url
      // (the clip loads via client JS) — only a poster display_url. parseInstagram-
      // Media refuses to emit that poster as a photo, so `parsed` comes back with
      // no downloadUrl. Defer to the GraphQL extractor (which returns the real
      // video_url) instead of returning an empty result here — and crucially, do
      // NOT fall through to the scrape fallback below, which would re-emit the
      // poster as a single photo. This is the case that misrendered reels.
      if (this.mediaContainsVideo(media) && !parsed.downloadUrl) return null
      if (parsed.downloadUrl || (parsed.images?.length ?? 0) > 0) return parsed
    }

    // 2) Fallback: scrape the rendered embed for a single image / video.
    const imgSrc = firstTagAttr(html, 'img', 'src', 'EmbeddedMediaImage')
    const videoSrc = firstTagAttr(html, 'video', 'src')
    const username =
      textOfFirstWithClass(html, 'UsernameText') ||
      textOfFirstWithClass(html, 'Username') ||
      'Unknown'

    if (!imgSrc && !videoSrc) return null

    // CRITICAL: Instagram video embeds ship NO usable <video src> (the clip is
    // loaded by client JS), only the poster frame as img.EmbeddedMediaImage. So
    // when the rich JSON above didn't parse, blindly returning that poster would
    // misrender a reel as a single photo. If the page carries any video marker,
    // bail to null so the caller falls through to the GraphQL extractor (which
    // returns the real video_url) instead of emitting a bogus image.
    const looksLikeVideo =
      !videoSrc &&
      (/"is_video"\s*:\s*(true|1)/.test(html) ||
        /"video_url"\s*:\s*"/.test(html) || // a real URL value, not "video_url":null
        html.includes('video_view_count') || // video-only metadata fields
        html.includes('video_duration') ||
        hasTag(html, 'video'))
    if (looksLikeVideo) return null

    return {
      id: shortcode,
      title: `Instagram post by @${username}`,
      url: originalUrl,
      thumbnail: imgSrc || '',
      duration: 0,
      author: username,
      description: '',
      downloadUrl: videoSrc || '',
      images:
        !videoSrc && imgSrc
          ? [{ id: `${shortcode}_0`, url: imgSrc, thumbnail: imgSrc }]
          : undefined,
      isPhotoCarousel: false,
    }
  }

  // Map an Instagram `shortcode_media` object onto our shared VideoData shape.
  private parseInstagramMedia(
    media: IgShortcodeMedia,
    shortcode: string,
    originalUrl: string,
  ): VideoData {
    const username = media.owner?.username || 'Unknown'
    const caption =
      media.edge_media_to_caption?.edges?.[0]?.node?.text?.trim() || ''
    const title = caption
      ? caption.slice(0, 80).replace(/\s+/g, ' ').trim()
      : `Instagram post by @${username}`

    const images: ImageData[] = []
    let downloadUrl = ''

    const children = media.edge_sidecar_to_children?.edges
    if (Array.isArray(children) && children.length > 0) {
      // Carousel: collect every photo; the first video becomes the primary clip.
      // A video child is added ONLY when it carries a real video_url — never via
      // its poster display_url (see the single-media note below).
      children.forEach((edge, i) => {
        const node = edge?.node
        if (!node) return
        if (node.is_video && node.video_url) {
          if (!downloadUrl) downloadUrl = node.video_url
        } else if (!node.is_video && node.display_url) {
          images.push({
            id: `${shortcode}_${i}`,
            url: node.display_url,
            thumbnail: node.display_resources?.[0]?.src || node.display_url,
          })
        }
      })
    } else if (media.is_video && media.video_url) {
      downloadUrl = media.video_url
    } else if (!media.is_video && media.display_url) {
      // Photo only. A video whose video_url is absent (the embed JSON ships
      // is_video=true with just a poster display_url) deliberately yields
      // NOTHING here — passing its poster off as a photo is exactly what
      // misrendered reels as single images. The caller detects the empty
      // result and defers to the GraphQL extractor (which returns video_url).
      images.push({
        id: `${shortcode}_0`,
        url: media.display_url,
        thumbnail: media.display_url,
      })
    }

    const thumbnail =
      media.display_url || media.thumbnail_src || images[0]?.thumbnail || ''

    return {
      id: shortcode,
      title,
      url: originalUrl,
      thumbnail,
      duration: Math.round(media.video_duration || 0),
      author: username,
      description: caption,
      downloadUrl,
      images: images.length > 0 ? images : undefined,
      isPhotoCarousel: false,
    }
  }

  // True when a `shortcode_media` graph is (or contains) a video. Used by the
  // embed extractor to decide whether a parse that produced no playable video
  // URL should defer to a richer extractor (GraphQL) rather than be mistaken for
  // a photo — the embed ships is_video=true with no video_url for reels/videos.
  private mediaContainsVideo(media: IgShortcodeMedia): boolean {
    if (media.is_video) return true
    const children = media.edge_sidecar_to_children?.edges
    return (
      Array.isArray(children) && children.some((edge) => Boolean(edge?.node?.is_video))
    )
  }

  // Pull the embedded `shortcode_media` JSON out of an embed page's HTML.
  private extractEmbeddedShortcodeMedia(
    html: string,
  ): IgShortcodeMedia | null {
    // Preferred path: the embed ships `"contextJSON":"<json-encoded-json>"`.
    // The value is a JSON-encoded string whose contents are themselves JSON,
    // so a double JSON.parse decodes every escape (quotes, slashes, \uXXXX)
    // correctly — far more robust than hand-rolled unescaping.
    const fromContext = this.extractContextJson(html)
    if (fromContext) return fromContext

    // Fallback: balance-match the raw `shortcode_media` object. Handles the
    // raw (already-unescaped) variant some payloads ship.
    const key = '"shortcode_media":'
    const keyIdx = html.indexOf(key)
    if (keyIdx !== -1) {
      const braceStart = html.indexOf('{', keyIdx + key.length)
      if (braceStart !== -1) {
        const json = this.extractBalancedJson(html, braceStart)
        if (json) {
          try {
            return JSON.parse(json) as IgShortcodeMedia
          } catch {
            // fall through
          }
        }
      }
    }
    return null
  }

  // Decode the embed page's `contextJSON` blobs and return the first that
  // contains a shortcode_media. The page can ship several contextJSON strings
  // (e.g. a NavigationMetrics telemetry one), so we scan all of them rather
  // than assuming the media blob comes first.
  private extractContextJson(html: string): IgShortcodeMedia | null {
    const key = '"contextJSON":'
    let searchFrom = 0
    while (true) {
      const idx = html.indexOf(key, searchFrom)
      if (idx === -1) break
      const quoteStart = html.indexOf('"', idx + key.length)
      if (quoteStart === -1) break

      // Read the JSON string token (respecting backslash escapes).
      let i = quoteStart + 1
      let escaped = false
      for (; i < html.length; i++) {
        const ch = html[i]
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') break
      }
      searchFrom = i + 1

      const token = html.slice(quoteStart, i + 1)
      try {
        const inner = JSON.parse(token) as string // first decode → JSON text
        const obj = JSON.parse(inner) as {
          gql_data?: { shortcode_media?: IgShortcodeMedia }
          context?: { media?: IgShortcodeMedia }
        }
        const media = obj?.gql_data?.shortcode_media || obj?.context?.media
        if (media) return media
      } catch {
        // not the media blob — try the next contextJSON occurrence
      }
    }
    return null
  }

  // Return the balanced `{...}` substring starting at `start`, respecting
  // nested braces and string literals.
  private extractBalancedJson(text: string, start: number): string | null {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) return text.slice(start, i + 1)
      }
    }
    return null
  }

  private async resolveUrl(url: string): Promise<string> {
    try {
      if (
        url.includes('vm.tiktok.com') ||
        url.includes('vt.tiktok.com') ||
        url.includes('/t/')
      ) {
        const response = await http.head(url, {
          maxRedirects: 5,
          validateStatus: () => true,
          headers: { 'User-Agent': this.userAgent },
          timeout: 10000,
        })
        return response.request.res.responseUrl || url
      }
    } catch {
      // If resolve fails, return original URL
    }
    return url
  }
}
