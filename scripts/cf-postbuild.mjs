#!/usr/bin/env node
/**
 * Post-processes the static export in `out/` for Workers Static Assets.
 *
 * Three jobs, all of which fail the build rather than degrade quietly:
 *
 *   1. Verify the export is complete. `next.config.ts` restricts the static
 *      build to `.tsx` route files so that src/app/api/** is excluded, and the
 *      failure mode of that trick is silent — name a new page `.ts` and it
 *      simply never renders, with a successful build. Every URL in the
 *      generated sitemap is checked against a real file on disk.
 *
 *   2. Generate `out/_headers`. Next writes the generated PNGs (OpenGraph,
 *      Twitter cards, app icons) to extension-less paths like
 *      `out/tiktok-downloader/opengraph-image`, because that is the URL the
 *      metadata points at. The asset server infers Content-Type from the file
 *      extension, so without an explicit rule those are served as
 *      application/octet-stream and no social scraper will render them.
 *
 *   3. Check the free-plan asset limits (20,000 files, 25 MiB per file).
 *
 * Run automatically by `pnpm cf:build`.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'

const OUT_DIR = 'out'

// Workers Static Assets, free plan.
const MAX_ASSETS = 20_000
const MAX_ASSET_BYTES = 25 * 1024 * 1024
// A _headers file may define at most 100 rules.
const MAX_HEADER_RULES = 100

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Hashed filenames can never change meaning, so they are cached forever. */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

/**
 * Generated images are not content-hashed — `/opengraph-image` keeps its URL
 * across deploys — so they cannot be immutable. A day of freshness with a week
 * of stale-while-revalidate means a redesigned card propagates within a day
 * while costing at most one revalidation per day per edge location.
 */
const IMAGE_CACHE = 'public, max-age=86400, stale-while-revalidate=604800'

/**
 * HTML and the RSC payload files (`*.txt`) deliberately get no rule, keeping
 * the asset server's `max-age=0, must-revalidate` default.
 *
 * They must revalidate. A deploy replaces the whole asset manifest, so the
 * previous build's hashed chunks stop existing — a browser reusing cached HTML
 * would request script URLs that are now 404s and render a blank page. The
 * revalidation is a 304 against Cloudflare's edge cache, so the cost is one
 * round trip, and the bytes still come from cache.
 */

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full))
      continue
    }
    out.push(full)
  }
  return out
}

/** Absolute-on-disk path -> the URL path the asset server will expose it at. */
function toUrlPath(file) {
  return '/' + relative(OUT_DIR, file).split(sep).join(posix.sep)
}

function isPng(file) {
  const head = Buffer.alloc(PNG_MAGIC.length)
  const fd = readFileSync(file)
  fd.copy(head, 0, 0, PNG_MAGIC.length)
  return head.equals(PNG_MAGIC)
}

function fail(message) {
  console.error(`\n  cf-postbuild: ${message}\n`)
  process.exit(1)
}

// ---------------------------------------------------------------- 1. verify

/**
 * Every `<loc>` in the sitemap must resolve to a file the asset server can
 * serve. The sitemap is generated from the same platform list the pages are, so
 * this catches a page that silently failed to render far more reliably than a
 * hardcoded expected-route list would.
 */
function verifySitemapRoutes(files) {
  const sitemapPath = join(OUT_DIR, 'sitemap.xml')
  let sitemap
  try {
    sitemap = readFileSync(sitemapPath, 'utf8')
  } catch {
    fail('out/sitemap.xml is missing — the metadata routes did not render.')
  }

  const present = new Set(files.map(toUrlPath))
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  if (locs.length === 0) fail('out/sitemap.xml contains no <loc> entries.')

  const missing = []
  for (const loc of locs) {
    const pathname = new URL(loc).pathname.replace(/\/$/, '')
    // `/` is index.html; `/tiktok-downloader` is tiktok-downloader.html.
    const candidates =
      pathname === ''
        ? ['/index.html']
        : [`${pathname}.html`, `${pathname}/index.html`]
    if (!candidates.some((c) => present.has(c))) missing.push(loc)
  }

  if (missing.length > 0) {
    fail(
      `sitemap lists ${missing.length} URL(s) with no exported HTML:\n` +
        missing.map((m) => `    ${m}`).join('\n') +
        '\n\n  A page file named `.ts` instead of `.tsx` is excluded from the\n' +
        '  static export — see pageExtensions in next.config.ts.',
    )
  }

  const required = [
    '/robots.txt',
    '/sitemap.xml',
    '/404.html',
    '/manifest.json',
    '/llms.txt',
    // Android's GoogleAssociationService fetches this for every installed PWA
    // — 24 requests from 13 addresses in a day, all answered 404 because the
    // file did not exist. It holds `[]`: a valid, empty Digital Asset Links
    // statement list, which claims exactly what a 404 claimed (this site
    // vouches for no app) while being an answer rather than an error. It is
    // asserted here because it lives in `public/.well-known/`, and a build
    // step that skipped dot-directories would drop it without a word.
    '/.well-known/assetlinks.json',
  ]
  const absent = required.filter((r) => !present.has(r))
  if (absent.length > 0) fail(`missing required file(s): ${absent.join(', ')}`)

  return locs.length
}

