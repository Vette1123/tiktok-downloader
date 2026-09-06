/**
 * What to say about a link that is not a post.
 *
 * The two commonest things anybody pastes by mistake are a profile and a
 * playlist, and until now both took the same road as a broken link: a full
 * resolve, four extractors, and then *"Could not download this generic content.
 * The post may be private, region-locked, unavailable, or not supported."* Every
 * clause of that is wrong for `instagram.com/nasa`. We know exactly what that
 * link is before making a single request.
 *
 * Worse, a YouTube playlist got the same answer — while the site has a feature
 * that turns a playlist into a queue. The visitor was being told no by the one
 * product that says yes.
 *
 * So this runs on the pasted text before anything is resolved. It is pure and
 * it never guesses: anything it does not positively recognise falls through to
 * the normal path, because a false positive here would refuse a real post.
 */

import { detectImportSource } from './importSources'

export type AdviceKind =
  /** A playlist, board, subreddit or channel the queue importer can expand. */
  | 'collection'
  /** Someone's page. There is nothing here to download; a post is one click in. */
  | 'profile'
  /** The site itself, with no path at all. */
  | 'home'

export interface LinkAdvice {
  kind: AdviceKind
  /** What went wrong, in the visitor's terms. */
  title: string
  /** What to do about it. */
  hint: string
}

/** Path segments that are Instagram routes rather than usernames. */
const IG_ROUTES = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'stories',
  'explore',
  'accounts',
  'direct',
  's',
])

/** Likewise for X, where a bare segment is a handle but these are pages. */
const X_ROUTES = new Set([
  'i',
  'home',
  'explore',
  'search',
  'settings',
  'messages',
  'notifications',
  'compose',
])

function segments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean)
}

function host(u: URL): string {
  return u.hostname.replace(/^www\./i, '').toLowerCase()
}

function isHostOf(h: string, domain: string): boolean {
  return h === domain || h.endsWith(`.${domain}`)
}

/**
 * Whether a URL names somebody's page rather than one of their posts.
 *
 * Each platform is matched on its own shape rather than by a shared "one path
 * segment" rule, because that rule is wrong on half of them: `vimeo.com/76979871`
 * is a video, `youtu.be/dQw4w9WgXcQ` is a video, and both are one segment.
 *
 * Returns the name with its article attached — "an Instagram", "a TikTok" —
 * because the article is a property of the word, not of its first letter: "an
 * X profile" is right and any rule based on spelling gets it wrong.
 */
function profileOf(u: URL): string | null {
  const h = host(u)
  const segs = segments(u.pathname)

  if (isHostOf(h, 'instagram.com')) {
    if (segs.length === 1 && !IG_ROUTES.has(segs[0].toLowerCase())) return 'an Instagram'
    return null
  }
  if (isHostOf(h, 'tiktok.com')) {
    // @handle alone. A video is /@handle/video/<id>.
    if (segs.length === 1 && segs[0].startsWith('@')) return 'a TikTok'
    return null
  }
  if (isHostOf(h, 'youtube.com')) {
    if (segs.length === 1 && segs[0].startsWith('@')) return 'a YouTube'
    if (segs.length === 2 && ['c', 'channel', 'user'].includes(segs[0])) return 'a YouTube'
    return null
  }
  if (isHostOf(h, 'x.com') || isHostOf(h, 'twitter.com')) {
    if (segs.length === 1 && !X_ROUTES.has(segs[0].toLowerCase())) return 'an X'
    return null
  }
  if (isHostOf(h, 'facebook.com')) {
    if (segs.length === 1 && !segs[0].includes('.php')) return 'a Facebook'
    return null
  }
  if (isHostOf(h, 'pinterest.com') || /(^|\.)pinterest\.[a-z.]+$/.test(h)) {
    // A board is /<user>/<board>/ and the importer handles it; one segment is
    // the person.
    if (segs.length === 1) return 'a Pinterest'
    return null
  }
  if (isHostOf(h, 'threads.net') || isHostOf(h, 'threads.com')) {
    if (segs.length === 1 && segs[0].startsWith('@')) return 'a Threads'
    return null
  }
  return null
}

/** Every platform whose front page someone might paste. */
const KNOWN_HOSTS = [
  'instagram.com',
  'tiktok.com',
  'youtube.com',
  'x.com',
  'twitter.com',
  'facebook.com',
  'pinterest.com',
  'reddit.com',
  'vimeo.com',
  'threads.net',
  'threads.com',
  'twitch.tv',
  'snapchat.com',
]

/**
 * Advice for a link that cannot be a post, or null to resolve it normally.
 *
 * Null is the default and the safe answer: a link this does not recognise takes
 * the road it always took. Refusing a real post to show a tidier message would
 * be a far worse trade than occasionally letting a profile through.
 */
export function linkAdvice(raw: string): LinkAdvice | null {
  const text = raw.trim()
  if (!text) return null

  let u: URL
  try {
    u = new URL(text.startsWith('http') ? text : `https://${text}`)
  } catch {
    return null
  }

  // A collection first: it is the one case with a real answer rather than a
  // redirect, and `detectImportSource` is the same function the importer uses,
  // so the two can never disagree about what is expandable.
  const source = detectImportSource(text)
  if (source) {
    return {
      kind: 'collection',
      title: `That link is a whole ${COLLECTION_NOUN[source.kind]}, not one post`,
      hint: 'The batch queue can expand it into rows and work through them. Or open any single post from it and paste that link instead.',
    }
  }

  const platform = profileOf(u)
  if (platform) {
    return {
      kind: 'profile',
      title: `That is ${platform} profile, not a post`,
      hint: 'Open the video, reel or photo you want and paste the link to that. Profile pages hold no file to download.',
    }
  }

  const h = host(u)
  if (segments(u.pathname).length === 0 && KNOWN_HOSTS.some((k) => isHostOf(h, k))) {
    return {
      kind: 'home',
      title: 'That is the site itself, not a post',
      hint: 'Open the post you want on that site and paste the link from its address bar.',
    }
  }

  return null
}

const COLLECTION_NOUN: Record<string, string> = {
  youtube: 'playlist',
  reddit: 'feed',
  pinterest: 'board',
  vimeo: 'channel',
}
