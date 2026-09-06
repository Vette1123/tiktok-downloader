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
import { validateUrl, detectPlatform, parseYouTubeId } from './validator'
import { getCached, setCached } from './responseCache'
import { worthCaching } from './cacheWorthy'
import { readEdgeCache, writeEdgeCache, type WaitUntilContext } from './edgeCache'
import { slugify } from './filename'
import { nativeMediaAvailable, nativeMediaUnavailable } from './nativeMedia'
import { MEDIA_PROXY_HANDLERS } from './mediaProxy'
import { extractPlaylistItems, PLAYLIST_SCAN_BYTES } from './playlist'
import {
  detectImportSource,
  parseRedditListing,
  parseRssItems,
} from './importSources'
import {
  eventsToSubtitle,
  findTrackUrl,
  extractCaptionTracks,
  parseJson3,
} from './subtitles'
import { fetchPlayerResponse } from './youtubeInnertube'
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

// requireDb and WorkerEnv live in their own leaf module. Importing them from
// here would put apiRoutes back in an import cycle with auth/routes and the
// billing handlers, which esbuild answers by wrapping ~28 KiB of the bundle in
// init closures that V8 then compiles during evaluation instead of at parse —
// 1.8 ms of isolate startup, on a Worker where nearly every request starts an
// isolate. See the header of src/lib/workerEnv.ts.
import type { WorkerEnv } from './workerEnv'