/**
 * Every asset the web app manifest points at must exist in the export.
 *
 * A manifest that references a missing icon does not fail loudly — the install
 * prompt simply disappears, or the home-screen icon falls back to a screenshot
 * of the page, and you find out weeks later on someone else's phone. The same
 * goes for a `shortcuts[].url` pointing at a page that was renamed.
 *
 * Chrome additionally needs a 192px and a 512px PNG for installability, and a
 * screenshot per form factor for the richer install UI, so both are asserted
 * rather than merely resolved.
 */
function verifyManifest(files) {
  const manifest = JSON.parse(readFileSync(join(OUT_DIR, 'manifest.json'), 'utf8'))
  const present = new Set(files.map(toUrlPath))
  const icons = manifest.icons ?? []
  const shortcuts = manifest.shortcuts ?? []
  const screenshots = manifest.screenshots ?? []

  const referenced = [
    ...icons.map((i) => i.src),
    ...screenshots.map((s) => s.src),
    ...shortcuts.flatMap((s) => (s.icons ?? []).map((i) => i.src)),
  ]

  // Icons carry a `?v=` cache-buster (see ICON_VERSION in src/lib/appIcon.tsx)
  // so returning visitors and installed PWAs actually pick up new art. The
  // query string is not part of the emitted asset path, so compare on the path
  // alone — otherwise every versioned icon reads as missing.
  const assetPath = (src) => src.split('?')[0]
  const missing = referenced.filter((src) => src && !present.has(assetPath(src)))
  if (missing.length > 0) {
    fail(`manifest.json references ${missing.length} missing asset(s):\n    ${[...new Set(missing)].join('\n    ')}`)
  }

  const brokenLinks = shortcuts
    .map((s) => s.url)
    .filter((url) => url && !present.has(`${url}.html`) && !present.has(`${url}/index.html`))
  if (brokenLinks.length > 0) {
    fail(`manifest.json shortcuts point at missing page(s): ${brokenLinks.join(', ')}`)
  }

  const pngSizes = new Set(
    icons.filter((i) => i.type === 'image/png').map((i) => i.sizes),
  )
  for (const needed of ['192x192', '512x512']) {
    if (!pngSizes.has(needed)) {
      fail(`manifest.json has no ${needed} PNG icon; Chrome will not offer install.`)
    }
  }

  const formFactors = new Set(screenshots.map((s) => s.form_factor))
  for (const needed of ['wide', 'narrow']) {
    if (!formFactors.has(needed)) {
      fail(`manifest.json has no "${needed}" screenshot; the richer install UI is skipped on that form factor.`)
    }
  }

  return referenced.length
}

// --------------------------------------------------------------- 2. headers

/**
 * Applied to every asset response.
 *
 * These are cheap to serve (the asset server adds them, no Worker involved) and
 * they are what a security scan looks for. HSTS is deliberately conservative on
 * max-age and does not preload — the domain is new, and a preload entry is
 * effectively irreversible.
 */
const SECURITY_HEADERS = [
  'X-Content-Type-Options: nosniff',
  'Referrer-Policy: strict-origin-when-cross-origin',
  'X-Frame-Options: SAMEORIGIN',
  'Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Strict-Transport-Security: max-age=15552000; includeSubDomains',
]

