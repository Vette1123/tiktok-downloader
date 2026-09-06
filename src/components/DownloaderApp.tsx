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
  initialState,
  isResolvingOrDownloading,
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
  PlayIcon,
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
import { buildDownloadFilename, formatBytes } from '@/lib/filename'
import { parseYouTubeId } from '@/lib/validator'
import { SubtitlePicker } from '@/components/SubtitlePicker'
import { ThumbnailButton } from '@/components/ThumbnailButton'
import { ShareButton } from '@/components/ShareButton'
import { CopyLinkButton } from '@/components/CopyLinkButton'
import { friendlyError } from '@/lib/errorMessages'
import { useT } from '@/lib/i18nStore'
import {
  clearPlatformQuality,
  effectiveQuality,
  getStoredQualityMap,
  rememberPlatformQuality,
  removeQuality,
  type QualityMap,
} from '@/lib/platformQuality'
import { detectPlatform, type SupportedPlatform } from '@/lib/validator'
import { resolve } from '@/lib/resolve'
import {
  describeProgress,
  getProgressServerSnapshot,
  getProgressSnapshot,
  reportProgress,
  subscribeProgress,
} from '@/lib/downloadProgress'
import { useFilenameTemplate, useProToken } from '@/lib/entitlements'
import {
  addHistory,
  clearHistory,
  exportHistory,
  getHistorySnapshot,
  getHistoryServerSnapshot,
  importHistory,
  removeHistory,
  subscribeHistory,
  type HistoryEntry,
} from '@/lib/history'
import { saveBlob } from '@/lib/blobSaver'

// Pull the first http(s) URL out of arbitrary shared text. Android's share sheet
// often hands a link inside `text` wrapped in a caption ("check this out <url>"),
// so we scan for the first URL token rather than assume the whole string is one.
function extractFirstUrl(s: string): string | null {
  if (!s) return null
  const m = s.match(/https?:\/\/[^\s]+/i)
  const candidate = (m ? m[0] : s).trim()
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
    const u = raw.trim()
    if (u && !seen.has(u)) {
      seen.add(u)
      out.push(u)
    }
  }
  return out
}

// How big a body we're willing to hold in memory to show a percentage. Past
// this we hand the file to the browser's own download manager instead, which
// streams to disk at no memory cost — a 300 MB blob is a tab crash on mobile.
const MAX_IN_MEMORY_DOWNLOAD_BYTES = 80 * 1024 * 1024

// A transfer we project to take longer than this also goes to the download
// manager. Reading it ourselves is what buys the percentage, but it costs the
// two things the browser's own downloader gives for free: bytes landing on disk
// as they arrive, and a transfer that survives leaving the page. For a couple of
// minutes that trade is worth it; for a 40-minute one it is not — and a slow
// public tunnel instance can easily make a long video that.
const MAX_STREAM_SECONDS = 120

// Don't judge the rate off the first few chunks — TLS ramp-up and the
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

// Stream a download response, reporting progress as it lands. Emits a 0–100
// percentage when the response declares a size; otherwise emits null
// (indeterminate) and lets the browser buffer. Buffering the chunks here is no
// heavier than response.blob(), which also holds the whole body in memory — it
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
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        received += value.length
        onProgress(Math.min(99, Math.round((received / total) * 100)))
        // The MB/rate readout rides a module store rather than the reducer —
        // see lib/downloadProgress. Cleared in finally, never throttled there.
        reportProgress({ received, total, startedAt })
        if (bail?.(received, total, nowMs() - startedAt)) {
          await reader.cancel().catch(() => {})
          throw new StreamBailout()
        }
      }
    }
    onProgress(100)
    return new Blob(chunks, type ? { type } : undefined)
  } finally {
    reportProgress(null)
  }
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

// isResolvingOrDownloading now lives in lib/appReducer, beside
// isSuccessMessage — the banner's retry offer needs the same predicate the
// promo slot does, and one copy keeps them from drifting apart.

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
        resolve('') // tainted canvas / decode failure — fall back to a tile
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
// route when the canvas path fails — an old browser that taints the canvas, a
// decode error, or a CDN the browser can't send the right Referer to. Either
// way the returned value is a self-contained data URL, so the Recent thumbnail
// survives the source URL expiring. Returns '' when nothing worked (→ tile).
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
    // network/parse failure — fall through to the tile.
  }
  return ''
}

// Hand a tunnel URL straight to the browser's download manager WITHOUT leaving
// the app. The bytes go browser→instance directly (Content-Disposition:
// attachment), skipping our function. A cross-origin <a download> is ignored by
// browsers, so an anchor just navigates the tab to the file (or pops a new tab
// showing the URL). A hidden iframe avoids that: the browser starts the
// attachment download from the iframe navigation while the page stays exactly
// where it is. The `filename` is advisory only — the instance's own attachment
// filename wins cross-origin — so it's unused here.
function triggerDirectDownload(url: string, filename: string) {
  void filename
  const iframe = document.createElement('iframe')
  iframe.style.display = 'none'
  iframe.src = url
  document.body.appendChild(iframe)
  // Give the navigation→download time to start, then tear the iframe down.
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
 *     disposition — worth the egress only when the alternative is holding a
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

/**
 * The line under the YouTube embed.
 *
 * Three outcomes, not two. The middle one is new and is the whole reason this
 * is a function rather than an inline ternary: YouTube now bot-blocks video
 * extraction from datacenter addresses for most videos, but its iPhone client
 * still hands over the audio track — so the common result is an embed you
 * cannot save as video and CAN save as an MP3. Telling that visitor "direct
 * download isn't available" would be pointing away from the working button
 * sitting right underneath.
 */
function embedCaption(hasVideo: boolean, hasAudio: boolean): string {
  if (hasVideo) return 'Preview via YouTube — use the buttons below to download.'
  if (hasAudio) {
    return 'Playing via YouTube. The video itself can’t be saved from here, but the audio can — grab the MP3 below.'
  }
  return 'Playing via YouTube — direct download isn’t available for this video.'
}

// Save an already-fetched body under our own filename: shared helper
// (src/lib/blobSaver.ts), same technique this file used to hand-roll.

// Pull a tunnel download through fetch() so we can report real progress, then
// save it. The bytes still go browser→instance directly — the point of the
// direct path is keeping them out of our Worker, and this preserves that; it
// only replaces the hidden-iframe navigation (which is unobservable) with a
// stream we can measure. Cobalt tunnels send `Access-Control-Allow-Origin: *`,
// so the read is allowed.
//
// Why three outcomes rather than a boolean: the right fallback differs. A body
// too big (or too slow) to hold in memory should go to the browser's download
// manager, which streams to disk; an outright failure should be retried through
// the proxy, which can still show a progress bar. Giving up costs only the bytes
// read so far — these URLs can all be opened again.
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
    // bailout on a slow transfer — only the last of those wants the download
    // manager, and it flagged itself on the way out.
    return oversize ? 'too-big' : 'failed'
  }
}

