// Tiny in-memory response cache for resolved downloads. No external store is
// provisioned (no KV/Redis), so this is a module-level Map that lives on a warm
// serverless instance and dies with it — a best-effort cache, not a durable one.
//
// Why it still helps: the same link gets resolved repeatedly in tight windows —
// double-tapping Download, re-picking HD/SD/MP3 on a result, re-tapping a Recent
// entry, or a batch that contains a dup. Serving those repeats from memory skips
// a full Cobalt round-trip (and its quota + latency).
//
// Why the TTL is short: the media URLs a resolve returns (Cobalt tunnels, signed
// CDN links) are EPHEMERAL — they expire in minutes. Caching them long would
// hand back a dead download URL. So the TTL is deliberately small: long enough
// to absorb immediate repeats (the download happens seconds after the resolve,
// while the URL is still live), short enough that a re-tap minutes later
// re-resolves fresh. Never cache failures.
//
// "Short enough" turned out to be a guess, and the wrong one. Measured against
// production on 2026-09-07, a Cobalt tunnel is valid for 92 seconds — so for
// the last 88 seconds of an entry's life, every visitor served from it got a
// download button that answered 404. The TTL below is now a ceiling rather than
// the whole rule: `cacheableForMs` reads the expiry the URLs themselves carry
// and shortens the entry to match, or refuses to store it at all when there is
// not enough life left to be worth serving. See lib/urlExpiry.ts.

import { cacheableForMs } from './urlExpiry'

const TTL_MS = 3 * 60 * 1000 // 3 minutes — see note above on ephemeral URLs.
const MAX_ENTRIES = 200 // hard cap so a warm instance can't grow unbounded.

// Entries hold the SERIALISED body, not the payload object. The handler has to
// produce that string anyway to answer the request, so storing it means a hit
// costs a Response construction and nothing else — no second JSON.stringify of
// a nested object graph on the path that is supposed to be the cheap one.
interface Entry {
  body: string
  expires: number
}

// Insertion-ordered Map doubles as a cheap LRU: on read we re-insert (moves the
// key to the newest slot); on overflow we evict the oldest (first) key.
const store = new Map<string, Entry>()

export function getCached(key: string): string | null {
  const hit = store.get(key)
  if (!hit) return null
  if (hit.expires <= Date.now()) {
    store.delete(key)
    return null
  }
  // Touch: move to newest so it survives eviction longest.
  store.delete(key)
  store.set(key, hit)
  return hit.body
}

export function setCached(key: string, body: string): void {
  const now = Date.now()
  const lifetime = cacheableForMs(body, TTL_MS, now)
  // Zero means the URLs inside die too soon to be worth handing to anyone. A
  // miss re-resolves and works; a hit on this would not.
  if (lifetime <= 0) {
    store.delete(key)
    return
  }
  if (store.has(key)) store.delete(key)
  store.set(key, { body, expires: now + lifetime })
  // Evict oldest entries past the cap (usually just one per insert).
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}
