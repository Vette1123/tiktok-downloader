/**
 * Live byte-level progress for the big in-page downloads.
 *
 * The reducer carries only the percentage (`SET_PROGRESS`) because ten call
 * sites dispatch it; threading received/total through every one of them for a
 * readout nobody can act on differently was plumbing without a payoff. So the
 * bytes travel over a module store instead — the same external-store shape
 * proSignals and history use — and exactly one subscriber (the progress line)
 * reads them.
 *
 * Emissions are throttled to ~4/second: chunks arrive far faster than that,
 * and a re-render per chunk on a 100 MB download is pure waste. The clearing
 * write is never throttled — when a transfer ends, the line must drop its
 * numbers on the same frame the percentage resets.
 */

export interface ProgressDetail {
  received: number
  total: number
  /** Epoch ms when this transfer started; the rate is derived from it. */
  startedAt: number
}

type Listener = () => void

const listeners = new Set<Listener>()

let current: ProgressDetail | null = null
let lastEmittedAt = 0

const MIN_INTERVAL_MS = 250

function emit(): void {
  for (const listener of listeners) listener()
}

/** Report chunk progress. Throttled; pass null to clear immediately. */
export function reportProgress(
  detail: ProgressDetail | null,
  now: number = Date.now(),
): void {
  if (detail === null) {
    current = null
    lastEmittedAt = 0
    emit()
    return
  }
  current = detail
  if (now - lastEmittedAt < MIN_INTERVAL_MS) return
  lastEmittedAt = now
  emit()
}

export function subscribeProgress(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getProgressSnapshot(): ProgressDetail | null {
  return current
}

/** Prerender and hydration see no transfer, which is the quiet state. */
export function getProgressServerSnapshot(): ProgressDetail | null {
  return null
}

const MB = 1024 * 1024

/** `8.4 MB`, or `840 KB` below a megabyte — one decimal, never `.0 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes >= MB) {
    const mb = bytes / MB
    const rounded = Math.round(mb * 10) / 10
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} MB`
  }
  return `${Math.max(0, Math.round(bytes / 1024))} KB`
}

/**
 * How much longer, in words, or '' when saying would be worse than not.
 *
 * The one number a person watching a download actually wants, and the one the
 * readout never had: bytes and a rate are the inputs to a sum nobody should
 * have to do while waiting.
 *
 * Three cases where it stays quiet, because a wrong estimate is worse than
 * none:
 *
 *   - Before there is a stable sample. The opening seconds are TLS setup and
 *     the instance's own startup, and an estimate built on them is wildly
 *     pessimistic — the same reason `RATE_SAMPLE_AFTER_MS` exists in the
 *     download path.
 *   - Under five seconds left, where the number changes faster than it can be
 *     read and "almost done" is the honest reading of a bar that is nearly full.
 *   - Over an hour, which on a social video means the rate has collapsed, and
 *     printing "about 4 hours" would be a guess about a transfer that is going
 *     to fail rather than finish.
 */
const ETA_MIN_ELAPSED_MS = 3000
const ETA_MIN_SECONDS = 5
const ETA_MAX_SECONDS = 60 * 60

export function describeRemaining(
  detail: ProgressDetail | null,
  now: number = Date.now(),
): string {
  if (!detail || detail.total <= 0 || detail.received <= 0) return ''
  const elapsedMs = now - detail.startedAt
  if (elapsedMs < ETA_MIN_ELAPSED_MS) return ''

  const bytesPerMs = detail.received / elapsedMs
  if (bytesPerMs <= 0) return ''
  const seconds = Math.round((detail.total - detail.received) / bytesPerMs / 1000)
  if (seconds < ETA_MIN_SECONDS || seconds > ETA_MAX_SECONDS) return ''

  if (seconds < 60) return `about ${seconds}s left`
  const minutes = Math.round(seconds / 60)
  return `about ${minutes} min left`
}

/**
 * The whole readout: `6.2 / 20.0 MB · 3.1 MB/s · about 40s left`. Rate comes
 * from the transfer window the caller measured, not from between-emission
 * deltas, so a stalled second reads as slow rather than as infinity. Returns ''
 * before there is anything worth saying.
 */
export function describeProgress(
  detail: ProgressDetail | null,
  now: number = Date.now(),
): string {
  if (!detail || detail.total <= 0) return ''
  const elapsedS = Math.max(0.5, (now - detail.startedAt) / 1000)
  const mbps = detail.received / MB / elapsedS
  const speed = mbps >= 0.1 ? `${mbps.toFixed(1)} MB/s` : `${Math.round((detail.received / 1024) / elapsedS)} KB/s`
  const parts = [
    `${formatBytes(detail.received)} / ${formatBytes(detail.total)}`,
    speed,
    describeRemaining(detail, now),
  ]
  return parts.filter(Boolean).join(' · ')
}