/**
 * The text under the progress bar: percentage from the reducer, bytes and
 * rate from the progress store. Two sources on one line because they move at
 * different rates — the percentage is throttled by chunk cadence, the store
 * by its own clock — and neither is derived from the other.
 */
function ProgressLine({ pct }: { pct: number | null }) {
  const detail = useSyncExternalStore(
    subscribeProgress,
    getProgressSnapshot,
    getProgressServerSnapshot,
  )
  const t = useT()
  const readout = describeProgress(detail)
  return (
    <p className='text-center text-xs text-white/50'>
      {pct === null
        ? t('preparingDownload')
        : t('progressLine', { pct }) + (readout ? ` · ${readout}` : '')}
    </p>
  )
}

/**
 * The status banner's text. Messages dispatched inside this component were
 * already localized at their call sites; the reducer sets one English
 * constant of its own ('Content processed successfully!'), which is mapped
 * here rather than by threading a locale through the pure reducer.
 */
function displayMessage(
  t: (key: Parameters<ReturnType<typeof useT>>[0]) => string,
  message: string,
): string {
  if (message === 'Content processed successfully!') return t('msgProcessed')
  return message
}

const PLATFORM_DISPLAY: Record<string, string> = {
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
  // Any other host. Recent titles read "Web video" rather than falling back to
  // "Saved link", so the list stays content-shaped for long-tail saves too.
  generic: 'Web',
}

// Never store a raw URL or "Untitled" as a Recent title — fall back to a clean
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
// (drag/swipe + AnimatePresence). It's buried deep behind "Show images" → tap a
// thumbnail, so it is never in the critical path. Lazy-loading it splits the
// ~69KB motion chunk out of the initial bundle — it only downloads the first
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

/**
 * A gallery tile that fails to load, once.
 *
 * These are signed CDN URLs behind our own proxy, and a carousel asks for every
 * one of them at the same moment — a post whose slides load individually can
 * still drop two of them to a throttle. Observed live: three slides requested
 * together, one arrived, and the other two sat as grey placeholders while the
 * exact same URLs answered 200 a second later.
 *
 * So the first failure is retried once with a cache-busting parameter, and only
 * the second falls back. A clip falls back to a plain dark tile rather than the
 * picture placeholder, which would put a "no image" graphic under a play badge.
 */
function retryThumbnailOnce(kind?: 'image' | 'video') {
  return (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    if (img.dataset.retried) {
      if (kind === 'video') img.style.visibility = 'hidden'
      else img.src = getImagePlaceholderBase64()
      return
    }
    img.dataset.retried = '1'
    const separator = img.src.includes('?') ? '&' : '?'
    img.src = `${img.src}${separator}r=1`
  }
}

