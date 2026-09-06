/**
 * End-to-end smoke test against a deployed Cloudflare Worker.
 *
 *   node scripts/cf-smoke.mjs                      test the workers.dev URL
 *   node scripts/cf-smoke.mjs https://example.com  test a specific origin
 *   node scripts/cf-smoke.mjs --passes 3           repeat the whole suite
 *   node scripts/cf-smoke.mjs --only api           run only checks matching a
 *                                                  substring — use right after
 *                                                  a deploy to exercise a route
 *                                                  on a genuinely cold isolate,
 *                                                  since anything run before it
 *                                                  warms the Next server
 *
 * Exists because `wrangler dev` does not enforce the free plan's 10 ms CPU
 * limit, so a route can pass locally and return `error code 1102` in
 * production — which is exactly what happened to all 24 OpenGraph/Twitter image
 * routes back when Next rendered them per request. Every assertion here
 * therefore runs against the real deployment, and 1101 (thrown exception) /
 * 1102 (resource limit) are called out explicitly rather than being lumped in
 * with ordinary 5xx.
 *
 * The site is now a static export: pages, images, robots.txt and sitemap.xml
 * are files in `out/`, matched by Workers Static Assets before the Worker is
 * invoked. Several checks below exist specifically to prove that — a page or
 * image that started being served by Worker code would still return 200, so
 * the assertions look at Cache-Control and Content-Type, which the asset server
 * and `out/_headers` set in a way Worker code would not reproduce by accident.
 *
 * Two passes by default: the first can hit a cold isolate; the second confirms
 * the warm path. A failure on pass 1 only is still a failure — real users hit
 * cold isolates too.
 *
 * Exits non-zero if any check fails, so it can gate a deploy.
 */

/**
 * The canonical origin, because it is the only one that serves the whole app.
 *
 * The workers.dev hostname was the default here until it stopped being a
 * second front door: cloudflare/worker.js now answers everything but
 * /api/billing/webhook there with a 301 to the canonical origin (see the
 * comment on WEBHOOK_PATH for why). `redirect: 'follow'` turns a redirected
 * POST into a GET, so every POST check came back 405 and 14 of them failed
 * against a deployment that was perfectly healthy.
 */
const DEFAULT_BASE = 'https://www.socialdownloader.space'

// Kept in sync with src/lib/platforms.ts by the sitemap check below, which
// fails if the deployed sitemap and this list disagree.
const PLATFORM_SLUGS = [
  'tiktok-downloader',
  'twitter-video-downloader',
  'instagram-downloader',
  'youtube-downloader',
  'facebook-downloader',
  'pinterest-downloader',
  'reddit-video-downloader',
  'threads-video-downloader',
  'snapchat-downloader',
  'twitch-clip-downloader',
  'vimeo-downloader',
]

const PNG_MAGIC = '89504e470d0a1a0a'
// A 1x1 transparent GIF on a host that is always reachable, used to exercise
// the media proxies without depending on a social platform staying up.
const PROXY_PROBE_IMAGE = 'https://www.google.com/favicon.ico'

const args = process.argv.slice(2)
const passesFlag = args.indexOf('--passes')
const PASSES = passesFlag === -1 ? 2 : Number(args[passesFlag + 1])
const onlyFlag = args.indexOf('--only')
const ONLY = onlyFlag === -1 ? null : args[onlyFlag + 1]
const BASE = (args.find((a) => a.startsWith('http')) ?? DEFAULT_BASE).replace(/\/+$/, '')
// Requests run a few at a time: enough to be quick, few enough that the Worker
// is not being deliberately stress-tested (which would prove nothing about the
// per-request CPU budget).
const CONCURRENCY = 6

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
}

/** Cloudflare returns these as a plain-text body, not a structured error. */
function cloudflareErrorCode(text) {
  const match = text.match(/^error code: (\d+)$/m)
  return match ? match[1] : null
}

function describeCloudflareError(code) {
  if (code === '1102') return 'Worker exceeded resource limits (CPU over 10 ms)'
  if (code === '1101') return 'Worker threw an unhandled exception'
  if (code === '1027') return 'Worker daily request limit exceeded'
  return `Cloudflare Worker error ${code}`
}

// --- check definitions ----------------------------------------------------

/**
 * The canonical URL baked into the HTML at build time.
 *
 * Always the production origin, never the origin under test — a preview
 * deployment must not advertise itself as canonical, or search engines will
 * index workers.dev instead of the real domain. The root canonical carries no
 * trailing slash, matching what Next emits from `metadataBase`.
 */
const CANONICAL_ORIGIN = 'https://www.socialdownloader.space'

function canonicalUrl(pathname) {
  if (pathname === '/') return CANONICAL_ORIGIN
  return `${CANONICAL_ORIGIN}${pathname}`
}