function buildHeaders(files) {
  const rules = []

  rules.push(['/*', SECURITY_HEADERS])

  // One splat covers the entire hashed bundle: JS, CSS and the subsetted
  // woff2 fonts under _next/static/media.
  rules.push(['/_next/static/*', [`Cache-Control: ${IMMUTABLE_CACHE}`]])

  // Extension-less PNGs, listed individually. A splat would be shorter, but
  // these paths interleave with real routes (`/tiktok-downloader` is a page,
  // `/tiktok-downloader/opengraph-image` is an image), so a wrong pattern would
  // hand an HTML page an image/png Content-Type.
  const images = files
    .filter((file) => !/\.[a-z0-9]+$/i.test(file) && isPng(file))
    .map(toUrlPath)
    .sort()

  for (const url of images) {
    rules.push([
      url,
      [`Content-Type: image/png`, `Cache-Control: ${IMAGE_CACHE}`],
    ])
  }

  if (rules.length > MAX_HEADER_RULES) {
    fail(`_headers would define ${rules.length} rules; the limit is ${MAX_HEADER_RULES}.`)
  }

  const body =
    '# Generated by scripts/cf-postbuild.mjs — do not edit.\n' +
    '#\n' +
    '# Extension-less paths are the generated OpenGraph / Twitter / icon PNGs;\n' +
    '# they need an explicit Content-Type because the asset server infers it\n' +
    '# from the file extension, and they have none.\n\n' +
    rules
      .map(([path, headers]) => `${path}\n${headers.map((h) => `  ${h}`).join('\n')}`)
      .join('\n\n') +
    '\n'

  writeFileSync(join(OUT_DIR, '_headers'), body)
  return images.length
}

// ---------------------------------------------------------------- 3. limits

function checkLimits(files) {
  if (files.length > MAX_ASSETS) {
    fail(`${files.length} assets exceeds the ${MAX_ASSETS} free-plan limit.`)
  }

  let total = 0
  const oversized = []
  for (const file of files) {
    const { size } = statSync(file)
    total += size
    if (size > MAX_ASSET_BYTES) oversized.push(`${toUrlPath(file)} (${mib(size)})`)
  }

  if (oversized.length > 0) {
    fail(`asset(s) over the ${mib(MAX_ASSET_BYTES)} per-file limit:\n    ${oversized.join('\n    ')}`)
  }

  return total
}

function mib(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

/**
 * Recompress the generated OG/Twitter cards.
 *
 * satori writes full 32-bit RGBA PNGs, which for 1200x630 comes out around
 * 550 KB each. There are 28 of them, so they were 12.5 MB of a 17.5 MB export —
 * by far the largest thing we ship.
 *
 * Palette quantisation with dithering is the right tool: these cards are flat
 * background, one gradient and text, so a 256-colour palette reproduces them
 * essentially exactly while cutting ~72%. `quality: 100` keeps the full palette
 * rather than trading colours away, because gradients are what would band, and
 * `effort: 10` spends build time (not runtime) finding a better encoding.
 *
 * Deliberately still PNG. WebP is 92% smaller here and very tempting, but
 * og:image support across scrapers is inconsistent — X handles WebP, several
 * others silently drop the preview — and a card nobody renders is worth less
 * than a card that's 100 KB bigger.
 *
 * Sharp is a build-time dependency only; nothing here runs on the Worker.
 */
async function optimizeImages(files) {
  const { default: sharp } = await import('sharp')
  const targets = files.filter((file) => isPng(file))

  let before = 0
  let after = 0
  for (const file of targets) {
    const original = readFileSync(file)
    const encoded = await sharp(original)
      .png({ palette: true, quality: 100, effort: 10 })
      .toBuffer()

    before += original.length
    // Keep whichever is smaller: a card that somehow defeats quantisation
    // should not get bigger just because we ran it through the optimiser.
    if (encoded.length < original.length) {
      writeFileSync(file, encoded)
      after += encoded.length
    } else {
      after += original.length
    }
  }

  return { count: targets.length, before, after }
}

// -------------------------------------------------------------------- main

const files = walk(OUT_DIR)
const routes = verifySitemapRoutes(files)
const manifestAssets = verifyManifest(files)
const images = buildHeaders(files)
// Before checkLimits, so the reported total reflects what actually ships.
const optimized = await optimizeImages(files)
const total = checkLimits(files)

// A stable fingerprint of the deployable output, handy when checking whether a
// redeploy actually changed anything.
const fingerprint = createHash('sha256')
  .update(files.sort().map((f) => `${toUrlPath(f)}:${statSync(f).size}`).join('\n'))
  .digest('hex')
  .slice(0, 12)

console.log(
  [
    '',
    `  Static export ready (${fingerprint})`,
    `    ${files.length} assets, ${mib(total)} total`,
    `    ${routes} sitemap routes verified`,
    `    ${manifestAssets} manifest assets verified`,
    `    ${images} generated PNGs given an explicit Content-Type`,
    `    ${optimized.count} PNGs recompressed: ${mib(optimized.before)} -> ${mib(optimized.after)}` +
      ` (${Math.round((1 - optimized.after / optimized.before) * 100)}% smaller)`,
    '',
  ].join('\n'),
)