export function DownloaderApp() {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const containerRef = useRef<HTMLDivElement>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [urlError, setUrlError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pasteBarRef = useRef<HTMLDivElement>(null)
  // Persisted in localStorage and mutated from several places, so it is read
  // from the history store rather than mirrored into component state — the
  // mutators below notify it and this re-renders. See lib/history.
  const history = useSyncExternalStore(
    subscribeHistory,
    getHistorySnapshot,
    getHistoryServerSnapshot,
  )
  const [showAllHistory, setShowAllHistory] = useState(false)
  // Sticky across visits, so they live in an external store that reads
  // localStorage on the first client render — see lib/prefs.
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
  // Download is pressed — and memoised because this runs on every keystroke.
  const pastedLinks = useMemo(() => parseBatchInput(state.url).length, [state.url])

  const [historyQuery, setHistoryQuery] = useState('')
  // Recent search filter. Client-side over at most 30 rows; empty query means
  // "everything", so the ordinary Recent flow is untouched.
  const filteredHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase()
    if (!q) return history
    return history.filter((h) =>
      [h.title, h.url, h.author].some((v) => (v ?? '').toLowerCase().includes(q)),
    )
  }, [history, historyQuery])
  // What the list actually renders. Collapsed shows the five most recent;
  // "View all" and any active filter both show the filtered set — a filter
  // that only searched the visible five would be a filter in name only.
  const visibleHistory = useMemo(
    () =>
      showAllHistory || historyQuery.trim()
        ? filteredHistory
        : history.slice(0, 5),
    [filteredHistory, history, historyQuery, showAllHistory],
  )
  // iPhone/iPad Safari: downloads land in Files, not the camera roll, so we show
  // a one-line "save to Photos" hint on video results. Set once on mount.
  // Read straight from the browser rather than via an effect — see lib/clientEnv.
  const isIOS = useIsIOSLike()
  const didInit = useRef(false)
  // Pro token, sent as X-Pro-Token so the server tries the operator's own
  // resolvers first for a subscriber's request — see lib/entitlements.
  const proToken = useProToken()
  // A supporter's saved-filename shape, or undefined for the built-in one.
  const filenameTemplate = useFilenameTemplate()
  // Core-flow copy follows the chosen language (footer picker); deep copy —
  // hints, FAQ, legal — stays English by design. See lib/i18n.ts.
  const t = useT()
  // Bumped when a per-platform quality override changes, so the hint under
  // the quality toggle repaints (storage itself is not reactive). The map
  // snapshot lives in state; resolveOne reads storage fresh at call time.
  const [platformQualityMap, setPlatformQualityMap] = useState<QualityMap>(() =>
    typeof window === 'undefined' ? {} : getStoredQualityMap(),
  )

  // Thin aliases: the store already persists and notifies, so these exist only
  // to keep the call sites in this file reading the same as before.
  const changeQuality = setQuality
  const changeFormat = setFormat

  /**
   * The name every file saved from this card gets.
   *
   * Seven call sites repeated the same three metadata lookups, differing only
   * in the extension — so adding a supporter's filename template would have
   * meant remembering it seven times, and the one that got missed would have
   * quietly withheld the feature from someone paying for it. One function
   * knows the shape now; callers name the extension and nothing else.
   */
  const nameFile = useCallback(
    (ext: string, extra?: { index?: number; total?: number }) =>
      buildDownloadFilename({
        platform: state.videoMetadata?.platform,
        author: state.videoMetadata?.author,
        title: state.videoMetadata?.title,
        ext,
        template: filenameTemplate,
        ...extra,
      }),
    [
      filenameTemplate,
      state.videoMetadata?.platform,
      state.videoMetadata?.author,
      state.videoMetadata?.title,
    ],
  )

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
      // An explicit re-pick wins; otherwise a platform's remembered choice
      // (set by an earlier re-pick on that platform's result); otherwise the
      // global pref. See lib/platformQuality.
      quality:
        opts?.quality ??
        effectiveQuality(quality, detectPlatform(target) as SupportedPlatform, getStoredQualityMap()),
      format: opts?.format ?? format,
      proToken,
    })

  // Snapshot the thumbnail off the main flow and prepend the link to Recent so
  // the card always shows an image (even after the source URL expires) and the
  // title never reads as a raw link.
  const rememberInHistory = async (
    target: string,
    // Optional because a resolve response is typed with `metadata?` — every
    // read below was already `meta?.…`, so undefined has always been handled.
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
    // only — it decides whether the header pill has earned a sentence.
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
        // A deliberate HD/SD pick on a result is taste for that platform —
        // remembered locally so the next link from it resolves the same way.
        if (nextFormat === 'video') {
          rememberPlatformQuality(
            detectPlatform(target) as SupportedPlatform,
            nextQuality,
          )
          setPlatformQualityMap(getStoredQualityMap())
        }
      } else {
        const fe = friendlyError(data.error, target)
        dispatch({ type: 'SET_MESSAGE', payload: `${fe.title} — ${fe.hint}` })
      }
    } catch (err) {
      const fe = friendlyError(err instanceof Error ? err.message : '', target)
      dispatch({ type: 'SET_MESSAGE', payload: `${fe.title} — ${fe.hint}` })
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
        'Please paste a TikTok, Twitter/X, Instagram, Facebook, or YouTube URL first',
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
          payload: `${fe.title} — ${fe.hint}`,
        })
      }
    } catch (err) {
      console.error('Processing error:', err)
      const fe = friendlyError(err instanceof Error ? err.message : '', target)
      dispatch({
        type: 'SET_MESSAGE',
        payload: `${fe.title} — ${fe.hint}`,
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
        // skip this link — keep going through the rest of the batch.
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
          ? `Saved ${saved} of ${urls.length} links to Recent — tap any to download. 🎉`
          : `Couldn’t resolve any of those ${urls.length} links. Check they’re public post URLs and try again.`,
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
        setUrlError('That doesn’t look like a link — paste a post URL.')
      } else {
        inputRef.current?.focus()
      }
    } catch {
      inputRef.current?.focus()
      setUrlError('Couldn’t read the clipboard — paste the link manually.')
    }
  }

  const handleClearHistory = () => {
    clearHistory()
  }

  // Recent list portability: the history is local-only by design, so export /
  // import are how it moves between a phone and a laptop. Export writes the
  // exact stored JSON; import merges (newest wins) and the store notifies.
  const handleExportHistory = () => {
    saveBlob(
      new Blob([exportHistory()], { type: 'application/json' }),
      'social-downloader-history.json',
    )
  }

  const importFileRef = useRef<HTMLInputElement>(null)
  const [historyNote, setHistoryNote] = useState('')
  const historyNoteTimer = useRef<number | null>(null)

  // The note is transient feedback — it says what one click just did, then
  // gets out of the way. Without the timer it sat under the list until a
  // reload, long after it stopped describing anything.
  const showHistoryNote = useCallback((text: string) => {
    setHistoryNote(text)
    if (historyNoteTimer.current !== null) {
      window.clearTimeout(historyNoteTimer.current)
    }
    historyNoteTimer.current = window.setTimeout(() => setHistoryNote(''), 6000)
  }, [])

  const handleImportHistoryFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const result = importHistory(await file.text())
      if (result === null) {
        showHistoryNote(t('importBadFile'))
        return
      }
      showHistoryNote(
        result.added > 0
          ? t('importedLinks', { n: result.added })
          : t('importNothingNew'),
      )
    } catch {
      showHistoryNote(t('importUnreadable'))
    }
  }

  // Runs once on mount to honour a PWA share-target / deep link (?url= /
  // ?text=). Sharing a link straight from the TikTok/IG/YouTube app lands here —
  // we auto-resolve it and strip the query so a refresh doesn't fire it again.
  // (The recent list needs no hydration step; it reads itself — see lib/history.)
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
        // loading — which is also what a share-target hand-off should look like.
        void Promise.resolve().then(() => handleProcess(found))
      }
    } catch {
      // no-op — malformed query, just show the normal empty state.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleVideoDownload = async () => {
    if (!state.downloadUrl) return

    // Direct path: a Cobalt tunnel downloads browser→Cobalt, skipping our proxy
    // (saves the function's egress). No progress bar — the browser's own
    // download manager takes over instantly.
    const direct = state.videoMetadata?.directVideoUrl
    if (direct) {
      const filename = nameFile('mp4')
      // The instance resolves server-side before the first byte, so nothing
      // moves for a moment after the click. Hold the button in a spinning
      // "preparing" state until the stream starts reporting.
      dispatch({ type: 'SET_DOWNLOADING', payload: true })
      dispatch({ type: 'SET_PROGRESS', payload: null })
      dispatch({ type: 'SET_MESSAGE', payload: t('preparingDownload') })
      const outcome = await downloadDirectWithProgress(direct, filename, (p) =>
        dispatch({ type: 'SET_PROGRESS', payload: p }),
      )
      if (outcome === 'saved') {
        dispatch({ type: 'SET_DOWNLOADING', payload: false })
        dispatch({ type: 'SET_PROGRESS', payload: null })
        dispatch({
          type: 'SET_MESSAGE',
          payload: t('msgVideoDone'),
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
            payload: t('msgDownloadStarted'),
          })
        }, 2800)
        return
      }
      // Nothing to hand off to — retry through the proxy below, which still
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
        nameFile('mp4'),
      )

      dispatch({
        type: 'SET_MESSAGE',
        payload: t('msgVideoDone'),
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
        nameFile('mp4'),
      )

      dispatch({
        type: 'SET_MESSAGE',
        payload: t('msgSlideshowDone'),
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

    // Direct path: a Cobalt audio tunnel (MP3) downloads browser→Cobalt,
    // bypassing our proxy. Only set when the audio source is itself a tunnel
    // (the "→ MP3" flow); re-serving a video stream as audio keeps the proxy.
    const direct = state.videoMetadata?.directAudioUrl
    if (direct) {
      // Same as the video path: stream it so the bar is real, and fall back to
      // the browser's download manager when the stream can't be read.
      const filename = nameFile('mp3')
      dispatch({ type: 'SET_DOWNLOADING_AUDIO', payload: true })
      dispatch({ type: 'SET_PROGRESS', payload: null })
      dispatch({ type: 'SET_MESSAGE', payload: t('preparingDownload') })
      const outcome = await downloadDirectWithProgress(direct, filename, (p) =>
        dispatch({ type: 'SET_PROGRESS', payload: p }),
      )
      if (outcome === 'saved') {
        dispatch({ type: 'SET_DOWNLOADING_AUDIO', payload: false })
        dispatch({ type: 'SET_PROGRESS', payload: null })
        dispatch({
          type: 'SET_MESSAGE',
          payload: t('msgAudioDone'),
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
            payload: t('msgDownloadStarted'),
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
        nameFile('mp3'),
      )

      dispatch({
        type: 'SET_MESSAGE',
        payload: t('msgAudioDone'),
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
        payload: `Pick at least one of the ${galleryNoun} first`,
      })
      return
    }

    dispatch({ type: 'SET_DOWNLOADING_IMAGES', payload: true })

    try {
      // Kind travels with the URL: the route names a clip `.mp4` and sends it
      // through the video proxy, where a still gets `.jpg` and the image proxy.
      const items = selectedImages.map((img) => ({
        url: img.url,
        kind: img.kind ?? 'image',
      }))

      if (state.downloadImagesAsZip) {
        dispatch({ type: 'SET_PROGRESS', payload: 0 })
        const response = await fetch('/api/images', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            items,
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
        // of the initial bundle — most visits never build an archive.
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
        link.download = nameFile('zip')
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)

        URL.revokeObjectURL(blobUrl)

        dispatch({
          type: 'SET_MESSAGE',
          payload: `${selectedImages.length} ${galleryNoun} downloaded as ZIP! 🗜️`,
        })
        dispatch({ type: 'SET_URL', payload: '' })
      } else {
        const response = await fetch('/api/images', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ items }),
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
            link.download = nameFile(
              // The route already worked out what each entry is; naming a clip
              // `.jpg` here was how a carousel's video reached the disk as a
              // file nothing would play.
              imageData.ext || 'jpg',
              { index: i + 1, total: totalImages },
            )
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
          payload: t('msgImagesDone', { n: selectedImages.length }),
        })
        dispatch({ type: 'SET_URL', payload: '' })
      }
    } catch (error) {
      console.error('Image download failed:', error)
      dispatch({
        type: 'SET_MESSAGE',
        payload: `Could not save those ${galleryNoun} — the links may have expired. Paste the post again to refresh them.`,
      })
    } finally {
      dispatch({ type: 'SET_DOWNLOADING_IMAGES', payload: false })
      dispatch({ type: 'SET_PROGRESS', payload: null })
    }
  }

  // A carousel can mix stills and clips, so the gallery cannot call everything
  // in it an image. "Items" only appears when there is actually a clip among
  // them — an all-photo post keeps the word people expect.
  const galleryHasVideo = (state.videoMetadata?.images ?? []).some(
    (item) => item.kind === 'video',
  )
  const galleryNoun = galleryHasVideo ? 'items' : 'images'

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

  // Keyboard-aware paste bar — the web equivalent of RN's KeyboardAvoidingView.
  // The soft keyboard doesn't reflow the page; it shrinks the *visual* viewport
  // and overlays the bottom, so a paste bar sitting low in the hero ends up
  // hidden behind it. visualViewport.height is the real post-keyboard height:
  // if the bar's bottom sits below the visible band, scroll the page up by
  // exactly that overlap (+ breathing room) so it rises above the keys.
  //
  // Measure the whole PASTE BAR, not just the input: on mobile the Download
  // button stacks *below* the field (flex-col), so scrolling only the input
  // into view left the button — the thing the user actually taps — still
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

  // The keyboard slide-up fires a visualViewport 'resize' — recentre then, when
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
      {/* Paste bar — the hero action. Input + CTA share one focus-ring pill. */}
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
            placeholder={t('pastePlaceholder')}
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
              // visualViewport 'resize' — nudge after the slide-up settles.
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
          {/* One-tap paste — only while the field is empty, so it never overlaps
              a link the user is typing. Reads the clipboard and auto-resolves. */}
          {!state.url && (
            <button
              type='button'
              onClick={handlePaste}
              aria-label={t('pasteAria')}
              className='card-hover absolute right-1.5 flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-xs font-medium text-white/70 hover:text-white active:scale-95'
            >
              <ClipboardIcon className='h-3.5 w-3.5' />
              {t('paste')}
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
              {t('processing')}
            </span>
          ) : (
            <span className='relative'>{t('downloadBtn')}</span>
          )}
        </button>
      </Surface>

      {urlError && (
        <p
          id='url-error'
          role='alert'
          className='animate-section-in mt-2 flex items-center gap-1.5 text-xs text-red-300 md:text-sm'
        >
          <span aria-hidden>⚠</span>
          {urlError}
        </p>
      )}

      {/* The strongest moment to make the case, and it costs nothing to be
          wrong: someone holding one link never sees it. A pasted list already
          works without the extras — it resolves one at a time into Recent and
          leaves every download to be tapped by hand — so this describes the
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
        Videos, reels, shorts, MP3 audio &amp; photo carousels — paste several
        links to grab them in one go
      </p>

      {/* Format + quality preferences — applied on the next resolve. Format
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
          <div className='flex flex-col gap-1'>
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
              {/* A re-pick on a result is remembered per platform; when the
                  link in the field belongs to one, say so and offer the way
                  back — otherwise the override would look like a broken
                  toggle. The version counter exists because the memory lives
                  in storage, not state: clearing must repaint this line. */}
              {(() => {
                const platform = detectPlatform(state.url || state.originalUrl)
                if (platform === 'unknown') return null
                const remembered = platformQualityMap[platform]
                if (!remembered) return null
                const label = PLATFORM_DISPLAY[platform] ?? platform
                return (
                  <span className='text-[11px] text-white/40'>
                    {label}:{' '}
                    {remembered === 'hd' ? 'HD' : 'Data saver'} ·{' '}
                    <button
                      type='button'
                      onClick={() => {
                        clearPlatformQuality(platform)
                        setPlatformQualityMap((m) => removeQuality(m, platform))
                      }}
                      className='underline underline-offset-2 transition-colors hover:text-white/70'
                    >
                      reset
                    </button>
                  </span>
                )
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Pro-only batch queue — self-hides for free users, so no conditional
          is needed at the call site. */}
      <BatchPanel />

      {/* Recent — locally-stored links (never leaves the device). Stays on
          screen alongside a result: it is the way back to an earlier link, and
          hiding it exactly when you have something to compare against is when
          it's least useful. Only a resolve in flight hides it, so the list
          can't be re-tapped mid-request. Tap to re-resolve. */}
      {history.length > 0 && !state.loading && (
        <div className='animate-section-in mt-4'>
          <div className='mb-2 flex items-center justify-between'>
            <span className='flex items-center gap-1.5 text-xs font-medium text-white/50'>
              <ClockIcon className='h-3.5 w-3.5' />
              {t('recent')}
            </span>
            <div className='flex items-center gap-1'>
              {/* Portability for a local-only list: export writes the stored
                  JSON, import merges a file back in. Text-only buttons, same
                  weight as Clear, so they read as plumbing rather than CTA. */}
              <button
                type='button'
                onClick={handleExportHistory}
                className='rounded-md px-1.5 py-0.5 text-[11px] text-white/50 transition-colors hover:text-white/80'
              >
                {t('export')}
              </button>
              <button
                type='button'
                onClick={() => importFileRef.current?.click()}
                className='rounded-md px-1.5 py-0.5 text-[11px] text-white/50 transition-colors hover:text-white/80'
              >
                {t('importLabel')}
              </button>
              <input
                ref={importFileRef}
                type='file'
                accept='.json,application/json'
                onChange={(e) => void handleImportHistoryFile(e)}
                className='hidden'
                aria-hidden
                tabIndex={-1}
              />
              <button
                type='button'
                onClick={handleClearHistory}
                className='flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-white/50 transition-colors hover:text-white/80'
              >
                <TrashIcon className='h-3 w-3' />
                {t('clear')}
              </button>
            </div>
          </div>
          {history.length > 8 && (
            <input
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              placeholder={t('filterRecent')}
              aria-label={t('filterRecent')}
              className='mb-2 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white caret-cyan-300 outline-none placeholder:text-white/35 focus:border-cyan-400/40'
            />
          )}
          {historyNote && (
            <p className='mb-2 text-right text-[11px] text-white/45'>
              {historyNote}
            </p>
          )}
          <ul
            className={`space-y-1.5 ${
              showAllHistory ? 'max-h-72 overflow-y-auto pr-1' : ''
            }`}
          >
            {visibleHistory.map((h) => (
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
                        t('savedLink')}
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
                    ×
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
              {showAllHistory ? t('showLess') : t('viewAll', { n: history.length })}
            </button>
          )}
        </div>
      )}

      {/* Install nudge — secondary, so it sits below the paste bar, controls and
          Recent rather than interrupting the core flow. Installing registers the
          Android share target (share a link straight from TikTok/IG/YouTube). */}
      {!state.videoMetadata && !state.loading && <InstallPrompt />}

      {/* Results — expand directly under the paste bar.
          scroll-mt-24: the success handler calls scrollIntoView({block:'start'}),
          which pins this section flush to the viewport top. On mobile the
          collapsing address bar overlays that strip and eats the card header
          ("top disappears"). scroll-margin-top leaves ~6rem so the header always
          clears the browser chrome. */}
      <div className='results-section mt-6 space-y-4 scroll-mt-24'>
        {state.message && (
          // Plain conditional + CSS reveal. key={message} remounts on new text
          // so the entrance re-fires as state feedback. No height animation to
          // stall, no 0-height ghost left in the space-y flow.
          <div
            key={state.message}
            role='status'
            aria-live='polite'
            className={`animate-section-in p-3 rounded-xl text-center text-sm md:text-base ${
              isSuccessMessage(state.message)
                ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                : 'bg-red-500/20 text-red-300 border border-red-500/30'
            }`}
          >
            {displayMessage(t, state.message)}
            {!isSuccessMessage(state.message) &&
              !isResolvingOrDownloading(state) &&
              state.originalUrl && (
                // A failed resolve usually means "the source hiccuped", not
                // "give up" — offer the retry where the failure is, instead
                // of making someone scroll up and re-click Process. Gated on
                // isResolvingOrDownloading because "Preparing your download…"
                // is not a success message either: without it, every running
                // transfer offers to restart itself.
                <button
                  type='button'
                  onClick={() => void handleProcess(state.originalUrl)}
                  className='btn-press mx-auto mt-2 block rounded-lg border border-white/25 px-3 py-1 text-xs font-semibold transition-colors hover:bg-white/10'
                >
                  {t('tryAgain')}
                </button>
              )}
          </div>
        )}

        {/* Attached to the success line, and only ever to that one. This is the
            single point in the flow where the visitor has what they came for
            and is not waiting on anything — the one moment an ask is not an
            interruption. It reads as a footnote to the confirmation above it
            rather than a second banner. */}
        {isSuccessMessage(state.message) && (
          <ProNudge
            id='post-download'
            tone='attached'
            action={`Support this — $${SUPPORT_PRICES.monthly}/month`}
            lede={
              <>
                Saved you some time? This site is free to use and not free to
                run — supporters get the batch queue, downloads named the way
                they file things, priority on every link and no sponsor card,
                switched on automatically.
              </>
            }
          />
        )}

        {/* Batch mode: show a compact per-link progress line instead of the
            single-result skeleton while a pasted list resolves. */}
        {batch && (
          <Surface
            elevation='raised'
            className='animate-section-in space-y-2 p-4'
            role='status'
            aria-live='polite'
          >
            <div className='flex items-center justify-between text-sm text-white/80'>
              <span className='flex items-center gap-2'>
                <SpinnerIcon className='h-4 w-4' />
                Resolving link {Math.min(batch.done + 1, batch.total)} of{' '}
                {batch.total}…
              </span>
              <span className='text-xs text-white/50'>{batch.saved} saved</span>
            </div>
            <div className='h-1.5 w-full overflow-hidden rounded-full bg-white/10'>
              <div
                className='h-full rounded-full bg-gradient-to-r from-cyan-400 to-sky-400 transition-[width] duration-200 ease-out'
                style={{
                  width: `${Math.round((batch.done / batch.total) * 100)}%`,
                }}
              />
            </div>
          </Surface>
        )}

        {state.loading && !batch && !state.videoMetadata && <ResultsSkeleton />}

          {state.videoMetadata && (
            // CSS entrance (not framer initial:opacity-0). On mobile the main
            // thread is busy decoding carousel images, which starves framer's
            // rAF animation-start and leaves the card stuck at opacity:0 for
            // seconds. animate-card-enter runs on the compositor and never
            // drops below 0.6 opacity, so the card is always visible.
            <Surface elevation='raised' className='animate-card-enter p-4 space-y-4'>
              <div className='flex items-start space-x-3'>
                {state.videoMetadata.thumbnail && (
                  <img
                    src={state.videoMetadata.thumbnail}
                    alt='Video thumbnail'
                    loading='lazy'
                    decoding='async'
                    className='w-16 h-16 md:w-20 md:h-20 rounded-lg object-cover flex-shrink-0'
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                )}
                <div className='flex-1 min-w-0'>
                  <h3 className='text-white font-medium text-sm md:text-base line-clamp-2'>
                    {state.videoMetadata.title}
                  </h3>
                  <p className='text-white/70 text-xs md:text-sm mt-1'>
                    by {state.videoMetadata.author}
                  </p>
                  {(state.videoMetadata.duration > 0 ||
                    !!state.videoMetadata.sizeBytes) && (
                    <p className='text-white/50 text-xs mt-1 tabular-nums'>
                      {state.videoMetadata.duration > 0 && (
                        <>
                          {Math.floor(state.videoMetadata.duration / 60)}:
                          {(state.videoMetadata.duration % 60)
                            .toString()
                            .padStart(2, '0')}
                        </>
                      )}
                      {state.videoMetadata.duration > 0 &&
                        !!state.videoMetadata.sizeBytes && (
                          <span className='mx-1.5 text-white/25'>·</span>
                        )}
                      {formatBytes(state.videoMetadata.sizeBytes)}
                    </p>
                  )}
                  {state.originalUrl &&
                    (() => {
                      const platform = state.videoMetadata?.platform
                      const platformConfig: Partial<
                        Record<
                          NonNullable<typeof platform>,
                          {
                            label: string
                            Icon: React.ComponentType<{ className?: string }>
                            color: string
                          }
                        >
                      > = {
                        tiktok: {
                          label: 'View on TikTok',
                          Icon: TikTokIcon,
                          color: 'text-pink-400 hover:text-pink-300',
                        },
                        twitter: {
                          label: 'View on Twitter/X',
                          Icon: TwitterXIcon,
                          color: 'text-sky-400 hover:text-sky-300',
                        },
                        instagram: {
                          label: 'View on Instagram',
                          Icon: InstagramIcon,
                          color: 'text-fuchsia-400 hover:text-fuchsia-300',
                        },
                        facebook: {
                          label: 'View on Facebook',
                          Icon: FacebookIcon,
                          color: 'text-blue-400 hover:text-blue-300',
                        },
                        youtube: {
                          label: 'View on YouTube',
                          Icon: YouTubeIcon,
                          color: 'text-red-400 hover:text-red-300',
                        },
                      }
                      const fallback = {
                        label: 'View original post',
                        Icon: ExternalLinkIcon,
                        color: 'text-cyan-400 hover:text-cyan-300',
                      }
                      const cfg =
                        (platform && platformConfig[platform]) || fallback
                      return (
                        <a
                          href={state.originalUrl}
                          target='_blank'
                          rel='noopener noreferrer'
                          className={`inline-flex items-center gap-1 mt-2 text-xs transition-colors underline underline-offset-2 break-all ${cfg.color}`}
                        >
                          <cfg.Icon className='w-3 h-3 flex-shrink-0' />
                          {cfg.label}
                        </a>
                      )
                    })()}
                </div>
              </div>

              {/* Preview Toggle (downloadable video or embed-only fallback) */}
              {(state.downloadUrl || state.videoMetadata?.embedUrl) && (
                <button
                  onClick={togglePreview}
                  className='btn-ghost btn-press w-full py-2.5 px-4 font-semibold rounded-xl flex items-center justify-center text-sm md:text-base'
                >
                  <span className='relative'>
                    {state.showPreview ? 'Hide preview' : 'Show preview'}
                  </span>
                </button>
              )}

              {/* Video Preview (direct stream). For YouTube we prefer the
                  lightweight embed below so previewing doesn't trigger a full
                  yt-dlp download. */}
              {state.showPreview &&
                state.downloadUrl &&
                !state.videoMetadata?.embedUrl && (
                  <div className='animate-section-in space-y-3'>
                    {/* Deliberately the same-origin /api/video proxy, NOT the
                        direct tunnel the download button uses.

                        A media element requests bytes with a Range header, and
                        Cobalt tunnels answer that with a `206` that omits the
                        mandatory `Content-Range`. Browsers reject such a
                        response outright, so pointing <video> at the tunnel
                        produces a preview that always fails while the download
                        — a plain GET, no Range, clean `200` — works fine.
                        resolveRangeResponse() in lib/proxyHeaders.ts repairs
                        that shape, so going through the proxy is what makes
                        playback (and seeking) work at all.

                        The bandwidth argument still holds for downloads, which
                        is the high-volume path and still goes browser→tunnel
                        direct. A preview costs two extra clicks (Show preview,
                        then play) and preload='none' means nothing is fetched
                        until the user actually presses play. */}
                    <div className='bg-black rounded-xl overflow-hidden ring-1 ring-inset ring-white/10 shadow-lg'>
                      <video
                        src={state.downloadUrl}
                        poster={state.videoMetadata?.thumbnail || undefined}
                        controls
                        playsInline
                        className='w-full h-auto max-h-[60vh] object-contain bg-black'
                        preload='none'
                        onError={(e) => {
                          console.error('Video preview error:', e)
                          dispatch({
                            type: 'SET_MESSAGE',
                            payload:
                              'Preview unavailable, but download should work',
                          })
                        }}
                      >
                        Your browser does not support the video tag.
                      </video>
                    </div>
                    <p className='text-white/50 text-xs text-center'>
                      Press play to preview — nothing streams until you do.
                    </p>
                  </div>
                )}

              {/* YouTube embed fallback — playable but not downloadable. Shown
                  when free extraction is blocked so the video stays viewable. */}
              {state.showPreview && state.videoMetadata?.embedUrl && (
                <div className='animate-section-in space-y-3'>
                  <div className='relative bg-black rounded-xl overflow-hidden ring-1 ring-inset ring-white/10 shadow-lg aspect-video'>
                    <iframe
                      src={state.videoMetadata.embedUrl}
                      title={state.videoMetadata.title || 'YouTube video'}
                      allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
                      allowFullScreen
                      loading='lazy'
                      referrerPolicy='strict-origin-when-cross-origin'
                      className='absolute inset-0 h-full w-full'
                    />
                  </div>
                  <p className='text-white/50 text-xs text-center'>
                    {embedCaption(!!state.downloadUrl, !!state.audioUrl)}
                  </p>
                </div>
              )}

              {/* Photo Carousel Audio Preview */}
              {state.videoMetadata?.isPhotoCarousel && state.audioUrl && (
                <div className='animate-fade-in-up space-y-3 bg-gradient-to-br from-cyan-500/10 to-sky-500/10 rounded-xl p-4 border border-white/[0.1]'>
                  <div className='flex items-center gap-2 text-white'>
                    <MusicIcon className='w-5 h-5 text-cyan-300' />
                    <div className='flex-1 min-w-0'>
                      <p className='text-sm font-semibold truncate'>
                        {state.videoMetadata.musicTitle ||
                          'Slideshow soundtrack'}
                      </p>
                      {state.videoMetadata.musicAuthor && (
                        <p className='text-xs text-white/60 truncate'>
                          by {state.videoMetadata.musicAuthor}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* preload='none', not 'metadata': every carousel result
                      would otherwise pull the head of the track through
                      /api/audio for a visitor who never pressed play. */}
                  <audio
                    src={state.audioUrl}
                    controls
                    preload='none'
                    className='w-full'
                  >
                    Your browser does not support the audio element.
                  </audio>
                </div>
              )}

              {/* Image Gallery */}
              {state.videoMetadata?.images &&
                state.videoMetadata.images.length > 0 && (
                  <div className='space-y-3'>
                    <button
                      onClick={toggleImageGallery}
                      className='btn-ghost btn-press w-full py-2.5 px-4 font-semibold rounded-xl flex items-center justify-center text-sm md:text-base'
                    >
                      <span className='relative'>
                        {state.showImageGallery
                          ? `Hide ${galleryNoun}`
                          : `Show ${galleryNoun} (${state.videoMetadata.images.length})`}
                      </span>
                    </button>

                    {state.showImageGallery && (
                      // No height animation — a big image grid is exactly what
                      // starved framer's rAF on mobile and left the gallery
                      // collapsed/invisible. CSS reveal is instant, compositor-
                      // only, and can't be stalled. px-1 gives the selected
                      // tiles' inset cyan ring breathing room from the edge.
                      <div className='animate-section-in space-y-3 px-1'>
                        <div className='flex items-center justify-between bg-white/[0.03] border border-white/[0.08] rounded-lg p-3'>
                          <span className='text-white text-sm'>
                            Select {galleryNoun} to download:
                          </span>
                          <div className='flex space-x-2'>
                            <button
                              onClick={() => selectAllImages(true)}
                              className='btn-grad px-3 py-1 text-xs font-semibold rounded-md transition-[box-shadow] duration-200'
                            >
                              All
                            </button>
                            <button
                              onClick={() => selectAllImages(false)}
                              className='btn-ghost px-3 py-1 text-xs font-medium rounded-md transition-colors'
                            >
                              None
                            </button>
                          </div>
                        </div>

                        <div className='grid grid-cols-2 sm:grid-cols-3 gap-3'>
                          {state.videoMetadata.images.map((image, index) => (
                            // Wrapper is positioning-only (no ring/overflow) so
                            // badges can overlay; the ring lives on the image
                            // button itself — same element as the rounding, so
                            // the outline aligns pixel-perfect to the corners.
                            // `ring-inset` is essential: an OUTWARD ring is a
                            // box-shadow painted outside the element, and this
                            // grid's collapse wrapper (the height-animated
                            // `overflow-hidden` motion.div) would slice that
                            // outward ring off the left/right edge tiles —
                            // permanently for selected tiles and on hover (when
                            // it thickens 1px→2px). An inset ring renders inside
                            // the element's own box, so no ancestor clip can
                            // ever cut it, in any state.
                            <div key={image.id} className='group relative'>
                              <button
                                type='button'
                                onClick={() => setLightboxIndex(index)}
                                className={`flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-black/30 ring-inset transition duration-200 ${
                                  image.kind === 'video'
                                    ? 'cursor-pointer'
                                    : 'cursor-zoom-in'
                                } ${
                                  image.selected
                                    ? 'ring-2 ring-cyan-400'
                                    : 'ring-1 ring-white/10 hover:ring-2 hover:ring-white/60'
                                }`}
                                aria-label={
                                  image.kind === 'video'
                                    ? `Play video ${index + 1}`
                                    : `Open image ${index + 1} full size`
                                }
                              >
                                {/* object-contain shows the whole image (never
                                    cropped). No hover scale — scaling a
                                    contained image past the cell would clip it
                                    (overflow-hidden) and look cropped on hover. */}
                                <img
                                  src={image.thumbnail || image.url}
                                  alt={
                                    image.kind === 'video'
                                      ? `Cover frame of video ${index + 1}`
                                      : `Slide ${index + 1}`
                                  }
                                  className='h-full w-full object-contain'
                                  loading='lazy'
                                  decoding='async'
                                  onError={retryThumbnailOnce(image.kind)}
                                />
                                {/* A clip has to look like one before it is
                                    opened: without this a video slide is a
                                    still frame in a grid of stills, and the
                                    only way to find out was to tap it. */}
                                {image.kind === 'video' && (
                                  <span className='pointer-events-none absolute inset-0 flex items-center justify-center'>
                                    <span className='flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/25 backdrop-blur-[2px] transition-transform duration-200 group-hover:scale-110'>
                                      <PlayIcon className='ml-0.5 h-5 w-5' />
                                    </span>
                                  </span>
                                )}
                              </button>

                              <button
                                type='button'
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleImageSelection(image.id)
                                }}
                                aria-pressed={image.selected}
                                aria-label={
                                  image.selected
                                    ? `Deselect item ${index + 1}`
                                    : `Select item ${index + 1}`
                                }
                                className={`absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 backdrop-blur-sm transition-all duration-200 ${
                                  image.selected
                                    ? 'border-cyan-400 bg-cyan-400 text-[#04171b]'
                                    : 'border-white/50 bg-black/40 hover:border-white hover:bg-black/60'
                                }`}
                              >
                                {image.selected && (
                                  <CheckIcon className='h-4 w-4 text-[#04171b]' />
                                )}
                              </button>

                              <div className='pointer-events-none absolute top-1.5 left-1.5 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white'>
                                {index + 1}
                              </div>

                              <div className='pointer-events-none absolute inset-x-1.5 bottom-1.5 rounded bg-black/40 px-1.5 py-0.5 text-center text-[10px] text-white/80 opacity-0 transition-opacity group-hover:opacity-100'>
                                {image.kind === 'video'
                                  ? 'Click to play'
                                  : 'Click to preview'}
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className='bg-white/[0.03] border border-white/[0.08] rounded-lg p-3 space-y-3'>
                            <div className='flex items-center space-x-3'>
                              <input
                                type='checkbox'
                                id='downloadAsZip'
                                checked={state.downloadImagesAsZip}
                                onChange={(e) =>
                                  dispatch({
                                    type: 'SET_DOWNLOAD_IMAGES_AS_ZIP',
                                    payload: e.target.checked,
                                  })
                                }
                                className='w-4 h-4 accent-cyan-400 bg-white/10 border-white/30 rounded focus:ring-cyan-400 focus:ring-2'
                              />
                              <label
                                htmlFor='downloadAsZip'
                                className='text-white text-sm'
                              >
                                Download as ZIP file
                              </label>
                            </div>
                            <p className='text-white/60 text-xs'>
                              {state.downloadImagesAsZip
                                ? `Selected ${galleryNoun} arrive as one ZIP file`
                                : `Selected ${galleryNoun} download one by one`}
                            </p>
                          </div>

                        <button
                          onClick={handleImageDownload}
                          disabled={
                            state.downloadingImages ||
                            !state.videoMetadata?.images?.some(
                              (img) => img.selected,
                            )
                          }
                          className='btn-grad w-full py-3 px-4 disabled:opacity-50 disabled:cursor-not-allowed font-semibold rounded-xl transition-[box-shadow,transform] duration-200 flex items-center justify-center text-sm md:text-base gap-2'
                        >
                          {state.downloadingImages ? (
                            <>
                              <SpinnerIcon className='flex-shrink-0 h-4 w-4' />
                              <span>{t('downloadingBtn')}</span>
                            </>
                          ) : (
                            <>
                              <DownloadIcon className='flex-shrink-0 h-5 w-5' />
                              <span>
                                Download selected (
                                {state.videoMetadata?.images?.filter(
                                  (img) => img.selected,
                                ).length || 0}
                                )
                              </span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}

              {/* Re-pick rendition — re-resolve the SAME link as HD / Data
                  saver / MP3 without making the user re-paste. Hidden for photo
                  carousels and embed-only results (no single stream to swap). */}
              {(() => {
                const meta = state.videoMetadata
                const hasStream = !!state.downloadUrl || !!state.audioUrl
                const isGallery =
                  meta?.isPhotoCarousel || (meta?.images?.length ?? 0) > 0
                if (!hasStream || isGallery) return null
                const active: 'hd' | 'sd' | 'audio' =
                  format === 'audio' ? 'audio' : quality
                const options: Array<{
                  key: 'hd' | 'sd' | 'audio'
                  label: string
                  onPick: () => void
                }> = [
                  { key: 'hd', label: 'HD', onPick: () => reResolve('video', 'hd') },
                  {
                    key: 'sd',
                    label: 'Data saver',
                    onPick: () => reResolve('video', 'sd'),
                  },
                  {
                    key: 'audio',
                    label: 'MP3',
                    onPick: () => reResolve('audio', quality),
                  },
                ]
                return (
                  <div className='flex items-center justify-center gap-2 text-xs'>
                    <span className='text-white/50'>Get it as</span>
                    <div
                      role='group'
                      aria-label='Re-download as'
                      className='inline-flex rounded-full border border-white/10 bg-white/[0.03] p-0.5'
                    >
                      {options.map((o) => {
                        const isActive = active === o.key
                        const isPending = repicking === o.key
                        return (
                          <button
                            key={o.key}
                            type='button'
                            onClick={o.onPick}
                            disabled={repicking !== null}
                            aria-pressed={isActive}
                            className={`flex items-center gap-1 rounded-full px-3 py-1 font-medium transition-colors disabled:cursor-not-allowed ${
                              isActive
                                ? 'bg-cyan-400/90 text-[#04171b]'
                                : 'text-white/55 hover:text-white disabled:opacity-50'
                            }`}
                          >
                            {isPending && <SpinnerIcon className='h-3 w-3' />}
                            {o.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {/* Download Buttons */}
              {(() => {
                const hasImagesForSlideshow =
                  state.videoMetadata?.isPhotoCarousel &&
                  (state.videoMetadata?.images?.length ?? 0) > 0
                const showVideoButton =
                  !!state.downloadUrl || hasImagesForSlideshow
                const showAudioButton = !!state.audioUrl
                if (!showVideoButton && !showAudioButton) return null
                return (
                  <div
                    className={`grid gap-3 ${
                      showVideoButton && showAudioButton
                        ? 'grid-cols-1 md:grid-cols-2'
                        : 'grid-cols-1'
                    }`}
                  >
                    {showVideoButton && (
                      <button
                        onClick={
                          state.downloadUrl
                            ? handleVideoDownload
                            : handleSlideshowRender
                        }
                        disabled={
                          state.downloading || state.downloadingImages
                        }
                        className='btn-grad btn-press group relative py-3 px-4 disabled:opacity-50 disabled:cursor-not-allowed font-semibold rounded-xl flex items-center justify-center text-sm md:text-base gap-2 overflow-hidden'
                      >
                        <span
                          className='pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-1000 ease-out'
                          aria-hidden
                        />
                        {state.downloading ? (
                          <span className='relative flex items-center gap-2'>
                            <SpinnerIcon className='flex-shrink-0 h-4 w-4' />
                            <span>
                              {state.videoMetadata?.isPhotoCarousel &&
                              !state.downloadUrl
                                ? 'Rendering...'
                                : 'Downloading...'}
                            </span>
                          </span>
                        ) : (
                          <span className='relative flex items-center gap-2'>
                            <DownloadIcon className='flex-shrink-0 h-5 w-5' />
                            <span>
                              {state.videoMetadata?.isPhotoCarousel
                                ? t('videoSlideshowBtn')
                                : t('videoBtn')}
                            </span>
                          </span>
                        )}
                      </button>
                    )}

                    {showAudioButton && (
                      <button
                        onClick={handleAudioDownload}
                        disabled={
                          state.downloadingAudio || state.downloadingImages
                        }
                        className='btn-ghost btn-press py-3 px-4 disabled:opacity-50 disabled:cursor-not-allowed font-semibold rounded-xl flex items-center justify-center text-sm md:text-base gap-2'
                      >
                        {state.downloadingAudio ? (
                          <span className='relative flex items-center gap-2'>
                            <SpinnerIcon className='flex-shrink-0 h-4 w-4' />
                            <span>{t('downloadingBtn')}</span>
                          </span>
                        ) : (
                          <span className='relative flex items-center gap-2'>
                            <MusicIcon className='flex-shrink-0 h-5 w-5' />
                            <span>
                              {state.videoMetadata?.isPhotoCarousel
                                ? t('downloadAudioBtn')
                                : t('extractAudio')}
                            </span>
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                )
              })()}

              {/* Extras row. Share and Copy-link apply to every resolved
                  result, so the row's own condition is "there is a result" —
                  gating it on the thumbnail would have hidden both from every
                  long-tail link that resolves without a cover image. The two
                  conditional members (cover image, caption picker) each render
                  nothing when they do not apply, so the common path gains no
                  noise. */}
              {state.originalUrl && (
                <div className='flex flex-wrap items-center justify-center gap-2'>
                  {state.videoMetadata?.thumbnail && (
                    <ThumbnailButton
                      url={state.videoMetadata.thumbnail}
                      title={state.videoMetadata.title}
                    />
                  )}
                  <ShareButton
                    title={state.videoMetadata?.title || state.originalUrl}
                    url={state.originalUrl}
                  />
                  <CopyLinkButton url={state.originalUrl} />
                  {state.videoMetadata?.platform === 'youtube' &&
                    (() => {
                      const ytId = parseYouTubeId(state.originalUrl)
                      return ytId ? <SubtitlePicker videoId={ytId} /> : null
                    })()}
                </div>
              )}

              {/* iOS: video downloads land in Files, not the camera roll, so
                  point users at the one extra tap that saves to Photos. Only for
                  a real video stream (MP3/Files-only downloads don't need it). */}
              {isIOS &&
                !!state.downloadUrl &&
                !state.videoMetadata?.isPhotoCarousel && (
                  <p className='text-center text-[11px] leading-relaxed text-white/50'>
                    On iPhone it saves to Files. To add it to Photos, open the
                    file, tap Share, then Save Video.
                  </p>
                )}

              {(state.downloadUrl || state.audioUrl) &&
                (() => {
                  const isDownloading =
                    state.downloading ||
                    state.downloadingAudio ||
                    state.downloadingImages
                  if (!isDownloading) {
                    return (
                      <p className='text-white/50 text-xs text-center'>
                        {t('clickToDownload')}
                      </p>
                    )
                  }
                  const pct = state.progress
                  return (
                    <div
                      className='space-y-1.5'
                      role='status'
                      aria-live='polite'
                    >
                      <div className='h-1.5 w-full overflow-hidden rounded-full bg-white/10'>
                        {pct === null ? (
                          <div className='animate-progress-indeterminate h-full w-1/3 rounded-full bg-gradient-to-r from-cyan-400 to-sky-400' />
                        ) : (
                          <div
                            className='h-full rounded-full bg-gradient-to-r from-cyan-400 to-sky-400 transition-[width] duration-150 ease-out'
                            style={{ width: `${pct}%` }}
                          />
                        )}
                      </div>
                      <ProgressLine pct={pct} />
                    </div>
                  )
                })()}
            </Surface>
          )}
        </div>

      {/* Sponsor card — only after a result exists, never while resolving or
          downloading, and always below the download controls. */}
      {state.videoMetadata && !isResolvingOrDownloading(state) && (
        <PromoSlot placement='post-result' platform={state.videoMetadata.platform} />
      )}

      {lightboxIndex !== null && state.videoMetadata?.images && (
        <ImageLightbox
          images={state.videoMetadata.images}
          activeIndex={lightboxIndex}
          platform={state.videoMetadata.platform}
          author={state.videoMetadata.author}
          title={state.videoMetadata.title}
          filenameTemplate={filenameTemplate}
          onClose={() => setLightboxIndex(null)}
          onPrev={() =>
            setLightboxIndex((i) => {
              const total = state.videoMetadata?.images?.length ?? 0
              if (i === null || total === 0) return i
              return (i - 1 + total) % total
            })
          }
          onNext={() =>
            setLightboxIndex((i) => {
              const total = state.videoMetadata?.images?.length ?? 0
              if (i === null || total === 0) return i
              return (i + 1) % total
            })
          }
        />
      )}
    </div>
  )
}