/** An HTML document that actually rendered the app, not an error shell. */
function htmlPage(pathname, mustContain) {
  return {
    name: `page ${pathname}`,
    request: { pathname },
    check: async (response, body) => {
      if (response.status !== 200) return `expected 200, got ${response.status}`
      const type = response.headers.get('content-type') ?? ''
      if (!type.includes('text/html')) return `expected text/html, got "${type}"`

      // The asset server's default for HTML. Anything else means Worker code
      // produced this page, which would put every page view on the CPU budget.
      const cacheControl = response.headers.get('cache-control') ?? ''
      if (!cacheControl.includes('must-revalidate')) {
        return `not served from static assets (cache-control: "${cacheControl}")`
      }

      const text = new TextDecoder().decode(body)
      if (!text.includes('</html>')) return 'body is not a complete HTML document'

      // Prerendered, not a client-rendered shell: the crawler-visible content
      // has to be in the first byte, which is the entire point of the export.
      const canonical = `<link rel="canonical" href="${canonicalUrl(pathname)}"`
      if (!text.includes(canonical)) return `missing or wrong canonical (expected ${canonical}>)`
      if (!/<title>[^<]{20,}<\/title>/.test(text)) return 'no substantive <title>'
      if (!text.includes('application/ld+json')) return 'no structured data in the HTML'
      if (!text.includes('<h1')) return 'no <h1> in the prerendered markup'

      for (const needle of mustContain) {
        if (!text.includes(needle)) return `body is missing ${JSON.stringify(needle)}`
      }
      return null
    },
  }
}

/**
 * A prerendered image route. These are the ones that blew the CPU budget, so
 * the check insists on real PNG bytes — a 200 with an error body would
 * otherwise look like a pass.
 *
 * The Cache-Control assertion doubles as proof of provenance. These images are
 * written to extension-less paths (`out/tiktok-downloader/opengraph-image`), so
 * both the Content-Type and the Cache-Control here can only have come from the
 * `out/_headers` file that scripts/cf-postbuild.mjs generates — which means the
 * asset server answered, and no Worker code ran.
 *
 * @param minBytes some prerendered icons are legitimately small; the social
 *   cards are ~500 KB and a tiny one means satori emitted an empty canvas.
 */
function pngImage(pathname, minBytes = 10_000) {
  return {
    name: `image ${pathname}`,
    request: { pathname },
    check: async (response, body) => {
      if (response.status !== 200) return `expected 200, got ${response.status}`
      const magic = Buffer.from(body.slice(0, 8)).toString('hex')
      if (magic !== PNG_MAGIC) return `not a PNG (first 8 bytes: ${magic})`
      if (body.byteLength < minBytes) {
        return `PNG is suspiciously small (${body.byteLength} bytes, expected >= ${minBytes})`
      }
      const cacheControl = response.headers.get('cache-control') ?? ''
      if (!cacheControl.includes('max-age=86400')) {
        return `served by the Worker, not Assets (cache-control: "${cacheControl}")`
      }
      const type = response.headers.get('content-type') ?? ''
      if (!type.includes('image/png')) return `expected image/png, got "${type}"`
      return null
    },
  }
}

function staticFile(pathname, expectedType, minBytes = 1) {
  return {
    name: `static ${pathname}`,
    request: { pathname },
    check: async (response, body) => {
      if (response.status !== 200) return `expected 200, got ${response.status}`
      const type = response.headers.get('content-type') ?? ''
      if (!type.includes(expectedType)) return `expected ${expectedType}, got "${type}"`
      if (body.byteLength < minBytes) return `body too small (${body.byteLength} bytes)`
      return null
    },
  }
}

/** A route whose native binaries cannot exist on workerd — must 501, not hang. */
function nativeMediaGuard(name, request) {
  return {
    name: `guard ${name}`,
    request,
    check: async (response, body) => {
      if (response.status !== 501) return `expected 501, got ${response.status}`
      const text = new TextDecoder().decode(body)
      if (!text.includes('{')) return 'expected a JSON explanation body'
      return null
    },
  }
}

