/**
 * The media proxy routes (/api/image, /api/video, /api/audio, /api/thumb),
 * implemented against the platform `Request`/`Response` types instead of
 * `NextRequest`/`NextResponse`.
 *
 * Why they live here rather than in the route files: on Cloudflare these are
 * dispatched by the Worker entrypoint (cloudflare/worker.ts) *before* Next's
 * server is initialized. That initialization is lazy and gets billed to
 * whichever request triggers it, which measured at 76-98 ms of CPU against a
 * 10 ms free-plan budget — and it recurs, because every new isolate pays it
 * again. Since none of these four handlers need routing, rendering, or any
 * other part of Next, skipping it entirely keeps them at a few ms.
 *
 * The App Router routes in src/app/api/* are thin wrappers over these same
 * functions, so local `next dev` and any non-Cloudflare host behave identically
 * and there is exactly one implementation to maintain.
 */

import { getMediaReferer, resolveRangeResponse } from './proxyHeaders'

// Several of these CDNs serve different (or no) content to non-browser clients.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
const VIDEO_ACCEPT =
  'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5'
const AUDIO_ACCEPT = 'video/webm,video/ogg,video/*;q=0.9,*/*;q=0.5'

// Caps the /api/thumb payload. Two reasons, and the second is the binding one:
// a huge source image would bloat localStorage, and base64-encoding it is the
// single most CPU-expensive thing any of these handlers does — a real risk
// against the Worker free plan's 10 ms budget, where everything else here is
// pass-through streaming that costs ~nothing. The real inputs are platform
// cover images (TikTok's are ~360px, 20-40 KB), so this bound is well clear of
// what actually arrives while cutting the worst case by more than half.
const MAX_THUMB_BYTES = 120_000

/** Upstream request headers, including the Referer that hotlink-gated CDNs need. */
function upstreamHeaders(
  url: string,
  accept: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Accept: accept,
    ...extra,
  }
  const referer = getMediaReferer(url)
  if (referer) headers['Referer'] = referer
  return headers
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
}

function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

/** Shared CORS/streaming headers for the byte-streaming proxies. */
function streamingHeaders(
  contentType: string,
  filename: string,
): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename="${filename}"`,
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Accept-Ranges': 'bytes',
    'Access-Control-Expose-Headers':
      'Content-Length, Content-Range, X-Estimated-Content-Length',
  }
}

/**
 * Pass an upstream's size *estimate* through to the client.
 *
 * Cobalt tunnels are chunked: they send no Content-Length, only their own
 * `estimated-content-length`. It can't be re-emitted as a real Content-Length —
 * it's an estimate, and a Content-Length that doesn't match the body is a
 * malformed response — so it travels under its own name and the download UI
 * uses it purely to draw a percentage.
 */
function attachEstimatedLength(
  target: Record<string, string>,
  upstream: Response,
) {
  if (target['Content-Length']) return
  const estimated = upstream.headers.get('estimated-content-length')
  if (estimated) target['X-Estimated-Content-Length'] = estimated
}

/**
 * The file extension for an image type, for the rare response the video proxy
 * is honest about rather than relabelling. Unknown types get `jpg`, which is
 * what a social CDN serves when it serves anything.
 */
export function extensionForImageType(contentType: string): string {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('gif')) return 'gif'
  if (contentType.includes('avif')) return 'avif'
  if (contentType.includes('heic')) return 'heic'
  return 'jpg'
}

/**
 * A timestamped download name. Takes the clock as an argument because the
 * Worker entrypoint may run this at module-evaluation-adjacent times where a
 * caller wants a stable value in tests.
 */
function timestampedName(prefix: string, extension: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${prefix}-${timestamp}.${extension}`
}

/**
 * Streams a remote image same-origin.
 *
 * Instagram's scontent/fbcdn hosts omit CORS headers, so the browser cannot
 * fetch them directly for the carousel ZIP — they have to come through here.
 */
