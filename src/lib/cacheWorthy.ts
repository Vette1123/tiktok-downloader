/**
 * Whether a resolve is good enough to hand to the next person who asks.
 *
 * The caches in front of `/api/download` were storing every success, and
 * "success" is a low bar: a reel whose extraction was rate-limited still comes
 * back `success: true`, carrying the post's cover image and no video. Measured
 * on 2026-09-07, one such answer was then served from cache to the next seven
 * requests — a single unlucky resolve turned into minutes of everyone getting a
 * JPEG for a video link, which is the exact complaint
 * `lessons/2026-09-06-the-tunnel-that-served-a-jpeg.md` is about, arriving by a
 * different road.
 *
 * The distinction that matters is between a result that is *bad* and one that
 * is merely *limited*. YouTube legitimately answers with a playable embed and
 * no stream, every time, because Google refuses this host — that is a stable
 * property worth caching, and refusing to cache it would re-run the most
 * expensive resolve on the site for nothing. A reel with no video is not
 * stable; it is us being throttled, and the next attempt may well work.
 */

/**
 * Link shapes that can only ever be a video.
 *
 * Deliberately conservative. A link this does not recognise simply falls back
 * to the old behaviour (cache it), so a missing pattern costs nothing; a wrong
 * one disables caching for a whole platform, which costs a lot and is invisible.
 * `x.com/…/status/…` is absent on purpose: a post can be text, images or video,
 * so "no video" is often the correct answer for one.
 */
const VIDEO_LINK_SHAPES: readonly RegExp[] = [
  // Instagram's video routes. A photo is never served under one.
  /instagram\.com\/(?:[\w.-]+\/)?(?:reel|reels|tv)\//i,
  /tiktok\.com\/@[\w.-]+\/video\//i,
  /facebook\.com\/(?:reel\/|watch\/?\?|[\w.-]+\/videos\/)/i,
  /(?:youtube\.com\/(?:watch\?|shorts\/|live\/)|youtu\.be\/)/i,
  /clips\.twitch\.tv\/|twitch\.tv\/[\w.-]+\/clip\//i,
  /vimeo\.com\/\d/i,
]

export function isVideoShapedLink(url: string): boolean {
  return VIDEO_LINK_SHAPES.some((pattern) => pattern.test(url))
}

/** The fields of a resolve payload that count as "something to download". */
export interface ResolveOutcome {
  downloadUrl?: string
  audioUrl?: string
  metadata?: {
    embedUrl?: string
  }
}

/**
 * Whether this answer should be stored for the next caller.
 *
 * A link that does not name a video is cached as before — a carousel of stills
 * is the right answer for a `/p/` link, and there is nothing to compare it
 * against.
 *
 * A link that does name a video is cached only if it produced something for
 * that video: the stream, the audio, or the embed. None of the three means the
 * extraction was refused, and refusing once is not a reason to refuse everyone
 * else for the next two minutes.
 */
export function worthCaching(url: string, payload: ResolveOutcome): boolean {
  if (!isVideoShapedLink(url)) return true
  return Boolean(
    payload.downloadUrl || payload.audioUrl || payload.metadata?.embedUrl,
  )
}
