// Cloudflare edge cache for resolved downloads.
//
// This sits in front of the per-isolate Map in responseCache.ts. That Map only
// helps a repeat that lands on the *same warm isolate*; Cloudflare spins up many
// per colo and recycles them freely, so most repeats miss it. The edge cache is
// shared by every isolate in a colo, which is what makes a link that several
// people paste — or one person re-taps from Recent — actually cheap.
//
// Three things about the Cache API drive the shape of this module:
//
//   1. It only stores GET responses, and /api/download is a POST. The standard
//      way round that is a synthetic key: a GET Request whose URL encodes the
//      inputs. The key is never routed or fetched — it exists only to be hashed
//      into a cache slot.
//
//   2. It is a NO-OP on *.workers.dev, in the dashboard editor, and in
//      playground previews. Only a custom domain or a route gets a real cache.
//      So every call here has to tolerate a silent miss forever, and nothing may
//      depend on a write being readable back.
//
//   3. `caches` does not exist off-workerd at all (`next dev`, Node hosts, the
//      profiling harness), hence the capability check rather than a build flag.
//

import { cacheableForMs } from './urlExpiry'

// A ceiling, not the whole rule. What is stored is a set of EPHEMERAL signed
// CDN links and Cobalt tunnels, and handing back a dead URL is worse than
// re-resolving — but "two minutes is short enough" was a guess, and a measured
// Cobalt tunnel lives 92 seconds, so the last half-minute of every edge entry
// served a download that answered 404. `cacheableForMs` shortens the entry to
// the expiry the URLs themselves carry. See lib/urlExpiry.ts.
const EDGE_TTL_SECONDS = 120

/**
 * The slice of Cloudflare's ExecutionContext we need. Declared structurally so
 * this module stays free of @cloudflare/workers-types, and so the Next route
 * wrappers — which have no context to pass — can simply pass nothing.
 */
export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void
}

interface CacheLike {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

/**
 * `caches.default` is Cloudflare-specific — the web-standard `caches` object
 * (which Node 22+ does not implement either) has no `default` property.
 */
function edgeCache(): CacheLike | null {
  const store = (globalThis as { caches?: { default?: CacheLike } }).caches
  return store?.default ?? null
}

/**
 * Synthetic GET request used as the cache key.
 *
 * The full logical key goes in the query string verbatim rather than hashed:
 * a hash short enough to be worth it would carry real collision risk, and a
 * collision here means handing someone a different video. Encoding costs
 * nothing measurable and cannot collide.
 *
 * The path is one no asset or route can ever occupy, so a cache entry can never
 * shadow a real URL.
 */
function cacheKeyRequest(origin: string, key: string): Request {
  return new Request(`${origin}/__resolve-cache?k=${encodeURIComponent(key)}`, {
    method: 'GET',
  })
}

/**
 * Returns the cached JSON body for `key`, or null on any miss.
 *
 * Never throws: a cache is an optimisation, and an error here must degrade to a
 * normal resolve rather than fail the request.
 */
export async function readEdgeCache(
  origin: string,
  key: string,
): Promise<string | null> {
  const cache = edgeCache()
  if (!cache) return null
  try {
    const hit = await cache.match(cacheKeyRequest(origin, key))
    if (!hit) return null
    return await hit.text()
  } catch {
    return null
  }
}

/**
 * Stores `body` under `key`.
 *
 * Runs through `waitUntil` when a context is available so the write settles
 * after the response has already been returned — the client waits on the
 * resolve, never on the cache write.
 */
export function writeEdgeCache(
  origin: string,
  key: string,
  body: string,
  ctx?: WaitUntilContext,
): void {
  const cache = edgeCache()
  if (!cache) return

  // The two-minute ceiling was still too long: a Cobalt tunnel lives 92
  // seconds, so the last half-minute of an edge entry served a dead download.
  // The URLs say when they die; the entry is cut to match, or skipped when
  // there is not enough left to be worth serving. See lib/urlExpiry.ts.
  const lifetime = cacheableForMs(body, EDGE_TTL_SECONDS * 1000, Date.now())
  if (lifetime <= 0) return

  const stored = new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      // What actually sets the entry's lifetime — the Cache API honours
      // Cache-Control on the stored response.
      'Cache-Control': `public, max-age=${Math.floor(lifetime / 1000)}`,
    },
  })

  const write = cache.put(cacheKeyRequest(origin, key), stored).catch(() => {
    // Over the per-entry size cap, an unsupported key, or workers.dev. A failed
    // write just means the next request resolves again.
  })

  if (ctx) {
    ctx.waitUntil(write)
    return
  }
  // No context (Next route wrapper, tests): let it settle on its own. Not
  // awaited — the caller should not pay for a cache write.
  void write
}