export async function handleImageProxy(request: Request): Promise<Response> {
  try {
    const imageUrl = new URL(request.url).searchParams.get('url')

    if (!imageUrl) {
      return json({ error: 'Image URL is required' }, { status: 400 })
    }
    if (!isHttpUrl(imageUrl)) {
      return json({ error: 'Invalid image URL format' }, { status: 400 })
    }

    const response = await fetch(imageUrl, {
      headers: upstreamHeaders(imageUrl, IMAGE_ACCEPT),
      redirect: 'follow',
    })
    if (!response.ok) {
      return json(
        { error: `Failed to fetch image: ${response.status}` },
        { status: response.status },
      )
    }

    const headers: Record<string, string> = {
      'Content-Type': response.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
    }
    const contentLength = response.headers.get('content-length')
    if (contentLength) headers['Content-Length'] = contentLength

    // Pass the body through as a stream — never buffer it into memory.
    return new Response(response.body, { status: 200, headers })
  } catch (error) {
    return json(
      { error: 'Failed to fetch image: ' + errorMessage(error) },
      { status: 500 },
    )
  }
}

/**
 * Streams video bytes, normalizing the broken `206`-without-`Content-Range`
 * responses that Cobalt tunnels return (browsers reject those for playback).
 *
 * This is a last-resort fallback: the app prefers handing the browser a direct
 * tunnel URL so the bytes never transit the Worker at all.
 */
export async function handleVideoProxy(request: Request): Promise<Response> {
  try {
    const videoUrl = new URL(request.url).searchParams.get('url')

    if (!videoUrl) {
      return json({ error: 'Video URL is required' }, { status: 400 })
    }
    if (!isHttpUrl(videoUrl)) {
      return json({ error: 'Invalid video URL format' }, { status: 400 })
    }

    const rangeHeader = request.headers.get('range')
    const headers = upstreamHeaders(videoUrl, VIDEO_ACCEPT, {
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'identity',
      // Forwarded so the browser can seek.
      ...(rangeHeader ? { Range: rangeHeader } : {}),
    })

    const response = await fetch(videoUrl, { headers, redirect: 'follow' })
    if (!response.ok && response.status !== 206) {
      return json(
        { error: `Failed to fetch video: ${response.status}` },
        { status: response.status },
      )
    }

    const ranged = await resolveRangeResponse(response, rangeHeader, (retry) =>
      fetch(videoUrl, {
        headers: { ...headers, Range: retry },
        redirect: 'follow',
      }),
    )

    // `video/mp4` is forced because most of these sources declare nothing
    // useful (a tunnel says `application/octet-stream` for everything) and a
    // browser will not build a player without a type it recognises.
    //
    // The one thing it must never do is force it onto a *picture*. An upstream
    // that says `image/…` is believed and passed through with the extension to
    // match: that combination is how a reel reached people as an `.mp4` that
    // was a JPEG, and while the extractors now refuse such a stream twice over,
    // this is the last place it could still be relabelled on the way out. See
    // lessons/2026-09-06-the-tunnel-that-served-a-jpeg.md.
    const upstreamType = (response.headers.get('content-type') ?? '')
      .toLowerCase()
      .split(';')[0]
      .trim()
    const isPicture = upstreamType.startsWith('image/')
    const responseHeaders = streamingHeaders(
      isPicture ? upstreamType : 'video/mp4',
      isPicture
        ? timestampedName('social-image', extensionForImageType(upstreamType))
        : timestampedName('social-video', 'mp4'),
    )
    if (ranged.contentLength) responseHeaders['Content-Length'] = ranged.contentLength
    if (ranged.contentRange) responseHeaders['Content-Range'] = ranged.contentRange
    attachEstimatedLength(responseHeaders, response)

    return new Response(ranged.body, {
      status: ranged.status,
      headers: responseHeaders,
    })
  } catch (error) {
    return json(
      { error: 'Failed to fetch video: ' + errorMessage(error) },
      { status: 500 },
    )
  }
}

