/**
 * The single client-side entry to POST /api/download.
 *
 * Lifted verbatim out of `DownloaderApp`'s `resolveOne` so the Pro batch queue
 * can run the same pipeline without importing a React component. Nothing here
 * touches hooks, component state, or the DOM — the caller passes everything in.
 *
 * Sibling modules are imported by relative path (not `@/lib/...`) so this file
 * loads in the Vitest node environment, which has no path-alias plugin.
 */

import type { VideoMetadata } from './appReducer'
import { resolveTikTokInBrowser } from './tikwmClient'
import { detectPlatform } from './validator'

export interface ResolveOptions {
  type?: 'video' | 'audio'
  quality?: 'hd' | 'sd'
  /**
   * `'video'` and `'auto'` are the same thing to the server: `handleDownload`
   * maps anything that is not `'audio'` to mode `'auto'`. Both are accepted so
   * the paste box can keep sending the exact value it always sent while the
   * batch queue uses the plan's `'auto'`.
   */
  format?: 'auto' | 'video' | 'audio'
  /** Task 15: sent as X-Pro-Token so the Worker can prefer the fast resolver. */
  proToken?: string | null
  signal?: AbortSignal
}

export interface ResolveResult {
  success: boolean
  downloadUrl?: string
  audioUrl?: string
  metadata?: VideoMetadata
  error?: string
}

/**
 * How long the browser's own TikTok attempt runs alone before the server is
 * asked as well. See `resolve`.
 *
 * Short enough that a stalled tikwm is barely felt, long enough that its usual
 * answer (a few hundred ms from a residential IP) still arrives first and the
 * server is never troubled at all.
 */
const HEDGE_AFTER_MS = 700

const after = (ms: number) =>
  new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))

/**
 * Resolve one link against the API. Returns the parsed response, or throws on
 * network failure — the caller owns the error copy.
 */
export async function resolve(
  url: string,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const wantType = opts.type ?? 'video'
  const wantQuality = opts.quality ?? 'hd'
  const wantFormat = opts.format ?? 'auto'

  const fromServer = (signal?: AbortSignal) =>
    resolveOnServer(
      url,
      wantType,
      wantQuality,
      wantFormat,
      signal ? { ...opts, signal } : opts,
    )

  // TikTok resolves ~25x faster straight from the browser, and costs us nothing
  // at all when it works — see lib/tikwmClient.
  //
  // It is HEDGED rather than awaited outright. tikwm queues its callers under
  // load (measured 2026-08-14: 13.2s for a request it reports spending 2.1s on),
  // and waiting for it to time out before asking the server made a paste take
  // the timeout plus a full server resolve. So the server is asked too once the
  // browser attempt has had HEDGE_AFTER_MS to itself, and whichever answers
  // first is the answer. In the common case tikwm is quick, wins, and no server
  // request is ever made.
  if (wantFormat !== 'audio' && detectPlatform(url) === 'tiktok') {
    // Widened to the shared result type on purpose: tikwm's own type narrows
    // `success` to `true`, and the two resolvers have to be interchangeable
    // below for either to win the race.
    const local: Promise<ResolveResult | null> = resolveTikTokInBrowser(
      url,
      wantQuality,
    ).catch(() => null)

    // Answered inside the hedge window: nothing else is ever sent.
    const early = await Promise.race([local, after(HEDGE_AFTER_MS)])
    if (early) return early

    // The browser attempt has either missed or is still queueing. Ask the server
    // as well and take whichever finishes first — a browser answer that arrives
    // late is still the better one (its CDN URL streams to the visitor directly).
    //
    // The loser is cancelled rather than abandoned. An abandoned fetch is not a
    // free one: it holds a connection open until the Worker has finished
    // writing a body nobody will read. The controller stands in for the
    // caller's `opts.signal` and follows it, so a cancelled paste still
    // cancels — this only adds a second reason to stop.
    const abandon = new AbortController()
    opts.signal?.addEventListener('abort', () => abandon.abort(), { once: true })
    const server = fromServer(abandon.signal)

    // A server *failure* must not settle the race — tikwm may still be about to
    // answer, and racing the raw promise handed a network error to the caller
    // while a perfectly good browser answer was in flight. Null means "this one
    // has nothing", and the race waits for the other side.
    const serverOrNull: Promise<ResolveResult | null> = server.catch(() => null)
    const localFirst: Promise<ResolveResult | null> = local.then(
      (answer) => answer ?? serverOrNull,
    )
    const serverFirst: Promise<ResolveResult | null> = serverOrNull.then(
      (answer) => answer ?? local,
    )
    const winner = await Promise.race([localFirst, serverFirst])
    if (winner) {
      abandon.abort()
      return winner
    }
    // Both came back empty: re-await the server so its rejection is what the
    // caller sees, rather than a silent undefined.
    return server
  }

  return fromServer()
}

async function resolveOnServer(
  url: string,
  type: 'video' | 'audio',
  quality: 'hd' | 'sd',
  format: 'auto' | 'video' | 'audio',
  opts: ResolveOptions,
): Promise<ResolveResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (opts.proToken) headers['X-Pro-Token'] = opts.proToken

  const response = await fetch('/api/download', {
    method: 'POST',
    headers,
    signal: opts.signal,
    body: JSON.stringify({ url, type, quality, format }),
  })
  return response.json()
}
