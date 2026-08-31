/**
 * Last-resort generic extractor: pull a media URL straight out of a page's
 * HTML, in-Worker, with no external resolver.
 *
 * Why this exists: `downloadGeneric` previously had exactly one option for an
 * unrecognised link — the Cobalt instance list — and the public instance only
 * serves a fixed set of platforms. With no self-hosted resolver configured
 * (`COBALT_API_URL` unset) every generic link therefore failed, even when the
 * page advertised its own media in a meta tag.
 *
 * What it deliberately does NOT try to be: yt-dlp. Sites that sign URLs per
 * session, obfuscate the player payload, or require login are out of reach, and
 * a Worker cannot tunnel the bytes to fix an IP-bound URL. This handles the
 * honest majority — pages that publish `og:video`, a JSON-LD `VideoObject`, or
 * a plain `<video>` element.
 *
 * The tag-reading primitives come from `htmlExtract`, which already solved
 * bounded, cheerio-free attribute extraction for the platform scrapers. This
 * module is only the candidate ordering and the "is that actually media"
 * judgement on top.
 */

import {
  decodeEntities,
  metaContent,
  mp4Hrefs,
  pageTitle,
  scriptContaining,
} from './htmlExtract'
import { freeRelaysUsable } from './nativeMedia'

/**
 * How much of the page is pulled off the wire at all. `readCappedText` stops
 * here and cancels the stream, so a 4 MB video page never costs 4 MB.
 *
 * This is a transfer bound, not a CPU bound: reading bytes is I/O, which does
 * not count against the Worker's 10 ms CPU budget. The CPU bound is
 * FAST_SCAN_BYTES below.
 *
 * 256 KB because real video sites bury their metadata deep. Measured on one
 * live host: 1.4 MB of markup with `og:video` at byte 100,601. A 64 KB window
 * found nothing there, which was a large part of "it doesn't work everywhere".
 */
export const MAX_SCAN_BYTES = 262_144

/**
 * The window scanned first. Most pages that publish media at all publish it in
 * a normal-sized `<head>`, and those resolve here having paid one pass over
 * 64 KB. Only a page that yields nothing in this window pays for the full
 * MAX_SCAN_BYTES sweep — so the expensive path is taken exclusively by pages
 * that would otherwise have failed outright.
 */
export const FAST_SCAN_BYTES = 65_536

/**
 * The most expensive scan in the file: an unanchored URL match with no tag to
 * anchor on. Bounded below the full window because it only fires when every
 * structured signal has already missed.
 */
const INLINE_SCAN_BYTES = 131_072

/**
 * Cheap reject before any extractor runs. One literal alternation, no capture,
 * no backtracking, one pass.
 *
 * Most pages reaching this extractor have no media at all — a mistyped link, a
 * paywall, an article. This settles that in a single sweep where the full
 * candidate list would take seven.
 */
const MEDIA_HINT =
  /og:video|twitter:player:stream|contentUrl|<video|<source|\.mp4|\.m3u8/i

/** Extensions we are willing to hand to a browser as a direct download. */
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i
/** Manifests: playable, but not saveable without ffmpeg. */
const STREAM_EXT = /\.(m3u8|mpd)(\?|#|$)/i

/**
 * Content types that are the answer rather than a page containing it.
 *
 * A pasted `…/clip.mp4` has no markup to read, so the scraper found nothing and
 * the link failed — while the URL in hand was already exactly what the user
 * asked for.
 */
const DIRECT_MEDIA_TYPE = /^\s*(video|audio)\//i

export function isDirectMediaType(contentType: string): boolean {
  return DIRECT_MEDIA_TYPE.test(contentType)
}

/**
 * A pasted link that *is* the file has no title but its own filename.
 */
export function filenameTitle(url: string): string {
  try {
    const { pathname } = new URL(url)
    const name = decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1))
    return name.replace(/\.[a-z0-9]{2,4}$/i, '').trim() || 'Video'
  } catch {
    return 'Video'
  }
}

