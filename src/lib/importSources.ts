/**
 * Where a batch can be expanded from, and how each source is read.
 *
 * One endpoint (`/api/playlist`) accepts any of these link shapes; the
 * detection here decides what to fetch, and the parsers turn the response
 * into the same `{url,title}` rows YouTube playlists produce — so the batch
 * panel neither knows nor cares which source answered.
 *
 * Every source is something an anonymous Worker can fetch: Reddit's public
 * `.json` listings, Pinterest board RSS, Vimeo user/channel RSS. No login, no
 * third-party API, no yt-dlp.
 */

import { parseYouTubePlaylistId } from './playlist'

export const MAX_IMPORT_ITEMS = 50

export interface ImportItem {
  url: string
  title?: string
}

export type ImportSource =
  | { kind: 'youtube'; listId: string }
  | { kind: 'reddit'; feedUrl: string }
  | { kind: 'pinterest'; feedUrl: string }
  | { kind: 'vimeo'; feedUrl: string }

function stripWww(host: string): string {
  return host.replace(/^www\./i, '')
}

/**
 * Whether `host` is `domain` itself or a subdomain of it.
 *
 * `endsWith('vimeo.com')` is NOT this test: it also accepts `myvimeo.com`,
 * a domain anyone can register. That matters because two of the branches
 * below build their feed URL from the pasted link's own origin and the
 * server then fetches it — so a sloppy match turns this endpoint into a
 * fetch-anything proxy running on our IP. The dot is the whole point.
 */
function isHostOf(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * Pinterest, on `.com` or any of its country domains (`pinterest.co.uk`,
 * `pinterest.fr`), with or without a subdomain. Anchored at both ends and
 * requiring `pinterest` to be a whole label, for the reason in `isHostOf` —
 * this branch fetches the pasted link's own origin.
 */
const PINTEREST_HOST =
  /^(?:[\w-]+\.)*pinterest\.(?:com|[a-z]{2,3}(?:\.[a-z]{2})?)$/

/**
 * Recognise an expandable collection link. Returns null for anything that is
 * not one — including a plain YouTube watch URL without `list=`, which stays
 * a single-link resolve rather than masquerading as an import.
 */
export function detectImportSource(url: string): ImportSource | null {
  let u: URL
  try {
    u = new URL(url.startsWith('http') ? url : `https://${url}`)
  } catch {
    return null
  }
  const host = stripWww(u.hostname)

  if (isHostOf(host, 'youtube.com') || host === 'youtu.be') {
    const listId = parseYouTubePlaylistId(url)
    return listId ? { kind: 'youtube', listId } : null
  }

  if (isHostOf(host, 'reddit.com')) {
    // /r/<sub>[/hot|new|top] and /user/<name>[/submitted] — everything else
    // (a comments permalink, /search) is not a collection.
    const m = u.pathname.match(/^\/(?:r|user)\/([\w-]+)(?:\/(hot|new|top|submitted))?\/?$/)
    if (!m) return null
    const [, name, sort] = m
    const feedUrl = u.pathname.startsWith('/user/')
      ? `https://www.reddit.com/user/${name}/submitted.json?limit=${MAX_IMPORT_ITEMS}`
      : `https://www.reddit.com/r/${name}/${sort ?? 'top'}.json?t=all&limit=${MAX_IMPORT_ITEMS}`
    return { kind: 'reddit', feedUrl }
  }

  if (PINTEREST_HOST.test(host)) {
    // A board is /<user>/<board>/; its RSS lives at <board>.rss.
    const segs = u.pathname.split('/').filter(Boolean)
    if (segs.length < 2) return null
    const feedUrl = `${u.origin}/${segs[0]}/${segs[1].replace(/\.rss$/, '')}.rss`
    return { kind: 'pinterest', feedUrl }
  }

  if (isHostOf(host, 'vimeo.com')) {
    // /channels/<name> and /<user> both expose /videos/rss. An explicit rss
    // URL passes through untouched so a pasted feed link just works.
    const segs = u.pathname.split('/').filter(Boolean)
    if (segs.length === 0) return null
    if (segs[segs.length - 1] === 'rss') {
      return { kind: 'vimeo', feedUrl: `${u.origin}${u.pathname}` }
    }
    if (segs[0] === 'channels' && segs[1]) {
      return { kind: 'vimeo', feedUrl: `${u.origin}/channels/${segs[1]}/videos/rss` }
    }
    const user = segs[0]
    if (!/^[\w-]+$/.test(user) || ['settings', 'blog', 'help'].includes(user)) return null
    return { kind: 'vimeo', feedUrl: `${u.origin}/${user}/videos/rss` }
  }

  return null
}

const MEDIA_POST_HINTS = new Set(['image', 'video', 'rich:video'])

interface RedditChild {
  data?: {
    title?: string
    permalink?: string
    is_video?: boolean
    post_hint?: string
    stickied?: boolean
  }
}

/**
 * Parse a Reddit `.json` listing down to media posts. Pinned mod posts are
 * dropped — they are housekeeping, not the content someone imported for —
 * and everything that does not look like it carries media is skipped rather
 * than handed to the queue to fail honestly later.
 */
export function parseRedditListing(raw: string, cap = MAX_IMPORT_ITEMS): ImportItem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const children = (parsed as { data?: { children?: RedditChild[] } })?.data?.children ?? []
  const items: ImportItem[] = []
  for (const child of children) {
    const d = child?.data
    if (!d?.permalink || d.stickied) continue
    const hasMedia = d.is_video === true || MEDIA_POST_HINTS.has(d.post_hint ?? '')
    if (!hasMedia) continue
    items.push({
      url: `https://www.reddit.com${d.permalink}`,
      ...(d.title ? { title: d.title } : {}),
    })
    if (items.length >= cap) break
  }
  return items
}

function xmlText(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(block)
  if (!m) return undefined
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

/**
 * Parse a generic RSS/Atom-ish feed into items. Pinterest boards and Vimeo
 * feeds both use `<item><link><title>` shapes, which is all this reads; any
 * entry whose link does not look like a page URL is skipped.
 */
export function parseRssItems(
  xml: string,
  opts: { linkMustInclude?: string } = {},
  cap = MAX_IMPORT_ITEMS,
): ImportItem[] {
  if (!/<item[\s>]/i.test(xml)) return []
  const items: ImportItem[] = []
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []
  for (const block of blocks) {
    const link = xmlText(block, 'link')
    if (!link || !/^https?:\/\//i.test(link)) continue
    if (opts.linkMustInclude && !link.includes(opts.linkMustInclude)) continue
    const title = xmlText(block, 'title')
    items.push({ url: link, ...(title ? { title } : {}) })
    if (items.length >= cap) break
  }
  return items
}