function buildChecks() {
  const checks = [
    htmlPage('/', ['socialdownloader', '<main']),
    ...PLATFORM_SLUGS.map((slug) => htmlPage(`/${slug}`, ['<main'])),

    // Root cards plus one pair per platform: 24 generated images total.
    pngImage('/opengraph-image'),
    pngImage('/twitter-image'),
    ...PLATFORM_SLUGS.flatMap((slug) => [
      pngImage(`/${slug}/opengraph-image`),
      pngImage(`/${slug}/twitter-image`),
    ]),

    // PWA icons referenced by manifest.json — also prerendered, also promoted
    // to static assets. Smaller than the social cards, hence the lower floor.
    ...['192', '512', 'apple', 'maskable'].map((name) =>
      pngImage(`/icons/${name}`, 1_000),
    ),

    // iOS launch screens. One per device, and Safari matches them exactly, so
    // a missing file is a blank launch screen rather than a fallback. Spot-check
    // the smallest and the largest: they share one route and one renderer, so a
    // break at either end is a break in the middle too.
    ...['640x1136', '2048x2732'].map((size) => pngImage(`/splash/${size}`, 1_000)),

    staticFile('/robots.txt', 'text/plain', 100),
    staticFile('/sitemap.xml', 'xml', 500),
    staticFile('/manifest.json', 'json', 100),
    staticFile('/favicon.svg', 'svg'),
    // Google's crawler fetches this path literally for the search-result icon,
    // ignoring both the SVG and the ?v= the <link> carries.
    staticFile('/favicon.ico', 'icon', 500),
    staticFile('/f62bfbe4672c27f2ad3204b176eaab35.txt', 'text/plain'),

    {
      // Guards against a silent drift between platforms.ts and this file, and
      // proves the sitemap is generated rather than stale.
      name: 'sitemap lists every platform',
      request: { pathname: '/sitemap.xml' },
      check: async (response, body) => {
        const text = new TextDecoder().decode(body)
        const missing = PLATFORM_SLUGS.filter((slug) => !text.includes(`/${slug}`))
        if (missing.length) return `sitemap is missing: ${missing.join(', ')}`
        return null
      },
    },

    {
      // Content-hashed filenames, so they must be cached forever. Getting this
      // wrong costs a revalidation round trip per script, per visit, forever.
      // The URL is discovered from the homepage rather than hardcoded, since
      // the hashes change on every build.
      name: 'hashed JS bundle is immutable',
      request: { pathname: '/' },
      check: async (response, body) => {
        const html = new TextDecoder().decode(body)
        const match = html.match(/\/_next\/static\/chunks\/[^"']+\.js/)
        if (!match) return 'no /_next/static chunk referenced by the homepage'
        const asset = await fetch(`${BASE}${match[0]}`)
        if (asset.status !== 200) return `${match[0]} returned ${asset.status}`
        const cacheControl = asset.headers.get('cache-control') ?? ''
        if (!cacheControl.includes('immutable')) {
          return `${match[0]} is not immutable (cache-control: "${cacheControl}")`
        }
        return null
      },
    },

    // Unmatched paths, including the vulnerability scans that make up most of a
    // public site's 404s. `not_found_handling: "404-page"` means the asset
    // router serves out/404.html for these without invoking the Worker at all —
    // they used to cost up to 116 ms of CPU each rendering Next's not-found
    // page. A `text/html` body with the asset server's Cache-Control is the
    // evidence that no Worker code ran.
    ...[
      '/definitely-not-a-real-page',
      '/wp-login.php',
      '/.env',
      '/vendor/phpunit.php',
      '/admin.php',
      '/wp-content/uploads/shell.php',
    ].map((pathname) => ({
      name: `404 ${pathname}`,
      request: { pathname },
      check: async (response, body) => {
        // A WAF rule now answers the scanner paths at the edge (see
        // WAF_RULES in cf-setup.mjs), which is cheaper still than the asset
        // router — the request never reaches the zone's own store. Both
        // answers are correct here; only a 200 or a 5xx would not be.
        if (response.status === 403) return null
        if (response.status !== 404) return `expected 403 or 404, got ${response.status}`
        const type = response.headers.get('content-type') ?? ''
        if (!type.includes('text/html')) return `expected the 404 page, got "${type}"`
        const cacheControl = response.headers.get('cache-control') ?? ''
        if (!cacheControl.includes('must-revalidate')) {
          return `Worker rendered this 404 instead of the asset router (cache-control: "${cacheControl}")`
        }
        const text = new TextDecoder().decode(body)
        if (!text.includes('</html>')) return '404 body is not the styled page'
        return null
      },
    })),

    {
      // The RSC payload the client router fetches on soft navigation. Missing
      // these does not break the site — the link falls back to a full page
      // load — but it silently costs the instant in-app transitions.
      name: 'RSC payload for client-side navigation',
      request: { pathname: '/tiktok-downloader.txt' },
      check: async (response, body) => {
        if (response.status !== 200) return `expected 200, got ${response.status}`
        if (body.byteLength < 500) return `payload too small (${body.byteLength} bytes)`
        return null
      },
    },

    {
      name: 'security headers on every asset',
      request: { pathname: '/' },
      check: async (response) => {
        const expected = {
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'strict-origin-when-cross-origin',
          'x-frame-options': 'SAMEORIGIN',
          'strict-transport-security': 'max-age=',
        }
        const missing = Object.entries(expected)
          .filter(([header, value]) => !(response.headers.get(header) ?? '').includes(value))
          .map(([header]) => header)
        if (missing.length) return `missing/incorrect: ${missing.join(', ')}`
        return null
      },
    },

    {
      name: 'API rejects a wrong method with 405, not the 404 page',
      request: { pathname: '/api/download' },
      check: async (response, body) => {
        if (response.status !== 405) return `expected 405, got ${response.status}`
        if (!(response.headers.get('allow') ?? '').includes('POST')) return 'no Allow header'
        const payload = JSON.parse(new TextDecoder().decode(body))
        if (payload.success !== false) return 'expected a structured JSON rejection'
        return null
      },
    },

    {
      // run_worker_first pins /api/* to the Worker; without it the asset
      // router's 404-page rule would swallow every API request.
      name: 'unknown /api path falls through to the 404 page',
      request: { pathname: '/api/does-not-exist' },
      check: async (response) => {
        if (response.status !== 404) return `expected 404, got ${response.status}`
        const type = response.headers.get('content-type') ?? ''
        if (!type.includes('text/html')) return `expected the 404 page, got "${type}"`
        return null
      },
    },

    {
      name: 'api/download resolves a YouTube URL to a real stream',
      // Innertube answers a datacenter caller differently, and differently
      // again on a repeat ask seconds later — see THIRD_PARTY_IS_ADVISORY.
      thirdParty: true,
      request: {
        pathname: '/api/download',
        method: 'POST',
        json: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', quality: '720' },
        timeoutMs: 90_000,
      },
      check: async (response, body) => {
        if (response.status !== 200) return `expected 200, got ${response.status}`
        const payload = JSON.parse(new TextDecoder().decode(body))
        if (!payload.success) return `success=false: ${payload.error ?? 'no error given'}`
        // Shape is flat: { success, downloadUrl, audioUrl, metadata }.
        if (!payload.metadata?.title) return 'no metadata.title in response'
        if (!payload.downloadUrl) return 'no downloadUrl in response'

        // The distinction that matters for YouTube: a real extraction versus
        // the embed-only degradation. Both set success=true, so assert on
        // something only extraction produces — the bytes.
        //
        // This used to assert `metadata.duration > 0`, on the reasoning that
        // duration comes from Innertube's videoDetails and the embed fallback
        // hardcodes 0. That was a proxy for the extractor, not for the claim,
        // and it broke the day the extractor changed: when ANDROID_VR is
        // rate-limited the resolve falls through to Cobalt, which serves a
        // perfectly good 720p tunnel with metadata enriched from oEmbed — and
        // oEmbed carries no duration. The check went red for two full runs
        // while production was working better than the check expected.
        //
        // Reading a kilobyte of the stream asserts the actual promise instead,
        // and holds whichever extractor won.
        if (payload.metadata.embedUrl && !payload.downloadUrl) {
          return 'fell back to embed-only — no extractor produced a stream'
        }
        return checkStreamIsVideo(payload.downloadUrl)
      },
    },

    {
      name: 'api/download resolves YouTube audio',
      thirdParty: true,
      request: {
        pathname: '/api/download',
        method: 'POST',
        json: {
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          format: 'audio',
        },
        timeoutMs: 90_000,
      },
      check: async (response, body) => {
        if (response.status !== 200) return `expected 200, got ${response.status}`
        const payload = JSON.parse(new TextDecoder().decode(body))
        if (!payload.success) return `success=false: ${payload.error ?? 'no error given'}`
        if (!payload.audioUrl) return 'no audioUrl for an audio-mode request'
        return null
      },
    },

    {
      // The Cache API is a silent no-op on *.workers.dev — writes appear to
      // succeed and reads always miss. So this asserts the tier actually
      // reached, and only *requires* a cross-isolate hit on a custom domain,
      // where a miss would be a real regression rather than a platform rule.
      name: 'api/download caches a repeated resolve',
      request: {
        pathname: '/api/download',
        method: 'POST',
        json: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        timeoutMs: 90_000,
      },
      check: async (response) => {
        if (response.status !== 200) return `expected 200, got ${response.status}`

        // The check above already resolved this exact URL, so a second request
        // must come from one of the two cache tiers.
        const repeat = await fetch(`${BASE}/api/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
        })
        const tier = repeat.headers.get('x-cache')
        const payload = await repeat.json()
        if (!payload.success) return `repeat resolve failed: ${payload.error}`

        const onWorkersDev = new URL(BASE).hostname.endsWith('.workers.dev')
        if (tier === 'HIT' || tier === 'EDGE') return null
        if (onWorkersDev) {
          // Same-isolate luck is the only way to hit here; not a failure.
          return null
        }
        return `expected X-Cache HIT or EDGE on a repeat, got ${tier ?? 'no header'}`
      },
    },

    {
      name: 'api/download rejects an unsupported URL cleanly',
      request: {
        pathname: '/api/download',
        method: 'POST',
        json: { url: 'https://example.com/not-a-video' },
        timeoutMs: 30_000,
      },
      check: async (response, body) => {
        // 422: the link was understood and nothing resolvable is behind it.
        // 504 is the other honest answer — an upstream that never replied — so
        // both pass. A 500 does not: that is now the code for a failure the
        // route did not recognise, and it stopped being the everyday answer
        // when resolveFailure started classifying (see src/lib/apiRoutes.ts).
        if (![422, 504].includes(response.status)) {
          return `expected 422 (unresolvable) or 504 (upstream timeout), got ${response.status}`
        }
        const text = new TextDecoder().decode(body)
        let payload
        try {
          payload = JSON.parse(text)
        } catch {
          return `non-JSON error body: ${text.slice(0, 120)}`
        }
        if (payload.success) return 'unsupported URL was accepted'
        if (!payload.error) return 'rejection carried no error message'
        return null
      },
    },

    {
      name: 'api/images maps URLs without buffering',
      request: {
        pathname: '/api/images',
        method: 'POST',
        json: {
          imageUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
          title: 'Some Post Title!',
        },
      },
      check: async (response, body) => {
        if (response.status !== 200) return `expected 200, got ${response.status}`
        const payload = JSON.parse(new TextDecoder().decode(body))
        if (!payload.success) return `success=false: ${payload.error ?? ''}`
        const images = payload.images ?? []
        if (images.length !== 2) return `expected 2 images, got ${images.length}`
        if (!images[0].filename?.endsWith('.jpg')) return `bad filename: ${images[0].filename}`
        // Each entry points at the /api/image proxy rather than the origin URL:
        // the browser does the zipping now, and most of these CDNs refuse a
        // cross-origin fetch. Proxying image bytes is fine on CPU (a stream
        // pass-through) — it is *video* that must never transit the Worker.
        const expectedProxy = `/api/image?url=${encodeURIComponent('https://example.com/a.jpg')}`
        if (images[0].url !== expectedProxy) return `expected proxy URL, got ${images[0].url}`
        // Zero-padded index, so a 10+ image carousel sorts correctly on disk.
        if (!/_0*1\.jpg$/.test(images[0].filename)) return `filename is not index-padded: ${images[0].filename}`
        // Title is slugified into the filename so a carousel unzips readably.
        if (!images[0].filename.startsWith('some-post-title')) {
          return `title was not slugified into the filename: ${images[0].filename}`
        }
        return null
      },
    },

    {
      name: 'api/image streams a remote file',
      request: { pathname: `/api/image?url=${encodeURIComponent(PROXY_PROBE_IMAGE)}`, timeoutMs: 30_000 },
      check: async (response, body) => {
        if (response.status !== 200) return `expected 200, got ${response.status}`
        if (body.byteLength < 100) return `streamed only ${body.byteLength} bytes`
        return null
      },
    },

    {
      name: 'api/thumb returns a data URL',
      request: { pathname: `/api/thumb?url=${encodeURIComponent(PROXY_PROBE_IMAGE)}`, timeoutMs: 30_000 },
      check: async (response, body) => {
        if (response.status !== 200) return `expected 200, got ${response.status}`
        const payload = JSON.parse(new TextDecoder().decode(body))
        const dataUrl = payload.dataUrl ?? payload.thumbnail ?? ''
        if (!dataUrl.startsWith('data:image/')) return `no data URL in response: ${JSON.stringify(payload).slice(0, 120)}`
        return null
      },
    },

    {
      name: 'api/image rejects a missing url param',
      request: { pathname: '/api/image' },
      check: async (response) => {
        if (response.status >= 500) return `server error ${response.status}`
        if (response.status === 200) return 'accepted a request with no url'
        return null
      },
    },

    {
      // The auth routes are registered in API_ROUTES precisely so a request
      // never initialises Next. A refresh with no session cookie must fail
      // cleanly — 401 when D1 is bound, 503 when it is not — and must never
      // return the 404 page, which would mean the Worker is not serving it.
      name: 'api/auth/refresh rejects an anonymous caller cleanly',
      request: { pathname: '/api/auth/refresh', method: 'POST' },
      check: async (response, body) => {
        if (response.status !== 401 && response.status !== 503) {
          return `expected 401 (no session) or 503 (unconfigured), got ${response.status}`
        }
        const text = new TextDecoder().decode(body)
        let payload
        try {
          payload = JSON.parse(text)
        } catch {
          return `non-JSON error body: ${text.slice(0, 120)}`
        }
        if (payload.success) return 'anonymous refresh was accepted'
        return null
      },
    },

    {
      name: 'api/billing/webhook rejects an unsigned body',
      request: { pathname: '/api/billing/webhook', method: 'POST', json: {} },
      check: async (response) => {
        if (response.status !== 401 && response.status !== 503) {
          return `expected 401 (bad signature) or 503 (unconfigured), got ${response.status}`
        }
        return null
      },
    },

    {
      // A route that cancels a subscription must refuse an anonymous caller. If
      // this ever answers 200 it is cancelling somebody's plan for them, so the
      // check treats a success body as a failure regardless of the status.
      name: 'api/billing/cancel refuses an anonymous caller',
      request: { pathname: '/api/billing/cancel', method: 'POST', json: {} },
      check: async (response, body) => {
        if (response.status !== 401 && response.status !== 503) {
          return `expected 401 (no session) or 503 (unconfigured), got ${response.status}`
        }
        const text = new TextDecoder().decode(body)
        if (text.includes('"success":true')) return 'anonymous cancel was accepted'
        return null
      },
    },

    nativeMediaGuard('api/slideshow', {
      pathname: '/api/slideshow',
      method: 'POST',
      json: { images: ['https://example.com/a.jpg'] },
    }),
    nativeMediaGuard('api/tiktok', {
      pathname: '/api/tiktok?url=https%3A%2F%2Fwww.tiktok.com%2F%40a%2Fvideo%2F1',
    }),
    nativeMediaGuard('api/youtube', { pathname: '/api/youtube?id=dQw4w9WgXcQ' }),
  ]

  checks.push(...PLATFORM_PROBES.map(platformProbeCheck))

  return checks
}

/**
 * One real, public post per platform, resolved end to end.
 *
 * This is the only thing in the repo that notices an extractor rotting. Every
 * other test asserts against a fixture, which keeps passing forever after the
 * site it was captured from changes its HTML — that is exactly how the
 * 2026-08-13 sweep found every generic platform already dead, with a green
 * test suite. A platform can only be proven working by resolving something
 * from it today.
 *
 * Rules for this list:
 *
 * - Every URL is verified working before it is added. A guessed one produces a
 *   red run that means nothing.
 * - Prefer an account that does not delete: an agency, a brand, a public
 *   figure whose archive is part of the point. A deleted post is a false
 *   alarm, and a monitor that cries wolf gets muted, which is worse than not
 *   having one.
 * - When a probe does go red, check the URL in a browser BEFORE touching the
 *   extractor. "The post is gone" and "the extractor is broken" look identical
 *   from here.
 *
 * These run on every deploy as advisories and once a day as hard failures —
 * see THIRD_PARTY_IS_ADVISORY and .github/workflows/platform-monitor.yml.
 */
const PLATFORM_PROBES = [
  // Vimeo has its own extractor rather than going through the fallback chain.
  { platform: 'vimeo', url: 'https://vimeo.com/76979871' },
  // Reddit's own video host, which serves DASH rather than a plain file.
  {
    platform: 'reddit',
    url: 'https://www.reddit.com/r/oddlysatisfying/comments/1vhp8n5/taking_a_walk_in_the_rain/',
  },
  // An image pin: proves the images[] path, which no video probe covers.
  { platform: 'pinterest', url: 'https://www.pinterest.com/pin/214343263495052387/' },
  // The logged-out Instagram wall is the thing most likely to close. This is a
  // carousel on an account that will outlive the site.
  { platform: 'instagram', url: 'https://www.instagram.com/p/CmUv48DLvxd/' },
  // A reel, and the only probe here that asserts the bytes are a video. The
  // carousel above passes on `images.length` alone, so for two years nothing in
  // this repo ever checked that an Instagram VIDEO resolved to a video — which
  // is how a resolve that answered reels with the post's cover JPEG went
  // unnoticed. This reel is Instagram's own most-viewed-reels list; its embed
  // page ships no `video_url`, so it also exercises the crawler-view extractor.
  {
    platform: 'instagram',
    url: 'https://www.instagram.com/reel/DKcalTzoftf/',
    expectVideo: true,
  },
  {
    platform: 'facebook',
    url: 'https://www.facebook.com/reel/1536569814605331/',
    expectVideo: true,
  },
  { platform: 'twitter', url: 'https://x.com/NASA/status/2094078415376658588' },
]

/**
 * The first bytes of a file say what it is; a content type says what somebody
 * claimed. `/api/video` forces `video/mp4` onto whatever it proxies, so its
 * header can never be the test — that is exactly how a JPEG shipped as a reel
 * for who knows how long. ISO base media puts `ftyp` at offset 4; WebM/Matroska
 * opens with the EBML magic.
 */
function looksLikeVideoBytes(bytes) {
  if (bytes.length >= 8) {
    const brand = String.fromCharCode(...bytes.slice(4, 8))
    if (brand === 'ftyp') return true
  }
  if (bytes.length >= 4) {
    const [a, b, c, d] = bytes
    if (a === 0x1a && b === 0x45 && c === 0xdf && d === 0xa3) return true
  }
  return false
}

function describeBytes(bytes) {
  const [a, b, c, d] = bytes
  if (a === 0xff && b === 0xd8 && c === 0xff) return 'a JPEG'
  if (a === 0x89 && b === 0x50 && c === 0x4e && d === 0x47) return 'a PNG'
  if (a === 0x47 && b === 0x49 && c === 0x46) return 'a GIF'
  if (a === 0x3c) return 'an HTML page'
  return `bytes starting ${[...bytes.slice(0, 8)]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join(' ')}`
}

/**
 * Pull the head of a resolved stream and say whether it is really a video.
 * Returns null when it is, or the failure line when it is not — the shape every
 * `check` in this file returns.
 *
 * Shared by the YouTube check and the platform probes, which had drifted into
 * asserting different things about the same promise: the probes read bytes, and
 * YouTube read `metadata.duration` and went red the moment a different
 * extractor (with equally good output) started answering.
 */
async function checkStreamIsVideo(downloadUrl) {
  if (!downloadUrl) return 'no downloadUrl to check'
  const target = downloadUrl.startsWith('/') ? `${BASE}${downloadUrl}` : downloadUrl
  const head = await fetch(target, {
    headers: { Range: 'bytes=0-1023' },
    signal: AbortSignal.timeout(60_000),
  })
  if (head.status !== 200 && head.status !== 206) {
    return `the resolved stream answered ${head.status}`
  }
  const bytes = new Uint8Array(await head.arrayBuffer())
  if (!looksLikeVideoBytes(bytes)) {
    return `a video link downloaded ${describeBytes(bytes)}, not a video`
  }
  return null
}

/**
 * A probe is not "success: true".
 *
 * An extractor that has lost its media path still answers 200 with a title
 * scraped from the error page, and a sweep that only reads `success` scores
 * that as a working platform — the mistake the 2026-08-13 lesson is named
 * after. So this asserts the platform it was routed to, a title, and at least
 * one thing a visitor could actually save.
 *
 * And for a probe whose URL names a video, it PULLS THE FIRST BYTES. A resolve
 * that answers a reel with the post's cover image satisfies every check above:
 * the platform is right, the title is right, `downloadUrl` is populated, and
 * the file is a picture. That shipped, and nothing here noticed, because no
 * check had ever looked at what came down the wire. See
 * lessons/2026-09-06-the-tunnel-that-served-a-jpeg.md.
 */
function platformProbeCheck(probe) {
  return {
    name: `platform ${probe.platform} resolves a live public ${
      probe.expectVideo ? 'video' : 'post'
    }`,
    thirdParty: true,
    request: {
      pathname: '/api/download',
      method: 'POST',
      json: { url: probe.url },
      timeoutMs: 90_000,
    },
    check: async (response, body) => {
      if (response.status !== 200) return `expected 200, got ${response.status}`
      const payload = JSON.parse(new TextDecoder().decode(body))
      if (!payload.success) return `success=false: ${payload.error ?? 'no error given'}`
      const meta = payload.metadata ?? {}
      if (meta.platform !== probe.platform) {
        return `routed to ${meta.platform ?? 'no platform'}, expected ${probe.platform}`
      }
      if (!meta.title) return 'success with no title — the shape of a scraped error page'
      const media =
        payload.downloadUrl || payload.audioUrl || meta.embedUrl || (meta.images ?? []).length
      if (!media) return 'success with nothing to download: no downloadUrl, embedUrl or images'

      if (!probe.expectVideo) return null
      if (!payload.downloadUrl) {
        return `a video link resolved with no video: ${
          (meta.images ?? []).length
        } image(s) and no downloadUrl`
      }
      return checkStreamIsVideo(payload.downloadUrl)
    },
  }
}

/**
 * Whether a failed `thirdParty` check counts as a failure.
 *
 * The YouTube checks assert a real extraction rather than the embed fallback,
 * and the platform probes assert a live post still resolves. Both are worth
 * asserting — they are the difference between a download and a broken promise
 * — but their verdict belongs to somebody else's server, which answers a
 * datacenter address differently from a home one and throttles a repeat ask
 * within seconds. In CI, from a shared Azure address, YouTube degraded on pass
 * 2 and failed a deploy that was healthy.
 *
 * So in CI they are reported and not counted, while everything this repo
 * controls stays a hard failure. Nothing a platform does should be able to
 * block shipping a fix.
 *
 * `SMOKE_STRICT=1` turns them back into hard failures inside CI. That is what
 * the daily monitor sets: there, an upstream's verdict is the entire point,
 * and a red run is the only way anyone hears that a platform broke.
 * Unset outside CI too — run this from an ordinary machine and every check is
 * already hard.
 */
const THIRD_PARTY_IS_ADVISORY = Boolean(process.env.CI) && !process.env.SMOKE_STRICT

// --- runner ---------------------------------------------------------------

async function runCheck(check) {
  const { pathname, method = 'GET', json, timeoutMs = 20_000 } = check.request
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()

  try {
    const response = await fetch(`${BASE}${pathname}`, {
      method,
      headers: json ? { 'content-type': 'application/json' } : undefined,
      body: json ? JSON.stringify(json) : undefined,
      signal: controller.signal,
      // Follow the app's own redirects, but surface a redirect loop as a failure
      // rather than hanging.
      redirect: 'follow',
    })
    const body = new Uint8Array(await response.arrayBuffer())
    const elapsed = Date.now() - started

    // A Cloudflare-level error can arrive with any status, so check the body
    // shape before running the route's own assertions.
    const text = body.byteLength < 200 ? new TextDecoder().decode(body) : ''
    const cfCode = cloudflareErrorCode(text)
    if (cfCode) {
      return { ok: false, elapsed, reason: describeCloudflareError(cfCode), fatal: true }
    }

    const reason = await check.check(response, body)
    return { ok: reason === null, elapsed, reason }
  } catch (error) {
    const elapsed = Date.now() - started
    if (error.name === 'AbortError') return { ok: false, elapsed, reason: `timed out after ${timeoutMs} ms` }
    return { ok: false, elapsed, reason: error.message }
  } finally {
    clearTimeout(timer)
  }
}

/** Runs checks with a bounded number in flight, preserving input order. */
async function runAll(checks) {
  const results = new Array(checks.length)
  let next = 0

  async function worker() {
    while (next < checks.length) {
      const index = next++
      results[index] = await runCheck(checks[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, checks.length) }, worker))
  return results
}

async function main() {
  const all = buildChecks()
  const checks = ONLY ? all.filter((c) => c.name.includes(ONLY)) : all
  if (checks.length === 0) {
    throw new Error(`--only ${JSON.stringify(ONLY)} matched none of the ${all.length} checks`)
  }
  console.log(`${C.bold('Target')}  ${BASE}`)
  if (ONLY) console.log(`${C.bold('Filter')}  name contains ${JSON.stringify(ONLY)}`)
  console.log(`${C.bold('Checks')}  ${checks.length} x ${PASSES} pass(es)\n`)

  const failures = []
  const advisories = []

  for (let pass = 1; pass <= PASSES; pass++) {
    console.log(C.bold(`Pass ${pass}/${PASSES}`))
    const results = await runAll(checks)

    results.forEach((result, index) => {
      const check = checks[index]
      const timing = C.dim(`${String(result.elapsed).padStart(6)} ms`)
      if (result.ok) {
        console.log(`  ${C.green('✓')} ${timing}  ${check.name}`)
        return
      }
      if (check.thirdParty && THIRD_PARTY_IS_ADVISORY && !result.fatal) {
        const note = C.dim('advisory in CI — the upstream decides this one')
        console.log(
          `  ${C.yellow('!')} ${timing}  ${check.name}\n       ${C.dim(result.reason)}\n       ${note}`,
        )
        advisories.push({ pass, name: check.name, reason: result.reason })
        return
      }
      const marker = result.fatal ? C.red('✗✗') : C.red('✗')
      console.log(`  ${marker} ${timing}  ${check.name}\n       ${C.red(result.reason)}`)
      failures.push({ pass, name: check.name, reason: result.reason })
    })
    console.log('')
  }

  // Printed whether or not anything failed: an advisory that keeps recurring
  // is worth running from a normal machine, where it is a hard assertion.
  for (const advisory of advisories) {
    console.log(`  ${C.yellow('!')} pass ${advisory.pass}  ${advisory.name} — ${advisory.reason}`)
  }

  if (failures.length === 0) {
    const total = checks.length * PASSES
    // An advisory did not pass, so it is not counted as one that did.
    console.log(
      C.green(
        advisories.length
          ? `${total - advisories.length} of ${total} checks passed across ${PASSES} pass(es); ${advisories.length} advisory.`
          : `All ${total} checks passed across ${PASSES} pass(es).`,
      ),
    )
    console.log(C.dim(`(${checks.length} distinct routes exercised; no 1101/1102 seen)`))
    return
  }

  console.log(C.red(`${failures.length} check(s) failed:`))
  for (const failure of failures) {
    console.log(`  ${C.red('·')} pass ${failure.pass}  ${failure.name} — ${failure.reason}`)
  }
  process.exitCode = 1
}

main().catch((error) => {
  console.error(`\n${C.red('✗')} smoke runner crashed: ${error.stack ?? error}`)
  process.exitCode = 1
})