/**
 * Below this, a 200 OK carrying HTML is not the page that was asked for.
 *
 * Measured against the live failure this was written for: the host answers a
 * Cloudflare datacenter IP with 369 bytes — a `<title>.</title>` and one
 * obfuscated script that bounces the caller to the homepage — while the same
 * URL fetched from a residential IP returns 88 KB of real markup. Several
 * hosts behave this way. No header changes it; the block is on the IP, and a
 * Worker has no other IP to offer.
 *
 * Detection is by size rather than by matching the stub's script, because the
 * script is deliberately obfuscated (`top["loc"+"ation"]`, so the string
 * "location" never appears) and every site's wall is written differently. Size
 * is the property they share: a real video page is tens of kilobytes. This is
 * only ever consulted after extraction has already found nothing, so a genuinely
 * tiny page that *does* publish media has returned long before.
 */
export const MIN_REAL_PAGE_BYTES = 2_048

export function looksLikeBotWall(html: string): boolean {
  return html.trim().length < MIN_REAL_PAGE_BYTES
}

/**
 * One last way to read a page that walled us: fetch it through an unlocker.
 *
 * The block these sites apply is on datacenter IP ranges, not on Cloudflare
 * specifically — a VPS, a self-hosted Cobalt or a yt-dlp box gets the same
 * 369-byte stub, so moving the work off Workers fixes nothing. The only thing
 * that changes the answer is egress from an address that is not a datacenter,
 * which means a third party's residential pool.
 *
 * Configured as a URL template rather than a vendor, because every one of these
 * services is the same shape (`?api_key=…&url=…`) and none of them is worth
 * writing a client for:
 *
 *   SCRAPE_UNLOCKER_URL="https://api.example.com/?api_key=KEY&url={url}"
 *
 * `{url}` is replaced with the percent-encoded target. Unset — which is how
 * this ships — the whole path is skipped and the caller reports the block
 * exactly as it does today. Nothing else changes, and no request is spent.
 *
 * Only ever reached after a wall has already been detected, so sites that
 * answer us normally never touch it and never cost a credit.
 */
export function unlockerUrl(target: string): string | null {
  const template = process.env.SCRAPE_UNLOCKER_URL?.trim()
  if (!template || !template.includes('{url}')) return null
  return template.replace('{url}', encodeURIComponent(target))
}

/**
 * The Internet Archive's copy of a page, unmodified.
 *
 * `/web/2id_/` is the raw-snapshot form: `2` means "closest to now" and the
 * `id_` suffix asks for the bytes as captured, without the toolbar and URL
 * rewriting a normal Wayback view injects. Relative hrefs therefore survive as
 * the origin wrote them, which matters because the caller resolves them against
 * the *original* URL — a rewritten snapshot would point every download link at
 * web.archive.org.
 *
 * Free, unauthenticated, and it answers a datacenter IP, which is the whole
 * reason it is worth trying before anything that bills. Its ceiling is real
 * though: it only helps for a page that was crawled, and the crawler is itself
 * a datacenter client, so a walled site may well have served it the same stub.
 * That case is caught below like any other wall.
 */
interface RelayAttempt {
  url: string
  headers?: Record<string, string>
}

function archiveUrl(target: string): RelayAttempt {
  return { url: `https://web.archive.org/web/2id_/${target}` }
}

/**
 * A reader service that fetches a page and returns it. Measured as the only
 * relay of the three that answers us at all *and* is answered by a host that
 * walls us — the free CORS proxy below refuses our requests outright, and the
 * archive holds nothing for a robots-excluded domain.
 *
 * The header is load-bearing: by default it returns the page converted to
 * markdown, which throws away exactly what is being looked for here (the same
 * embed came back as 361 bytes of prose instead of 8 KB of markup). Asking for
 * HTML keeps the document intact.
 */
function readerUrl(target: string): RelayAttempt {
  return {
    url: `https://r.jina.ai/${target}`,
    headers: { 'X-Return-Format': 'html' },
  }
}

/**
 * A free public CORS proxy. It fetches from its own address, which is the only
 * property that matters here: measured against a host that walls us, its egress
 * is answered normally where ours is not, so the block is on particular
 * networks rather than on datacenter address space as a whole.
 *
 * It is a free service with no guarantees and it does fail — roughly a third of
 * the time under test, and more on large pages. That is survivable because it
 * is one of several ordered attempts and because nothing routes here until a
 * wall has already been detected.
 */
