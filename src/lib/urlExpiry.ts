/**
 * When the media URLs inside a resolve payload stop working.
 *
 * Both caches in front of `/api/download` store a serialised payload full of
 * signed, short-lived links: Cobalt tunnels, TikTok CDN URLs, googlevideo. Each
 * carries its own expiry in a query parameter, and each cache had a fixed TTL
 * picked to be "short enough" — three minutes in the isolate Map, two at the
 * edge.
 *
 * Measured on 2026-09-07 against production: **a Cobalt tunnel is valid for 92
 * seconds.** So for the last 88 seconds of a memory-cache entry's life, and the
 * last 28 of an edge one, every visitor served that entry got a download button
 * that answered `404`. On a Cobalt-backed platform — TikTok, YouTube, Facebook,
 * Reddit, X, which is most of the site — roughly half the cache window was
 * handing out dead links.
 *
 * A fixed TTL cannot fix this: it would have to be shorter than the shortest
 * expiry any provider might ever choose, which is unknowable and would throw
 * away the cache's whole value. The URLs already say when they die, so the
 * cache reads that instead of guessing.
 */

/**
 * The query parameters providers use to stamp an expiry on a signed URL.
 *
 * Deliberately a short list of unambiguous names. A too-eager pattern is worse
 * than a missing one: a false match on some unrelated numeric parameter would
 * make an entry look already-expired and silently disable caching for that
 * platform, which is exactly the kind of regression that hides for months.
 *
 * The trailing guard is a negative lookahead rather than `(?:&|$)`, because the
 * string being scanned is a JSON payload: a URL whose last parameter is the
 * expiry is followed by a quote, not by `&` or the end of the string. Requiring
 * one of those matched a tunnel (where `sig` comes after `exp`) and silently
 * missed every provider that puts the expiry last.
 */
const EXPIRY_PARAMS = /[?&](?:exp|expire|expires|x-expires)=(\d{9,14})(?!\d)/gi

/**
 * Seconds and milliseconds both appear in the wild — Cobalt stamps `exp` in ms,
 * most CDNs use Unix seconds. Ten-digit values are seconds until roughly the
 * year 2286; anything longer is already milliseconds.
 */
function toMillis(raw: string): number {
  const value = Number(raw)
  return value < 1e11 ? value * 1000 : value
}

/**
 * The soonest expiry stamped on any URL in `body`, or null when none is.
 *
 * Scans the serialised payload rather than parsing it back into an object: the
 * caller already holds the string, and a regex pass over a few kilobytes costs
 * far less than a `JSON.parse` plus a walk on a per-request CPU budget measured
 * in single-digit milliseconds.
 *
 * Null means "nothing here says when it dies", which is the honest answer for a
 * payload of plain CDN links, and leaves the caller's own TTL in charge.
 */
export function earliestUrlExpiry(body: string): number | null {
  let soonest: number | null = null
  // `matchAll` on a global regex, so `lastIndex` state cannot leak between calls.
  for (const match of body.matchAll(EXPIRY_PARAMS)) {
    const at = toMillis(match[1])
    if (soonest === null || at < soonest) soonest = at
  }
  return soonest
}

/**
 * How long a payload may be cached for, in milliseconds, given the clock.
 *
 * Never longer than `ttlMs`, never past the soonest URL expiry, and zero when
 * what is left is too short to be worth serving. Zero means "do not cache":
 * storing a payload whose links die before anybody can press Download is
 * strictly worse than a miss, because a miss re-resolves and works.
 *
 * The margin is the gap between a visitor seeing the card and the first byte
 * moving — reading the title, opening the preview, deciding. A URL with ten
 * seconds left is not a working download, so an entry is dropped rather than
 * stored the moment it cannot cover that gap.
 */
export const EXPIRY_MARGIN_MS = 20_000

export function cacheableForMs(
  body: string,
  ttlMs: number,
  now: number,
): number {
  const expiry = earliestUrlExpiry(body)
  if (expiry === null) return ttlMs
  const usable = expiry - now - EXPIRY_MARGIN_MS
  if (usable <= 0) return 0
  return Math.min(ttlMs, usable)
}
