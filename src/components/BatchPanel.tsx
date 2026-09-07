'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Surface } from '@/components/Surface'
import {
  MAX_BATCH_URLS,
  parseBatchInput,
  runBatch,
  type BatchItem,
  type BatchItemStatus,
} from '@/lib/batchQueue'
import {
  categorizeResult,
  isCancelled,
  isZippable,
  rowStatusColorClass,
  rowStatusText,
} from '@/lib/batchPresentation'
import { buildDownloadFilename } from '@/lib/filename'
import { saveBlob, saveMedia } from '@/lib/blobSaver'
import { resolve, type ResolveResult } from '@/lib/resolve'
import {
  usePendingBatchLinks,
  usePendingCollectionImport,
} from '@/lib/batchHandoff'
import {
  useFilenameTemplate,
  useProToken,
  useTier,
} from '@/lib/entitlements'
import { CheckIcon, SpinnerIcon } from '@/components/icons'

/**
 * Pro's headline feature: paste up to MAX_BATCH_URLS links and resolve them as
 * a queue (see `src/lib/batchQueue.ts` for the driver). Delivery is
 * deliberately not "always ZIP" — a client-side archive of twenty videos would
 * exhaust memory on the phones this audience uses:
 *  - Video results save individually, one per finished item, reusing the same
 *    direct-tunnel-first / proxy-fallback path the single-link flow uses so
 *    Cobalt tunnel bytes keep bypassing the Worker.
 *  - Image and audio results collect into a single ZIP, built with the same
 *    lazily-imported JSZip the single-link image gallery already uses.
 *
 * The pure routing/labeling logic (`categorizeResult`, `isCancelled`,
 * `rowStatusText`, `rowStatusColorClass`) lives in `@/lib/batchPresentation`,
 * not here — it needs to be unit-testable, and this file cannot be (no jsdom
 * in this repo's Vitest config).
 */

// Batch is one format for the whole run, not per-item — the queue has no UI
// real estate for twenty individual toggles, and this is the choice that
// actually matters: TikTok/Instagram creators are exactly the audience this
// feature targets, and audio-only extraction is a common thing to want in
// bulk. Threaded straight into `resolve()`'s existing `format` option.
type BatchFormat = 'video' | 'audio'

// Hand a Cobalt tunnel URL straight to the browser's download manager via a
// throwaway iframe — same technique `triggerDirectDownload` uses in
// DownloaderApp.tsx, kept local for the same reason as saveBlobLocally above.
function triggerTunnelDownload(url: string) {
  const iframe = document.createElement('iframe')
  iframe.style.display = 'none'
  iframe.src = url
  document.body.appendChild(iframe)
  window.setTimeout(() => iframe.remove(), 120000)
}

/**
 * Save a finished video item the moment it resolves. Prefers the direct
 * Cobalt tunnel URL (bytes flow browser→instance, never through our Worker);
 * falls back to fetching the proxied URL when no tunnel was issued. Best
 * effort — a save failure here doesn't change the item's resolved status, it
 * just means that one video needs a manual re-download.
 */
async function saveVideoResult(
  result: ResolveResult,
  template?: string,
): Promise<void> {
  const meta = result.metadata
  const filename = buildDownloadFilename({
    platform: meta?.platform,
    author: meta?.author,
    title: meta?.title,
    ext: 'mp4',
    template,
  })
  try {
    const direct = meta?.directVideoUrl
    if (direct) {
      triggerTunnelDownload(direct)
      return
    }
    if (!result.downloadUrl) return
    const response = await fetch(result.downloadUrl)
    if (!response.ok) return
    await saveMedia(await response.blob(), filename)
  } catch {
    // Network hiccup or an expired proxy URL — silent, matches the best-effort
    // contract described above.
  }
}

/**
 * Fetch every zippable (image/audio) "done" item and fold it into one ZIP
 * archive. Callers are expected to have already filtered to
 * `isZippable(categorizeResult(item.result))` — this only branches on
 * 'image'/'audio' and silently skips anything else, so a stray non-zippable
 * item contributes nothing rather than erroring.
 */
