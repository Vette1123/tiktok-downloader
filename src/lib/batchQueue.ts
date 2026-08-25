import type { ResolveResult } from './resolve'

export const MAX_BATCH_URLS = 20

/**
 * Two at a time. The extractors are third-party and several of them rate-limit
 * by IP; a batch that hammers them just converts into a batch of failures.
 */
export const BATCH_CONCURRENCY = 2

export type BatchItemStatus = 'queued' | 'resolving' | 'done' | 'failed'

export interface BatchItem {
  url: string
  status: BatchItemStatus
  result?: ResolveResult
  error?: string
}

/**
 * Accepts however the user pasted them: one per line, comma-separated, or space
 * separated. Duplicates are dropped because resolving the same link twice is
 * always a mistake, and the list is capped so a paste of a thousand links
 * cannot be turned into a thousand extractor calls.
 */
export function parseBatchInput(raw: string): string[] {
  const parts = raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  return [...new Set(parts)].slice(0, MAX_BATCH_URLS)
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Failed to resolve'
}

/** Distinct error text for an item cancelled before it ever reached `resolveFn`. */
export const CANCELLED_ERROR = 'Cancelled'

/**
 * A bounded-concurrency queue. Workers pull from a shared cursor rather than
 * the list being chunked, so one slow link does not idle the other lane: as
 * soon as either lane finishes an item it grabs the next unclaimed index, so
 * a batch of [slow, fast, fast, fast] keeps both lanes busy instead of one
 * lane sitting idle behind the slow item.
 *
 * Cancellation is best-effort and split in two, matched to what is actually
 * reachable:
 *  - Items still `'queued'` are stoppable for free: as soon as `signal` fires,
 *    the shared cursor stops handing out new work, and every item that never
 *    started is resolved immediately to `status: 'failed'` with
 *    `error: CANCELLED_ERROR` — distinguishable from a real resolve failure.
 *  - Items already in flight (up to `BATCH_CONCURRENCY` of them) are NOT cut
 *    short. `signal` is forwarded into `resolveFn`, so a `resolveFn` built on
 *    `resolve()` (src/lib/resolve.ts) can abort its `/api/download` fetch —
 *    but `resolve()` calls `resolveTikTokInBrowser` first for TikTok links,
 *    which runs its own internal 6-second AbortController and takes no
 *    external signal at all (src/lib/tikwmClient.ts:29). So an in-flight
 *    TikTok item can still take up to ~6 seconds to actually stop after
 *    abort — this function does not claim otherwise. New work stops at once;
 *    in-flight work stops when `resolveFn` lets it.
 *
 * Per-item failure handling: `resolve()` can both reject (network failure,
 * or a non-JSON/error response body since it has no `response.ok` check) and
 * resolve with `{ success: false, error }`. Both are caught here and folded
 * into the same 'failed' status with a human-readable `error` string, so one
 * bad link never throws out of `runBatch` or stops the other lanes.
 */
export async function runBatch(
  urls: string[],
  resolveFn: (url: string, signal?: AbortSignal) => Promise<ResolveResult>,
  onUpdate: (items: BatchItem[]) => void,
  signal?: AbortSignal,
  concurrency: number = BATCH_CONCURRENCY,
): Promise<BatchItem[]> {
  const items: BatchItem[] = urls.map((url) => ({ url, status: 'queued' }))
  let cursor = 0

  const publish = () => onUpdate(items.map((item) => ({ ...item })))

  /** Resolves every still-queued item to a cancelled failure. Idempotent. */
  function cancelQueuedItems(): boolean {
    let changed = false
    for (const item of items) {
      if (item.status === 'queued') {
        item.status = 'failed'
        item.error = CANCELLED_ERROR
        changed = true
      }
    }
    return changed
  }

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      if (signal?.aborted) {
        if (cancelQueuedItems()) publish()
        return
      }

      const index = cursor++
      const item = items[index]
      item.status = 'resolving'
      publish()

      try {
        const result = await resolveFn(item.url, signal)
        if (result?.success) {
          item.status = 'done'
          item.result = result
        } else {
          item.status = 'failed'
          item.error = result?.error || 'Failed to resolve'
        }
      } catch (error) {
        item.status = 'failed'
        // An in-flight item's `resolveFn` rejects with a browser-specific
        // AbortError (its exact message varies by engine) once `signal` fires
        // — represent that identically to a still-queued cancellation rather
        // than surfacing the raw abort text as if it were a real failure.
        item.error = signal?.aborted ? CANCELLED_ERROR : messageOf(error)
      }
      publish()
    }
  }

  const lanes = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: lanes }, () => worker()))
  return items
}
