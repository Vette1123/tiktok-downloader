'use client'

import dynamic from 'next/dynamic'
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { Surface } from '@/components/Surface'
import {
  appReducer,
  type AppState,
  initialState,
  isSuccessMessage,
  type VideoMetadata,
} from '@/lib/appReducer'
import {
  CheckIcon,
  ClipboardIcon,
  ClockIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FacebookIcon,
  getImagePlaceholderBase64,
  InstagramIcon,
  MusicIcon,
  SpinnerIcon,
  TikTokIcon,
  TrashIcon,
  TwitterXIcon,
  YouTubeIcon,
} from '@/components/icons'
import { BatchPanel } from '@/components/BatchPanel'
import { InstallPrompt } from '@/components/InstallPrompt'
import { PastDueBanner } from '@/components/PastDueBanner'
import { PromoSlot } from '@/components/PromoSlot'
import { ProNudge } from '@/components/ProNudge'
import { SUPPORT_PRICES } from '@/config/support'
import { parseBatchInput } from '@/lib/batchQueue'
import { recordResolve } from '@/lib/proSignals'
import { nowMs, useIsIOSLike } from '@/lib/clientEnv'
import { setFormat, setQuality, usePrefs } from '@/lib/prefs'
import { buildDownloadFilename } from '@/lib/filename'
import { friendlyError } from '@/lib/errorMessages'
import { resolve } from '@/lib/resolve'
import { useProToken } from '@/lib/entitlements'
import {
  addHistory,
  clearHistory,
  getHistorySnapshot,
  getHistoryServerSnapshot,
  removeHistory,
  subscribeHistory,
  type HistoryEntry,
} from '@/lib/history'

// Pull the first http(s) URL out of arbitrary shared text. Android's share sheet
// often hands a link inside `text` wrapped in a caption ("check this out <url>"),
// so we scan for the first URL token rather than assume the whole string is one.
function extractFirstUrl(s: string): string | null {
  if (!s) return null
  const m = s.match(/https?:\/\/[^\s]+/i)
  const candidate = (m ? m[0] : s)
    .trim()
    .replace(/[ï¼Œã€‚ï¼ï¼Ÿï¼›ï¼šã€ï¼‰ã€‘ã€‹ã€ã€]+$/u, '')
  return /^https?:\/\//i.test(candidate) ? candidate : null
}

// Pull EVERY http(s) URL out of pasted text, de-duplicated in order. Powers
// batch mode: paste a list (one per line, or space-separated) and each link is
// resolved and saved to Recent in turn.
function extractAllUrls(s: string): string[] {
  if (!s) return []
  const matches = s.match(/https?:\/\/[^\s]+/gi) || []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of matches) {
    const u = raw.trim().replace(/[ï¼Œã€‚ï¼ï¼Ÿï¼›ï¼šã€ï¼‰ã€‘ã€‹ã€ã€]+$/u, '')
    if (u && !seen.has(u)) {
      seen.add(u)
      out.push(u)
    }
  }
  return out
}

// How big a body we're willing to hold in memory to show a percentage. Past
// this we hand the file to the browser's own download manager instead, which
// streams to disk at no memory cost â€” a 300 MB blob is a tab crash on mobile.
const MAX_IN_MEMORY_DOWNLOAD_BYTES = 80 * 1024 * 1024

// A transfer we project to take longer than this also goes to the download
// manager. Reading it ourselves is what buys the percentage, but it costs the
// two things the browser's own downloader gives for free: bytes landing on disk
// as they arrive, and a transfer that survives leaving the page. For a couple of
// minutes that trade is worth it; for a 40-minute one it is not â€” and a slow
// public tunnel instance can easily make a long video that.
const MAX_STREAM_SECONDS = 120

// Don't judge the rate off the first few chunks â€” TLS ramp-up and the
// instance's own startup make the opening seconds unrepresentative.
const RATE_SAMPLE_AFTER_MS = 5000

// Total size of a response body, in bytes, or 0 when it can't be known.
//
// Cobalt tunnels are chunked and send no Content-Length at all; they publish
// `estimated-content-length` instead and expose it via CORS. Our own media
// proxy re-emits that as `x-estimated-content-length` when the upstream had
// nothing better. An estimate is fine here: the percentage is clamped to 99
// until the stream actually ends.
function responseSize(response: Response): number {
  const headers = response.headers
  const declared =
    headers.get('content-length') ||
    headers.get('estimated-content-length') ||
    headers.get('x-estimated-content-length')
  return Number(declared) || 0
}

// Stream a download response, reporting progress as it lands. Emits a 0â€“100
// percentage when the response declares a size; otherwise emits null
// (indeterminate) and lets the browser buffer. Buffering the chunks here is no
// heavier than response.blob(), which also holds the whole body in memory â€” it
// just lets us surface a real progress bar on big mobile downloads.
async function streamToBlob(
  response: Response,
  onProgress: (pct: number | null) => void,
  bail?: (received: number, total: number, elapsedMs: number) => boolean,
): Promise<Blob> {
  const total = responseSize(response)
  const type = response.headers.get('content-type') || ''
  if (!response.body || !total) {
    onProgress(null)
    const blob = await response.blob()
    onProgress(100)
    return blob
  }
  const reader = response.body.getReader()
  const chunks: BlobPart[] = []
  const startedAt = nowMs()
  let received = 0
  onProgress(0)
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      received += value.length
      onProgress(Math.min(99, Math.round((received / total) * 100)))
      if (bail?.(received, total, nowMs() - startedAt)) {
        await reader.cancel().catch(() => {})
        throw new StreamBailout()
      }
    }
  }
  onProgress(100)
  return new Blob(chunks, type ? { type } : undefined)
}

/** Thrown by `streamToBlob` when its `bail` predicate asks it to stop. */
class StreamBailout extends Error {}

/**
 * True once the measured rate says this transfer won't finish in a reasonable
 * time. Waits for a stable sample before judging.
 */
function isTooSlowToStream(
  received: number,
  total: number,
  elapsedMs: number,
): boolean {
  if (elapsedMs < RATE_SAMPLE_AFTER_MS || received === 0) return false
  const projectedMs = (elapsedMs / received) * total
  return projectedMs > MAX_STREAM_SECONDS * 1000
}

// True while a link is being resolved or a file is actively transferring â€”
// `state.loading` covers only the former; the latter is three independent
// flags because video/audio/images can each be mid-transfer on their own.
// The promo slot (and anything else that must stay off-screen for the whole
// paste-to-download path) gates on this rather than inlining the four terms.
function isResolvingOrDownloading(state: AppState): boolean {
  return (
    state.loading ||
    state.downloading ||
    state.downloadingAudio ||
    state.downloadingImages
  )
}

// Capture a tiny, self-contained snapshot of a thumbnail for the Recent list.
// Loads the image through our same-origin /api/image proxy (which sets CORS +
// the right Referer for hotlink-gated CDNs), downscales it onto a canvas, and
// returns a ~96px JPEG data URL. Storing the pixels means Recent thumbnails
// never go blank later when a signed CDN URL expires or blocks hotlinking.
// Returns '' on any failure so the caller can fall back to a platform tile.
async function snapshotImage(srcUrl: string): Promise<string> {
  if (!srcUrl || typeof document === 'undefined') return ''
  const src = srcUrl.startsWith('/')
    ? srcUrl
    : `/api/image?url=${encodeURIComponent(srcUrl)}`
  return new Promise((resolve) => {
    const img = document.createElement('img')
    img.crossOrigin = 'anonymous'
    const timer = window.setTimeout(() => resolve(''), 8000)
    img.onload = () => {
      window.clearTimeout(timer)
      try {
        const max = 96
        const scale =
          Math.min(max / img.naturalWidth, max / img.naturalHeight, 1) || 1
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve('')
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.72))
      } catch {
        resolve('') // tainted canvas / decode failure â€” fall back to a tile
      }
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      resolve('')
    }
    img.src = src
  })
}

// Capture a persistent thumbnail for the Recent list. Tries the client canvas
// snapshot first (compact, downscaled), and falls back to the server /api/thumb
// route when the canvas path fails â€” an old browser that taints the canvas, a
// decode error, or a CDN the browser can't send the right Referer to. Either
// way the returned value is a self-contained data URL, so the Recent thumbnail
// survives the source URL expiring. Returns '' when nothing worked (â†’ tile).
async function captureThumbnail(srcUrl: string): Promise<string> {
  if (!srcUrl) return ''
  const snap = await snapshotImage(srcUrl)
  if (snap) return snap
  // Server fallback needs the original remote URL, not our proxy wrapper.
  const proxyPrefix = '/api/image?url='
  const raw = srcUrl.startsWith(proxyPrefix)
    ? decodeURIComponent(srcUrl.slice(proxyPrefix.length))
    : srcUrl
  if (!/^https?:\/\//i.test(raw)) return ''
  try {
    const res = await fetch(`/api/thumb?url=${encodeURIComponent(raw)}`)
    if (res.ok) {
      const data = (await res.json()) as { dataUrl?: string | null }
      if (typeof data?.dataUrl === 'string' && data.dataUrl) return data.dataUrl
    }
  } catch {
    // network/parse failure â€” fall through to the tile.
  }
  return ''
}

// Hand a tunnel URL straight to the browser's download manager WITHOUT leaving
// the app. The bytes go browserâ†’instance directly (Content-Disposition:
// attachment), skipping our function. A cross-origin <a download> is ignored by
// browsers, so an anchor just navigates the tab to the file (or pops a new tab
// showing the URL). A hidden iframe avoids that: the browser starts the
// attachment download from the iframe navigation while the page stays exactly
// where it is. The `filename` is advisory only â€” the instance's own attachment
// filename wins cross-origin â€” so it's unused here.
function triggerDirectDownload(url: string, filename: string) {
  void filename
  const iframe = document.createElement('iframe')
  iframe.style.display = 'none'
  iframe.src = url
  document.body.appendChild(iframe)
  // Give the navigationâ†’download time to start, then tear the iframe down.
  setTimeout(() => iframe.remove(), 120000)
}

/**
 * Which URL (if any) to hand to the browser's download manager after a direct
 * stream didn't finish.
 *
 * The manager needs a URL that downloads rather than displays, i.e. one served
 * as an attachment:
 *   - a cobalt tunnel already is one, so it can be used as-is;
 *   - a raw CDN URL is not, but our own proxy re-serves it with the right
 *     disposition â€” worth the egress only when the alternative is holding a
 *     very large file in a tab's memory.
 * An ordinary failure returns null: retrying through the proxy in-page is
 * better there, because it keeps the progress bar.
 */
function downloadManagerUrl(
  outcome: DirectDownloadOutcome,
  directUrl: string,
  isAttachment: boolean | undefined,
  proxiedUrl: string,
): string | null {
  if (isAttachment) return directUrl
  if (outcome === 'too-big' && proxiedUrl) return proxiedUrl
  return null
}

// Save an already-fetched body under our own filename. Same-origin blob URLs
// honour the `download` attribute, which a cross-origin URL never does.
function saveBlob(blob: Blob, filename: string) {
  const blobUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(blobUrl)
}

// Pull a tunnel download through fetch() so we can report real progress, then
// save it. The bytes still go browserâ†’instance directly â€” the point of the
// direct path is keeping them out of our Worker, and this preserves that; it
// only replaces the hidden-iframe navigation (which is unobservable) with a
// stream we can measure. Cobalt tunnels send `Access-Control-Allow-Origin: *`,
// so the read is allowed.
//
// Why three outcomes rather than a boolean: the right fallback differs. A body
// too big (or too slow) to hold in memory should go to the browser's download
// manager, which streams to disk; an outright failure should be retried through
// the proxy, which can still show a progress bar. Giving up costs only the bytes
// read so far â€” these URLs can all be opened again.
type DirectDownloadOutcome = 'saved' | 'too-big' | 'failed'

async function downloadDirectWithProgress(
  url: string,
  filename: string,
  onProgress: (pct: number | null) => void,
): Promise<DirectDownloadOutcome> {
  let oversize = false
  try {
    const response = await fetch(url)
    if (!response.ok || !response.body) return 'failed'
    if (responseSize(response) > MAX_IN_MEMORY_DOWNLOAD_BYTES) {
      await response.body.cancel().catch(() => {})
      return 'too-big'
    }
    const blob = await streamToBlob(response, onProgress, (...args) => {
      const slow = isTooSlowToStream(...args)
      if (slow) oversize = true
      return slow
    })
    saveBlob(blob, filename)
    return 'saved'
  } catch {
    // Cross-origin block, an expired URL, a dropped connection, or our own
    // bailout on a slow transfer â€” only the last of those wants the download
    // manager, and it flagged itself on the way out.
    return oversize ? 'too-big' : 'failed'
  }
}

const PLATFORM_DISPLAY: Record<string, string> = {
  douyin: 'æŠ–éŸ³',
  kuaishou: 'å¿«æ‰‹',
  bilibili: 'å“”å“©å“”å“©',
  xiaohongshu: 'å°çº¢ä¹¦',
  tiktok: 'TikTok',
  twitter: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  reddit: 'Reddit',
  threads: 'Threads',
  snapchat: 'Snapchat',
  twitch: 'Twitch',
  vimeo: 'Vimeo',
}

// Never store a raw URL or "Untitled" as a Recent title â€” fall back to a clean
// "<Platform> video" label so the list reads like content, not plumbing.
function friendlyTitle(rawTitle: string | undefined, platform?: string): string {
  const t = (rawTitle || '').trim()
  if (t && !/^https?:\/\//i.test(t) && !/^untitled$/i.test(t)) return t
  const name = platform ? PLATFORM_DISPLAY[platform] : ''
  return name ? `${name} video` : 'Saved link'
}

// Branded fallback tile for a Recent entry with no usable snapshot. IG/FB/YT
// icons are full-colour badges that fill the tile; the rest render as a glyph on
// a neutral chip.
function PlatformTile({ platform }: { platform?: HistoryEntry['platform'] }) {
  const badges: Partial<
    Record<string, React.ComponentType<{ className?: string }>>
  > = {
    instagram: InstagramIcon,
    facebook: FacebookIcon,
    youtube: YouTubeIcon,
  }
  const glyphs: Partial<
    Record<string, React.ComponentType<{ className?: string }>>
  > = {
    tiktok: TikTokIcon,
    twitter: TwitterXIcon,
  }
  const Badge = platform ? badges[platform] : undefined
  if (Badge) return <Badge className='h-full w-full' />
  const Glyph = (platform && glyphs[platform]) || ExternalLinkIcon
  return (
    <span className='flex h-full w-full items-center justify-center bg-white/[0.06] text-white/55'>
      <Glyph className='h-4 w-4' />
    </span>
  )
}

// The lightbox is the ONLY component that genuinely needs the motion library
// (drag/swipe + AnimatePresence). It's buried deep behind "Show images" â†’ tap a
// thumbnail, so it is never in the critical path. Lazy-loading it splits the
// ~69KB motion chunk out of the initial bundle â€” it only downloads the first
// time a user actually opens a carousel image. A cheap inline placeholder keeps
// the layout stable while the chunk streams in.
const ImageLightbox = dynamic(
  () => import('@/components/ImageLightbox').then((m) => m.ImageLightbox),
  {
    ssr: false,
    loading: () => null,
  },
)

// Shown the instant "Process URL" is hit, filling the results column with a
// shaped placeholder so the card doesn't pop in cold ~1.5s later. Its outline
// matches the real result (thumbnail + title, a toggle, a tile grid, and the
// two download buttons) so the swap to real content reads as fill-in, not a
// late appearance.
function ResultsSkeleton() {
  return (
    <Surface
      aria-hidden
      elevation='raised'
      className='animate-fade-in-up space-y-4 p-4'
    >
      <div className='flex items-start gap-3'>
        <div className='h-16 w-16 shrink-0 animate-pulse rounded-lg bg-white/[0.07] md:h-20 md:w-20' />
        <div className='flex-1 space-y-2 pt-1'>
          <div className='h-4 w-3/4 animate-pulse rounded bg-white/[0.07]' />
          <div className='h-3 w-2/5 animate-pulse rounded bg-white/[0.06]' />
          <div className='h-3 w-1/4 animate-pulse rounded bg-white/[0.05]' />
        </div>
      </div>
      <div className='h-11 w-full animate-pulse rounded-xl bg-white/[0.05]' />
      <div className='grid grid-cols-3 gap-3'>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className='aspect-square animate-pulse rounded-xl bg-white/[0.05]'
          />
        ))}
      </div>
      <div className='grid grid-cols-2 gap-3'>
        <div className='h-11 animate-pulse rounded-xl bg-white/[0.06]' />
        <div className='h-11 animate-pulse rounded-xl bg-white/[0.05]' />
      </div>
    </Surface>
  )
}