async function buildBatchZip(
  zipCandidates: BatchItem[],
  template?: string,
): Promise<Blob> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()

  for (const item of zipCandidates) {
    const result = item.result
    if (!result) continue
    const meta = result.metadata
    const kind = categorizeResult(result)

    if (kind === 'image') {
      const images = meta?.images ?? []
      for (let i = 0; i < images.length; i++) {
        const img = images[i]
        try {
          const response = await fetch(img.url)
          if (!response.ok) continue
          zip.file(
            buildDownloadFilename({
              platform: meta?.platform,
              author: meta?.author,
              title: meta?.title,
              // A carousel slide can be a clip. Naming one .jpg is how a video
              // reaches the disk as a file nothing will open — see
              // lessons/2026-09-06-the-tunnel-that-served-a-jpeg.md.
              ext: img.kind === 'video' ? 'mp4' : 'jpg',
              index: i + 1,
              total: images.length,
              template,
            }),
            await response.arrayBuffer(),
          )
        } catch {
          // One bad image shouldn't drop the rest of the archive.
        }
      }
    } else if (kind === 'audio' && result.audioUrl) {
      try {
        const response = await fetch(result.audioUrl)
        if (response.ok) {
          zip.file(
            buildDownloadFilename({
              platform: meta?.platform,
              author: meta?.author,
              title: meta?.title,
              ext: 'mp3',
              template,
            }),
            await response.arrayBuffer(),
          )
        }
      } catch {
        // Same best-effort contract as the image branch above.
      }
    }
  }

  // STORE, not DEFLATE: these are already-compressed JPEGs/MP3s, so deflating
  // them buys nothing but a frozen tab on a big batch (mirrors the single-link
  // image ZIP in DownloaderApp.tsx).
  return zip.generateAsync({ type: 'blob', compression: 'STORE' })
}

function StatusIcon({ item }: { item: BatchItem }) {
  if (item.status === 'done') {
    if (categorizeResult(item.result) === 'none') {
      return (
        <span aria-hidden className='shrink-0 text-white/50'>
          –
        </span>
      )
    }
    return <CheckIcon className='h-3.5 w-3.5 shrink-0 text-emerald-300' />
  }
  if (item.status === 'resolving') {
    return <SpinnerIcon className='h-3.5 w-3.5 shrink-0 text-cyan-300' />
  }
  if (item.status === 'failed' && !isCancelled(item)) {
    return (
      <span aria-hidden className='shrink-0 text-red-300'>
        ⚠
      </span>
    )
  }
  return null
}

// Where the pasted list survives a reload. A twenty-link queue resolved over
// several minutes should not die because the tab refreshed.
const BATCH_DRAFT_KEY = 'smd:batch:draft'
// How many parallel resolve lanes the queue runs. Local by design — extractors
// rate-limit by IP, and that IP is whoever is using it, not a synced account.
const LANES_KEY = 'smd:batch-lanes'
export const LANE_CHOICES = [1, 2, 3] as const