function corsProxyUrl(target: string): RelayAttempt {
  return { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}` }
}

/**
 * The page as some other client saw it, or null if nothing could deliver one.
 *
 * Ordered by cost: the free relays go first and the configured unlocker, which
 * bills per request, is only reached when they come up empty. Never throws —
 * this is already the last resort, and its failure must read as "still blocked"
 * rather than as a new error of its own.
 */
export async function fetchThroughRelay(target: string): Promise<string | null> {
  const configured = unlockerUrl(target)
  // Empty on Cloudflare: all three free relays refuse our egress there, so the
  // only thing they buy is three timeouts. See freeRelaysUsable().
  const attempts = freeRelaysUsable()
    ? [readerUrl(target), archiveUrl(target), corsProxyUrl(target)]
    : []
  if (configured) attempts.push({ url: configured })
  if (attempts.length === 0) return null

  for (const attempt of attempts) {
    const html = await relay(attempt)
    if (html) return html
  }
  return null
}

async function relay({ url, headers }: RelayAttempt): Promise<string | null> {
  try {
    // Longer than the direct fetch: these services load the page themselves,
    // sometimes in a real browser, and 10 seconds is not enough for that.
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(25_000) })
    if (!response.ok) return null
    const html = await readCappedText(response)
    // A wall relayed through anything is still a wall.
    return looksLikeBotWall(html) ? null : html
  } catch {
    return null
  }
}

/**
 * Thrown when the origin served a wall instead of its page, so the caller can
 * say that plainly rather than offering the generic list of maybes. The user can
 * act on "this site blocks us"; they cannot act on "possibly region-locked".
 */
export class OriginBlockedError extends Error {
  constructor(hostname: string) {
    super(
      `${hostname} blocks automated requests from our servers, so this link cannot be resolved here. Sites that do this generally require a desktop app such as yt-dlp.`,
    )
    this.name = 'OriginBlockedError'
  }
}

export interface ScrapedMedia {
  mediaUrl: string
  /** m3u8/mpd need a player, not a download — the caller must not offer "save". */
  isStream: boolean
  title: string
  thumbnail: string
}

/**
 * Read at most `cap` bytes of a response body and decode them as text.
 *
 * `response.text()` would buffer the entire page first, which is the expensive
 * half of scraping. Cancelling the stream at the cap also tells the origin to
 * stop sending. A multi-byte character split across the cap boundary decodes to
 * a replacement char; that only ever lands in the discarded tail.
 */
export async function readCappedText(
  response: Response,
  cap = MAX_SCAN_BYTES,
): Promise<string> {
  const body = response.body
  if (!body) return ''
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let read = 0
  let text = ''
  try {
    while (read < cap) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      // Trim the chunk rather than the accumulated string: a body that arrives
      // as one buffer (a small page, or any in-memory Response) would otherwise
      // sail past the cap on the first read and decode in full.
      const remaining = cap - read
      const chunk =
        value.byteLength > remaining ? value.subarray(0, remaining) : value
      read += chunk.byteLength
      text += decoder.decode(chunk, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return text
}

/** Absolutise a src that may be relative or protocol-relative. */
function absolutise(candidate: string, baseUrl: string): string {
  if (!candidate) return ''
  try {
    return new URL(candidate, baseUrl).toString()
  } catch {
    return ''
  }
}

/**
 * Pages that publish a *preview* under a tag meant for the real thing.
 *
 * This is the single biggest reason a scraped URL looks right and plays wrong.
 * A large share of video sites put a short muted teaser in `og:video` so social
 * embeds autoplay something cheap, and keep the actual file elsewhere. Taking
 * the first tag that parsed therefore fetched a few seconds of preview rather
 * than the video.
 */
const PREVIEW_TOKENS =
  /(preview|teaser|trailer|sample|snippet|promo|thumb|poster|watermark|lowres|_low|[/_-]low[/_.-]|mobile)/i

/**
 * Resolution hints, best first. The number is the score adjustment.
 *
 * The low entries are negative on purpose. A site that offers several
 * renditions often advertises its smallest one in `og:video` (measured: a page
 * whose og:video is the 240P file while its player carries 1080),
 * and "we fetched the 240p" is indistinguishable to a user from "we fetched a
 * preview". Ranking the small ones below zero means they only ever win when
 * nothing else is on offer.
 */
const RESOLUTION_HINTS: Array<[RegExp, number]> = [
  [/(2160p?|\b4k\b|uhd)/i, 46],
  [/1440p?/i, 40],
  [/(1080p?|fullhd|fhd)/i, 34],
  [/(720p?|\bhd\b)/i, 22],
  [/480p?/i, 6],
  [/360p?/i, -18],
  [/(240p?|144p?)/i, -30],
]

/**
 * Player and embed pages, which are HTML rather than media. `new URL` is happy
 * to absolutise one and the extension test cannot see it, so exclude by shape.
 */
const EMBED_PATH = /\/(embed|iframe|player|watch)(\/|$|\?|#)/i

interface Candidate {
  url: string
  /** How hard the page asserts this is its media. A tiebreak, not the verdict. */
  base: number
  /** True when the source guarantees media, so a missing extension is fine. */
  trusted: boolean
}

function looksLikeMedia(url: string): boolean {
  return VIDEO_EXT.test(url) || STREAM_EXT.test(url)
}

/**
 * A URL is usable when it either ends in a media extension OR came from a tag
 * whose whole purpose is naming a media file.
 *
 * The second half matters as much as the first: signed CDN URLs routinely carry
 * no extension at all (`/v/9f21c?token=…`), and demanding one rejected every
 * such site. That was a large part of "it doesn't work everywhere".
 */
function isUsableMedia(candidate: Candidate): boolean {
  // Rejects javascript:, data: and blob: — `new URL` absolutises those happily.
  if (!/^https?:\/\//i.test(candidate.url)) return false
  if (looksLikeMedia(candidate.url)) return true
  if (!candidate.trusted) return false
  return !EMBED_PATH.test(candidate.url)
}

/** Higher is better. Decides which of several candidates is returned. */
export function scoreCandidate(candidate: Candidate): number {
  let score = candidate.base
  const url = candidate.url

  if (PREVIEW_TOKENS.test(url)) score -= 60

  for (const [pattern, bonus] of RESOLUTION_HINTS) {
    if (pattern.test(url)) {
      score += bonus
      break
    }
  }

  // A progressive file can be handed to the browser; a manifest needs a player
  // we do not have.
  if (VIDEO_EXT.test(url)) score += 12

  // Sites that publish an AV1 rendition publish an H.264 one beside it. AV1 is
  // smaller but still decodes poorly in older players, and the whole point of
  // this app is a file that opens anywhere, so the safe codec wins a tie.
  if (/av1/i.test(url)) score -= 8

  return score
}

/** Each present `content` among `keys`, in order. */
function metaAll(html: string, keys: string[]): string[] {
  const out: string[] = []
  for (const key of keys) {
    const value = metaContent(html, key)
    if (value) out.push(value)
  }
  return out
}

/**
 * Every `contentUrl` inside JSON-LD. Parsing the whole graph would mean
 * JSON.parse on an arbitrary blob, so pull the field directly — the shape is
 * standardised even when the surrounding graph is not. JSON-LD escapes forward
 * slashes, so `https:\/\/…` has to be unescaped.
 */
function jsonLdContentUrls(html: string): string[] {
  const block = scriptContaining(html, '"contentUrl"')
  if (!block) return []
  const out: string[] = []
  const pattern = /"contentUrl"\s*:\s*"([^"]+)"/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(block)) !== null) {
    // decodeEntities matters as much here as in the tag readers: a signed URL
    // that arrives carrying a literal `&amp;` in its query string is a
    // guaranteed 403 from the CDN.
    out.push(decodeEntities(match[1].replace(/\\\//g, '/')))
  }
  return out
}

/**
 * Every `<video src>` and `<source src>`, plus the `data-` attributes players
 * read before they hydrate. A page with several `<source>` elements is offering
 * qualities, and the scorer picks between them instead of the parser taking
 * whichever happened to come first.
 */
function elementSrcs(html: string): string[] {
  const out: string[] = []
  const tag = /<(?:video|source)\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = tag.exec(html)) !== null) {
    const attrs =
      /\b(?:data-)?(?:src|video-src|video|mp4|file|url)\s*=\s*("[^"]*"|'[^']*')/gi
    let attr: RegExpExecArray | null
    while ((attr = attrs.exec(match[0])) !== null) {
      out.push(decodeEntities(attr[1].slice(1, -1)))
    }
  }
  return out
}

/**
 * Media URLs sitting in an inline player config. Self-hosted players (Video.js,
 * Plyr, JW) keep their sources here, and it is often the only place the full
 * file appears when `og:video` holds a preview. Every match is collected so the
 * scorer can prefer the 1080p entry over the 360p one.
 */
function inlineMediaUrls(html: string): string[] {
  const scope =
    html.length > INLINE_SCAN_BYTES ? html.slice(0, INLINE_SCAN_BYTES) : html
  const pattern =
    /https?:\\?\/\\?\/[^\s"'<>\\]+\.(?:mp4|webm|mov|m4v|m3u8)(?:\?[^\s"'<>\\]*)?/gi
  const out: string[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(scope)) !== null) {
    out.push(decodeEntities(match[0].replace(/\\\//g, '/')))
    // A page can embed hundreds of URLs; the scorer only needs a sane pool.
    if (out.length >= 24) break
  }
  return out
}

/**
 * Collect every candidate the page offers, then return the best-scoring one.
 *
 * The earlier version returned the first tag that parsed, in a fixed order with
 * `og:video` at the top. That is exactly the wrong instinct: `og:video` is the
 * tag most likely to hold a preview clip, because its job is to autoplay
 * cheaply inside someone else's timeline. Collecting everything and ranking on
 * what each URL says about itself fixes both that and the pages where the good
 * URL simply was not in whichever tag was checked first.
 */
/** Every candidate a single window of markup offers, unscored. */
function collectCandidates(scanned: string): Candidate[] {
  return [
    // The strongest signal on any page: a link the site itself offers as a
    // download. Measured on a host whose `/dload/<id>/720/<file>.mp4` anchors
    // serve real bytes to any IP with no Referer, while the JSON-LD contentUrl
    // the same page advertises answers 403. Ranked above everything else
    // because a download link is the site stating where the file is, rather
    // than where its player happens to point.
    ...mp4Hrefs(scanned).map((url) => ({ url, base: 38, trusted: true })),
    // Named by a schema whose entire purpose is "this is the file".
    ...jsonLdContentUrls(scanned).map((url) => ({ url, base: 30, trusted: true })),
    // The player's own markup — usually the real thing, often several qualities.
    ...elementSrcs(scanned).map((url) => ({ url, base: 26, trusted: true })),
    // A guess scraped from arbitrary script text, so it must look like media.
    ...inlineMediaUrls(scanned).map((url) => ({ url, base: 20, trusted: false })),
    // Trusted, but scored lowest: this is the preview tag. See PREVIEW_TOKENS.
    ...metaAll(scanned, [
      'og:video:secure_url',
      'og:video:url',
      'og:video',
      'twitter:player:stream',
    ]).map((url) => ({ url, base: 14, trusted: true })),
  ]
}

function usableFrom(scanned: string, baseUrl: string): Candidate[] {
  if (!MEDIA_HINT.test(scanned)) return []
  return collectCandidates(scanned)
    .map((candidate) => ({ ...candidate, url: absolutise(candidate.url, baseUrl) }))
    .filter(isUsableMedia)
}

export function extractMediaFromHtml(
  html: string,
  baseUrl: string,
): ScrapedMedia | null {
  const full = html.length > MAX_SCAN_BYTES ? html.slice(0, MAX_SCAN_BYTES) : html

  // Two stages, so the cheap window pays for the common case and only a page
  // that yields nothing there is scanned in full. A page with a normal <head>
  // never touches the wide sweep; a page that buries og:video past 100 KB is
  // found instead of failing.
  const fast = full.length > FAST_SCAN_BYTES ? full.slice(0, FAST_SCAN_BYTES) : full
  let usable = usableFrom(fast, baseUrl)
  let scanned = fast
  if (usable.length === 0 && full.length > fast.length) {
    usable = usableFrom(full, baseUrl)
    scanned = full
  }

  if (usable.length === 0) return null

  let best = usable[0]
  let bestScore = scoreCandidate(best)
  for (const candidate of usable) {
    const score = scoreCandidate(candidate)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }

  return {
    mediaUrl: best.url,
    isStream: STREAM_EXT.test(best.url),
    title: scrapeTitle(scanned),
    thumbnail: absolutise(
      metaContent(scanned, 'og:image') ??
        metaContent(scanned, 'twitter:image') ??
        '',
      baseUrl,
    ),
  }
}

/** Never empty, so a result card always has a label. */
export function scrapeTitle(html: string): string {
  return metaContent(html, 'og:title') ?? pageTitle(html) ?? 'Video'
}