type Handler = (
  request: Request,
  ctx?: WaitUntilContext,
  env?: WorkerEnv,
) => Promise<Response> | Response

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
): Promise<Response> {
  try {
    const { url, type = 'video', quality, format } = await request.json()
    const preferredQuality: 'hd' | 'sd' = quality === 'sd' ? 'sd' : 'hd'
    const mode: 'auto' | 'audio' = format === 'audio' ? 'audio' : 'auto'

    if (!url) {
      return Response.json({ success: false, error: 'URL is required' }, { status: 400 })
    }

    if (!validateUrl(url)) {
      return Response.json(
        {
          success: false,
          error:
            'Invalid URL. Paste a public post or video link — TikTok, X, Instagram, Facebook, YouTube, Pinterest, Reddit, Threads, Snapchat, Twitch, Vimeo, or any other site.',
        },
        { status: 400 },
      )
    }

    const platform = detectPlatform(url)

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
    const credentialed = claims?.c === true

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
    const cacheKey = resolveCacheKey(type, preferredQuality, mode, url)
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
    const videoData = await downloader.downloadVideo(url)

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

    // Instagram's CDN only serves to instagram.com, so its image URLs must go
    // through our same-origin proxy for both display and download. TikTok and
    // Twitter images load directly and are left untouched.
    const isInstagram = platform === 'instagram'
    const proxyImage = (u: string) =>
      isInstagram && u ? `/api/image?url=${encodeURIComponent(u)}` : u

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
        // Only ever present when the source stated it; the card renders nothing
        // rather than a guess.
        sizeBytes: videoData.sizeBytes,
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
        // A gallery entry can be a clip (a carousel that mixes stills and
        // video). Its bytes need the video proxy — the image proxy would set
        // the wrong content type and the wrong referer — while its poster is
        // still an image and goes through the image proxy like any other.
        images:
          videoData.images?.map((img) => ({
            ...img,
            url:
              img.kind === 'video'
                ? toMediaUrl(img.url, '/api/video')
                : proxyImage(img.url),
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
    //
    // And never store a video link that came back without a video: that is us
    // being rate-limited, not a fact about the post, and caching it turns one
    // refused extraction into minutes of everyone getting the cover image
    // instead of the reel. See cacheWorthy.ts.
    if (!credentialed && worthCaching(url, payload)) {
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
 * Expand a collection link into batch rows.
 *
 * One endpoint, four sources — YouTube playlists, Reddit subreddits/profiles,
 * Pinterest boards, Vimeo channels/users — because the visitor's question is
 * "give me all of these", not "speak YouTube". Detection and parsing live in
 * importSources.ts (unit-tested); this handler authenticates, fetches each
 * source once, and shapes the identical `{videos:[{url,title}]}` response so
 * the client stays source-blind.
 *
 * Pro-gated (`p` grant) like every expansion path: one fetch here multiplies
 * downstream resolve volume, so free traffic has no reason to hammer it.
 */
const IMPORT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

async function fetchImportText(
  feedUrl: string,
  timeoutMs = 15_000,
): Promise<{ ok: true; text: string } | { ok: false; status?: number }> {
  try {
    const response = await fetch(feedUrl, {
      headers: { 'User-Agent': IMPORT_UA, 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return { ok: false, status: response.status }
    return { ok: true, text: await response.text() }
  } catch {
    return { ok: false }
  }
}

export async function handlePlaylist(request: Request): Promise<Response> {
  const claims = await readProToken(request)
  if (claims?.p !== true) {
    return Response.json(
      { success: false, error: 'Playlist import is a supporter feature.' },
      { status: 403 },
    )
  }

  try {
    const { url } = await request.json()
    const source =
      typeof url === 'string' ? detectImportSource(url) : null

    if (!source) {
      return Response.json(
        {
          success: false,
          error:
            'Paste a YouTube playlist link, a Reddit subreddit or user page, a Pinterest board, or a Vimeo channel or user.',
        },
        { status: 400 },
      )
    }

    let items: Array<{ url: string; title?: string }> = []

    if (source.kind === 'youtube') {
      // The original path: YouTube's playlist HTML carries its entries in an
      // early inline script, scanned bounded rather than parsed whole.
      const page = await fetchImportText(
        `https://www.youtube.com/playlist?list=${source.listId}&hl=en`,
      )
      if (!page.ok) {
        return Response.json(
          { success: false, error: `YouTube answered ${page.status ?? 'with an error'} for that playlist.` },
          { status: 502 },
        )
      }
      items = extractPlaylistItems(page.text.slice(0, PLAYLIST_SCAN_BYTES))
    } else if (source.kind === 'reddit') {
      // Reddit serves clean JSON to a browser UA from any IP; www first, the
      // older host as the fallback when the listing endpoint refuses.
      let page = await fetchImportText(source.feedUrl)
      if (!page.ok && source.feedUrl.includes('www.reddit.com')) {
        page = await fetchImportText(source.feedUrl.replace('www.reddit.com', 'old.reddit.com'))
      }
      if (!page.ok) {
        return Response.json(
          { success: false, error: 'Reddit refused that listing. It may be private or quarantined.' },
          { status: 502 },
        )
      }
      items = parseRedditListing(page.text)
    } else {
      // Pinterest board RSS / Vimeo videos RSS — plain XML both.
      const page = await fetchImportText(source.feedUrl)
      if (!page.ok) {
        return Response.json(
          { success: false, error: `That ${source.kind} feed could not be fetched (${page.status ?? 'network error'}).` },
          { status: 502 },
        )
      }
      items = parseRssItems(page.text, {
        linkMustInclude:
          source.kind === 'pinterest' ? 'pinterest.' : 'vimeo.com/',
      })
    }

    if (items.length === 0) {
      return Response.json(
        {
          success: false,
          error:
            'No downloadable posts found there. The collection may be empty, private, or media-free.',
        },
        { status: 422 },
      )
    }

    return Response.json({ success: true, videos: items })
  } catch (error) {
    return resolveFailure(error, 'Failed to expand collection')
  }
}

/**
 * Liveness for uptime monitors (the free-tier ones included). Deliberately
 * dependency-free: no D1 read, no extractor call — this answers "is the
 * Worker serving" in microseconds, which is what a probe needs and all it
 * should cost. Parity with deploy/resolver's /health.
 */
export function handleHealth(): Response {
  return Response.json(
    { status: 'ok' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * YouTube subtitles, Pro-gated.
 *
 * One POST serves two shapes: `{videoId|url, list:true}` returns the track
 * list; `{lang, auto?, fmt?}` returns the converted file as text/plain. The
 * client fetches with its token and saves the blob itself — a download link
 * navigating at this route could not carry the X-Pro-Token header, and a
 * token in the query string would end up in logs.
 */
export async function handleSubtitles(request: Request): Promise<Response> {
  const claims = await readProToken(request)
  if (claims?.p !== true) {
    return Response.json(
      { success: false, error: 'Subtitles are a supporter feature.' },
      { status: 403 },
    )
  }

  try {
    const body = (await request.json()) as {
      url?: string
      videoId?: string
      lang?: string
      auto?: boolean
      fmt?: string
      list?: boolean
    }

    const videoId =
      typeof body.videoId === 'string' && /^[\w-]{11}$/.test(body.videoId)
        ? body.videoId
        : typeof body.url === 'string'
          ? parseYouTubeId(body.url)
          : null
    if (!videoId) {
      return Response.json(
        { success: false, error: 'A YouTube link or video id is required.' },
        { status: 400 },
      )
    }

    const data = await fetchPlayerResponse(videoId)
    if (!data) {
      return Response.json(
        { success: false, error: 'Could not load that video from YouTube. It may be private or unavailable.' },
        { status: 502 },
      )
    }

    if (body.list === true) {
      return Response.json({
        success: true,
        title: data.videoDetails?.title ?? '',
        tracks: extractCaptionTracks(data),
      })
    }

    const languageCode =
      typeof body.lang === 'string' && /^[a-zA-Z-]{2,12}$/.test(body.lang)
        ? body.lang
        : null
    if (!languageCode) {
      return Response.json(
        { success: false, error: 'A subtitle language is required.' },
        { status: 400 },
      )
    }
    const auto = body.auto === true
    const trackUrl = findTrackUrl(data, languageCode, auto)
    if (!trackUrl) {
      return Response.json(
        { success: false, error: 'That subtitle track does not exist for this video.' },
        { status: 404 },
      )
    }

    // json3 rather than the XML default: small, JSON.parse-able, and the only
    // format whose shape this module has to know.
    const response = await fetch(`${trackUrl}&fmt=json3`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) {
      return Response.json(
        { success: false, error: `YouTube refused the caption request (${response.status}).` },
        { status: 502 },
      )
    }
    const events = parseJson3(await response.text())
    const format = body.fmt === 'vtt' ? 'vtt' : 'srt'
    const content = eventsToSubtitle(events, format)
    const emptyThreshold = format === 'vtt' ? 'WEBVTT'.length + 2 : 0
    if (content.trim().length <= emptyThreshold) {
      return Response.json(
        { success: false, error: 'That track exists but carries no cues.' },
        { status: 422 },
      )
    }

    const title = slugify(data.videoDetails?.title ?? '', 60) || videoId
    const filename = `${title}.${languageCode}${auto ? '.auto' : ''}.${format}`
    return new Response(content, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return resolveFailure(error, 'Failed to fetch subtitles')
  }
}

/**
 * Gallery URLs may arrive already wrapped in one of our own display proxies —
 * `/api/image?url=<raw>` for stills (Instagram) and `/api/video?url=<raw>` for
 * a carousel's clips. Unwrap back to the raw CDN URL so it can be re-wrapped
 * cleanly rather than double-proxied.
 */
function toRawMediaUrl(u: string): string {
  if (!u.startsWith('/api/image') && !u.startsWith('/api/video')) return u
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
 * Resolves a carousel's items to same-origin download URLs.
 *
 * Deliberately does no fetching. It used to build the ZIP here — pulling every
 * image into memory and running DEFLATE over already-compressed JPEGs, which a
 * 20-image post could push to ~100 MB inside a 128 MB isolate. Archiving now
 * happens in the browser, where the bytes are headed anyway, leaving this as a
 * pure mapping: no subrequests, constant time in the item count.
 *
 * Takes `items` — `{ url, kind }` — because a carousel can hold clips as well
 * as stills, and the two need different proxies and different extensions. A
 * plain `imageUrls` array still works and means "all stills", which is what
 * every caller meant before carousels could carry video.
 */
export async function handleImages(request: Request): Promise<Response> {
  try {
    const { imageUrls, items, title } = await request.json()

    const list: Array<{ url: string; kind?: string }> = Array.isArray(items)
      ? items.filter((i) => typeof i?.url === 'string')
      : Array.isArray(imageUrls)
        ? imageUrls
            .filter((u: unknown) => typeof u === 'string')
            .map((url: string) => ({ url }))
        : []

    if (list.length === 0) {
      return Response.json({ success: false, error: 'No images provided' }, { status: 400 })
    }

    // Slug used for entry names so extracted files stay recognisable.
    const titleSlug = (typeof title === 'string' && slugify(title, 40)) || 'image'
    const pad = Math.max(2, String(list.length).length)

    return Response.json({
      success: true,
      images: list.map((item, index) => {
        const isVideo = item.kind === 'video'
        const ext = isVideo ? 'mp4' : 'jpg'
        // Video bytes go through the video proxy, which sets the referer the
        // CDN demands and forces a type the browser will play.
        const proxy = isVideo ? '/api/video' : '/api/image'
        return {
          url: `${proxy}?url=${encodeURIComponent(toRawMediaUrl(item.url))}`,
          filename: `${titleSlug}_${String(index + 1).padStart(pad, '0')}.${ext}`,
          kind: isVideo ? 'video' : 'image',
          ext,
        }
      }),
    })
  } catch {
    return Response.json(
      { success: false, error: 'Failed to process images' },
      { status: 500 },
    )
  }
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
  '/api/playlist': { method: 'POST', handler: handlePlaylist },
  '/api/subtitles': { method: 'POST', handler: handleSubtitles },
  '/api/health': { method: 'GET', handler: handleHealth },
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
  ...Object.fromEntries(
    Object.entries(MEDIA_PROXY_HANDLERS).map(([pathname, handler]) => [
      pathname,
      { method: 'GET', handler },
    ]),
  ),
}
