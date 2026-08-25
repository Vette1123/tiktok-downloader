/**
 * YouTube playlist → batch links.
 *
 * The batch queue takes plain URLs, so importing a playlist is a pure mapping:
 * fetch the playlist page once, read the video ids out of it, and hand back a
 * list of watch URLs the existing queue resolves like any other link. No
 * yt-dlp, no innertube call, no extra infrastructure — one GET that any host,
 * including a Cloudflare Worker, can make.
 *
 * Titles are best-effort: they are scraped from the same markup and only ever
 * used as labels in the queue. A structure change on YouTube's side degrades
 * to untitled rows, never to a failed import — each link's real metadata
 * arrives when the batch resolves it anyway.
 */

/** Hard cap. Fifty is past what anyone queues in one sitting and bounds both
 * the response size and the regex work below. */
export const MAX_PLAYLIST_ITEMS = 50

/**
 * How much of the playlist page to scan. ytInitialData sits in an early inline
 * script; every playlistVideoRenderer block for the first ~100 items lives
 * inside the first few hundred KB. Capping keeps the CPU cost of the scans
 * bounded no matter how large the page grows.
 */
export const PLAYLIST_SCAN_BYTES = 393_216

/** The `list=` parameter shape YouTube issues (11+ url-safe chars). */
const LIST_ID = /^[\w-]{12,64}$/

const YT_HOST = /(^|\.)((m|music|www)\.)?youtube\.com$/

export function parseYouTubePlaylistId(url: string): string | null {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    if (!YT_HOST.test(u.hostname)) return null
    const list = u.searchParams.get('list')
    // Radio/mix playlists (RD…) are generated per video and expand to
    // whatever the recommender feels like — not a real playlist someone
    // chose to save.
    if (!list || !LIST_ID.test(list) || list.startsWith('RD')) return null
    return list
  } catch {
    return null
  }
}

export interface PlaylistItem {
  /** Canonical watch URL for one entry. */
  url: string
  title?: string
}

function decodeJsonText(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    return raw
  }
}

/**
 * Pull the playlist entries out of a /playlist page, in order, deduped.
 *
 * Primary source is the `playlistVideoRenderer` block, whose id and title sit
 * close enough together to pair with one tempered pattern (the middle skips
 * over nested objects without crossing into the next renderer). Only when the
 * page yields none of those does it fall back to a bare `"videoId"` sweep,
 * which cannot pair titles but has rescued pages where the renderer shape
 * moved.
 */
export function extractPlaylistItems(
  html: string,
  cap = MAX_PLAYLIST_ITEMS,
): PlaylistItem[] {
  if (!html.includes('"videoId":"')) return []

  const titles = new Map<string, string>()
  const renderer =
    /"playlistVideoRenderer":\{"videoId":"([\w-]{11})"(?:(?!playlistVideoRenderer)[\s\S])*?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)+)"/g
  let match: RegExpExecArray | null
  while ((match = renderer.exec(html)) !== null && titles.size < cap * 2) {
    // First occurrence wins: the entries list repeats an id only when the
    // page itself does, and the earlier slot is the playlist's own ordering.
    if (!titles.has(match[1])) titles.set(match[1], decodeJsonText(match[2]))
  }

  const items: PlaylistItem[] = []
  const seen = new Set<string>()
  const source =
    titles.size > 0
      ? titles.keys()
      : [...html.matchAll(/"videoId":"([\w-]{11})"/g)].map((m) => m[1])
  for (const id of source) {
    if (seen.has(id)) continue
    seen.add(id)
    const title = titles.get(id)
    items.push({
      url: `https://www.youtube.com/watch?v=${id}`,
      ...(title ? { title } : {}),
    })
    if (items.length >= cap) break
  }
  return items
}