/**
 * Streams audio bytes. Works both for real MP3 sources (slideshow music) and
 * for MP4 streams, where browsers extract the audio track themselves.
 */
export async function handleAudioProxy(request: Request): Promise<Response> {
  try {
    const audioUrl = new URL(request.url).searchParams.get('url')

    if (!audioUrl) {
      return json(
        { success: false, error: 'Video URL is required' },
        { status: 400 },
      )
    }

    const rangeHeader = request.headers.get('range')
    const headers = upstreamHeaders(audioUrl, AUDIO_ACCEPT, {
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'identity',
      ...(rangeHeader ? { Range: rangeHeader } : {}),
    })

    const response = await fetch(audioUrl, { headers, redirect: 'follow' })
    if (!response.ok && response.status !== 206) {
      throw new Error(
        `Failed to fetch audio: ${response.status} ${response.statusText}`,
      )
    }

    const ranged = await resolveRangeResponse(response, rangeHeader, (retry) =>
      fetch(audioUrl, {
        headers: { ...headers, Range: retry },
        redirect: 'follow',
      }),
    )

    const responseHeaders = streamingHeaders(
      'audio/mpeg',
      timestampedName('social-audio', 'mp3'),
    )
    if (ranged.contentLength) responseHeaders['Content-Length'] = ranged.contentLength
    if (ranged.contentRange) responseHeaders['Content-Range'] = ranged.contentRange
    attachEstimatedLength(responseHeaders, response)

    return new Response(ranged.body, {
      status: ranged.status,
      headers: responseHeaders,
    })
  } catch {
    return json({ success: false, error: 'Failed to extract audio' }, { status: 500 })
  }
}

/**
 * Server-side thumbnail snapshot for the Recent list — the fallback for when
 * the client's canvas capture fails. Returns a self-contained data URL so the
 * stored thumbnail survives the signed CDN URL expiring.
 *
 * Every failure path returns `{ dataUrl: null }` with a 200: the client treats
 * that as "use the branded platform tile instead", and a thumbnail is never
 * important enough to surface an error for.
 */
export async function handleThumb(request: Request): Promise<Response> {
  try {
    const imageUrl = new URL(request.url).searchParams.get('url')
    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
      return json({ dataUrl: null }, { status: 200 })
    }

    const response = await fetch(imageUrl, {
      headers: upstreamHeaders(imageUrl, IMAGE_ACCEPT),
      redirect: 'follow',
    })
    if (!response.ok) return json({ dataUrl: null })

    const contentType = response.headers.get('content-type') || 'image/jpeg'
    if (!contentType.startsWith('image/')) return json({ dataUrl: null })

    const declared = Number(response.headers.get('content-length')) || 0
    if (declared > MAX_THUMB_BYTES) {
      // Drop the body rather than leaving the stream dangling.
      await response.body?.cancel().catch(() => {})
      return json({ dataUrl: null })
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
    // Re-check after download — some CDNs omit content-length.
    if (bytes.length === 0 || bytes.length > MAX_THUMB_BYTES) {
      return json({ dataUrl: null })
    }

    const dataUrl = `data:${contentType};base64,${toBase64(bytes)}`
    return json({ dataUrl }, { headers: { 'Cache-Control': 'public, max-age=86400' } })
  } catch {
    return json({ dataUrl: null })
  }
}

/**
 * Base64 without Buffer, so this module stays free of Node built-ins and can be
 * bundled into the Worker entrypoint as-is.
 *
 * Chunked because `String.fromCharCode(...bytes)` on a 300 KB array blows the
 * argument limit.
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * Pathname -> handler, consumed by the Worker entrypoint so these never reach
 * Next. Keep in sync with the route files under src/app/api/.
 */
export const MEDIA_PROXY_HANDLERS: Record<
  string,
  (request: Request) => Promise<Response>
> = {
  '/api/image': handleImageProxy,
  '/api/video': handleVideoProxy,
  '/api/audio': handleAudioProxy,
  '/api/thumb': handleThumb,
}