function loadBatchDraft(): string {
  try {
    return window.sessionStorage.getItem(BATCH_DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

function loadLanes(): number {
  try {
    const raw = Number(window.localStorage.getItem(LANES_KEY))
    return (LANE_CHOICES as readonly number[]).includes(raw) ? raw : 2
  } catch {
    return 2
  }
}

export function BatchPanel() {
  const tier = useTier()
  // Batch is supporters-only, so the template always applies here — but it is
  // still read through the same hook, which is the one place that decides.
  const filenameTemplate = useFilenameTemplate()
  const proToken = useProToken()

  const [rawInput, setRawInput] = useState(loadBatchDraft)
  const [format, setFormat] = useState<BatchFormat>('video')
  const [items, setItems] = useState<BatchItem[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [isZipping, setIsZipping] = useState(false)
  const [note, setNote] = useState('')
  const [playlistUrl, setPlaylistUrl] = useState('')
  // A collection link handed over from the paste bar; see lib/batchHandoff.
  const pendingImport = usePendingCollectionImport()
  // A list of links handed over from the Recent panel; see lib/batchHandoff.
  const pendingLinks = usePendingBatchLinks()
  const [linksSeededFrom, setLinksSeededFrom] = useState<string | null>(null)
  // The last hand-off applied, so a re-render cannot overwrite typing.
  const [seededFrom, setSeededFrom] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [isImporting, setIsImporting] = useState(false)
  // Resolve lanes. Three is the ceiling on purpose: every lane hammers the
  // same third-party extractors from one IP, and past three the failure rate
  // climbs faster than the throughput does.
  const [lanes, setLanes] = useState<number>(loadLanes)

  const chooseLanes = useCallback((next: number) => {
    setLanes(next)
    try {
      window.localStorage.setItem(LANES_KEY, String(next))
    } catch {
      // storage disabled — the choice just does not outlive the tab.
    }
  }, [])

  // Persist edits as they happen. Writing to sessionStorage is synchronizing
  // with an external system — exactly what effects are for; no state changes.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(BATCH_DRAFT_KEY, rawInput)
    } catch {
      // private mode / disabled storage — a draft is not worth an error.
    }
  }, [rawInput])

  // Tracks each url's previous status across successive `onUpdate` broadcasts
  // so a video is auto-saved exactly once, on the transition into 'done' —
  // not on every later broadcast that merely repeats it.
  const prevStatusRef = useRef<Map<string, BatchItemStatus>>(new Map())
  const abortRef = useRef<AbortController | null>(null)
  const runStartedAtRef = useRef<number | null>(null)

  // Auto-height fallback. `field-sizing: content` on the textarea does this
  // natively in Chromium/WebKit with zero JS; this only fires on engines that
  // lack it, and setting an inline height there is safe precisely because
  // field-sizing is unsupported (an inline height would otherwise beat it).
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = textareaRef.current
    if (!el || CSS.supports('field-sizing', 'content')) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [rawInput])

  const parsedUrls = useMemo(() => parseBatchInput(rawInput), [rawInput])

  const zipCandidateCount = useMemo(
    () =>
      items.filter(
        (item) => item.status === 'done' && isZippable(categorizeResult(item.result)),
      ).length,
    [items],
  )

  // Mirror of the rendered list, so a retry can merge incoming rows into what
  // is on screen without a functional setState (whose updater must stay pure —
  // the auto-save below is a side effect).
  const itemsRef = useRef<BatchItem[]>([])

  // `publish` must keep a stable identity — every other callback here depends
  // on it — so the template is read through a ref rather than captured. That is
  // also the more correct read: a row that finishes after the shape was edited
  // should be named the new way, not the way it was when the run started.
  const templateRef = useRef(filenameTemplate)
  useEffect(() => {
    templateRef.current = filenameTemplate
  }, [filenameTemplate])

  const publish = useCallback((nextItems: BatchItem[], merge: boolean) => {
    let next = nextItems
    if (merge) {
      const byUrl = new Map(nextItems.map((n) => [n.url, n]))
      next = itemsRef.current.map((it) => byUrl.get(it.url) ?? it)
    }
    itemsRef.current = next
    setItems(next)
    for (const item of next) {
      const prevStatus = prevStatusRef.current.get(item.url)
      prevStatusRef.current.set(item.url, item.status)
      if (prevStatus !== 'done' && item.status === 'done' && item.result) {
        if (categorizeResult(item.result) === 'video') {
          void saveVideoResult(item.result, templateRef.current)
        }
      }
    }
  }, [])

  const handleUpdate = useCallback(
    (nextItems: BatchItem[]) => publish(nextItems, false),
    [publish],
  )

  /** One honest sentence when a run ends: wall time plus the scoreboard. */
  const summarizeRun = useCallback(() => {
    const startedAt = runStartedAtRef.current
    if (!startedAt) return null
    const done = itemsRef.current.filter((it) => it.status === 'done').length
    const failed = itemsRef.current.filter(
      (it) => it.status === 'failed' && !isCancelled(it),
    ).length
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
    const parts = [done === 1 ? '1 link saved' : `${done} links saved`]
    if (failed > 0) parts.push(failed === 1 ? '1 failed' : `${failed} failed`)
    parts.push(seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`)
    return parts.join(' · ')
  }, [])

  const handleStart = useCallback(async () => {
    if (isRunning || parsedUrls.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller
    prevStatusRef.current = new Map()
    setNote('')
    setIsRunning(true)
    runStartedAtRef.current = Date.now()
    const fresh: BatchItem[] = parsedUrls.map((url) => ({ url, status: 'queued' }))
    itemsRef.current = fresh
    setItems(fresh)
    try {
      await runBatch(
        parsedUrls,
        (url, signal) => resolve(url, { format, proToken, signal }),
        handleUpdate,
        controller.signal,
        lanes,
      )
      setNote(
        [summarizeRun(), 'Videos save as they finish.'].filter(Boolean).join(' — '),
      )
    } finally {
      setIsRunning(false)
      abortRef.current = null
    }
  }, [format, handleUpdate, isRunning, lanes, parsedUrls, proToken, summarizeRun])

  /**
   * Re-run only the failed rows. Cancelled ones are deliberately excluded —
   * the visitor said stop; a retry button must not override them. Done rows
   * are left exactly as they are (their files already saved), which is why
   * the update path merges rather than replaces.
   */
  const failedUrls = useMemo(
    () =>
      items
        .filter((it) => it.status === 'failed' && !isCancelled(it))
        .map((it) => it.url),
    [items],
  )

  const handleRetryFailed = useCallback(async () => {
    if (isRunning || failedUrls.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller
    setNote('')
    setIsRunning(true)
    runStartedAtRef.current = Date.now()
    prevStatusRef.current = new Map(itemsRef.current.map((it) => [it.url, it.status]))
    try {
      await runBatch(
        failedUrls,
        (url, signal) => resolve(url, { format, proToken, signal }),
        (next) => publish(next, true),
        controller.signal,
        lanes,
      )
      setNote(summarizeRun() ?? `Retried ${failedUrls.length} link(s).`)
    } finally {
      setIsRunning(false)
      abortRef.current = null
    }
  }, [failedUrls, format, isRunning, lanes, proToken, publish, summarizeRun])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  /**
   * Expand a YouTube playlist into watch URLs and drop them into the well.
   * The server does the expanding (one page fetch, Pro-gated); this only
   * dedupes against what is already queued, respects the batch cap, and
   * reports honestly when the playlist was longer than the queue.
   */
  const handleImportPlaylist = useCallback(async () => {
    const link = playlistUrl.trim()
    if (!link || isImporting) return
    setIsImporting(true)
    setNote('')
    try {
      const response = await fetch('/api/playlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(proToken ? { 'X-Pro-Token': proToken } : {}),
        },
        body: JSON.stringify({ url: link }),
      })
      const data = (await response.json().catch(() => null)) as
        | { success: boolean; error?: string; videos?: Array<{ url: string }> }
        | null
      if (!response.ok || !data?.success) {
        setNote(data?.error || 'Could not expand that playlist.')
        return
      }
      const existing = new Set(parsedUrls)
      const fresh = (data.videos ?? [])
        .map((v) => v.url)
        .filter((u) => !existing.has(u))
      const slots = MAX_BATCH_URLS - parsedUrls.length
      if (slots <= 0) {
        setNote(`Batch is full — ${MAX_BATCH_URLS} links max.`)
        return
      }
      const accepted = fresh.slice(0, slots)
      if (accepted.length === 0) {
        setNote('Those videos are already in the batch.')
        return
      }
      setRawInput((prev) =>
        prev.trim() ? `${prev.replace(/\s+$/, '')}\n${accepted.join('\n')}` : accepted.join('\n'),
      )
      setPlaylistUrl('')
      const leftOut = fresh.length - accepted.length
      setNote(
        `Imported ${accepted.length} video${accepted.length === 1 ? '' : 's'}.` +
          (leftOut > 0 ? ` ${leftOut} more than the ${MAX_BATCH_URLS}-link limit were left out.` : ''),
      )
    } catch {
      setNote('Network error while importing the playlist.')
    } finally {
      setIsImporting(false)
    }
  }, [isImporting, parsedUrls, playlistUrl, proToken])

  const handleSaveAll = useCallback(async () => {
    const zipCandidates = items.filter(
      (item) => item.status === 'done' && isZippable(categorizeResult(item.result)),
    )
    if (zipCandidates.length === 0 || isZipping) return
    setIsZipping(true)
    setNote('')
    try {
      const blob = await buildBatchZip(zipCandidates, filenameTemplate)
      saveBlob(
        blob,
        buildDownloadFilename({
          title: 'batch',
          ext: 'zip',
          template: filenameTemplate,
        }),
      )
      setNote(`${zipCandidates.length} photo/audio item(s) saved as a ZIP.`)
    } catch {
      setNote('Could not build the ZIP — try again.')
    } finally {
      setIsZipping(false)
    }
  }, [filenameTemplate, isZipping, items])

  /**
   * A collection pasted into the main bar arrives here.
   *
   * `linkAdvice` recognises a playlist, board or subreddit the moment it is
   * pasted, and the useful answer to that is not an error message — it is this
   * panel.
   *
   * Applied during render rather than in an effect. `setState` inside an effect
   * is banned here (see lib/prefs.ts for what it costs), and this is the case
   * React documents the pattern for: state derived from something outside that
   * changed. `seededFrom` is what stops it re-applying over something the
   * visitor has since typed.
   */
  if (pendingImport !== null && pendingImport !== seededFrom) {
    setSeededFrom(pendingImport)
    setPlaylistUrl(pendingImport)
  }

  // The same pattern for a list of links, which lands in the queue itself
  // rather than the importer. Appended, never replacing: somebody who has
  // already pasted a few links and then sends their unsaved Recent rows over
  // meant both.
  if (pendingLinks !== null && pendingLinks !== linksSeededFrom) {
    setLinksSeededFrom(pendingLinks)
    setRawInput((current) =>
      current.trim() ? [current.trimEnd(), pendingLinks].join('\n') : pendingLinks,
    )
  }

  // Scrolled into view because the panel is below the fold on most screens:
  // filling a field nobody can see looks exactly like nothing happening. A DOM
  // call, not state, so it belongs in an effect.
  useEffect(() => {
    if (!seededFrom && !linksSeededFrom) return
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [seededFrom, linksSeededFrom])

  if (tier !== 'pro') return null

  return (
    <Surface
      ref={panelRef}
      elevation='raised'
      className='animate-section-in mt-4 p-4'
    >
      <div className='flex items-center justify-between gap-2'>
        <h2 className='text-sm font-semibold text-white/85'>Batch download</h2>
        <span className='text-xs text-white/50'>
          {parsedUrls.length}/{MAX_BATCH_URLS} links
        </span>
      </div>

      {/* The well is a Surface, not a hand-rolled border+fill, so the focus ring
          is the same `--surface-line` tween the paste bar uses. Growth is
          `field-sizing: content` (the effect above only covers engines without
          it), so the box is exactly as tall as the pasted list up to max-h. */}
      <Surface
        radius='xl'
        className='mt-2 transition-colors duration-200 focus-within:[--surface-line:rgba(34,211,238,0.55)] focus-within:shadow-[0_0_18px_-6px_rgba(34,211,238,0.35)]'
      >
        <textarea
          ref={textareaRef}
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          placeholder={`Paste up to ${MAX_BATCH_URLS} links, one per line or separated by spaces/commas`}
          aria-label='Batch links'
          disabled={isRunning}
          className='field-sizing-content block max-h-64 min-h-24 w-full resize-none overflow-y-auto rounded-xl bg-transparent p-3 text-sm leading-relaxed text-white caret-cyan-300 outline-none selection:bg-cyan-400/25 placeholder:text-white/40 disabled:opacity-60'
        />
      </Surface>

      {/* Playlist import — the reason a queue beats a paste box for YouTube
          viewers: one link becomes up to MAX_BATCH_URLS rows without anyone
          copying twenty URLs by hand. */}
      <Surface
        radius='xl'
        className='mt-2 transition-colors duration-200 focus-within:[--surface-line:rgba(34,211,238,0.55)]'
      >
        <div className='flex items-center gap-2 p-1.5'>
          <input
            value={playlistUrl}
            onChange={(e) => setPlaylistUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleImportPlaylist()
              }
            }}
            placeholder='Playlist, subreddit, board, or channel link — expand into the queue'
            aria-label='Collection link'
            disabled={isRunning || isImporting}
            className='min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1.5 text-xs text-white caret-cyan-300 outline-none placeholder:text-white/35 disabled:opacity-60'
          />
          <button
            type='button'
            onClick={() => void handleImportPlaylist()}
            disabled={isRunning || isImporting || !playlistUrl.trim()}
            className='shrink-0 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
          >
            {isImporting ? 'Importing…' : 'Import'}
          </button>
        </div>
      </Surface>

      {/* Resolve lanes — the one knob that trades speed against extractor
          rate limits, so it lives beside the format choice and explains
          itself on hover rather than in a paragraph. */}
      <div className='mt-2 flex items-center gap-2 text-xs'>
        <span
          className='text-white/50'
          title='Parallel downloads. More is faster until an extractor starts refusing the extra traffic from your IP.'
        >
          Speed
        </span>
        <div
          role='group'
          aria-label='Parallel resolve lanes'
          className='inline-flex rounded-full border border-white/10 bg-white/[0.03] p-0.5'
        >
          {LANE_CHOICES.map((n) => (
            <button
              key={n}
              type='button'
              onClick={() => chooseLanes(n)}
              disabled={isRunning}
              aria-pressed={lanes === n}
              title={`${n} lane${n === 1 ? '' : 's'}`}
              className={`rounded-full px-3 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                lanes === n ? 'bg-cyan-400/90 text-[#04171b]' : 'text-white/55 hover:text-white'
              }`}
            >
              {n}×
            </button>
          ))}
        </div>
      </div>

      {/* One format for the whole batch — see the BatchFormat comment above
          for why this isn't per-item. */}
      <div className='mt-2 flex items-center gap-2 text-xs'>
        <span className='text-white/50'>Format</span>
        <div
          role='group'
          aria-label='Batch download format'
          className='inline-flex rounded-full border border-white/10 bg-white/[0.03] p-0.5'
        >
          {(['video', 'audio'] as const).map((f) => (
            <button
              key={f}
              type='button'
              onClick={() => setFormat(f)}
              disabled={isRunning}
              aria-pressed={format === f}
              className={`rounded-full px-3 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                format === f ? 'bg-cyan-400/90 text-[#04171b]' : 'text-white/55 hover:text-white'
              }`}
            >
              {f === 'video' ? 'Video' : 'Audio (MP3)'}
            </button>
          ))}
        </div>
      </div>

      <div className='mt-2 flex flex-wrap items-center gap-2'>
        <button
          type='button'
          onClick={() => void handleStart()}
          disabled={isRunning || parsedUrls.length === 0}
          className='btn-grad btn-press rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50'
        >
          {isRunning ? 'Resolving…' : 'Start batch'}
        </button>

        {isRunning && (
          <button
            type='button'
            onClick={handleCancel}
            className='rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:text-white'
          >
            Cancel
          </button>
        )}

        {failedUrls.length > 0 && !isRunning && (
          <button
            type='button'
            onClick={() => void handleRetryFailed()}
            className='rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:text-white'
          >
            Retry failed ({failedUrls.length})
          </button>
        )}

        {zipCandidateCount > 0 && (
          <button
            type='button'
            onClick={() => void handleSaveAll()}
            disabled={isZipping}
            className='rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
          >
            {isZipping ? 'Zipping…' : `Save all (${zipCandidateCount})`}
          </button>
        )}
      </div>

      {note && <p className='mt-2 text-xs text-white/50'>{note}</p>}

      {items.length > 0 && (
        <ul className='mt-3 flex flex-col gap-1.5'>
          {items.map((item) => (
            <li
              key={item.url}
              className='animate-section-in flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs'
            >
              <StatusIcon item={item} />
              {/* Once a link resolves, the row reads as content (its title),
                  not plumbing (its URL) — same rule the Recent list follows. */}
              <span className='min-w-0 flex-1 truncate text-white/70'>
                {item.result?.metadata?.title || item.url}
              </span>
              <span className={`shrink-0 font-medium ${rowStatusColorClass(item)}`}>
                {rowStatusText(item)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className='mt-3 text-xs text-white/50'>
        {format === 'video'
          ? 'Videos save individually as each one finishes. Photos collect into one ZIP — tap “Save all” once the queue is done.'
          : 'Audio tracks collect into one ZIP — tap “Save all” once the queue is done. A link with nothing downloadable (e.g. a playable-only embed) is marked as such, not as a failure.'}
      </p>
    </Surface>
  )
}