export function DownloaderApp() {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const containerRef = useRef<HTMLDivElement>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [urlError, setUrlError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pasteBarRef = useRef<HTMLDivElement>(null)
  // Persisted in localStorage and mutated from several places, so it is read
  // from the history store rather than mirrored into component state â€” the
  // mutators below notify it and this re-renders. See lib/history.
  const history = useSyncExternalStore(
    subscribeHistory,
    getHistorySnapshot,
    getHistoryServerSnapshot,
  )
  const [showAllHistory, setShowAllHistory] = useState(false)
  // Sticky across visits, so they live in an external store that reads
  // localStorage on the first client render â€” see lib/prefs.
  const { quality, format } = usePrefs()
  // Batch progress while resolving a pasted list of links; null when idle.
  const [batch, setBatch] = useState<{
    done: number
    total: number
    saved: number
  } | null>(null)
  // Which rendition the result-card re-pick is currently fetching (null = idle).
  const [repicking, setRepicking] = useState<'hd' | 'sd' | 'audio' | null>(null)
  // How many links are sitting in the field right now. The same parser the
  // batch runner uses, so "two links" here means exactly what it will mean when
  // Download is pressed â€” and memoised because this runs on every keystroke.
  const pastedLinks = useMemo(() => parseBatchInput(state.url).length, [state.url])
  // iPhone/iPad Safari: downloads land in Files, not the camera roll, so we show
  // a one-line "save to Photos" hint on video results. Set once on mount.
  // Read straight from the browser rather than via an effect â€” see lib/clientEnv.
  const isIOS = useIsIOSLike()
  const didInit = useRef(false)
  // Pro token, sent as X-Pro-Token so the server tries the operator's own
  // resolvers first for a subscriber's request â€” see lib/entitlements.
  const proToken = useProToken()

  // Thin aliases: the store already persists and notifies, so these exist only
  // to keep the call sites in this file reading the same as before.
  const changeQuality = setQuality
  const changeFormat = setFormat

  // Resolve one link against the API. Shared by the single-link flow, batch
  // mode, and the result-card re-pick. `opts` overrides the current format/
  // quality prefs so the re-pick can request a different rendition without
  // waiting for a setState round-trip. Returns the parsed response (or throws
  // on network failure). The pipeline itself lives in lib/resolve so the batch
  // queue can run it without importing this component.
  const resolveOne = (
    target: string,
    opts?: { quality?: 'hd' | 'sd'; format?: 'video' | 'audio' },
  ) =>
    resolve(target, {
      type: state.downloadType,
      quality: opts?.quality ?? quality,
      format: opts?.format ?? format,
      proToken,
    })

  // Snapshot the thumbnail off the main flow and prepend the link to Recent so
  // the card always shows an image (even after the source URL expires) and the
  // title never reads as a raw link.
  const rememberInHistory = async (
    target: string,
    // Optional because a resolve response is typed with `metadata?` â€” every
    // read below was already `meta?.â€¦`, so undefined has always been handled.
    meta:
      | {
          title?: string
          author?: string
          platform?: HistoryEntry['platform']
          thumbnail?: string
        }
      | undefined,
  ) => {
    const snap = await captureThumbnail(meta?.thumbnail || '')
    addHistory({
      url: target,
      title: friendlyTitle(meta?.title, meta?.platform),
      author: meta?.author || '',
      platform: meta?.platform,
      thumbnail: snap || meta?.thumbnail || '',
      ts: nowMs(),
    })
    // The one place a link is known to have resolved, which is why the day's
    // count is kept here rather than at each of the download buttons. Local
    // only â€” it decides whether the header pill has earned a sentence.
    recordResolve()
  }

  // Re-resolve the current result at a different rendition (HD / Data saver /
  // MP3) without making the user re-paste. Keeps the card on screen (no reset),
  // updates the saved prefs so the top toggles stay in sync, and swaps in the
  // fresh result. `repicking` marks the pending chip so the control can show a
  // spinner and lock out double-taps.
  const reResolve = async (
    nextFormat: 'video' | 'audio',
    nextQuality: 'hd' | 'sd',
  ) => {
    const target = state.originalUrl
    if (!target || repicking) return
    // Persist the new prefs so the paste-bar toggles and next resolve match.
    if (nextFormat !== format) changeFormat(nextFormat)
    if (nextQuality !== quality) changeQuality(nextQuality)
    setRepicking(nextFormat === 'audio' ? 'audio' : nextQuality)
    setUrlError(null)
    try {
      const data = await resolveOne(target, {
        quality: nextQuality,
        format: nextFormat,
      })
      if (data.success) {
        dispatch({
          type: 'SET_DOWNLOAD_SUCCESS',
          payload: {
            downloadUrl: data.downloadUrl,
            audioUrl: data.audioUrl,
            // A successful resolve always carries metadata; the response type
            // marks it optional because the failure branch has none.
            metadata: data.metadata as VideoMetadata,
            originalUrl: target,
          },
        })
        void rememberInHistory(target, data.metadata)
      } else {
        const fe = friendlyError(data.error, target)
        dispatch({ type: 'SET_MESSAGE', payload: `${fe.title} â€” ${fe.hint}` })
      }
    } catch (err) {
      const fe = friendlyError(err instanceof Error ? err.message : '', target)
      dispatch({ type: 'SET_MESSAGE', payload: `${fe.title} â€” ${fe.hint}` })
    } finally {
      setRepicking(null)
    }
  }

  // `overrideUrl` lets the paste button, the PWA share target, and the recent
  // list kick off a resolve without waiting for a state round-trip through the
  // input. When omitted we use whatever's in the field.
  const handleProcess = async (overrideUrl?: string) => {
    const target = (overrideUrl ?? state.url).trim()
    if (!target) {
      setUrlError(
        'è¯·å…ˆç²˜è´´æŠ–éŸ³ã€å¿«æ‰‹ã€å“”å“©å“”å“©ã€å°çº¢ä¹¦ã€TikTokã€Xã€Instagramã€Facebook æˆ– YouTube é“¾æ¥',
      )
      return
    }

    // Batch: a pasted list of links resolves each in turn (see processBatch).
    // The paste button / share target pass a single overrideUrl and skip this.
    if (overrideUrl === undefined) {
      const urls = extractAllUrls(target)
      if (urls.length > 1) {
        void processBatch(urls)
        return
      }
    }

    if (overrideUrl !== undefined) {
      dispatch({ type: 'SET_URL', payload: overrideUrl })
    }
    setUrlError(null)

    dispatch({ type: 'SET_LOADING', payload: true })
    dispatch({ type: 'RESET_DOWNLOAD_STATE' })

    try {
      const data = await resolveOne(target)

      if (data.success) {
        dispatch({
          type: 'SET_DOWNLOAD_SUCCESS',
          payload: {
            downloadUrl: data.downloadUrl,
            audioUrl: data.audioUrl,
            // See reResolve: success implies metadata, the type does not.
            metadata: data.metadata as VideoMetadata,
            originalUrl: target,
          },
        })

        // Remember it locally (one-tap re-open), off the main flow.
        void rememberInHistory(target, data.metadata)

        dispatch({ type: 'SET_URL', payload: '' })

        setTimeout(() => {
          if (containerRef.current) {
            const resultsSection =
              containerRef.current.querySelector('.results-section')
            if (resultsSection) {
              resultsSection.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              })
            }
          }
        }, 500)
      } else {
        const fe = friendlyError(data.error, target)
        dispatch({
          type: 'SET_MESSAGE',
          payload: `${fe.title} â€” ${fe.hint}`,
        })
      }
    } catch (err) {
      console.error('Processing error:', err)
      const fe = friendlyError(err instanceof Error ? err.message : '', target)
      dispatch({
        type: 'SET_MESSAGE',
        payload: `${fe.title} â€” ${fe.hint}`,
      })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }

  // Resolve a pasted list of links one at a time (sequential keeps load light on
  // the public extractor). Each success is saved to Recent; the last one also
  // fills the result card so there's something to act on immediately, and a
  // summary line reports how many landed.
  const processBatch = async (urls: string[]) => {
    setUrlError(null)
    dispatch({ type: 'RESET_DOWNLOAD_STATE' })
    dispatch({ type: 'SET_LOADING', payload: true })
    setBatch({ done: 0, total: urls.length, saved: 0 })

    let saved = 0
    let last: { data: unknown; target: string } | null = null

    for (let i = 0; i < urls.length; i++) {
      setBatch({ done: i, total: urls.length, saved })
      try {
        const data = await resolveOne(urls[i])
        if (data.success) {
          saved++
          await rememberInHistory(urls[i], data.metadata)
          last = { data, target: urls[i] }
        }
      } catch {
        // skip this link â€” keep going through the rest of the batch.
      }
    }

    setBatch(null)
    dispatch({ type: 'SET_LOADING', payload: false })

    if (last) {
      const data = last.data as {
        downloadUrl?: string
        audioUrl?: string
        metadata: VideoMetadata
      }
      dispatch({
        type: 'SET_DOWNLOAD_SUCCESS',
        payload: {
          downloadUrl: data.downloadUrl,
          audioUrl: data.audioUrl,
          metadata: data.metadata,
          originalUrl: last.target,
        },
      })
    }
    dispatch({ type: 'SET_URL', payload: '' })
    dispatch({
      type: 'SET_MESSAGE',
      payload:
        saved > 0
          ? `Saved ${saved} of ${urls.length} links to Recent â€” tap any to download. ğŸ‰`
          : `Couldnâ€™t resolve any of those ${urls.length} links. Check theyâ€™re public post URLs and try again.`,
    })
  }

  // One-tap paste: read the clipboard, and if it holds a link, resolve it
  // immediately. Falls back to filling the field (or focusing it, when the
  // browser blocks programmatic clipboard reads) so the user is never stuck.
  const handlePaste = async () => {
    if (!navigator.clipboard?.readText) {
      inputRef.current?.focus()
      setUrlError('Long-press the field and choose Paste.')
      return
    }
    try {
      const text = await navigator.clipboard.readText()
      const found = extractFirstUrl(text)
      if (found) {
        handleProcess(found)
      } else if (text.trim()) {
        dispatch({ type: 'SET_URL', payload: text.trim() })
        inputRef.current?.focus()
        setUrlError('That doesnâ€™t look like a link â€” paste a post URL.')
      } else {
        inputRef.current?.focus()
      }
    } catch {
      inputRef.current?.focus()
      setUrlError('Couldnâ€™t read the clipboard â€” paste the link manually.')
    }
  }

  const handleClearHistory = () => {
    clearHistory()
  }

  // Runs once on mount to honour a PWA share-target / deep link (?url= /
  // ?text=). Sharing a link straight from the TikTok/IG/YouTube app lands here â€”
  // we auto-resolve it and strip the query so a refresh doesn't fire it again.
  // (The recent list needs no hydration step; it reads itself â€” see lib/history.)
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    try {
      const params = new URLSearchParams(window.location.search)
      const shared = params.get('url') || params.get('text') || ''
      const found = extractFirstUrl(shared)
      if (found) {
        window.history.replaceState(null, '', window.location.pathname)
        // Deferred rather than called inline. handleProcess dispatches straight
        // away, and doing that in the effect body makes the mount render
        // cascade into a second one before the first has committed. A microtask
        // runs it after commit, so the empty state paints and then flips to
        // loading â€” which is also what a share-target hand-off should look like.
        void Promise.resolve().then(() => handleProcess(found))
      }
    } catch {
      // no-op â€” malformed query, just show the normal empty state.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleVideoDownload = async () => {
    if (!state.downloadUrl) return

    // Direct path: a Cobalt tunnel downloads browserâ†’Cobalt, skipping our proxy
    // (saves the function's egress). No progress bar â€” the browser's own
    // download manager takes over instantly.
    const direct = state.videoMetadata?.directVideoUrl
    if (direct) {
      const filename = buildDownloadFilename({
        platform: state.videoMetadata?.platform,
        author: state.videoMetadata?.author,
        title: state.videoMetadata?.title,
        ext: 'mp4',
      })
      // The instance resolves server-side before the first byte, so nothing
      // moves for a moment after the click. Hold the button in a spinning
      // "preparing" state until the stream starts reporting.
      dispatch({ type: 'SET_DOWNLOADING', payload: true })
      dispatch({ type: 'SET_PROGRESS', payload: null })
      dispatch({ type: 'SET_MESSAGE', payload: 'Preparing your downloadâ€¦' })
      const outcome = await downloadDirectWithProgress(direct, filename, (p) =>
        dispatch({ type: 'SET_PROGRESS', payload: p }),
      )
      if (outcome === 'saved') {
        dispatch({ type: 'SET_DOWNLOADING', payload: false })
        dispatch({ type: 'SET_PROGRESS', payload: null })
        dispatch({
          type: 'SET_MESSAGE',
          payload: 'Video downloaded successfully! ğŸ‰',
        })
        dispatch({ type: 'SET_URL', payload: '' })
        return
      }
      const handoff = downloadManagerUrl(
        outcome,
        direct,
        state.videoMetadata?.directIsAttachment,
        state.downloadUrl,
      )
      if (handoff) {
        // The browser's own downloader streams to disk instead of holding the
        // file in a tab. The navigation is opaque to us, so release after a
        // short beat with a confirmation rather than a completion.
        triggerDirectDownload(handoff, filename)
        window.setTimeout(() => {
          dispatch({ type: 'SET_DOWNLOADING', payload: false })
          dispatch({ type: 'SET_PROGRESS', payload: null })
          dispatch({
            type: 'SET_MESSAGE',
            payload: 'Download started. Check your downloads. ğŸ‰',
          })
        }, 2800)
        return
      }
      // Nothing to hand off to â€” retry through the proxy below, which still
      // shows a progress bar.
    }

    dispatch({ type: 'SET_DOWNLOADING', payload: true })
    dispatch({ type: 'SET_PROGRESS', payload: 0 })

    try {
      const response = await fetch(state.downloadUrl)

      if (!response.ok) {
        throw new Error('Failed to download video')
      }
      const blob = await streamToBlob(response, (p) =>
        dispatch({ type: 'SET_PROGRESS', payload: p }),
      )
      saveBlob(
        blob,
        buildDownloadFilename({
          platform: state.videoMetadata?.platform,
          author: state.videoMetadata?.author,
          title: state.videoMetadata?.title,
          ext: 'mp4',
        }),
      )

      dispatch({
        type: 'SET_MESSAGE',
        payload: 'Video downloaded successfully! ğŸ‰',
      })
      dispatch({ type: 'SET_URL', payload: '' })
    } catch (error) {
      console.error('Download failed:', error)
      dispatch({
        type: 'SET_MESSAGE',
        payload: 'Failed to download video file',
      })
    } finally {
      dispatch({ type: 'SET_DOWNLOADING', payload: false })
      dispatch({ type: 'SET_PROGRESS', payload: null })
    }
  }

  const handleSlideshowRender = async () => {
    const images = state.videoMetadata?.images
    const rawMusicUrl = state.videoMetadata?.rawMusicUrl
    if (!images || images.length === 0) return

    dispatch({ type: 'SET_DOWNLOADING', payload: true })
    dispatch({
      type: 'SET_MESSAGE',
      payload: 'Rendering slideshow video... this takes ~30 seconds.',
    })

    try {
      const response = await fetch('/api/slideshow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrls: images.map((img) => img.url),
          audioUrl: rawMusicUrl,
          perImageSeconds: 3,
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to render slideshow')
      }

      const blob = await streamToBlob(response, (p) =>
        dispatch({ type: 'SET_PROGRESS', payload: p }),
      )
      saveBlob(
        blob,
        buildDownloadFilename({
          platform: state.videoMetadata?.platform,
          author: state.videoMetadata?.author,
          title: state.videoMetadata?.title,
          ext: 'mp4',
        }),
      )

      dispatch({
        type: 'SET_MESSAGE',
        payload: 'Slideshow video rendered and downloaded! ğŸ¬',
      })
      dispatch({ type: 'SET_URL', payload: '' })
    } catch (error) {
      console.error('Slideshow render failed:', error)
      dispatch({
        type: 'SET_MESSAGE',
        payload:
          error instanceof Error
            ? `Slideshow render failed: ${error.message}`
            : 'Failed to render slideshow video',
      })
    } finally {
      dispatch({ type: 'SET_DOWNLOADING', payload: false })
      dispatch({ type: 'SET_PROGRESS', payload: null })
    }
  }

  const handleAudioDownload = async () => {
    if (!state.audioUrl) return

    // Direct path: a Cobalt audio tunnel (MP3) downloads browserâ†’Cobalt,
    // bypassing our proxy. Only set when the audio source is itself a tunnel
    // (the "â†’ MP3" flow); re-serving a video stream as audio keeps the proxy.
    const direct = state.videoMetadata?.directAudioUrl
    if (direct) {
      // Same as the video path: stream it so the bar is real, and fall back to
      // the browser's download manager when the stream can't be read.
      const filename = buildDownloadFilename({
        platform: state.videoMetadata?.platform,
        author: state.videoMetadata?.author,
        title: state.videoMetadata?.title,
        ext: 'mp3',
      })
      dispatch({ type: 'SET_DOWNLOADING_AUDIO', payload: true })
      dispatch({ type: 'SET_PROGRESS', payload: null })
      dispatch({ type: 'SET_MESSAGE', payload: 'Preparing your downloadâ€¦' })
      const outcome = await downloadDirectWithProgress(direct, filename, (p) =>
        dispatch({ type: 'SET_PROGRESS', payload: p }),
      )
      if (outcome === 'saved') {
        dispatch({ type: 'SET_DOWNLOADING_AUDIO', payload: false })
        dispatch({ type: 'SET_PROGRESS', payload: null })
        dispatch({
          type: 'SET_MESSAGE',
          payload: 'Audio downloaded successfully! ğŸµ',
        })
        dispatch({ type: 'SET_URL', payload: '' })
        return
      }
      const handoff = downloadManagerUrl(
        outcome,
        direct,
        state.videoMetadata?.directIsAttachment,
        state.audioUrl,
      )
      if (handoff) {
        triggerDirectDownload(handoff, filename)
        window.setTimeout(() => {
          dispatch({ type: 'SET_DOWNLOADING_AUDIO', payload: false })
          dispatch({ type: 'SET_PROGRESS', payload: null })
          dispatch({
            type: 'SET_MESSAGE',
            payload: 'Download started. Check your downloads. ğŸµ',
          })
        }, 2800)
        return
      }
    }

    dispatch({ type: 'SET_DOWNLOADING_AUDIO', payload: true })
    dispatch({ type: 'SET_PROGRESS', payload: 0 })

    try {
      const response = await fetch(state.audioUrl)

      if (!response.ok) {
        throw new Error('Failed to download audio')
      }
      const blob = await streamToBlob(response, (p) =>
        dispatch({ type: 'SET_PROGRESS', payload: p }),
      )
      saveBlob(
        blob,
        buildDownloadFilename({
          platform: state.videoMetadata?.platform,
          author: state.videoMetadata?.author,
          title: state.videoMetadata?.title,
          ext: 'mp3',
        }),
      )

      dispatch({
        type: 'SET_MESSAGE',
        payload: 'Audio downloaded successfully! ğŸµ',
      })
      dispatch({ type: 'SET_URL', payload: '' })
    } catch (error) {
      console.error('Audio download failed:', error)
      dispatch({
        type: 'SET_MESSAGE',
        payload: 'Failed to download audio file',
      })
    } finally {
      dispatch({ type: 'SET_DOWNLOADING_AUDIO', payload: false })
      dispatch({ type: 'SET_PROGRESS', payload: null })
    }
  }

  const handleImageDownload = async () => {
    if (!state.videoMetadata?.images) return

    const selectedImages = state.videoMetadata.images.filter(
      (img) => img.selected,
    )

    if (selectedImages.length === 0) {
      dispatch({
        type: 'SET_MESSAGE',
        payload: 'Please select at least one image to download',
      })
      return
    }

    dispatch({ type: 'SET_DOWNLOADING_IMAGES', payload: true })

    try {
      const imageUrls = selectedImages.map((img) => img.url)

      if (state.downloadImagesAsZip) {
        dispatch({ type: 'SET_PROGRESS', payload: 0 })
        const response = await fetch('/api/images', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            imageUrls,
            title: state.videoMetadata.title,
          }),
        })

        if (!response.ok) {
          throw new Error('Failed to resolve image URLs')
        }

        const data = await response.json()
        if (!data.success || !data.images) {
          throw new Error('Invalid response from server')
        }
        const entries = data.images as Array<{
          url: string
          filename: string
        }>

        // The archive is built here rather than on the server: the browser is
        // already the destination for every one of these bytes, so zipping
        // server-side meant paying to hold the whole carousel in memory and
        // stream it a second time. JSZip is pulled in on demand so it stays out
        // of the initial bundle â€” most visits never build an archive.
        const { default: JSZip } = await import('jszip')
        const zip = new JSZip()

        let completed = 0
        const noteProgress = () => {
          completed += 1
          // Reserve the last tenth of the bar for assembling the archive.
          dispatch({
            type: 'SET_PROGRESS',
            payload: Math.round((completed / entries.length) * 90),
          })
        }

        await Promise.all(
          entries.map(async (entry) => {
            try {
              const imageResponse = await fetch(entry.url)
              if (!imageResponse.ok) {
                throw new Error(`HTTP ${imageResponse.status}`)
              }
              zip.file(entry.filename, await imageResponse.arrayBuffer())
            } catch (error) {
              console.error(`Failed to fetch ${entry.filename}:`, error)
              // Mirror the previous behaviour: a failed image leaves a note in
              // the archive rather than silently shrinking it.
              zip.file(
                `${entry.filename}-failed.txt`,
                `Failed to download: ${entry.url}`,
              )
            } finally {
              noteProgress()
            }
          }),
        )

        // STORE, not the DEFLATE default: these entries are JPEGs, which are
        // already compressed. Deflating them walks every byte for a fraction of
        // a percent, and on a large carousel that is the difference between an
        // instant archive and a visibly frozen tab.
        const blob = await zip.generateAsync(
          { type: 'blob', compression: 'STORE' },
          (meta) =>
            dispatch({
              type: 'SET_PROGRESS',
              payload: 90 + Math.round(meta.percent * 0.1),
            }),
        )
        const blobUrl = URL.createObjectURL(blob)

        const link = document.createElement('a')
        link.href = blobUrl
        link.download = buildDownloadFilename({
          platform: state.videoMetadata?.platform,
          author: state.videoMetadata?.author,
          title: state.videoMetadata?.title,
          ext: 'zip',
        })
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)

        URL.revokeObjectURL(blobUrl)

        dispatch({
          type: 'SET_MESSAGE',
          payload: `${selectedImages.length} image(s) downloaded as ZIP! ğŸ—œï¸`,
        })
        dispatch({ type: 'SET_URL', payload: '' })
      } else {
        const response = await fetch('/api/images', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ imageUrls }),
        })

        if (!response.ok) {
          throw new Error('Failed to get image download URLs')
        }

        const data = await response.json()

        if (!data.success || !data.images) {
          throw new Error('Invalid response from server')
        }

        const totalImages = data.images.length
        for (let i = 0; i < data.images.length; i++) {
          const imageData = data.images[i]
          try {
            const imageResponse = await fetch(imageData.url)
            if (!imageResponse.ok) continue

            const blob = await imageResponse.blob()
            const blobUrl = URL.createObjectURL(blob)

            const link = document.createElement('a')
            link.href = blobUrl
            link.download = buildDownloadFilename({
              platform: state.videoMetadata?.platform,
              author: state.videoMetadata?.author,
              title: state.videoMetadata?.title,
              ext: 'jpg',
              index: i + 1,
              total: totalImages,
            })
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)

            URL.revokeObjectURL(blobUrl)

            await new Promise((resolve) => setTimeout(resolve, 500))
          } catch (error) {
            console.error('Failed to download individual image:', error)
          }
        }
        dispatch({
          type: 'SET_MESSAGE',
          payload: `${selectedImages.length} image(s) downloaded individually! ğŸ–¼ï¸`,
        })
        dispatch({ type: 'SET_URL', payload: '' })
      }
    } catch (error) {
      console.error('Image download failed:', error)
      dispatch({
        type: 'SET_MESSAGE',
        payload: 'Failed to download images',
      })
    } finally {
      dispatch({ type: 'SET_DOWNLOADING_IMAGES', payload: false })
      dispatch({ type: 'SET_PROGRESS', payload: null })
    }
  }

  const toggleImageGallery = () => {
    dispatch({ type: 'TOGGLE_IMAGE_GALLERY' })
  }

  const toggleImageSelection = (imageId: string) => {
    dispatch({ type: 'TOGGLE_IMAGE_SELECTION', payload: imageId })
  }

  const selectAllImages = (selected: boolean) => {
    dispatch({ type: 'SELECT_ALL_IMAGES', payload: selected })
  }

  const togglePreview = () => {
    dispatch({ type: 'TOGGLE_PREVIEW' })
  }

  // Keyboard-aware paste bar â€” the web equivalent of RN's KeyboardAvoidingView.
  // The soft keyboard doesn't reflow the page; it shrinks the *visual* viewport
  // and overlays the bottom, so a paste bar sitting low in the hero ends up
  // hidden behind it. visualViewport.height is the real post-keyboard height:
  // if the bar's bottom sits below the visible band, scroll the page up by
  // exactly that overlap (+ breathing room) so it rises above the keys.
  //
  // Measure the whole PASTE BAR, not just the input: on mobile the Download
  // button stacks *below* the field (flex-col), so scrolling only the input
  // into view left the button â€” the thing the user actually taps â€” still
  // buried under the keyboard. getBoundingClientRect() on the container spans
  // input + button, so both clear the keys.
  const keepInputAboveKeyboard = useCallback(() => {
    const bar = pasteBarRef.current
    const vv = window.visualViewport
    if (!bar || !vv) return
    const rect = bar.getBoundingClientRect()
    const visibleBottom = vv.height + vv.offsetTop
    const overshoot = rect.bottom - visibleBottom + 24
    if (overshoot > 0) {
      window.scrollBy({ top: overshoot, behavior: 'smooth' })
    }
  }, [])

  // The keyboard slide-up fires a visualViewport 'resize' â€” recentre then, when
  // the final height is known, but only while our field holds focus.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      if (document.activeElement === inputRef.current) keepInputAboveKeyboard()
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [keepInputAboveKeyboard])

  return (
    <div ref={containerRef} className='mx-auto w-full max-w-2xl'>
      <PastDueBanner />
      {/* Paste bar â€” the hero action. Input + CTA share one focus-ring pill. */}
      <Surface
        ref={pasteBarRef}
        elevation='raised'
        className={`flex flex-col gap-2 p-2 transition-colors duration-200 sm:flex-row ${
          urlError
            ? '[--surface-line:rgba(248,113,113,0.6)]'
            : 'focus-within:[--surface-line:rgba(34,211,238,0.6)]'
        }`}
      >
        <div className='relative flex min-w-0 flex-1 items-center'>
          <input
            ref={inputRef}
            type='url'
            inputMode='url'
            enterKeyHint='go'
            autoCapitalize='none'
            autoCorrect='off'
            autoComplete='off'
            spellCheck={false}
            placeholder='Paste a video linkâ€¦'
            value={state.url}
            onChange={(e) => {
              if (urlError) setUrlError(null)
              dispatch({ type: 'SET_URL', payload: e.target.value })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleProcess()
              }
            }}
            onFocus={() => {
              // Fallback for browsers that raise the keyboard without a
              // visualViewport 'resize' â€” nudge after the slide-up settles.
              window.setTimeout(keepInputAboveKeyboard, 300)
            }}
            aria-invalid={urlError ? 'true' : 'false'}
            aria-describedby={urlError ? 'url-error' : undefined}
            /* Reserve room for the Paste chip only while it's shown (empty
               field); once a link is typed the chip is gone, so reclaim the
               width. The right-edge fade mask feathers an overflowing URL out
               instead of clipping it on a hard vertical edge. */
            className={`min-w-0 flex-1 rounded-xl bg-transparent py-3 pl-4 text-base text-white placeholder-white/40 outline-none [mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] [-webkit-mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] ${
              state.url ? 'pr-3' : 'pr-[4.75rem]'
            }`}
          />
          {/* One-tap paste â€” only while the field is empty, so it never overlaps
              a link the user is typing. Reads the clipboard and auto-resolves. */}
          {!state.url && (
            <button
              type='button'
              onClick={handlePaste}
              aria-label='Paste link from clipboard'
              className='card-hover absolute right-1.5 flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-xs font-medium text-white/70 hover:text-white active:scale-95'
            >
              <ClipboardIcon className='h-3.5 w-3.5' />
              Paste
            </button>
          )}
        </div>
        <button
          onClick={() => handleProcess()}
          disabled={
            state.loading ||
            state.downloading ||
            state.downloadingAudio ||
            state.downloadingImages
          }
          className='btn-grad btn-press group relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl px-6 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 md:text-base'
        >
          <span
            className='pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-1000 ease-out group-hover:translate-x-full'
            aria-hidden
          />
          {state.loading ? (
            <span className='relative flex items-center'>
              <SpinnerIcon className='-ml-1 mr-2 h-4 w-4 md:h-5 md:w-5' />
              Processing...
            </span>
          ) : (
            <span className='relative'>Download</span>
          )}
        </button>
      </Surface>

      {urlError && (
        <p
          id='url-error'
          role='alert'
          className='animate-section-in mt-2 flex items-center gap-1.5 text-xs text-red-300 md:text-sm'
        >
          <span aria-hidden>âš </span>
          {urlError}
        </p>
      )}

      {/* The strongest moment to make the case, and it costs nothing to be
          wrong: someone holding one link never sees it. A pasted list already
          works without the extras â€” it resolves one at a time into Recent and
          leaves every download to be tapped by hand â€” so this describes the
          tedium the visitor is one page away from, not a gated feature. */}
      {pastedLinks > 1 && (
        <ProNudge
          id='paste-multi'
          tone='attached'
          action='See how'
          lede={
            <>
              <strong className='font-semibold text-white'>
                {pastedLinks} links.
              </strong>{' '}
              These save to Recent to download one at a time. Supporters get a
              queue that runs the whole list.
            </>
          }
        />
      )}

      <p className='mt-3 text-center text-xs text-white/50'>
        Videos, reels, shorts, MP3 audio &amp; photo carousels â€” paste several
        links to grab them in one go
      </p>

      {/* Format + quality preferences â€” applied on the next resolve. Format
          picks video vs. audio-only (MP3); quality affects sources with a
          quality knob (most videos) and is irrelevant for audio, so it's hidden
          in audio mode. */}
      <div className='mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs'>
        <div className='flex items-center gap-2'>
          <span className='text-white/50'>Format</span>
          <div
            role='group'
            aria-label='Download format'
            className='inline-flex rounded-full border border-white/10 bg-white/[0.03] p-0.5'
          >
            {(['video', 'audio'] as const).map((f) => (
              <button
                key={f}
                type='button'
                onClick={() => changeFormat(f)}
                aria-pressed={format === f}
                className={`rounded-full px-3 py-1 font-medium transition-colors ${
                  format === f
                    ? 'bg-cyan-400/90 text-[#04171b]'
                    : 'text-white/55 hover:text-white'
                }`}
              >
                {f === 'video' ? 'Video' : 'Audio (MP3)'}
              </button>
            ))}
          </div>
        </div>

        {format === 'video' && (
          <div className='flex items-center gap-2'>
            <span className='text-white/50'>Quality</span>
            <div
              role='group'
              aria-label='Preferred video quality'
              className='inline-flex rounded-full border border-white/10 bg-white/[0.03] p-0.5'
            >
              {(['hd', 'sd'] as const).map((q) => (
                <button
                  key={q}
                  type='button'
                  onClick={() => changeQuality(q)}
                  aria-pressed={quality === q}
                  className={`rounded-full px-3 py-1 font-medium transition-colors ${
                    quality === q
                      ? 'bg-cyan-400/90 text-[#04171b]'
                      : 'text-white/55 hover:text-white'
                  }`}
                >
                  {q === 'hd' ? 'HD' : 'Data saver'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Pro-only batch queue â€” self-hides for free users, so no conditional
          is needed at the call site. */}
      <BatchPanel />

      {/* Recent â€” locally-stored links (never leaves the device). Stays on
          screen alongside a result: it is the way back to an earlier link, and
          hiding it exactly when you have something to compare against is when
          it's least useful. Only a resolve in flight hides it, so the list
          can't be re-tapped mid-request. Tap to re-resolve. */}
      {history.length > 0 && !state.loading && (
        <div className='animate-section-in mt-4'>
          <div className='mb-2 flex items-center justify-between'>
            <span className='flex items-center gap-1.5 text-xs font-medium text-white/50'>
              <ClockIcon className='h-3.5 w-3.5' />
              Recent
            </span>
            <button
              type='button'
              onClick={handleClearHistory}
              className='flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-white/50 transition-colors hover:text-white/80'
            >
              <TrashIcon className='h-3 w-3' />
              Clear
            </button>
          </div>
          <ul
            className={`space-y-1.5 ${
              showAllHistory ? 'max-h-72 overflow-y-auto pr-1' : ''
            }`}
          >
            {(showAllHistory ? history : history.slice(0, 5)).map((h) => (
              <li key={h.url} className='relative'>
                <button
                  type='button'
                  onClick={() => handleProcess(h.url)}
                  className='card-hover group flex w-full items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03] py-1.5 pr-9 pl-2 text-left'
                >
                  {/* Branded tile sits underneath; the snapshot (a self-contained
                      data URL) overlays it. If a legacy remote thumb ever fails,
                      onError removes it and the tile shows through. */}
                  <span className='relative h-9 w-9 shrink-0 overflow-hidden rounded-md'>
                    <PlatformTile platform={h.platform} />
                    {h.thumbnail && (
                      <img
                        src={
                          h.thumbnail.startsWith('data:')
                            ? h.thumbnail
                            : `/api/image?url=${encodeURIComponent(h.thumbnail)}`
                        }
                        alt=''
                        className='absolute inset-0 h-full w-full object-cover'
                        loading='lazy'
                        decoding='async'
                        onError={(e) => e.currentTarget.remove()}
                      />
                    )}
                  </span>
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate text-xs text-white/80'>
                      {h.title}
                    </span>
                    <span className='block truncate text-[10px] text-white/50'>
                      {h.author ||
                        (h.platform ? PLATFORM_DISPLAY[h.platform] : '') ||
                        'Saved link'}
                    </span>
                  </span>
                </button>
                <button
                  type='button'
                  onClick={() => removeHistory(h.url)}
                  aria-label={`Remove ${h.title} from recent`}
                  className='absolute top-1/2 right-1.5 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-white/30 transition-colors hover:bg-white/10 hover:text-white/70'
                >
                  <span aria-hidden className='text-base leading-none'>
                    Ã—
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {history.length > 5 && (
            <button
              type='button'
              onClick={() => setShowAllHistory((v) => !v)}
              className='card-hover mt-2 w-full rounded-lg border border-white/[0.06] py-1.5 text-center text-[11px] font-medium text-white/50 hover:text-white/80'
            >
              {showAllHistory ? 'Show less' : `View all (${history.length})`}
      #zã«h‘éì¶»§q«^v ¢¢6òvR&WV—&RF†R&ö&RFò7GVÆÇ’––VÆB'—FW2âvR7G&VÒF†R&W7öç6Ræ@¢¢&VBöæÇ’F†Rd•%5B6‡Væ²‡F†VâFV"F†R6öææV7F–öâF÷vâ’(	B6öæf—&Ö–ærF†P¢¢7G&VÒ—2Æ—fRv—F†÷WB'VffW&–ærF†Rv†öÆRf–ÆRâ„6ö&ÇBGVææVÇ2–væ÷&RF†P¢¢&ævR†VFW"æBv÷VÆB÷F†W'v—6R7G&VÒF†RVçF—&Rf–FVò–çFòÖVÖ÷'’†W&RÀ¢¢æBF†Vâv–âv†VâF†R6Æ–VçBfWF6†W2—Bf÷"&VÂâ¢ ¢¢&V¦V7D‡FÖÆFF—F–öæÆÇ’&VgW6W2&W7öç6RF†B—2vV"vRâ'—FW2&P¢¢F†R&–v‡BFW7Bf÷"GVææVÂ‡v†–6‚FV6Æ&W2æòW6VgVÂG—R’Â'WBU$À¢¢67&VBöfbvR6â&Rç7vW&VBv—F‚âW'&÷"vRÂæBâW'&÷"vP¢¢†2'—FW2Föòà¢¢ğ¢&—fFR7–æ2fW&–g•7G&VÕ&V6†&ÆR€¢W&Ã¢7G&–ærÀ¢÷G3ó¢²&V¦V7D‡FÖÃó¢&ööÆVâÒÀ¢“¢&öÖ—6SÆ&ööÆVãâ°¢òòæF—fRfWF6‚&F†W"F†â†–÷3¢†–÷2w2&W7öç6UG—S¢w7G&VÒv†æG0¢òò&6²æöFR&VF&ÆRÂv†–6‚—G2fWF6‚FFW"6ææ÷B&öGV6RæBv†–6€¢òòFöW2æ÷BW†—7Böâv÷&¶W&BâvV"&VF&ÆU7G&VÒv÷&·2–FVçF–6ÆÇ’öâ&÷F€¢òò'VçF–ÖW2ÂæB&VF–æröæR6‡Væ²g&öÒ—B6÷7G2æòÖVæ–ævgVÂ5Rà¢6öç7B&÷'BÒæWr&÷'D6öçG&öÆÆW"‚¢6öç7BF–ÖW"Ò6WEF–ÖV÷WB‚‚’Óâ&÷'Bæ&÷'B‚’Â#¢G'’°¢6öç7B&VfW&W"ÒvWDÖVF–&VfW&W"‡W&Â¢6öç7B†VFW'3¢&V6÷&CÇ7G&–ærÂ7G&–æsâÒ°¢&ævS¢v'—FW3ÓÓ#BrÀ¢uW6W"ÔvVçBs¢F†—2çW6W$vVçBÀ¢Ğ¢–b‡&VfW&W"’†VFW'2å&VfW&W"Ò&VfW&W  ¢6öç7B&W7öç6RÒv—BfWF6‚‡W&ÂÂ°¢†VFW'2À¢&VF—&V7C¢vföÆÆ÷rrÀ¢6–væÃ¢&÷'Bç6–væÂÀ¢Ò ¢6öç7B7FGW4ö²Ò&W7öç6Rç7FGW2ÓÓÒ#ÇÂ&W7öç6Rç7FGW2ÓÓÒ#`¢6öç7B—5vRÒ‡&W7öç6Ræ†VFW'2ævWB‚v6öçFVçB×G—Rr’óòrr’æ–æ6ÇVFW2€¢wFW‡Bö‡FÖÂrÀ¢¢òòâW‡Æ–6—B6öçFVçBÔÆVæwFƒ¢—2F†RV×G’×GVææVÂ6–væGW&R(	B&V¦V7BV&Ç’à¢–b€¢7FGW4ö²ÇÀ¢&W7öç6Ræ†VFW'2ævWB‚v6öçFVçBÖÆVæwF‚r’ÓÓÒsrÇÀ¢†÷G3òç&V¦V7D‡FÖÂbb—5vR¢’°¢v—B&W7öç6Ræ&öG“òæ6æ6VÂ‚¢&WGW&âfÇ6P¢Ğ¢–b‚&W7öç6Ræ&öG’’&WGW&âfÇ6P ¢òòG'VRöâF†Rf—'7BæöâÖV×G’6‡Væ³²fÇ6R–bF†R&öG’VæG2V×G’ÂW'&÷'2À¢òò÷"7FÆÇ2âöæR6‡Væ²—2Væ÷Vv‚(	BF†R&W7BöbF†Rf–ÆR—2æWfW"VÆÆVBÀ¢òòæB6æ6VÆÆ–ærFV'2F†R6öææV7F–öâF÷vâ6òF†RW7G&VÒ7F÷26VæF–ærà¢6öç7B&VFW"Ò&W7öç6Ræ&öG’ævWE&VFW"‚¢G'’°¢6öç7B²fÇVRÂFöæRÒÒv—B&VFW"ç&VB‚¢&WGW&âFöæRbb‡fÇVSòæ'—FTÆVæwF‚óò’â ¢Òf–æÆÇ’°¢v—B&VFW"æ6æ6VÂ‚’æ6F6‚‚‚’Óâ·Ò¢Ğ¢Ò6F6‚°¢&WGW&âfÇ6P¢Òf–æÆÇ’°¢6ÆV%F–ÖV÷WB‡F–ÖW"¢Ğ¢Ğ ¢&—fFR7–æ2F÷væÆöEF–µFö²‡W&Ã¢7G&–ær“¢&öÖ—6SÅf–FVôFFâ°¢6öç7Bf–FVô–BÒ'6Uf–FVô–B‡W&Â¢–b‚f–FVô–B’°¢F‡&÷ræWrW'&÷"‚t6÷VÆBæ÷BW‡G&7Bf–FVò”Bg&öÒU$Âr¢Ğ ¢òòF–·vÒæB6ö&ÇB&R&6VBÂæ÷BG&–VB–âGW&âà¢òòÒF–·vÒv—fW2F†R&–6†W7B&W7VÇB†6&÷W6VÇ2Â×W6–2ÂæöâÔ•Ö&÷VæBU$Â¢òòv†Vâ&V6†&ÆRÂ'WB—Bæ÷rVWVW2WfW'’&WVW7C¢ÖV7W&VB##bÓ‚ÓBÀ¢òò2ã'2vÆÂf÷"öæR÷7Bv–ç7B"ã2öb—G2÷vâ&ö6W76VE÷F–ÖVà¢òòÒ6ö&ÇB§GVææVÇ2¢F†RÖVF–F‡&÷Vv‚—G2÷vâ6W'fW"Â6òF†RU$Â—@¢òò&WGW&ç2—6âwB&÷VæBFòF–µFö²w26–væVB4Dâ6W76–öâæBÆ—2g&öÒç¢òò•‡F†R&rÆ”FG"F†B6æF–²öF—&V7B×67&R†æB&6²C72v†Và¢òò&RÖfWF6†VBg&öÒF–ffW&VçB†÷7B(	Bv†–6‚—2v‡’F–µFö²'&ö¶Röà¢òòfW&6VÂ’âÖV7W&VB‚ã72f÷"F†R6ÖR÷7Bà¢òğ¢òò–â6WVVæ6RF†Bv2ãg2öb6öÆB&W6öÇfRÂ&V6W6RF†Rf—6—F÷"–@¢òòF–·vÒw2VWVR–âgVÆÂ&Vf÷&R6ö&ÇBv2WfVâ6¶VBâ&6VBÂF†Rç7vW ¢òò'&—fW2v—F‚F†Rf7FW"öbF†RGvòÂæBF–·vÒ7F–ÆÂv–ç2v†VæWfW"—B—0¢òòF†Rf7FW"(	Bv†–6‚—2F†RöæÇ’6öæF—F–öâVæFW"v†–6‚—G2&–6†W"–Æö@¢òòv2v÷'F‚v—F–ærf÷"à¢6öç7B&6VBÒv—Bf—'7E&W7VÇB…°¢‚’ÓâF†—2çG'•F–·vÔÖWF†öB‡W&Â’À¢‚’ÓâF†—2çG'•F–µFö´6ö&ÇB‡W&Â’À¢Ò¢–b‡&6VB’&WGW&â&6V@ ¢òòWfW'—F†–ær&VÆ÷r—2fÆÆ&6²f÷"v†Vâ&÷F‚öbF†÷6RÖ—72ÂæB7F—0¢òò6WVVçF–Ã¢V6‚—2V—F†W"g&VR‡—BÖFÇÂ'6VçBöâv÷&¶W&B’÷"W‡Vç6—fP¢òòæBVæÆ–¶VÇ’‡F†RV&Æ–267&W'2’à¢òòÒ—BÖFÇ(	Bf7B²&VÆ–&ÆRÆö6ÆÇ’‡&W6–FVçF–Â•’ÂVæf–Æ&ÆRöà¢òòfW&6VÂ÷v÷&¶W&BÂv†W&R—B&WGW&ç2çVÆÂà¢òòÒF†R&VÖ–æ–ærV&Æ–267&W'22Æ7B&W6÷'G2‡6æF–²6†—0¢òòö&gW66FVB¥2Â777F–²æVVG2&÷FF–ærFö¶Vâ’â6¶—VBv†W&RvP¢òò67&–ær6ææ÷Bv÷&²(	B6VR‡FÖÅ67&–ætf–Æ&ÆR‚’(	B&V6W6RF†W’&P¢òòF†RW‡Vç6—fR†ÆböbF†—2Æ—7BæBÂöâFF6VçFW"•ÂF†R†Æ`¢òòF†BÇv—2Ö—76W2à¢6öç7BÖWF†öG2Ò°¢‚’ÓâF†—2çG'•—DFÇF–µFö²‡W&Â’À¢âââ†‡FÖÅ67&–ætf–Æ&ÆR‚¢ò°¢‚’ÓâF†—2çG'•6æF–´ÖWF†öB‡W&Â’À¢‚’ÓâF†—2çG'•554ÖWF†öB‡W&Â’À¢‚’ÓâF†—2çG'”F—&V7EF–µFöµ67&–ær‡W&Â’À¢Ğ¢¢µÒ’À¢Ğ ¢f÷"†6öç7BÖWF†öBöbÖWF†öG2’°¢G'’°¢6öç7B&W7VÇBÒv—BÖWF†öB‚¢–b‡&W7VÇB’°¢6öç6öÆRæÆör‚u7V66W76gVÆÇ’F÷væÆöFVBf–FVòW6–ærÖWF†öBr¢&WGW&â&W7VÇ@¢Ğ¢Ò6F6‚†W'&÷"’°¢6öç6öÆRçv&â‚tÖWF†öBf–ÆVBÂG'––æræW‡BââârÂW'&÷"¢6öçF–çVP¢Ğ¢Ğ ¢F‡&÷ræWrW'&÷"€¢tÆÂF÷væÆöBÖWF†öG2f–ÆVBâF–µFö²Ö–v‡B&R&Æö6¶–ær&WVW7G2÷"F†Rf–FVò—2&—fFRârÀ¢¢Ğ ¢ò¢ ¢¢—BÖFÇF–µFö²F‚âW6VB2F†R&VÆ–&ÆRfÆÆ&6²v†VâF†RV&Æ–267&W ¢¢6W'f–6W2f–Ââ&ö&W2f–Æ&–Æ—G’÷&V6†&–Æ—G’f–V–6²–æfòfWF6€¢¢‡v†–6‚Ç6ò––VÆG2F—FÆRöWF†÷"÷F‡VÖ&æ–ÂöGW&F–öâ“²öâ7V66W72&WGW&ç2¢¢&W7VÇBv†÷6Rf–FVòöVF–òö–çBBF†R6ÖRÖ÷&–v–âö’÷F–·Fö²7G&VÖ–æp¢¢VæGö–çBÂv†–6‚ÆWG2—BÖFÇFòF†R7GVÂfWF6‚6W'fW"×6–FR…F–µFö²w24Dà¢¢U$Ç2&R6–væVBv–ç7BF†RW‡G&7F–ær6W76–öâæB6âwB&R&WÆ–VB'’F†P¢¢Æ–âÖVF–&÷‡’’â&WGW&ç2çVÆÂv†Vâ—BÖFÇ—2Væf–Æ&ÆR†RærâfW&6VÂ’÷ ¢¢F†Rf–FVò6âwB&R&V6†VB†W&RÂ6òF†RæW‡BÖWF†öBvWG2GW&âà¢¢ğ¢&—fFR7–æ2G'•—DFÇF–µFö²‡W&Ã¢7G&–ær“¢&öÖ—6SÅf–FVôFFÂçVÆÃâ°¢6öç7B–æfòÒv—B—FFÇ–æfò‡W&Â¢–b‚–æfò’&WGW&âçVÆÀ ¢6öç7BVæ6öFVBÒVæ6öFUU$”6ö×öæVçB‡W&Â¢&WGW&â°¢–C¢'6Uf–FVô–B‡W&Â’ÇÂFFRææ÷r‚’çFõ7G&–ær‚’À¢F—FÆS¢–æfòçF—FÆRÇÂuF–µFö²f–FVòrÀ¢W&ÂÀ¢F‡VÖ&æ–Ã¢–æfòçF‡VÖ&æ–ÂÇÂrrÀ¢GW&F–öã¢ÖF‚ç&÷VæB†–æfòæGW&F–öâÇÂ’À¢WF†÷#¢–æfòçWÆöFW"ÇÂuVæ¶æ÷vârÀ¢FW67&—F–öã¢–æfòçF—FÆRÇÂrrÀ¢F÷væÆöEW&Ã¢ö’÷F–·Fö³÷W&ÃÒG¶Væ6öFVGÒf¶–æC×f–FVöÀ¢×W6–5W&Ã¢ö’÷F–·Fö³÷W&ÃÒG¶Væ6öFVGÒf¶–æCÖVF–öÀ¢—5†÷Fô6&÷W6VÃ¢fÇ6RÀ¢Ğ¢Ğ ¢ò¢ ¢¢F–µFö²f–6ö&ÇB(	BF†R&VÆ–&ÆRF‚öâFF6VçFW"†÷7G2…fW&6VÂ’â6ö&Ç@¢¢GVææVÇ2F†RÖVF–F‡&÷Vv‚—G2÷vâ6W'fW"Â6òF†R&WGW&æVBU$ÂÆ—2g&öÒç¢¢•ÂVæÆ–¶RF–µFö²w26–væVB4DâU$Ç2‡v†–6‚C2v†Vâ&RÖfWF6†VBVÇ6Wv†W&R’à¢¢F†RGVææVÂ6W'fW2'&÷w6W"Ög&–VæFÇ’‚ã#cBv—F‚&ævR7W÷'BÂ6ò—BG&—fW0¢¢&÷F‚F†R&Wf–WræBF†RF÷væÆöBF‡&÷Vv‚F†RW†—7F–ærö’÷f–FVò&÷‡’à¢ ¢¢6ö&ÇBw2ÖWFFF—27'6R†—BöæÇ’æÖW2F†Rf–ÆRF–·FöµóÆWF†÷#åóÆ–Cæ’À¢¢6òF—FÆRöWF†÷"÷F‡VÖ&æ–Â&RVç&–6†VBg&öÒF–µFö²w2V&Æ–2öVÖ&VBVæGö–çBà¢¢ğ¢&—fFR7–æ2G'•F–µFö´6ö&ÇB‡W&Ã¢7G&–ær“¢&öÖ—6SÅf–FVôFFÂçVÆÃâ°¢6öç7B&W7VÇBÒv—BF†—2çG'”6ö&ÇD–ç7Fæ6W2‡W&Â¢–b‚&W7VÇB’&WGW&âçVÆÀ ¢òò&V6÷fW"WF†÷"²çVÖW&–2–Bg&öÒ6ö&ÇBw2F–·FöµóÆWF†÷#åóÆ–Cæf–ÆVæÖP¢òò‡F†RF—FÆR—2F†Bf–ÆVæÖRÖ–çW2W‡FVç6–öâ’âfÆÇ2&6²FòF†RU$Âà¢6öç7BfäÖF6‚Ò&W7VÇBçF—FÆRæÖF6‚‚õçF–·Föµò‚â²•ò…ÆB²’Bò¢6öç7BfäWF†÷"ÒfäÖF6ƒòå³Ğ¢6öç7Bf–FVô–BÒfäÖF6ƒòå³%ÒÇÂ'6Uf–FVô–B‡W&Â’ÇÂ&W7VÇBæ–@¢&W7VÇBæ–BÒf–FVô–@ ¢6öç7B6æöæ–6ÂÒfäWF†÷ ¢ò‡GG3¢ò÷wwrçF–·Fö²æ6öÒôG¶fäWF†÷'Ò÷f–FVòòG·f–FVô–GÖ ¢¢W&À¢6öç7BÖWFÒv—BF†—2æfWF6…F–µFö´ÖWF†6æöæ–6Â ¢–b†ÖWFçF—FÆR’&W7VÇBçF—FÆRÒÖWFçF—FÆP¢VÇ6R–b†fäWF†÷"’&W7VÇBçF—FÆRÒF–µFö²'’G¶fäWF†÷'Ö ¢–b†ÖWFæWF†÷"’&W7VÇBæWF†÷"ÒÖWFæWF†÷ ¢VÇ6R–b†fäWF†÷"’&W7VÇBæWF†÷"ÒfäWF†÷ ¢–b†ÖWFçF‡VÖ&æ–Â’&W7VÇBçF‡VÖ&æ–ÂÒÖWFçF‡VÖ&æ–À ¢&WGW&â&W7VÇ@¢Ğ ¢ò¢ ¢¢F–µFö²F—FÆRöWF†÷"÷F‡VÖ&æ–Âg&öÒF†RV&Æ–2öVÖ&VBVæGö–çB†æòÆöv–â÷ ¢¢¶W’&WV—&VB’â&W7BÖVff÷'B(	B&WGW&ç2âV×G’ö&¦V7Böâç’f–ÇW&R6òF†P¢¢6ÆÆW"¶VW2v†FWfW"ÖWFFF—BÇ&VG’†Bà¢¢ğ¢&—fFR7–æ2fWF6…F–µFö´ÖWF€¢W&Ã¢7G&–ærÀ¢“¢&öÖ—6SÇ²F—FÆSó¢7G&–æs²WF†÷#ó¢7G&–æs²F‡VÖ&æ–Ãó¢7G&–ærÓâ°¢G'’°¢6öç7B&W7öç6RÒv—B‡GGævWB€¢‡GG3¢ò÷wwrçF–·Fö²æ6öÒööVÖ&VC÷W&ÃÒG¶Væ6öFUU$”6ö×öæVçB‡W&Â—ÖÀ¢°¢†VFW'3¢²uW6W"ÔvVçBs¢F†—2çW6W$vVçBÂ66WC¢vÆ–6F–öâö§6öârÒÀ¢F–ÖV÷WC¢#À¢ÒÀ¢¢&WGW&â°¢F—FÆS¢&W7öç6RæFFòçF—FÆRÀ¢WF†÷#¢&W7öç6RæFFòæWF†÷%öæÖRÀ¢F‡VÖ&æ–Ã¢&W7öç6RæFFòçF‡VÖ&æ–Å÷W&ÂÀ¢Ğ¢Ò6F6‚°¢&WGW&â·Ğ¢Ğ¢Ğ ¢òòG'’WfW'’6ö&ÇB–ç7Fæ6R–â÷&FW"à¢&—fFR7–æ2G'”6ö&ÇD–ç7Fæ6W2‡W&Ã¢7G&–ær“¢&öÖ—6SÅf–FVôFFÂçVÆÃâ°¢6öç7BW'&÷'3¢7G&–æuµÒÒµĞ¢òò6VÆbÖ†÷7FVB&W6öÇfW"F†B6VÆb×&Vv—7FW'2—G2‡÷76–&Ç’&÷FF–ær’U$Â—0¢òòF—66÷fW&VBB&WVW7BF–ÖRæBVæFVBgFW"F†R7FF–2Æ—7B(	B6ò—Bw0¢òò&V6†VBWfVâv†Vâ—G2V&Æ–2U$Â†26†ævVBæBæòVçbv2WFFVBâFVGWV@¢òòv–ç7BF†R6öæf–wW&VB–ç7Fæ6W26ò7F&ÆRU$Â—6âwBG&–VBGv–6Rà¢6öç7BF—66÷fW&VBÒv—BF—66÷fW%&W6öÇfW$&6R‚¢6öç7B6öæf–wW&VBÒæWr6WB€¢F†—2æ6ö&ÇD–ç7Fæ6W2æÖ‚†’’Óâ’ç&WÆ6R‚õÂòBòÂrr’’À¢¢6öç7B–ç7Fæ6W2Ğ¢F—66÷fW&VBbb6öæf–wW&VBæ†2†F—66÷fW&VBç&WÆ6R‚õÂòBòÂrr’¢ò²ââçF†—2æ6ö&ÇD–ç7Fæ6W2ÂF—66÷fW&VEĞ¢¢F†—2æ6ö&ÇD–ç7Fæ6W0¢òò&VfW"â–ç7Fæ6RF†B§GVææVÇ2¢÷fW"öæRF†B†æG2&6²&r4Dà¢òò&VF—&V7Bâ&÷F‚&RW6&ÆRÂ'WBöæÇ’GVææVÂ7G&V×2g&öÒç’•v—F€¢òò6öçFVçBÔF—7÷6—F–öâ6WBÂv†–6‚ÆWG2F†R'&÷w6W"VÆÂF†Rf–ÆR7G&–v‡@¢òòg&öÒF†R–ç7Fæ6R(	B&VF—&V7B†2Fò&R&R×7G&VÖVBF‡&÷Vv‚÷W"÷và¢òò&÷‡’f÷"&VfW&W"ö6öçFVçB×G—RÂWGF–ærWfW'’'—FRöbF†RF÷væÆöBöâ÷W ¢òò†÷7Bâ6ò&VF—&V7B—2†VÆB2fÆÆ&6²æBF†R&VÖ–æ–ær–ç7Fæ6W2&P¢òò7F–ÆÂG&–VC²—B—2öæÇ’W6VB–bæ÷F†–ærGVææVÇ2à¢òòöæÇ’&rÔ4Dâ&VF—&V7B—2FVfW'&VBÂ–FVçF–f–VB'’GVææVÂÓÓÒfÇ6Và¢òòF†BfÆr—26WBW‡Æ–6—FÇ’öâF†RGVææVÂ÷&VF—&V7B'&æ6‚ÆöæRÂ6ò¢òò–6¶W&&W7VÇB‡†÷Fò6&÷W6VÂ’ÆVfW2—BVæFVf–æVBæB—2&WGW&æV@¢òò–ÖÖVF–FVÇ’Æ–¶Rç’÷F†W"FW&Ö–æÂç7vW"à¢ÆWB&VF—&V7DfÆÆ&6³¢f–FVôFFÂçVÆÂÒçVÆÀ¢f÷"†6öç7B–ç7Fæ6Röb–ç7Fæ6W2’°¢G'’°¢6öç7B&W7VÇBÒv—BF†—2çG'”6ö&ÇD–ç7Fæ6R†–ç7Fæ6RÂW&Â¢–b‚&W7VÇB’6öçF–çVP¢–b‡&W7VÇBçGVææVÂÓÓÒfÇ6R’°¢&VF—&V7DfÆÆ&6²óóÒ&W7VÇ@¢6öçF–çVP¢Ğ¢&WGW&â&W7VÇ@¢Ò6F6‚†R’°¢W'&÷'2çW6‚†G¶–ç7Fæ6WÓ¢G¶WÖ¢Ğ¢Ğ¢–b‡&VF—&V7DfÆÆ&6²’&WGW&â&VF—&V7DfÆÆ&6°¢6öç6öÆRçv&â‚tÆÂ6ö&ÇB–ç7Fæ6W2f–ÆVC¢rÂW'&÷'2¢&WGW&âçVÆÀ¢Ğ ¢&—fFR7–æ2G'”6ö&ÇD–ç7Fæ6R€¢&6UW&Ã¢7G&–ærÀ¢W&Ã¢7G&–ærÀ¢“¢&öÖ—6SÅf–FVôFFÂçVÆÃâ°¢6öç7B†VFW'3¢&V6÷&CÇ7G&–ærÂ7G&–æsâÒ°¢66WC¢vÆ–6F–öâö§6öârÀ¢t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öârÀ¢Ğ¢òòv†VâF†R‡6VÆbÖ†÷7FVB’–ç7Fæ6R&WV—&W2WF‚Âf÷'v&BF†R¶W’6òöæÇ¢òòF†—26âW6R—BâæòÖ÷f÷"F†R÷VâV&Æ–2–ç7Fæ6Rà¢–b‡&ö6W72æVçbä4ô$ÅEô•ô´U’’°¢†VFW'2äWF†÷&—¦F–öâÒ’Ô¶W’G·&ö6W72æVçbä4ô$ÅEô•ô´U—Ö ¢Ğ ¢òòVF–òÖöFR6·26ö&ÇBf÷"âVF–òÖöæÇ’Õ2GVææVÂ‡F†R.(i"Õ2"fÆ÷r“°¢òò÷F†W'v—6Ræ÷&ÖÂf–FVòGVææVÂBF†R&VfW'&VBVÆ—G’à¢6öç7B&öG’Ğ¢F†—2æÖöFRÓÓÒvVF–òp¢ò°¢W&ÂÀ¢F÷væÆöDÖöFS¢vVF–òrÀ¢VF–ôf÷&ÖC¢v×2rÀ¢f–ÆVæÖU7G–ÆS¢v&6–2rÀ¢Ğ¢¢°¢W&ÂÀ¢f–FVõVÆ—G“¢F†—2çf–FVõVÆ—G’ÓÓÒw6BròsCƒr¢vÖ‚rÀ¢f–ÆVæÖU7G–ÆS¢v&6–2rÀ¢Ğ ¢òò&WG'’G&ç6–VçBf–ÇW&W2ƒC#’òW‡‚ò6öÆB×7F'BF–ÖV÷WG2’&Vf÷&Rv—f–æp¢òòWöâF†—2–ç7Fæ6RæBÖ÷f–ærFòF†RæW‡Bà¢6öç7B&W7öç6RÒv—Bv—F…&WG'’€¢‚’Óâ‡GGç÷7B†&6UW&ÂÂ&öG’Â²†VFW'2ÂF–ÖV÷WC¢#Ò’À¢²&WG&–W3¢"Â—5&WG'–&ÆS¢—5G&ç6–VçDW'&÷"ÒÀ¢ ¢6öç7BFFÒ&W7öç6RæFF ¢–b†FFç7FGW2ÓÓÒvW'&÷"r’°¢F‡&÷ræWrW'&÷"€¢6ö&ÇBW'&÷#¢G¶FFæW'&÷#òæ6öFRóò¥4ôâç7G&–æv–g’†FFæW'&÷"—ÖÀ¢¢Ğ ¢–b†FFç7FGW2ÓÓÒwGVææVÂrÇÂFFç7FGW2ÓÓÒw&VF—&V7Br’°¢6öç7B—4VF–òÒF†—2æÖöFRÓÓÒvVF–òp¢&WGW&â°¢–C¢FFRææ÷r‚’çFõ7G&–ær‚’À¢F—FÆS¢FFæf–ÆVæÖSòç&WÆ6R‚õÂåµâåÒ²BòÂrr’ÇÂu6ö6–ÂÖVF–f–FVòrÀ¢W&ÂÀ¢F‡VÖ&æ–Ã¢rrÀ¢GW&F–öã¢À¢WF†÷#¢uVæ¶æ÷vârÀ¢FW67&—F–öã¢rrÀ¢òò–âVF–òÖöFRF†RGVææVÂ—2âÕ2(	B†æB—B&6²2F†R×W6–2G&6°¢òò†æòf–FVò’Â6òF†R’6W'fW2—BF‡&÷Vv‚F†RVF–òF‚à¢F÷væÆöEW&Ã¢—4VF–òòrr¢FFçW&ÂÀ¢âââ†—4VF–òò²×W6–5W&Ã¢FFçW&ÂÒ¢·Ò’À¢òòGVææVÂ7G&V×2g&öÒç’•v—F‚6öçFVçBÔF—7÷6—F–öã¢GF6†ÖVçBÂ6ğ¢òòF†R'&÷w6W"6âF÷væÆöB—BF—&V7FÇ’†'—76–ær÷W"&÷‡’’â¢òò&VF—&V7F—2&r4DâU$Â(	BFòäõBÖ&²—BF—&V7B×6fRà¢GVææVÃ¢FFç7FGW2ÓÓÒwGVææVÂrÀ¢Ğ¢Ğ ¢–b†FFç7FGW2ÓÓÒw–6¶W"r’°¢6öç7B—FV×2ÒFFç–6¶W"2'&“Ç°¢G—S¢7G&–æp¢W&Ã¢7G&–æp¢F‡VÖ#ó¢7G&–æp¢Óà¢6öç7Bf–FV÷2Ò—FV×3òæf–ÇFW"‚‡’ÓâçG—RÓÓÒwf–FVòr’ÇÂµĞ¢6öç7B†÷F÷2Ò—FV×3òæf–ÇFW"‚‡’ÓâçG—RÓÓÒw†÷Fòr’ÇÂµĞ¢6öç7BF÷væÆöEW&ÂÒf–FV÷5³ÓòçW&ÂÇÂ—FV×3òå³ÓòçW&ÂÇÂrp ¢6öç7B–ÖvW3¢–ÖvTFFµÒÒ†÷F÷2æÖ€¢†–Ös¢²W&Ã¢7G&–æs²F‡VÖ#ó¢7G&–ærÒÂ“¢çVÖ&W"’Óâ‡°¢–C¢–ÖuòG¶—ÖÀ¢W&Ã¢–ÖrçW&ÂÀ¢F‡VÖ&æ–Ã¢–ÖrçF‡VÖ"ÇÂ–ÖrçW&ÂÀ¢Ò’À¢ ¢&WGW&â°¢–C¢FFRææ÷r‚’çFõ7G&–ær‚’À¢F—FÆS¢FFæf–ÆVæÖSòç&WÆ6R‚õÂåµâåÒ²BòÂrr’ÇÂu6ö6–ÂÖVF–6öçFVçBrÀ¢W&ÂÀ¢F‡VÖ&æ–Ã¢—FV×3òå³ÓòçF‡VÖ"ÇÂrrÀ¢GW&F–öã¢À¢WF†÷#¢uVæ¶æ÷vârÀ¢FW67&—F–öã¢rrÀ¢F÷væÆöEW&ÂÀ¢–ÖvW3¢–ÖvW2æÆVæwF‚âò–ÖvW2¢VæFVf–æVBÀ¢—5†÷Fô6&÷W6VÃ¢–ÖvW2æÆVæwF‚âÀ¢Ğ¢Ğ ¢6öç6öÆRçv&â‚t6ö&ÇBVæW‡V7FVB7FGW3¢rÂFFç7FGW2ÂFF¢&WGW&âçVÆÀ¢Ğ ¢òòGv—GFW"õƒ¢W6Rg‡Gv—GFW"’†÷Vâ6÷W&6RÂæòWF‚&WV—&VB¢&—fFR7–æ2G'•g…Gv—GFW$ÖWF†öB‡W&Ã¢7G&–ær“¢&öÖ—6SÅf–FVôFFÂçVÆÃâ°¢òòW‡G&7BW6W&æÖRæBGvVWB”Bg&öÒU$À¢6öç7BÖF6‚ÒW&ÂæÖF6‚‚òƒó§Gv—GFW'Ç‚•Âæ6öÕÂò…µâõÒ²•Â÷7FGW5Âò…ÆB²’ò¢–b‚ÖF6‚’F‡&÷ræWrW'&÷"‚t6÷VÆBæ÷B'6RGv—GFW"U$Âr¢6öç7B²ÂW6W&æÖRÂGvVWD–EÒÒÖF6€ ¢6öç7B&W7öç6RÒv—B‡GGævWB€¢‡GG3¢òö’çg‡Gv—GFW"æ6öÒòG·W6W&æÖWÒ÷7FGW2òG·GvVWD–GÖÀ¢°¢†VFW'3¢°¢uW6W"ÔvVçBs¢F†—2çW6W$vVçBÀ¢66WC¢vÆ–6F–öâö§6öârÀ¢ÒÀ¢F–ÖV÷WC¢#À¢ÒÀ¢ ¢6öç7BFFÒ&W7öç6RæFF ¢òòf–æB&W7Bf–FVòÖVF–¢6öç7BÖVF–—FV×2Ò†FFæÖVF–öW‡FVæFVBóòFFæÖVF–óòµÒ’2'&“Ç°¢G—S¢7G&–æp¢W&Ã¢7G&–æp¢F‡VÖ&æ–Å÷W&Ãó¢7G&–æp¢ÇEFW‡Có¢7G&–æp¢Óà ¢6öç7Bf–FVô—FVÒÒÖVF–—FV×2æf–æB€¢†Ò’ÓâÒçG—RÓÓÒwf–FVòrÇÂÒçG—RÓÓÒvv–brÀ¢¢6öç7B†÷Fô—FV×2ÒÖVF–—FV×2æf–ÇFW"‚†Ò’ÓâÒçG—RÓÓÒv–ÖvRr ¢–b‚f–FVô—FVÒbb†÷Fô—FV×2æÆVæwF‚ÓÓÒ’°¢F‡&÷ræWrW'&÷"‚tæòF÷væÆöF&ÆRÖVF–f÷VæB–âGvVWBr¢Ğ ¢6öç7BF÷væÆöEW&ÂÒf–FVô—FVÓòçW&ÂÇÂrp¢6öç7B–ÖvW3¢–ÖvTFFµÒÒ†÷Fô—FV×2æÖ‚†–ÖrÂ’’Óâ‡°¢–C¢Guö–ÖuòG¶—ÖÀ¢W&Ã¢–ÖrçW&ÂÀ¢F‡VÖ&æ–Ã¢–ÖrçF‡VÖ&æ–Å÷W&ÂÇÂ–ÖrçW&ÂÀ¢Ò’ ¢&WGW&â°¢–C¢GvVWD–BÀ¢F—FÆS¢FFçFW‡@¢òFFçFW‡Bç6Æ–6RƒÂƒ’ç&WÆ6R‚õÇ2²örÂrr¢¢GvVWB'’G·W6W&æÖWÖÀ¢W&ÂÀ¢F‡VÖ&æ–Ã¢f–FVô—FVÓòçF‡VÖ&æ–Å÷W&ÂÇÂ†÷Fô—FV×5³ÓòçW&ÂÇÂrrÀ¢GW&F–öã¢À¢WF†÷#¢FFçW6W%öæÖRÇÂW6W&æÖRÀ¢FW67&—F–öã¢FFçFW‡BÇÂrrÀ¢F÷væÆöEW&ÂÀ¢–ÖvW3¢–ÖvW2æÆVæwF‚âò–ÖvW2¢VæFVf–æVBÀ¢—5†÷Fô6&÷W6VÃ¢–ÖvW2æÆVæwF‚âbbf–FVô—FVÒÀ¢Ğ¢Ğ ¢&—fFR7–æ2G'•6æF–´ÖWF†öB‡W&Ã¢7G&–ær“¢&öÖ—6SÅf–FVôFFÂçVÆÃâ°¢G'’°¢òò7FW¢vWBF†RÖ–âvRFòW‡G&7BæV6W76'’Fö¶Vç0¢v—B‡GGævWB‚v‡GG3¢ò÷6æF–²æòrÂ°¢†VFW'3¢²uW6W"ÔvVçBs¢F†—2çW6W$vVçBÒÀ¢Ò ¢òò7FW#¢7V&Ö—BF†RU$À¢6öç7Bf÷&ÔFFÒæWrU$Å6V&6…&×2‚¢f÷&ÔFFæVæB‚wW&ÂrÂW&Â ¢6öç7B&W7öç6RÒv—B‡GGç÷7B€¢v‡GG3¢ò÷6æF–²æö&3"ç‡rÀ¢f÷&ÔFFÀ¢°¢†VFW'3¢°¢t6öçFVçBÕG—Rs¢vÆ–6F–öâ÷‚×wwrÖf÷&Ò×W&ÆVæ6öFVBrÀ¢uW6W"ÔvVçBs¢F†—2çW6W$vVçBÀ¢&VfW&W#¢v‡GG3¢ò÷6æF–²æòrÀ¢÷&–v–ã¢v‡GG3¢ò÷6æF–²ærÀ¢ÒÀ¢F–ÖV÷WC¢3À¢ÒÀ¢ ¢–b‡&W7öç6RæFFbbG—Vöb&W7öç6RæFFÓÓÒw7G&–ærr’°¢òòÆöö²f÷"F÷væÆöBÆ–æ·0¢6öç7BF÷væÆöDÆ–æ·2Ò×D‡&Vg2‡&W7öç6RæFF ¢–b†F÷væÆöDÆ–æ·2æÆVæwF‚â’°¢6öç7Bf–FVô–BÒ'6Uf–FVô–B‡W&Â’ÇÂwVæ¶æ÷vâp¢&WGW&â°¢–C¢f–FVô–BÀ¢F—FÆS¢uF–µFö²f–FVò…6æF–²’rÀ¢W&Ã¢W&ÂÀ¢F‡VÖ&æ–Ã¢rrÀ¢GW&F–öã¢À¢WF†÷#¢uVæ¶æ÷vârÀ¢FW67&—F–öã¢tF÷væÆöFVBf–6æF–²rÀ¢F÷væÆöEW&Ã¢F÷væÆöDÆ–æ·5³ÒÂòòW6RF†Rf—'7B‡W7VÆÇ’†–v†W7BVÆ—G’’Æ–æ°¢Ğ¢Ğ¢Ğ¢Ò6F6‚°¢F‡&÷ræWrW'&÷"‚u6æF–²ÖWF†öBf–ÆVBr¢Ğ¢&WGW&âçVÆÀ¢Ğ ¢&—fFR7–æ2G'•554ÖWF†öB‡W&Ã¢7G&–ær“¢&öÖ—6SÅf–FVôFFÂçVÆÃâ°¢G'’°¢6öç7B&W7öç6RÒv—B‡GGç÷7B€¢v‡GG3¢ò÷777F–²æ–òö&2rÀ¢°¢–C¢W&ÂÀ¢Æö6ÆS¢vVârÀ¢GC¢u$d&•£4&’rÀ¢ÒÀ¢°¢†VFW'3¢°¢t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öârÀ¢uW6W"ÔvVçBs¢F†—2çW6W$vVçBÀ¢66WC¢vÆ–6F–öâö§6öâÂFW‡B÷Æ–âÂ¢ò¢rÀ¢÷&–v–ã¢v‡GG3¢ò÷777F–²æ–òrÀ¢&VfW&W#¢v‡GG3¢ò÷777F–²æ–òöVârÀ¢ÒÀ¢F–ÖV÷WC¢3À¢ÒÀ¢ ¢–b‡&W7öç6RæFFbb&W7öç6RæFFçW&Â’°¢6öç7Bf–FVô–BÒ'6Uf–FVô–B‡W&Â’ÇÂwVæ¶æ÷vâp¢&WGW&â°¢–C¢f–FVô–BÀ¢F—FÆS¢&W7öç6RæFFçF—FÆRÇÂuF–µFö²f–FVò…557B’rÀ¢W&Ã¢W&ÂÀ¢F‡VÖ&æ–Ã¢&W7öç6RæFFæ6÷fW"ÇÂrrÀ¢GW&F–öã¢&W7öç6RæFFæGW&F–öâÇÂÀ¢WF†÷#¢&W7öç6RæFFæWF†÷"ÇÂuVæ¶æ÷vârÀ¢FW67&—F–öã¢&W7öç6RæFFçF—FÆRÇÂtF÷væÆöFVBf–555F–²rÀ¢F÷væÆöEW&Ã¢&W7öç6RæFFçW&ÂÀ¢Ğ¢Ğ¢Ò6F6‚°¢F‡&÷ræWrW'&÷"‚u555F–²ÖWF†öBf–ÆVBr¢Ğ¢&WGW&âçVÆÀ¢Ğ ¢&—fFR7–æ2G'•F–·vÔÖWF†öB‡W&Ã¢7G&–ær“¢&öÖ—6SÅf–FVôFFÂçVÆÃâ°¢G'’°¢6öç7B&W7öç6RÒv—B‡GGç÷7B€¢v‡GG3¢ò÷wwrçF–·vÒæ6öÒö’òrÀ¢°¢W&Ã¢W&ÂÀ¢6÷VçC¢"À¢7W'6÷#¢À¢òòäòvV#¢âF†BfÆr7v—F6†W2WfW'’U$Â–âF†R&W7öç6R÷fW"Fğ¢òòF–·vÒw2÷vâ†÷7C¢F†R6÷fW"&V6öÖW2†÷FÆ–æ²ÖvFVBF‚F†BC70¢òòf÷"WfW'–öæR†¶–ÆÆ–ærF†R&Wf–Wr÷7FW"’æB÷&–v–åö6÷fW&ğ¢òò•öG–æÖ–5ö6÷fW&6öÖR&6²V×G’Â6òF†W&R—2æò'6öÇWFR6÷fW ¢òòÆVgBFòfÆÂ&6²Fòâv—F†÷WBF†RfÆrvRvWBF†R6–væVBF–·Fö¶6Fà¢òò÷&–v–æÇ2Âv†–6‚F†R'&÷w6W"ÆöG2F—&V7FÇ’ƒ#’æBv†–6‚÷W ¢òòö’÷f–FVò&÷‡’6â7F–ÆÂ&ævRÖfWF6‚(	BfW&–f–VBv–ç7BF†P¢òòFWÆ÷–VBv÷&¶W#¢#bv—F‚6÷'&V7B6öçFVçBÕ&ævRà¢†C¢F†—2çf–FVõVÆ—G’ÓÓÒw6Brò¢À¢ÒÀ¢°¢†VFW'3¢°¢t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öârÀ¢uW6W"ÔvVçBs¢F†—2çW6W$vVçBÀ¢66WC¢vÆ–6F–öâö§6öâÂFW‡B÷Æ–âÂ¢ò¢rÀ¢÷&–v–ã¢v‡GG3¢ò÷wwrçF–·vÒæ6öÒrÀ¢&VfW&W#¢v‡GG3¢ò÷wwrçF–·vÒæ6öÒòrÀ¢ÒÀ¢F–ÖV÷WC¢3À¢ÒÀ¢ ¢–b‡&W7öç6RæFFbb&W7öç6RæFFæ6öFRÓÓÒbb&W7öç6RæFFæFF’°¢6öç7BFFÒ&W7öç6RæFFæFF¢6öç7Bf–FVô–BÒ'6Uf–FVô–B‡W&Â’ÇÂwVæ¶æ÷vâp ¢6öç7BF‡VÖ&æ–ÂÒ–6µF–·vÔ6÷fW"†FF ¢òò6†V6²–bF†—2—2†÷Fò6&÷W6VÂ‡6Æ–FW6†÷r¢6öç7B—5†÷Fô6&÷W6VÂĞ¢FFæ–ÖvW2bb'&’æ—4'&’†FFæ–ÖvW2’bbFFæ–ÖvW2æÆVæwF‚â  ¢ÆWB–ÖvW3¢–ÖvTFFµÒÒµĞ¢–b†—5†÷Fô6&÷W6VÂ’°¢–ÖvW2ÒFFæ–ÖvW2æÖ‚†–Ös¢7G&–ærÂ–æFWƒ¢çVÖ&W"’Óâ‡°¢–C¢G·f–FVô–GÕö–ÖuòG¶–æFW‡ÖÀ¢W&Ã¢–ÖrÀ¢F‡VÖ&æ–Ã¢–ÖrÀ¢Ò’¢Ğ ¢ÆWBF÷væÆöEW&Ã¢7G&–ærÂVæFVf–æV@ ¢òò†÷Fò6&÷W6VÇ3¢6¶—F–·vÒw2Æ–U$Â(	Bf÷"6Æ–FW6†÷r÷7G2—@¢òòö–çG2FòâVF–òÖöæÇ’ÕBv—F‚æò–ÖvRg&ÖW2âF†Rö’÷6Æ–FW6†÷p¢òò&÷WFR&VæFW'2&÷W"–ÖvW2¶×W6–2ÕBöâFVÖæB–ç7FVBà¢–b‚—5†÷Fô6&÷W6VÂ’°¢6öç7B†GÆ•W&ÂÒF–·vÔ'6öÇWFUW&Â†FFæ†GÆ’¢6öç7BÆ•W&ÂÒF–·vÔ'6öÇWFUW&Â†FFçÆ’¢6öç7Bv×Æ•W&ÂÒF–·vÔ'6öÇWFUW&Â†FFçv×Æ’ ¢–b††GÆ•W&Â’°¢òòfW&–g’F†R„BU$ÂW6W2'&÷w6W"×&VæFW&&ÆR6öFV2à¢òòF–µFö²6öÖWF–ÖW2Væ6öFW2v—F‚'f3"„'—FTFæ6R&÷&–WF'’’v†–6‚æò'&÷w6W"7W÷'G2À¢òò6W6–ærF†Rf–FVòVÆVÖVçBFò&VæFW"VF–òÖöæÇ’‚'6†÷w22×2"’à¢6öç7B†D6ö×F–&ÆRÒv—BF†—2æ6†V6µf–FVô6öFV46ö×F–&ÆR††GÆ•W&Â¢–b††D6ö×F–&ÆR’°¢F÷væÆöEW&ÂÒ†GÆ•W&À¢ÒVÇ6R°¢6öç6öÆRæÆör€¢·F–·vÕÒ†GÆ’W6W2Vç7W÷'FVB6öFV2f÷"G·f–FVô–GÒ(	BfÆÆ–ær&6²FòÆ’„‚ã#cB–À¢¢F÷væÆöEW&ÂÒÆ•W&ÂÇÂv×Æ•W&ÂÇÂ†GÆ•W&À¢Ğ¢ÒVÇ6R°¢F÷væÆöEW&ÂÒÆ•W&ÂÇÂv×Æ•W&À¢Ğ¢Ğ ¢òò6Æ–FW6†÷r6÷VæGG&6²…F–µFö²†÷Fò6&÷W6VÇ2Çv—2†fR×W6–2G&6²¢6öç7B×W6–5W&ÂĞ¢F–·vÔ'6öÇWFUW&Â†FFæ×W6–5ö–æfóòçÆ’’ÇÂF–·vÔ'6öÇWFUW&Â†FFæ×W6–2¢6öç7B×W6–5F—FÆRÒFFæ×W6–5ö–æfóòçF—FÆP¢6öç7B×W6–4WF†÷"ÒFFæ×W6–5ö–æfóòæWF†÷  ¢&WGW&â°¢–C¢f–FVô–BÀ¢F—FÆS¢FFçF—FÆRÇÂuF–µFö²f–FVòrÀ¢W&Ã¢W&ÂÀ¢F‡VÖ&æ–ÂÀ¢GW&F–öã¢FFæGW&F–öâÇÂÀ¢WF†÷#¢FFæWF†÷#òææ–6¶æÖRÇÂuVæ¶æ÷vârÀ¢FW67&—F–öã¢FFçF—FÆRÇÂrrÀ¢F÷væÆöEW&Ã¢F÷væÆöEW&ÂóòrrÀ¢–ÖvW2À¢—5†÷Fô6&÷W6VÂÀ¢×W6–5W&ÂÀ¢×W6–5F—FÆRÀ¢×W6–4WF†÷"À¢Ğ¢Ğ¢Ò6F6‚†R’°¢F‡&÷ræWrW'&÷"€¢F–·vÒÖWF†öBf–ÆVC¢G¶R–ç7Fæ6VöbW'&÷"òRæÖW76vR¢WÖÀ¢¢Ğ¢&WGW&âçVÆÀ¢Ğ ¢&—fFR7–æ2G'”F—&V7EF–µFöµ67&–ær€¢W&Ã¢7G&–ærÀ¢“¢&öÖ—6SÅf–FVôFFÂçVÆÃâ°¢G'’°¢òòf—'7B&W6öÇfRç’6†÷'FVæVBU$Ç0¢6öç7B&W6öÇfVEW&ÂÒv—BF†—2ç&W6öÇfUW&Â‡W&Â ¢6öç7B&W7öç6RÒv—B‡GGævWB‡&W6öÇfVEW&ÂÂ°¢†VFW'3¢°¢uW6W"ÔvVçBs¢F†—2çW6W$vVçBÀ¢66WC ¢wFW‡Bö‡FÖÂÆÆ–6F–öâ÷†‡FÖÂ·†ÖÂÆÆ–6F–öâ÷†ÖÃ·Óã’Æ–ÖvR÷vV'Â¢ò£·Óã‚rÀ¢t66WBÔÆæwVvRs¢vVâÕU2ÆVã·ÓãRrÀ¢t66WBÔVæ6öF–ærs¢vw¦—ÂFVfÆFRÂ'"rÀ¢6öææV7F–öã¢v¶VWÖÆ—fRrÀ¢uWw&FRÔ–ç6V7W&RÕ&WVW7G2s¢srÀ¢ÒÀ¢F–ÖV÷WC¢3À¢Ò ¢òòVÆÂF†R7FFR&Æö"F–µFö²–æÆ–æW2–çFòF†RvRâöæÇ’F†RöæR67&—@¢òò6''––ærF†RÖ&¶W"—2ÖFW&–Æ—6VB(	BF†RvR6†—2ÖVv'—FW2ö`¢òòÖ&·WÂ6ò'V–ÆF–ærDôÒFòf–æB—Bv÷VÆB6÷7B÷&FW'2öbÖvæ—GVFP¢òòÖ÷&R5RF†âÆö6F–ærF†RÖ&¶W"F—&V7FÇ’à¢6öç7B6öçFVçBÒ67&—D6öçF–æ–ær‡&W7öç6RæFFÂwvV&çf–FVòÖFWF–Âr¢–b†6öçFVçB’°¢òòW‡G&7Bf–FVòU$Ç2g&öÒF†R67&—B6öçFVç@¢6öç7Bf–FVõW&ÄÖF6‚Ò6öçFVçBæÖF6‚‚ò'Æ”FG"#¢"…µâ%Ò²’"ò¢6öç7BF÷væÆöEW&ÄÖF6‚Ò6öçFVçBæÖF6‚‚ò&F÷væÆöDFG"#¢"…µâ%Ò²’"ò ¢–b‡f–FVõW&ÄÖF6‚ÇÂF÷væÆöEW&ÄÖF6‚’°¢6öç7Bf–FVô–BÒ'6Uf–FVô–B‡W&Â’ÇÂwVæ¶æ÷vâp¢6öç7BF÷væÆöEW&ÂÒ€¢F÷væÆöEW&ÄÖF6ƒòå³ÒÇÀ¢f–FVõW&ÄÖF6ƒòå³ÒÇÀ¢rp¢’ç&WÆ6R‚õÅÇS$börÂròr ¢&WGW&â°¢–C¢f–FVô–BÀ¢F—FÆS¢uF–µFö²f–FVò„F—&V7B’rÀ¢W&Ã¢W&ÂÀ¢F‡VÖ&æ–Ã¢rrÀ¢GW&F–öã¢À¢WF†÷#¢uVæ¶æ÷vârÀ¢FW67&—F–öã¢tF÷væÆöFVBf–F—&V7B67&–ærrÀ¢F÷væÆöEW&Ã¢F÷væÆöEW&ÂÀ¢Ğ¢Ğ¢Ğ¢Ò6F6‚°¢F‡&÷ræWrW'&÷"‚tF—&V7B67&–ærÖWF†öBf–ÆVBr¢Ğ¢&WGW&âçVÆÀ¢Ğ ¢òòföÆÆ÷r&VF—&V7G2öâ–ç7Fw&Ò6†&R÷6†÷'BÆ–æ·2FòF†R6æöæ–6Â÷7BU$Âà¢&—fFR7–æ2&W6öÇfT–ç7Fw&ÕW&Â‡W&Ã¢7G&–ær“¢&öÖ—6SÇ7G&–æsâ°¢&WGW&âF†—2ç&W6öÇfU&VF—&V7B‡W&Â¢Ğ ¢ò¢ ¢¢vVæW&–2&VF—&V7BföÆÆ÷vW"(	B&W6öÇfW26†÷'B÷6†&RÆ–æ·2†f"çvF6‚À¢¢f6V&öö²æ6öÒ÷6†&Rş(
bÂ–ç7Fw&Ò6†&RÆ–æ·2’FòF†V—"6æöæ–6ÂU$Âà¢ ¢¢ÖWF6†&RÆ–æ²—26¶VBf÷"2Æ–æ²7&vÆW"ÂæBv—F‚„TBâÖV7W&V@¢¢##bÓ‚ÓBv–ç7BÆ—fR&VVÂ6†&RÆ–æ²(	BF†R6†RF†RÖö&–ÆRw0¢¢$6÷’Æ–æ²"&öGV6W2Â6òÖ÷7Böbv†Bf—6—F÷'27FS ¢ ¢¢'&÷w6W"W6W"vVçBÓâCÂæBF†RÆ–æ²7F—2÷6†&RòU$ÂÂv†–6‚F†P¢¢f–FVòÇVv–âç7vW'2v—F‚âW'&÷"vP¢¢7&vÆW"W6W"vVçBÓâ3"Fò‡GG3¢ò÷wwræf6V&öö²æ6öÒ÷&VVÂóÆ–CâÂv†–6€¢¢F†RÇVv–âç7vW'2v—F‚†E÷7&2²6E÷7&0¢ ¢¢„TB&V6W6RöæÇ’F†Rf–æÂU$Â—2vçFVBæBF†R6†&RvR—2†Æb¢¢ÖVv'—FRöbÖ&·WF†Bæ÷F†–ær†W&R&VG2à¢¢ğ¢&—fFR7–æ2&W6öÇfU&VF—&V7B‡W&Ã¢7G&–ær“¢&öÖ—6SÇ7G&–æsâ°¢6öç7B6†&RÒ—4f6V&ööµ6†÷'DÆ–æ²‡W&Â¢G'’°¢6öç7B6VæBÒ6†&Rò‡GGæ†VB¢‡GGævW@¢6öç7B&W7öç6RÒv—B6VæB‡W&ÂÂ°¢Ö…&VF—&V7G3¢RÀ¢fÆ–FFU7FGW3¢‚’ÓâG'VRÀ¢†VFW'3¢°¢uW6W"ÔvVçBs¢6†&RòÄ”äµô5$tÄU%ôtTåB¢F†—2çW6W$vVçBÀ¢ÒÀ¢F–ÖV÷WC¢#À¢Ò¢&WGW&â&W7öç6Rç&WVW7Còç&W3òç&W7öç6UW&ÂÇÂW&À¢Ò6F6‚°¢&WGW&âW&À¢Ğ¢Ğ ¢ò¢ ¢¢—BÖFÇ–÷UGV&RF‚â&ö&W2f–Æ&–Æ—G’f–V–6²–æfòfWF6‚‡v†–6‚Ç6ğ¢¢6öæf—&×2F†Rf–FVò—2&V6†&ÆRg&öÒ†W&R“²öâ7V66W72&WGW&ç2&W7VÇ@¢¢v†÷6Rf–FVòöVF–òö–çBBF†R6ÖRÖ÷&–v–âö’÷–÷WGV&R7G&VÖ–ærVæGö–ç@¢¢æBv†÷6RVÖ&VEW&ÂG&—fW2Æ–v‡GvV–v‡B&Wf–Wr‡6ò&Wf–Wv–ærFöW6âw@¢¢G&–vvW"gVÆÂF÷væÆöB’â&WGW&ç2çVÆÂFòfÆÂ&6²FòF†RV&Æ–0¢¢W‡G&7F÷'2v†Vâ—BÖFÇ—2Væf–Æ&ÆR÷"&Æö6¶VBà¢¢ğ¢&—fFR7–æ2G'•—DFÇ–÷UGV&R€¢f–FVô–C¢7G&–ærÀ¢6æöæ–6Ã¢7G&–ærÀ¢ÖWF¢²F—FÆSó¢7G&–æs²WF†÷#ó¢7G&–æs²F‡VÖ&æ–Ãó¢7G&–ærÒÀ¢“¢&öÖ—6SÅf–FVôFFÂçVÆÃâ°¢6öç7B–æfòÒv—B—FFÇ–æfò†6æöæ–6Â¢–b‚–æfò’&WGW&âçVÆÀ¢&WGW&â°¢–C¢f–FVô–BÀ¢F—FÆS¢ÖWFçF—FÆRÇÂ–æfòçF—FÆRÇÂu–÷UGV&Rf–FVòrÀ¢W&Ã¢6æöæ–6ÂÀ¢F‡VÖ&æ–Ã¢ÖWFçF‡VÖ&æ–ÂÇÂ–æfòçF‡VÖ&æ–ÂÇÂrrÀ¢GW&F–öã¢ÖF‚ç&÷VæB†–æfòæGW&F–öâÇÂ’À¢WF†÷#¢ÖWFæWF†÷"ÇÂ–æfòçWÆöFW"ÇÂu–÷UGV&RrÀ¢FW67&—F–öã¢rrÀ¢F÷væÆöEW&Ã¢ö’÷–÷WGV&Sö–CÒG·f–FVô–GÒf¶–æC×f–FVöÀ¢×W6–5W&Ã¢ö’÷–÷WGV&Sö–CÒG·f–FVô–GÒf¶–æCÖVF–öÀ¢VÖ&VEW&Ã¢‡GG3¢ò÷wwrç–÷WGV&RÖæö6öö¶–Ræ6öÒöVÖ&VBòG·f–FVô–GÖÀ¢Ğ¢Ğ ¢ò¢ ¢¢fWF6‚–÷UGV&RF—FÆRöWF†÷"÷F‡VÖ&æ–Âg&öÒF†RV&Æ–2ôVÖ&VBVæGö–çBà¢¢æòÆöv–â÷"’¶W’&WV—&VBâfÆÇ2&6²FòF†RFWFW&Ö–æ—7F–2—F–Öp¢¢F‡VÖ&æ–Â†Çv—2f–Æ&ÆRf÷"V&Æ–2f–FV÷2’v†VâôVÖ&VB—2Væf–Æ&ÆRà¢¢ğ¢&—fFR7–æ2fWF6…–÷UGV&TÖWF€¢f–FVô–C¢7G&–ærÂçVÆÂÀ¢6æöæ–6ÅW&Ã¢7G&–ærÀ¢“¢&öÖ—6SÇ²F—FÆSó¢7G&–æs²WF†÷#ó¢7G&–æs²F‡VÖ&æ–Ãó¢7G&–ærÓâ°¢6öç7BfÆÆ&6µF‡VÖ"Òf–FVô–@¢ò‡GG3¢òö’ç—F–Öræ6öÒ÷f’òG·f–FVô–GÒö‡FVfVÇBæ§v ¢¢rp¢G'’°¢6öç7B&W7öç6RÒv—B‡GGævWB€¢‡GG3¢ò÷wwrç–÷WGV&Ræ6öÒööVÖ&VC÷W&ÃÒG¶Væ6öFUU$”6ö×öæVçB€¢6æöæ–6ÅW&ÂÀ¢—Òff÷&ÖCÖ§6öæÀ¢°¢†VFW'3¢²uW6W"ÔvVçBs¢F†—2çW6W$vVçBÂ66WC¢vÆ–6F–öâö§6öârÒÀ¢F–ÖV÷WC¢#À¢ÒÀ¢¢6öç7BFFÒ&W7öç6RæFF¢&WGW&â°¢F—FÆS¢FFòçF—FÆRÀ¢WF†÷#¢FFòæWF†÷%öæÖRÀ¢F‡VÖ&æ–Ã¢FFòçF‡VÖ&æ–Å÷W&ÂÇÂfÆÆ&6µF‡VÖ"À¢Ğ¢Ò6F6‚°¢&WGW&â²F‡VÖ&æ–Ã¢fÆÆ&6µF‡VÖ"Ğ¢Ğ¢Ğ ¢ò¢ ¢¢f6V&öö²w2V&Æ–2f–FVòÇVv–âVÖ&VBâ—B—2FW6–væVBFò&RVÖ&VFFVBöà¢¢F†—&B×'G’6—FW2Â6ò—B&VæFW'2F†R7G&VÒ6öæf–rf÷"ç’V&Æ–2f–FVğ¢¢v—F†÷WBÆöv–âvÆÂâvR'6RF†R6ÖR¥÷W&Æ¶W—2F†RvF6‚vR6†—2à¢¢ğ¢&—fFR7–æ2G'”f6V&ööµÇVv–â€¢&W6öÇfVEW&Ã¢7G&–ærÀ¢÷&–v–æÅW&Ã¢7G&–ærÀ¢“¢&öÖ—6SÅf–FVôFFÂçVÆÃâ°¢6öç7BVÖ&VEW&ÂÒ‡GG3¢ò÷wwræf6V&öö²æ6öÒ÷ÇVv–ç2÷f–FVòç‡ö‡&VcÒG¶Væ6öFUU$”6ö×öæVçB€¢&W6öÇfVEW&ÂÀ¢—Ö ¢6öç7B&W7öç6RÒv—B‡GGævWB†VÖ&VEW&ÂÂ°¢†VFW'3¢°¢uW6W"ÔvVçBs¢F†—2çW6W$vVçBÀ¢66WC¢wFW‡Bö‡FÖÂÆÆ–6F–öâ÷†‡FÖÂ·†ÖÂÆÆ–6F–öâ÷†ÖÃ·Óã’Â¢ò£·Óã‚rÀ¢t66WBÔÆæwVvRs¢vVâÕU2ÆVã·Óã’rÀ¢u6V2ÔfWF6‚ÔFW7Bs¢vFö7VÖVçBrÀ¢u6V2ÔfWF6‚ÔÖöFRs¢væf–vFRrÀ¢u6V2ÔfWF6‚Õ6—FRs¢væöæRrÀ¢ÒÀ¢F–ÖV÷WC¢#À¢Ò¢6öç7B‡FÖÂÒG—Vöb&W7öç6RæFFÓÓÒw7G&–ærrò&W7öç6RæFF¢rp¢&WGW&âF†—2ç'6Tf6V&öö´‡FÖÂ†‡FÖÂÂ÷&–v–æÅW&Â¢Ğ ¢ò¢ ¢¢F—&V7B67&RöbF†RV&Æ–2f6V&öö²vF6‚÷&VVÂvRâF†RvRVÖ&VG2F†P¢¢f–FVò6öæf–r¥4ôâ6öçF–æ–ærF†R„Bõ4B6÷W&6RU$Ç2à¢¢ğ¢&—fFR7–æ2G'”f6V&ööµ67&R€¢&W6öÇfVEW&Ã¢7G&–ærÀ¢÷&–v–æÅW&Ã¢7G&–ærÀ¢“¢&öÖ—6SÅf–FVôFFÂçVÆÃâ°¢6öç7B&W7öç6RÒv—B‡GGævWB‡&W6öÇfVEW&ÂÂ°¢†VFW'3¢°¢uW6W"ÔvVçBs¢F†—2çW6W$vVçBÀ¢66WC¢wFW‡Bö‡FÖÂÆÆ–6F–öâ÷†‡FÖÂ·†ÖÂÆÆ–6F–öâ÷†ÖÃ·Óã’Â¢ò£·Óã‚rÀ¢t66WBÔÆæwVvRs¢vVâÕU2ÆVã·Óã’rÀ¢u6V2ÔfWF6‚ÔFW7Bs¢vFö7VÖVçBrÀ¢u6V2ÔfWF6‚ÔÖöFRs¢væf–vFRrÀ¢u6V2ÔfWF6‚Õ6—FRs¢væöæRrÀ¢uWw&FRÔ–ç6V7W&RÕ&WVW7G2s¢srÀ¢ÒÀ¢F–ÖV÷WC¢#À¢Ò¢6öç7B‡FÖÂÒG—Vöb&W7öç6RæFFÓÓÒw7G&–ærrò&W7öç6RæFF¢rp¢&WGW&âF†—2ç'6Tf6V&öö´‡FÖÂ†‡FÖÂÂ÷&–v–æÅW&Â¢Ğ ¢ò¢ ¢¢VÆÂÆ–&ÆRf–FVòU$Â²ÖWFFF÷WBöbf6V&öö²vR÷ÇVv–â…DÔÂà¢¢f6V&öö²6†—26WfW&Â6÷W&6R¶W—3²vR&VfW"„BÂF†Vâ4BÂF†VâF†P¢¢vVæW&–2Æ–&ÆU÷W&ÂâfÇVW2&R¥4ôâÖW66VB‚RÂÂòÂÇU………‚’Â6òvP¢¢FV6öFRF†VÒ&Vf÷&RW6Rà¢¢ğ¢&—fFR'6Tf6V&öö´‡FÖÂ€¢‡FÖÃ¢7G&–ærÀ¢÷&–v–æÅW&Ã¢7G&–ærÀ¢“¢f–FVôFFÂçVÆÂ°¢–b‚‡FÖÂ’&WGW&âçVÆÀ ¢6öç7B–6µW&ÂÒ‚ââæ¶W—3¢7G&–æuµÒ“¢7G&–ærÓâ°¢f÷"†6öç7B¶W’öb¶W—2’°¢òòÖF6‚&¶W’#¢#ÇfÇVSâ"6GW&–ærWFòF†RæW‡BVæW66VBV÷FRà¢6öç7B&RÒæWr&VtW‡†"G¶¶W—Ò#¢"‚â£ò’"ƒó¢ÇÅÅÇÒ–¢6öç7BÒÒ‡FÖÂæÖF6‚‡&R¢–b†ÒbbÕ³Ò’°¢6öç7BFV6öFVBÒF†—2æFV6öFTf6V&ööµ7G&–ær†Õ³Ò¢–b†FV6öFVBç7F'G5v—F‚‚v‡GGr’’&WGW&âFV6öFV@¢Ğ¢Ğ¢&WGW&ârp¢Ğ ¢6öç7BF÷væÆöEW&ÂÒ–6µW&Â€¢v'&÷w6W%öæF—fUö†E÷W&ÂrÀ¢wÆ–&ÆU÷W&Å÷VÆ—G•ö†BrÀ¢v†E÷7&5öæõ÷&FVÆ–Ö—BrÀ¢v†E÷7&2rÀ¢v'&÷w6W%öæF—fU÷6E÷W&ÂrÀ¢wÆ–&ÆU÷W&ÂrÀ¢w6E÷7&5öæõ÷&FVÆ–Ö—BrÀ¢w6E÷7&2rÀ¢ ¢–b‚F÷væÆöEW&Â’&WGW&âçVÆÀ ¢òòF†RÇVv–âvR6'&–W2æòörFw2BÆÂæBF—FÆW2—G6VÆb$f6V&öö²"À¢òòv†–6‚—2v÷'6RF†âF†RvVæW&–2æÖR(	B6ò&&R†÷7BæÖR—2F—66&FV@¢òò&F†W"F†â6†÷vâ2F†Rf–FVòw2F—FÆRà¢6öç7BvTæÖRÒvUF—FÆR†‡FÖÂ’ÇÂrp¢6öç7BöuF—FÆRĞ¢ÖWF6öçFVçB†‡FÖÂÂvös§F—FÆRr’ÇÀ¢‚õæf6V&öö²Bö’çFW7B‡vTæÖRçG&–Ò‚’’òrr¢vTæÖR¢6öç7BötFW67&—F–öâÒÖWF6öçFVçB†‡FÖÂÂvös¦FW67&—F–öâr’ÇÂrp ¢6öç7BF—FÆRĞ¢†öuF—FÆRÇÂötFW67&—F–öâÇÂtf6V&öö²f–FVòr¢ç6Æ–6RƒÂ¢ç&WÆ6R‚õÇ2²örÂrr¢çG&–Ò‚’ÇÂtf6V&öö²f–FVòp ¢&WGW&â°¢–C¢'6Uf–FVô–B†÷&–v–æÅW&Â’ÇÂFFRææ÷r‚’çFõ7G&–ær‚’À¢F—FÆRÀ¢W&Ã¢÷&–v–æÅW&ÂÀ¢F‡VÖ&æ–Ã¢f6V&ööµ÷7FW"†‡FÖÂ’À¢GW&F–öã¢À¢WF†÷#¢tf6V&öö²rÀ¢FW67&—F–öã¢ötFW67&—F–öâÀ¢F÷væÆöEW&ÂÀ¢Ğ¢Ğ ¢òòFV6öFRF†R¥4ôâ×7G&–ærW66–ærf6V&öö²6†—2–â—G2VÖ&VFFVB6öæf–rà¢&—fFRFV6öFTf6V&ööµ7G&–ær‡&s¢7G&–ær“¢7G&–ær°¢&WGW&â&p¢ç&WÆ6R‚õÅÇS#RörÂrRr¢ç&WÆ6R‚õÅÇS$böv’Âròr¢ç&WÆ6R‚õÅÅÂòörÂròr¢ç&WÆ6R‚õÅÇS#böv’Ârbr¢ç&WÆ6R‚õÅÇS4Böv’ÂsÒr¢ç&WÆ6R‚õÅÇS4böv’Âsòr¢ç&WÆ6R‚õÅÇR…µÆDÔfÖe×³GÒ’örÂ…òÂ‚’Óà¢7G&–æræg&öÔ6†$6öFR‡'6T–çB†‚Âb’’À¢¢ç&WÆ6R‚õÅÂörÂrr¢Ğ ¢ò¢ ¢¢†'fW7BF†RçF’Ô55$bFö¶Vç2†77&gFö¶Vâ²Ç6B’F†Rw&…ÂVæGö–ç@¢¢&WV—&W2Âg&öÒ†öÖWvRtUBâv†Vâ”uõ4U54”ôä”B—26öæf–wW&VBF†RtUB—0¢¢WF†VçF–6FVBÂ6òF†R&WGW&æVB77&gFö¶Vâ—2&÷VæBFòF†B6W76–öâ‡&WV—&V@¢¢f÷"Æöv–âÖvFVB÷7G2’â66†VB'&–VfÇ’Fòfö–BâW‡G&&÷VæB×G&—öà¢¢WfW'’&WVW7Bâ&WGW&ç2V×G’7G&–æw2öâf–ÇW&R(	BF†R6ÆÆW"7F–ÆÂG&–W0¢¢F†R&WVW7B†—B6–×Ç’vöâwB7V66VVBf÷"vFVB÷7G2’à¢¢ğ¢&—fFR7–æ2vWD–ç7Fw&ÕFö¶Vç2‚“¢&öÖ—6SÇ²77&c¢7G&–æs²Ç6C¢7G&–ærÓâ°¢6öç7Bæ÷rÒFFRææ÷r‚¢–b€¢–uFö¶Vä66†Rb`¢–uFö¶Vä66†Rç6W76–öä¶W’ÓÓÒF†—2æ–ç7Fw&Õ6W76–öä–Bb`¢–uFö¶Vä66†RæW‡—&W2âæ÷p¢’°¢&WGW&â²77&c¢–uFö¶Vä66†Ræ77&bÂÇ6C¢–uFö¶Vä66†RæÇ6BĞ¢Ğ ¢ÆWB77&bÒrp¢ÆWBÇ6BÒrp¢G'’°¢6öç7B&W7öç6RÒv—B‡GGævWB‚v‡GG3¢ò÷wwræ–ç7Fw&Òæ6öÒòrÂ°¢†VFW'3¢°¢uW6W"ÔvVçBs¢F†—2çW6W$vVçBÀ¢66WC ¢wFW‡Bö‡FÖÂÆÆ–6F–öâ÷†‡FÖÂ·†ÖÂÆÆ–6F–öâ÷†ÖÃ·Óã’Â¢ò£·Óã‚rÀ¢t66WBÔÆæwVvRs¢vVâÕU2ÆVã·Óã’rÀ¢òòF†RgVÆÂ6WB†W&RFöòÂæ÷B§W7BF†R6W76–öââF†—2tUB—2F†Rf—'7@¢òò&WVW7BöbWfW'’7&VFVçF–ÆVB&W6öÇfRÂ6ò&&R6W76–öæ–Föâ—@¢òòv÷VÆB&RF†RæöÖÇ’F†R&W7BöbF†R†VFW"v÷&²W†—7G2Fòfö–Bà¢âââ‡F†—2æ–ç7Fw&Ô6öö¶–Rò²6öö¶–S¢F†—2æ–ç7Fw&Ô6öö¶–RÒ¢·Ò’À¢ÒÀ¢F–ÖV÷WC¢#À¢fÆ–FFU7FGW3¢‚’ÓâG'VRÀ¢Ò¢6öç7B‡FÖÃ¢7G&–ærĞ¢G—Vöb&W7öç6RæFFÓÓÒw7G&–ærrò&W7öç6RæFF¢rp¢òò77&gFö¶Vâ—26WBf–6WBÔ6öö¶–S²fÆÂ&6²FòF†R–æÆ–æR6÷’–âF†P¢òòvRw26†&VBÖFF&Æö"à¢6öç7B6WD6öö¶–RÒ‡&W7öç6Ræ†VFW'5²w6WBÖ6öö¶–RuÒ27G&–æuµÒ’ÇÂµĞ¢f÷"†6öç7B6öö¶–Röb6WD6öö¶–R’°¢6öç7BÒÒö77&gFö¶VãÒ…µãµÒ²’òæW†V2†6öö¶–R¢–b†Ò’°¢77&bÒÕ³Ğ¢'&V°¢Ğ¢Ğ¢–b‚77&b’77&bÒ‡FÖÂæÖF6‚‚ò&77&e÷Fö¶Vâ#¢"…µâ%Ò²’"ò“òå³ÒÇÂrp¢Ç6BĞ¢‡FÖÂæÖF6‚‚ò$Å4B"ÅÅµÅÒÅÇ²'Fö¶Vâ#¢"…µâ%Ò²’"ò“òå³ÒÇÀ¢‡FÖÂæÖF6‚‚öæÖSÒ&Ç6B%Ç2·fÇVSÒ"…µâ%Ò²’"ò“òå³ÒÇÀ¢rp¢Ò6F6‚°¢òòæWGv÷&²W'&÷"(	B&WGW&âv†FWfW"vR†fR†Æ–¶VÇ’V×G’“²F†Rw&…À¢òò6ÆÂv–ÆÂf–ÂæBF†R6ÆÆW"fÆÇ2F‡&÷Vv‚FòF†RæW‡BÖWF†öBà¢Ğ ¢–uFö¶Vä66†RÒ°¢77&bÀ¢Ç6BÀ¢6W76–öä¶W“¢F†—2æ–ç7Fw&Õ6W76–öä–BÀ¢W‡—&W3¢æ÷r²R¢c¢À¢Ğ¢&WGW&â²77&bÂÇ6BĞ¢Ğ ¢ò¢ ¢¢F†R7&VFVçF–ÆVB–ç7Fw&ÒW‡G&7F÷#¢F†R&—fFRÖVF–’F†RÆövvVBÖ–à¢¢vV"6Æ–VçB—G6VÆb6ÆÇ2Â¶W–VBöâF†RçVÖW&–2ÖVF––BF†R6†÷'F6öFP¢¢Væ6öFW2†–ç7Fw&ÔÖVF––FÂæòÆöö·W&WVW7BæVVFVB’à¢ ¢¢F†—2W†—7G2&V6W6RF†Rw&…ÂW‡G&7F÷"&VÆ÷r7F÷VB&W6öÇf–ær÷7G2(	@¢¢–ç7Fw&Òæ÷rç7vW'2—G2Fö5ö–Fv—F‚²&W'&÷'2#¥·²&ÖW76vR#¢&W†V7WF–öà¢¢W'&÷"'ÕÒÂ&FF#¦çVÆÇÖv†WF†W"÷"æ÷B6W76–öâ—2GF6†VBÂv†–6‚ÆVgB¢¢7&VFVçF–ÆVB&W6öÇfRv—F‚æ÷F†–ærF†Ræöç–Ö÷W2F‚F–Bæ÷BÇ&VG’†fRà¢¢F†B—2v†BÖFRF†R6W76–öâÆöö²'&ö¶Vã¢—Bv2fÆ–BÂæBWfW'’F€¢¢F†B6÷VÆB†fRW6VB—Bv2FVBà¢ ¢¢6W76–öâÖöæÇ’'’FW6–vâÂæBæ÷BÖW&VÇ’2öÆ–7“¢v—F†÷WB6öö¶–W2F†P¢¢6ÖRVæGö–çBç7vW'2#v—F‚ãc´"Æöv–âvÆÂ6''––æræòÖVF–Â6ğ¢¢f÷"âæöç–Ö÷W2&W6öÇfRF†—2—2Æ&vRF÷væÆöBF†B6ææ÷B7V66VVBà¢¢&WGW&æ–ærçVÆÂWg&öçB¶VW2—BöfbF†Rg&VRF‚VçF—&VÇ’à¢¢ğ¢ò¢ ¢¢öæR—FVÒg&öÒö’÷cöÖVF–óÆ–Câö–æfòöÂF†RVæGö–çB–ç7Fw&Òw2÷vâvV ¢¢6Æ–VçB6ÆÇ2â÷7G2Â&VVÇ2æB7F÷'’—FV×2ÆÂÆ—fR&V†–æB—BæBÆÂ6öÖP¢¢&6²–âF†R6ÖR—FV×5³Ö6†RÂv†–6‚—2v‡’&÷F‚F†R÷7BW‡G&7F÷"æ@¢¢F†R7F÷'’W‡G&7F÷"&÷WFRF‡&÷Vv‚†W&Rà¢ ¢¢&V¦V7FVB6W76–öâç7vW'2v—F‚…DÔÂ†÷"¥4ôâv—F‚æò—FV×2“²&÷F‚&V6öÖP¢¢çVÆÂ6òF†R6ÆÆW"fÆÇ2F‡&÷Vv‚Fò—G2æW‡BÖWF†öB(	BF†Rw&6VgVÀ¢¢FVw&FF–öâF†R7&VFVçF–ÂvFR&öÖ—6W2à¢¢ğ¢&—fFR7–æ2–ç7Fw&ÔÖVF–—FVÒ€¢ÖVF––C¢7G&–ærÀ¢†VFW'3¢&V6÷&CÇ7G&–ærÂ7G&–æsâÀ¢“¢&öÖ—6SÄ–u7F÷'”—FVÒÂçVÆÃâ°¢6öç7B&W7öç6RÒv—B‡GGævWB€¢‡GG3¢ò÷wwræ–ç7Fw&Òæ6öÒö’÷cöÖVF–òG¶Væ6öFUU$”6ö×öæVçB†ÖVF––B—Òö–æfòöÀ¢²†VFW'2ÂF–ÖV÷WC¢#ÂfÆ–FFU7FGW3¢‚’ÓâG'VRÒÀ¢¢6öç7B—FVÒÒ&W7öç6RæFFòæ—FV×3òå³Ò2–u7F÷'”—FVÒÂVæFVf–æV@¢–b‚—FVÒ’Æöt–ç7Fw&Õ&VgW6Â‚vÖVF–ö–æfòrÂÖVF––BÂ&W7öç6R¢&WGW&â—FVÒóòçVÆÀ¢Ğ ¢&—fFR7–æ2G'”–ç7Fw&ÔÖVF––æfò€¢6†÷'F6öFS¢7G&–ærÀ¢÷&–v–æÅW&Ã¢7G&–ærÀ¢“¢&öÖ—6SÅf–FVôFFÂçVÆÃâ°¢–b‚F†—2æ–ç7Fw&Õ6W76–öä–B’&WGW&âçVÆÀ¢6öç7BÖVF––BÒ–ç7Fw&ÔÖVF––B‡6†÷'F6öFR¢–b‚ÖVF––B’&WGW&âçVÆÀ ¢6öç7B²77&bÒÒv—BF†—2ævWD–ç7Fw&ÕFö¶Vç2‚¢6öç7B—FVÒÒv—BF†—2æ–ç7Fw&ÔÖVF–—FVÒ†ÖVF––BÂ°¢uW6W"ÔvVçBs¢F†—2çW6W$vVçBÀ¢u‚Ô”rÔÔ”Bs¢F†—2æ–ç7Fw&Ô–BÀ¢66WC¢r¢ò¢rÀ¢&VfW&W#¢‡GG3¢ò÷wwræ–ç7Fw&Òæ6öÒ÷òG·6†÷'F6öFWÒöÀ¢6öö¶–S¢F†—2æ–ç7Fw&Ô6öö¶–Uv—F‚†77&b’À¢Ò¢–b‚—FVÒ’&WGW&âçVÆÀ ¢6öç7B'6VBÒF†—2ç'6T–ç7Fw&ÔÖVF–€¢–t–æfõFõ6†÷'F6öFTÖVF–†—FVÒ’À¢6†÷'F6öFRÀ¢÷&–v–æÅW&ÂÀ¢¢–b‚'6VBæF÷væÆöEW&Âbb‡'6VBæ–ÖvW3òæÆVæwF‚óò’ÓÓÒ’&WGW&âçVÆÀ¢&WGW&â'6V@¢Ğ ¢òò$TÔõdTB##bÓ‚ÓS¢F†RvV"w&…ÂW‡G&7F÷"†öw&‡Â÷VW'’öv—F€¢òòFö5ö–BƒƒCSsSƒSƒ#“ƒCR’â–ç7Fw&Ò&WF—&VBF†RW'6—7FVBVW'’(	BF†P¢òòVæGö–çBç7vW'2WfW'’&WVW7Bv—F€¢òò²&W'&÷'2#¥·²&ÖW76vR#¢&W†V7WF–öâW'&÷""Â'6WfW&—G’#¢$5$•D”4Â'ÕÒÂ&FF#¦çVÆÇĞ¢òòæB—B—2F†R§VW'’–B¢F†B—2&VgW6VBÂæ÷BF†R÷7C¢—Bf–Ç2–FVçF–6ÆÇ¢òòf÷"Æ—fR÷7BÂFVÆWFVBöæRÂæöç–Ö÷W6Ç’ÂæBv—F‚fÆ–B6W76–öââ¢òòFö5ö–B†'fW7FVBg&W6‚g&öÒ–ç7Fw&Òw2÷vâ'VæFÆRF†B6ÖRF¢òò…öÆ&—5÷7E&ö÷EVW'•ö–ç7Fw&Õ&VÆ”÷W&F–öâÒ#ƒcss“c“c##s#B’—2&VgW6V@¢òòF†R6ÖRv’f÷"ÆövvVBÖ÷WB6ÆÆW"Â6ò&R×ö–çF–ær—B'W—2æ÷F†–ærV—F†W"à¢òò—BöæÇ’6÷7BGvò&÷VæB×G&—2W"–ç7Fw&Ò&W6öÇfRâ6VP¢òòÆW76öç2ó##bÓ‚ÓRÖ–ç7Fw&ÒÖÆövvVBÖ÷WB×vÆÂæÖBà ¢ò¢ ¢¢&–Ö'’–ç7Fw&ÒW‡G&7F÷#¢F†RV&Æ–2VÖ&VBvRâ—B—2FW6–væVBFò&P¢¢V&Æ–6Ç’VÖ&VFF&ÆRÂ6ò—B6W'fW2gVÆÂ6†÷'F6öFUöÖVF–w&‚‡†÷F÷2À¢¢&VVÇ2÷f–FV÷2æB×VÇF’Ö—FVÒ6&÷W6VÇ2’v—F†÷WBÆöv–ââF†R'&÷w6W"ÖÆ–¶P¢¢6V2ÔfWF6‚Ò¦†VFW'2ÖGFW"(	B–ç7Fw&Ò&WGW&ç2C2v—F†÷WBF†VÒà¢ ¢¢f—'7B'6W2F†R&–6‚¥4ôâF†RvR6†—2††æFÆW26&÷W6VÇ2“²÷F†W'v—6P¢¢fÆÇ2&6²Fò67&–ærF†R&VæFW&VB6–ævÆR–ÖvR÷f–FVòVÆVÖVçBà¢¢ğ¢&—fFR7–æ2G'”–ç7Fw&ÔVÖ&VB€¢6†÷'F6öFS¢7G&–ærÀ¢÷&–v–æÅW&Ã¢7G&–ærÀ¢“¢&öÖ—6SÅf–FVôFFÂçVÆÃâ°¢6öç7BVÖ&VEW&ÂÒ‡GG3¢ò÷wwræ–ç7Fw&Òæ6öÒ÷òG·6†÷'F6öFWÒöVÖ&VBö6F–öæVBö ¢6öç7B&W7öç6RÒv—B‡GGævWB†VÖ&VEW&ÂÂ°¢†VFW'3¢°¢uW6W"ÔvVçBs¢F†—2çW6W$vVçBÀ¢66WC ¢wFW‡Bö‡FÖÂÆÆ–6F–öâ÷†‡FÖÂ·†ÖÂÆÆ–6F–öâ÷†ÖÃ·Óã’Â¢ò£·Óã‚rÀ¢t66WBÔÆæwVvRs¢vVâÕU2ÆVã·Óã’rÀ¢u6V2ÔfWF6‚ÔFW7Bs¢vFö7VÖVçBrÀ¢u6V2ÔfWF6‚ÔÖöFRs¢væf–vFRrÀ¢u6V2ÔfWF6‚Õ6—FRs¢væöæRrÀ¢ÒÀ¢F–ÖV÷WC¢#À¢Ò ¢6öç7B‡FÖÂÒG—Vöb&W7öç6RæFFÓÓÒw7G&–ærrò&W7öç6RæFF¢rp¢–b‚‡FÖÂ’&WGW&âçVÆÀ ¢òò’&W7B66S¢F†RVÖ&VBvR6†—2F†RgVÆÂ6†÷'F6öFUöÖVF–¥4ôâà¢6öç7BÖVF–ÒF†—2æW‡G&7DVÖ&VFFVE6†÷'F6öFTÖVF–†‡FÖÂ¢–b†ÖVF–’°¢6öç7B'6VBÒF†—2ç'6T–ç7Fw&ÔÖVF–†ÖVF–Â6†÷'F6öFRÂ÷&–v–æÅW&Â¢òòF†RVÖ&VB¥4ôâÖ&·2&VVÂ÷f–FVò2—5÷f–FVó×G'VR'WB6†—2äòf–FVõ÷W&À¢òò‡F†R6Æ—ÆöG2f–6Æ–VçB¥2’(	BöæÇ’÷7FW"F—7Æ•÷W&Ââ'6T–ç7Fw&ÒĞ¢òòÖVF–&VgW6W2FòVÖ—BF†B÷7FW"2†÷FòÂ6ò'6VF6öÖW2&6²v—F€¢òòæòF÷væÆöEW&ÂâFVfW"FòF†Rw&…ÂW‡G&7F÷"‡v†–6‚&WGW&ç2F†R&VÀ¢òòf–FVõ÷W&Â’–ç7FVBöb&WGW&æ–ærâV×G’&W7VÇB†W&R(	BæB7'V6–ÆÇ’ÂFğ¢òòäõBfÆÂF‡&÷Vv‚FòF†R67&RfÆÆ&6²&VÆ÷rÂv†–6‚v÷VÆB&RÖVÖ—BF†P¢òò÷7FW"26–ævÆR†÷FòâF†—2—2F†R66RF†BÖ—7&VæFW&VB&VVÇ2à¢–b‡F†—2æÖVF–6öçF–ç5f–FVò†ÖVF–’bb'6VBæF÷væÆöEW&Â’&WGW&âçVÆÀ¢–b‡'6VBæF÷væÆöEW&ÂÇÂ‡'6VBæ–ÖvW3òæÆVæwF‚óò’â’&WGW&â'6V@¢Ğ ¢òò"’fÆÆ&6³¢67&RF†R&VæFW&VBVÖ&VBf÷"6–ævÆR–ÖvRòf–FVòà¢6öç7B–Öu7&2Òf—'7EFtGG"†‡FÖÂÂv–ÖrrÂw7&2rÂtVÖ&VFFVDÖVF––ÖvRr¢6öç7Bf–FVõ7&2Òf—'7EFtGG"†‡FÖÂÂwf–FVòrÂw7&2r¢6öç7BW6W&æÖRĞ¢FW‡Dödf—'7Ev—F„6Æ72†‡FÖÂÂuW6W&æÖUFW‡Br’ÇÀ¢FW‡Dödf—'7Ev—F„6Æ72†‡FÖÂÂuW6W&æÖRr’ÇÀ¢uVæ¶æ÷vâp ¢–b‚–Öu7&2bbf–FVõ7&2’&WGW&âçVÆÀ ¢òò5$•D”4Ã¢–ç7Fw&Òf–FVòVÖ&VG26†—äòW6&ÆRÇf–FVò7&3â‡F†R6Æ——0¢òòÆöFVB'’6Æ–VçB¥2’ÂöæÇ’F†R÷7FW"g&ÖR2–ÖräVÖ&VFFVDÖVF––ÖvRâ6ğ¢òòv†VâF†R&–6‚¥4ôâ&÷fRF–FâwB'6RÂ&Æ–æFÇ’&WGW&æ–ærF†B÷7FW"v÷VÆ@¢òòÖ—7&VæFW"&VVÂ26–ævÆR†÷Fòâ–bF†RvR6'&–W2ç’f–FVòÖ&¶W"À¢òò&–ÂFòçVÆÂ6òF†R6ÆÆW"fÆÇ2F‡&÷Vv‚FòF†Rw&…ÂW‡G&7F÷"‡v†–6€¢òò&WGW&ç2F†R&VÂf–FVõ÷W&Â’–ç7FVBöbVÖ—GF–ær&öwW2–ÖvRà¢6öç7BÆöö·4Æ–¶Uf–FVòĞ¢f–FVõ7&2b`¢‚ò&—5÷f–FVò%Ç2£¥Ç2¢‡G'VWÃ’òçFW7B†‡FÖÂ’ÇÀ¢ò'f–FVõ÷W&Â%Ç2£¥Ç2¢"òçFW7B†‡FÖÂ’ÇÂòò&VÂU$ÂfÇVRÂæ÷B'f–FVõ÷W&Â#¦çVÆÀ¢‡FÖÂæ–æ6ÇVFW2‚wf–FVõ÷f–Wuö6÷VçBr’ÇÂòòf–FVòÖöæÇ’ÖWFFFf–VÆG0¢‡FÖÂæ–æ6ÇVFW2‚wf–FVõöGW&F–öâr’ÇÀ¢†5Fr†‡FÖÂÂwf–FVòr’¢–b†Æöö·4Æ–¶Uf–FVò’&WGW&âçVÆÀ ¢&WGW&â°¢–C¢6†÷'F6öFRÀ¢F—FÆS¢–ç7Fw&Ò÷7B'’G·W6W&æÖWÖÀ¢W&Ã¢÷&–v–æÅW&ÂÀ¢F‡VÖ&æ–Ã¢–Öu7&2ÇÂrrÀ¢GW&F–öã¢À¢WF†÷#¢W6W&æÖRÀ¢FW67&—F–öã¢rrÀ¢F÷væÆöEW&Ã¢f–FVõ7&2ÇÂrrÀ¢–ÖvW3 ¢f–FVõ7&2bb–Öu7&0¢ò·²–C¢G·6†÷'F6öFWÕóÂW&Ã¢–Öu7&2ÂF‡VÖ&æ–Ã¢–Öu7&2ÕĞ¢¢VæFVf–æVBÀ¢—5†÷Fô6&÷W6VÃ¢fÇ6RÀ¢Ğ¢Ğ ¢òòÖâ–ç7Fw&Ò6†÷'F6öFUöÖVF–ö&¦V7BöçFò÷W"6†&VBf–FVôFF6†Rà¢&—fFR'6T–ç7Fw&ÔÖVF–€¢ÖVF–¢–u6†÷'F6öFTÖVF–À¢6†÷'F6öFS¢7G&–ærÀ¢÷&–v–æÅW&Ã¢7G&–ærÀ¢“¢f–FVôFF°¢6öç7BW6W&æÖRÒÖVF–æ÷væW#òçW6W&æÖRÇÂuVæ¶æ÷vâp¢6öç7B6F–öâĞ¢ÖVF–æVFvUöÖVF–÷Fõö6F–öãòæVFvW3òå³ÓòææöFSòçFW‡CòçG&–Ò‚’ÇÂrp¢6öç7BF—FÆRÒ6F–öà¢ò6F–öâç6Æ–6RƒÂƒ’ç&WÆ6R‚õÇ2²örÂrr’çG&–Ò‚¢¢–ç7Fw&Ò÷7B'’G·W6W&æÖWÖ  ¢6öç7B–ÖvW3¢–ÖvTFFµÒÒµĞ¢ÆWBF÷væÆöEW&ÂÒrp ¢6öç7B6†–ÆG&VâÒÖVF–æVFvU÷6–FV6%÷Fõö6†–ÆG&VãòæVFvW0¢–b„'&’æ—4'&’†6†–ÆG&Vâ’bb6†–ÆG&VâæÆVæwF‚â’°¢òò6&÷W6VÃ¢6öÆÆV7BWfW'’†÷Fó²F†Rf—'7Bf–FVò&V6öÖW2F†R&–Ö'’6Æ—à¢òòf–FVò6†–ÆB—2FFVBôäÅ’v†Vâ—B6'&–W2&VÂf–FVõ÷W&Â(	BæWfW"f–¢òò—G2÷7FW"F—7Æ•÷W&Â‡6VRF†R6–ævÆRÖÖVF–æ÷FR&VÆ÷r’à¢6†–ÆG&Vâæf÷$V6‚‚†VFvRÂ’’Óâ°¢6öç7BæöFRÒVFvSòææöFP¢–b‚æöFR’&WGW&à¢–b†æöFRæ—5÷f–FVòbbæöFRçf–FVõ÷W&Â’°¢–b‚F÷væÆöEW&Â’F÷væÆöEW&ÂÒæöFRçf–FVõ÷W&À¢ÒVÇ6R–b‚æöFRæ—5÷f–FVòbbæöFRæF—7Æ•÷W&Â’°¢–ÖvW2çW6‚‡°¢–C¢G·6†÷'F6öFWÕòG¶—ÖÀ¢W&Ã¢æöFRæF—7Æ•÷W&ÂÀ¢F‡VÖ&æ–Ã¢æöFRæF—7Æ•÷&W6÷W&6W3òå³Óòç7&2ÇÂæöFRæF—7Æ•÷W&ÂÀ¢Ò¢Ğ¢Ò¢ÒVÇ6R–b†ÖVF–æ—5÷f–FVòbbÖVF–çf–FVõ÷W&Â’°¢F÷væÆöEW&ÂÒÖVF–çf–FVõ÷W&À¢ÒVÇ6R–b‚ÖVF–æ—5÷f–FVòbbÖVF–æF—7Æ•÷W&Â’°¢òò†÷FòöæÇ’âf–FVòv†÷6Rf–FVõ÷W&Â—2'6VçB‡F†RVÖ&VB¥4ôâ6†—0¢òò—5÷f–FVó×G'VRv—F‚§W7B÷7FW"F—7Æ•÷W&Â’FVÆ–&W&FVÇ’––VÆG0¢òòäõD„”är†W&R(	B76–ær—G2÷7FW"öfb2†÷Fò—2W†7FÇ’v†@¢òòÖ—7&VæFW&VB&VVÇ226–ævÆR–ÖvW2âF†R6ÆÆW"FWFV7G2F†RV×G¢òò&W7VÇBæBFVfW'2FòF†Rw&…ÂW‡G&7F÷"‡v†–6‚&WGW&ç2f–FVõ÷W&Â’à¢–ÖvW2çW6‚‡°¢–C¢G·6†÷'F6öFWÕóÀ¢W&Ã¢ÖVF–æF—7Æ•÷W&ÂÀ¢F‡VÖ&æ–Ã¢ÖVF–æF—7Æ•÷W&ÂÀ¢Ò¢Ğ ¢6öç7BF‡VÖ&æ–ÂĞ¢ÖVF–æF—7Æ•÷W&ÂÇÂÖVF–çF‡VÖ&æ–Å÷7&2ÇÂ–ÖvW5³ÓòçF‡VÖ&æ–ÂÇÂrp ¢&WGW&â°¢–C¢6†÷'F6öFRÀ¢F—FÆRÀ¢W&Ã¢÷&–v–æÅW&ÂÀ¢F‡VÖ&æ–ÂÀ¢GW&F–öã¢ÖF‚ç&÷VæB†ÖVF–çf–FVõöGW&F–öâÇÂ’À¢WF†÷#¢W6W&æÖRÀ¢FW67&—F–öã¢6F–öâÀ¢F÷væÆöEW&ÂÀ¢–ÖvW3¢–ÖvW2æÆVæwF‚âò–ÖvW2¢VæFVf–æVBÀ¢—5†÷Fô6&÷W6VÃ¢fÇ6RÀ¢Ğ¢Ğ ¢òòG'VRv†Vâ6†÷'F6öFUöÖVF–w&‚—2†÷"6öçF–ç2’f–FVòâW6VB'’F†P¢òòVÖ&VBW‡G&7F÷"FòFV6–FRv†WF†W"'6RF†B&öGV6VBæòÆ–&ÆRf–FVğ¢òòU$Â6†÷VÆBFVfW"Fò&–6†W"W‡G&7F÷"„w&…Â’&F†W"F†â&RÖ—7F¶Vâf÷ ¢òò†÷Fò(	BF†RVÖ&VB6†—2—5÷f–FVó×G'VRv—F‚æòf–FVõ÷W&Âf÷"&VVÇ2÷f–FV÷2à¢&—fFRÖVF–6öçF–ç5f–FVò†ÖVF–¢–u6†÷'F6öFTÖVF–“¢&ööÆVâ°¢–b†ÖVF–æ—5÷f–FVò’&WGW&âG'VP¢6öç7B6†–ÆG&VâÒÖVF–æVFvU÷6–FV6%÷Fõö6†–ÆG&VãòæVFvW0¢&WGW&â€¢'&’æ—4'&’†6†–ÆG&Vâ’bb6†–ÆG&Vâç6öÖR‚†VFvR’Óâ&ööÆVâ†VFvSòææöFSòæ—5÷f–FVò’¢¢Ğ ¢òòVÆÂF†RVÖ&VFFVB6†÷'F6öFUöÖVF–¥4ôâ÷WBöbâVÖ&VBvRw2…DÔÂà¢&—fFRW‡G&7DVÖ&VFFVE6†÷'F6öFTÖVF–€¢‡FÖÃ¢7G&–ærÀ¢“¢–u6†÷'F6öFTÖVF–ÂçVÆÂ°¢òò&VfW'&VBFƒ¢F†RVÖ&VB6†—2&6öçFW‡D¥4ôâ#¢#Æ§6öâÖVæ6öFVBÖ§6öãâ&à¢òòF†RfÇVR—2¥4ôâÖVæ6öFVB7G&–ærv†÷6R6öçFVçG2&RF†V×6VÇfW2¥4ôâÀ¢òò6òF÷V&ÆR¥4ôâç'6RFV6öFW2WfW'’W66R‡V÷FW2Â6Æ6†W2ÂÇU………‚¢òò6÷'&V7FÇ’(	Bf"Ö÷&R&ö'W7BF†â†æB×&öÆÆVBVæW66–ærà¢6öç7Bg&öÔ6öçFW‡BÒF†—2æW‡G&7D6öçFW‡D§6öâ†‡FÖÂ¢–b†g&öÔ6öçFW‡B’&WGW&âg&öÔ6öçFW‡@ ¢òòfÆÆ&6³¢&Ææ6RÖÖF6‚F†R&r6†÷'F6öFUöÖVF–ö&¦V7Bâ†æFÆW2F†P¢òò&r†Ç&VG’×VæW66VB’f&–çB6öÖR–ÆöG26†—à¢6öç7B¶W’Òr'6†÷'F6öFUöÖVF–#¢p¢6öç7B¶W”–G‚Ò‡FÖÂæ–æFW„öb†¶W’¢–b†¶W”–G‚ÓÒÓ’°¢6öç7B'&6U7F'BÒ‡FÖÂæ–æFW„öb‚w²rÂ¶W”–G‚²¶W’æÆVæwF‚¢–b†'&6U7F'BÓÒÓ’°¢6öç7B§6öâÒF†—2æW‡G&7D&Ææ6VD§6öâ†‡FÖÂÂ'&6U7F'B¢–b†§6öâ’°¢G'’°¢&WGW&â¥4ôâç'6R†§6öâ’2–u6†÷'F6öFTÖVF–¢Ò6F6‚°¢òòfÆÂF‡&÷Vv€¢Ğ¢Ğ¢Ğ¢Ğ¢&WGW&âçVÆÀ¢Ğ ¢òòFV6öFRF†RVÖ&VBvRw26öçFW‡D¥4ôæ&Æö'2æB&WGW&âF†Rf—'7BF†@¢òò6öçF–ç26†÷'F6öFUöÖVF–âF†RvR6â6†—6WfW&Â6öçFW‡D¥4ôâ7G&–æw0¢òò†Rærâæf–vF–öäÖWG&–72FVÆVÖWG'’öæR’Â6òvR66âÆÂöbF†VÒ&F†W ¢òòF†â77VÖ–ærF†RÖVF–&Æö"6öÖW2f—'7Bà¢&—fFRW‡G&7D6öçFW‡D§6öâ†‡FÖÃ¢7G&–ær“¢–u6†÷'F6öFTÖVF–ÂçVÆÂ°¢6öç7B¶W’Òr&6öçFW‡D¥4ôâ#¢p¢ÆWB6V&6„g&öÒÒ ¢v†–ÆR‡G'VR’°¢6öç7B–G‚Ò‡FÖÂæ–æFW„öb†¶W’Â6V&6„g&öÒ¢–b†–G‚ÓÓÒÓ’'&V°¢6öç7BV÷FU7F'BÒ‡FÖÂæ–æFW„öb‚r"rÂ–G‚²¶W’æÆVæwF‚¢–b‡V÷FU7F'BÓÓÒÓ’'&V° ¢òò&VBF†R¥4ôâ7G&–ærFö¶Vâ‡&W7V7F–ær&6·6Æ6‚W66W2’à¢ÆWB’ÒV÷FU7F'B²¢ÆWBW66VBÒfÇ6P¢f÷"ƒ²’Â‡FÖÂæÆVæwFƒ²’²²’°¢6öç7B6‚Ò‡FÖÅ¶•Ğ¢–b†W66VB’W66VBÒfÇ6P¢VÇ6R–b†6‚ÓÓÒuÅÂr’W66VBÒG'VP¢VÇ6R–b†6‚ÓÓÒr"r’'&V°¢Ğ¢6V&6„g&öÒÒ’² ¢6öç7BFö¶VâÒ‡FÖÂç6Æ–6R‡V÷FU7F'BÂ’²¢G'’°¢6öç7B–ææW"Ò¥4ôâç'6R‡Fö¶Vâ’27G&–æròòf—'7BFV6öFR(i"¥4ôâFW‡@¢6öç7Bö&¢Ò¥4ôâç'6R†–ææW"’2°¢wÅöFFó¢²6†÷'F6öFUöÖVF–ó¢–u6†÷'F6öFTÖVF–Ğ¢6öçFW‡Có¢²ÖVF–ó¢–u6†÷'F6öFTÖVF–Ğ¢Ğ¢6öç7BÖVF–Òö&£òæwÅöFFòç6†÷'F6öFUöÖVF–ÇÂö&£òæ6öçFW‡CòæÖVF–¢–b†ÖVF–’&WGW&âÖVF–¢Ò6F6‚°¢òòæ÷BF†RÖVF–&Æö"(	BG'’F†RæW‡B6öçFW‡D¥4ôâö67W'&Væ6P¢Ğ¢Ğ¢&WGW&âçVÆÀ¢Ğ ¢òò&WGW&âF†R&Ææ6VB²ââçÖ7V'7G&–ær7F'F–ærB7F'FÂ&W7V7F–æp¢òòæW7FVB'&6W2æB7G&–ærÆ—FW&Ç2à¢&—fFRW‡G&7D&Ææ6VD§6öâ‡FW‡C¢7G&–ærÂ7F'C¢çVÖ&W"“¢7G&–ærÂçVÆÂ°¢ÆWBFWF‚Ò ¢ÆWB–å7G&–ærÒfÇ6P¢ÆWBW66VBÒfÇ6P¢f÷"†ÆWB’Ò7F'C²’ÂFW‡BæÆVæwFƒ²’²²’°¢6öç7B6‚ÒFW‡E¶•Ğ¢–b†–å7G&–ær’°¢–b†W66VB’W66VBÒfÇ6P¢VÇ6R–b†6‚ÓÓÒuÅÂr’W66VBÒG'VP¢VÇ6R–b†6‚ÓÓÒr"r’–å7G&–ærÒfÇ6P¢6öçF–çVP¢Ğ¢–b†6‚ÓÓÒr"r’–å7G&–ærÒG'VP¢VÇ6R–b†6‚ÓÓÒw²r’FWF‚²°¢VÇ6R–b†6‚ÓÓÒwÒr’°¢FWF‚ÒĞ¢–b†FWF‚ÓÓÒ’&WGW&âFW‡Bç6Æ–6R‡7F'BÂ’²¢Ğ¢Ğ¢&WGW&âçVÆÀ¢Ğ ¢&—fFR7–æ2&W6öÇfUW&Â‡W&Ã¢7G&–ær“¢&öÖ—6SÇ7G&–æsâ°¢G'’°¢–b€¢W&Âæ–æ6ÇVFW2‚wfÒçF–·Fö²æ6öÒr’ÇÀ¢W&Âæ–æ6ÇVFW2‚wgBçF–·Fö²æ6öÒr’ÇÀ¢W&Âæ–æ6ÇVFW2‚r÷Bòr¢’°¢6öç7B&W7öç6RÒv—B‡GGæ†VB‡W&ÂÂ°¢Ö…&VF—&V7G3¢RÀ¢fÆ–FFU7FGW3¢‚’ÓâG'VRÀ¢†VFW'3¢²uW6W"ÔvVçBs¢F†—2çW6W$vVçBÒÀ¢F–ÖV÷WC¢À¢Ò¢&WGW&â&W7öç6Rç&WVW7Bç&W2ç&W7öç6UW&ÂÇÂW&À¢Ğ¢Ò6F6‚°¢òò–b&W6öÇfRf–Ç2Â&WGW&â÷&–v–æÂU$À¢Ğ¢&WGW&âW&À¢Ğ§Ğ