export type SupportedPlatform =
  | 'douyin'
  | 'kuaishou'
  | 'bilibili'
  | 'xiaohongshu'
  | 'tiktok'
  | 'twitter'
  | 'instagram'
  | 'facebook'
  | 'youtube'
  | 'pinterest'
  | 'reddit'
  | 'threads'
  | 'snapchat'
  | 'twitch'
  | 'vimeo'
  | 'generic'
  | 'unknown'

const platformPatterns: Record<
  Exclude<SupportedPlatform, 'unknown' | 'generic'>,
  RegExp[]
> = {
  douyin: [
    /^(https?:\/\/)?(?:www\.|m\.)?douyin\.com\/(?:video|note)\/\d+/,
    /^(https?:\/\/)?v\.douyin\.com\/[\w-]+/,
    /^(https?:\/\/)?(?:www\.)?iesdouyin\.com\/(?:share\/)?(?:video|note)\/\d+/,
  ],
  kuaishou: [
    /^(https?:\/\/)?v\.kuaishou\.com\/[\w-]+/,
    /^(https?:\/\/)?(?:www\.|m\.)?kuaishou\.com\/(?:short-video|f|photo)\/[\w-]+/,
    /^(https?:\/\/)?v\.m\.chenzhongtech\.com\/fw\/[\w/-]+/,
  ],
  bilibili: [
    /^(https?:\/\/)?(?:www\.|m\.)?bilibili\.com\/video\/(?:BV[\w]+|av\d+)/i,
    /^(https?:\/\/)?b23\.tv\/[\w-]+/,
  ],
  xiaohongshu: [
    /^(https?:\/\/)?(?:www\.)?xiaohongshu\.com\/(?:discovery\/item|explore)\/[\w-]+/,
    /^(https?:\/\/)?(?:www\.)?xhslink\.(?:com|cn)\/[\w/-]+/,
  ],
  tiktok: [
    /^(https?:\/\/)?(www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/,
    /^(https?:\/\/)?(www\.)?tiktok\.com\/[\w.-]+\/video\/\d+/,
    /^(https?:\/\/)?vm\.tiktok\.com\/[\w\d]+/,
    /^(https?:\/\/)?vt\.tiktok\.com\/[\w\d]+/,
    /^(https?:\/\/)?m\.tiktok\.com\/v\/\d+/,
    /^(https?:\/\/)?(www\.)?tiktok\.com\/t\/[\w\d]+/,
  ],
  twitter: [
    /^(https?:\/\/)?(www\.)?(twitter|x)\.com\/[\w]+\/status\/\d+/,
    /^(https?:\/\/)?t\.co\/[\w\d]+/,
  ],
  instagram: [
    // Post / reel / IGTV, with or without a leading /<username>/ segment
    /^(https?:\/\/)?(www\.)?instagram\.com\/(?:[\w.-]+\/)?(?:p|reel|reels|tv)\/[\w-]+/,
    // instagr.am short domain
    /^(https?:\/\/)?(www\.)?instagr\.am\/(?:p|reel|reels|tv)\/[\w-]+/,
    // Story items and highlights (resolved via a logged-in session — see
    // Downloader.downloadInstagramStory).
    /^(https?:\/\/)?(www\.)?instagram\.com\/stories\/highlights\/\d+/,
    /^(https?:\/\/)?(www\.)?instagram\.com\/stories\/[\w.-]+\/\d+/,
    // …and the bare-account form, which is what "copy link" on a profile ring
    // gives you. Without it the link missed every platform and fell through to
    // the generic extractor, which answers "could not download this generic
    // content" — a dead end for a link we can actually resolve.
    /^(https?:\/\/)?(www\.)?instagram\.com\/stories\/[\w.-]+\/?$/,
    // New-style share links (resolved to a canonical URL before extraction)
    /^(https?:\/\/)?(www\.)?instagram\.com\/share\/[\w-]+/,
    /^(https?:\/\/)?(www\.)?instagram\.com\/s\/[\w-]+/,
  ],
  youtube: [
    // Standard watch URL (?v=…) — also covers music.youtube.com and m.youtube.com
    /^(https?:\/\/)?(www\.|m\.|music\.)?youtube\.com\/watch\?[^ ]*v=[\w-]{11}/,
    // youtu.be short links
    /^(https?:\/\/)?youtu\.be\/[\w-]{11}/,
    // Shorts, embeds, and live URLs
    /^(https?:\/\/)?(www\.|m\.)?youtube\.com\/(?:shorts|embed|live|v)\/[\w-]{11}/,
    // youtube-nocookie embeds
    /^(https?:\/\/)?(www\.)?youtube-nocookie\.com\/embed\/[\w-]{11}/,
  ],
  facebook: [
    // Short watch links
    /^(https?:\/\/)?(www\.)?fb\.watch\/[\w-]+/,
    // /watch/?v=… and ?v=… variants
    /^(https?:\/\/)?(www\.|web\.|m\.|mbasic\.)?facebook\.com\/watch\/?\?[^ ]*v=\d+/,
    // /<page>/videos/<id> and /<page>/videos/<slug>/<id>
    /^(https?:\/\/)?(www\.|web\.|m\.|mbasic\.)?facebook\.com\/[\w.-]+\/videos\/(?:[\w.-]+\/)?\d+/,
    // Reels
    /^(https?:\/\/)?(www\.|web\.|m\.|mbasic\.)?facebook\.com\/reel\/\d+/,
    // Share links, resolved to canonical before extraction. Every letter
    // Facebook's share sheet uses is accepted — /v/ and /r/ are video and reel,
    // /p/ is a post, which is frequently a post *of* a video.
    /^(https?:\/\/)?(www\.|web\.|m\.|mbasic\.)?facebook\.com\/share\/[a-z]\/[\w-]+/,
    // A post on a profile or page, which carries its video inline
    /^(https?:\/\/)?(www\.|web\.|m\.|mbasic\.)?facebook\.com\/[\w.-]+\/posts\/[\w-]+/,
    // The same post inside a group
    /^(https?:\/\/)?(www\.|web\.|m\.|mbasic\.)?facebook\.com\/groups\/[\w.-]+\/(?:posts|permalink|videos)\/[\w-]+/,
    // Photos, which resolve to the image rather than to a video
    /^(https?:\/\/)?(www\.|web\.|m\.|mbasic\.)?facebook\.com\/photo(?:\.php)?\/?\?[^ ]*fbid=\d+/,
    /^(https?:\/\/)?(www\.|web\.|m\.|mbasic\.)?facebook\.com\/[\w.-]+\/photos\/[\w.-]+\/\d+/,
    // Stories. Accepted so the extractor can say what is actually wrong with
    // them — Facebook serves these only to a logged-in session.
    /^(https?:\/\/)?(www\.|web\.|m\.|mbasic\.)?facebook\.com\/stories\/\d+/,
    // Story / permalink video and bare ?v= on the root domain
    /^(https?:\/\/)?(www\.|web\.|m\.|mbasic\.)?facebook\.com\/(?:[\w.-]+\/)?(?:video\.php|story\.php|permalink\.php)\?[^ ]*v?=?\d+/,
  ],
  // The platforms below are resolved through the generic Cobalt/yt-dlp path
  // (see Downloader.downloadGeneric) — no bespoke extractor, so the patterns
  // only need to recognise a shareable post/clip URL.
  pinterest: [
    /^(https?:\/\/)?(www\.)?pinterest\.[a-z.]+\/pin\/\d+/,
    /^(https?:\/\/)?pin\.it\/[\w]+/,
  ],
  reddit: [
    /^(https?:\/\/)?(www\.|old\.|new\.|m\.)?reddit\.com\/(?:r|user|u)\/[\w.-]+\/comments\/[\w]+/,
    // New-style share links: /r/<sub>/s/<id>
    /^(https?:\/\/)?(www\.)?reddit\.com\/(?:r|user|u)\/[\w.-]+\/s\/[\w]+/,
    /^(https?:\/\/)?v\.redd\.it\/[\w]+/,
    /^(https?:\/\/)?redd\.it\/[\w]+/,
  ],
  threads: [
    /^(https?:\/\/)?(www\.)?threads\.(net|com)\/@[\w.-]+\/post\/[\w-]+/,
    /^(https?:\/\/)?(www\.)?threads\.(net|com)\/t\/[\w-]+/,
  ],
  snapchat: [
    /^(https?:\/\/)?(www\.)?snapchat\.com\/(?:spotlight|t|p|add|u)\/[\w.@/-]+/,
    /^(https?:\/\/)?story\.snapchat\.com\/[\w/@-]+/,
  ],
  twitch: [
    /^(https?:\/\/)?(www\.|m\.)?twitch\.tv\/[\w]+\/clip\/[\w-]+/,
    /^(https?:\/\/)?clips\.twitch\.tv\/[\w-]+/,
    /^(https?:\/\/)?(www\.|m\.)?twitch\.tv\/videos\/\d+/,
  ],
  vimeo: [
    /^(https?:\/\/)?(www\.|player\.)?vimeo\.com\/(?:video\/)?\d+/,
  ],
}

export function detectPlatform(url: string): SupportedPlatform {
  if (!url || typeof url !== 'string') return 'unknown'
  const trimmed = extractFirstHttpUrl(url) ?? url.trim()
  for (const [platform, patterns] of Object.entries(platformPatterns)) {
    if (patterns.some((p) => p.test(trimmed))) {
      return platform as SupportedPlatform
    }
  }
  // Any other well-formed http(s) link is resolved through the generic tunnel
  // path (self-hosted resolver via COBALT_API_URL). Non-URL text stays unknown
  // so it still surfaces the "unsupported link" message.
  return isHttpUrl(trimmed) ? 'generic' : 'unknown'
}

/**
 * Pull the first HTTP(S) URL out of a full share caption.
 *
 * Chinese apps commonly copy a sentence plus a URL instead of the bare URL.
 * The token is trimmed at punctuation that cannot be part of a valid share
 * link, while query-string punctuation such as `&`, `=` and `%` is preserved.
 */
export function extractFirstHttpUrl(input: string): string | null {
  if (!input || typeof input !== 'string') return null
  const match = input.match(/https?:\/\/[^\s<>"']+/i)
  if (!match) return null
  const candidate = match[0].replace(/[，。！？；：、）】》」』]+$/u, '')
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

// True only for a syntactically valid http/https URL with a real host.
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.startsWith('http') ? value : `https://${value}`)
    return (
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      u.hostname.includes('.')
    )
  } catch {
    return false
  }
}

export function validateUrl(url: string): boolean {
  return detectPlatform(url) !== 'unknown'
}

export function parseVideoId(url: string): string | null {
  const patterns = [
    /\/video\/(\d+)/,
    /\/v\/(\d+)/,
    /vm\.tiktok\.com\/([\w\d]+)/,
    /vt\.tiktok\.com\/([\w\d]+)/,
    /\/t\/([\w\d]+)/,
    /\/status\/(\d+)/,
    /\/p\/([\w-]+)/,
    /\/reel\/([\w-]+)/,
    /\/videos\/(\d+)/,
    /v=(\d+)/,
    /fb\.watch\/([\w\d-]+)/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match && match[1]) {
      return match[1]
    }
  }

  return null
}

export function parseDouyinId(url: string): string | null {
  const value = extractFirstHttpUrl(url) ?? url
  return (
    value.match(/\/(?:video|note|share\/video|share\/note)\/(\d+)/)?.[1] ??
    value.match(/[?&]modal_id=(\d+)/)?.[1] ??
    null
  )
}

export function parseBilibiliId(url: string): string | null {
  const value = extractFirstHttpUrl(url) ?? url
  return value.match(/\b(BV[0-9A-Za-z]+)\b/i)?.[1] ?? null
}

/**
 * Extracts the Instagram shortcode (the alphanumeric id in /p/<code>,
 * /reel/<code>, /reels/<code>, /tv/<code>) from a post URL. Tolerates an
 * optional leading /<username>/ segment and trailing query/hash.
 */
export function parseInstagramShortcode(url: string): string | null {
  const patterns = [
    /instagram\.com\/(?:[\w.-]+\/)?(?:p|reel|reels|tv)\/([\w-]+)/,
    /instagr\.am\/(?:p|reel|reels|tv)\/([\w-]+)/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match && match[1]) return match[1]
  }
  return null
}

/**
 * Recognise an Instagram story or highlight URL and pull out what we need to
 * fetch it. Returns null for ordinary post/reel URLs.
 *   /stories/<username>/<storyPk>/        → { username, storyPk }
 *   /stories/<username>/                  → { username }
 *   /stories/highlights/<highlightId>/    → { highlightId }
 *
 * The bare-username form is what you get by copying the address bar while a
 * story is open in some clients, and by tapping "copy link" on a profile ring.
 * Without it that link fell through to the generic extractor and failed with
 * "could not download this generic content", which tells the user nothing —
 * the story extractor already treats `storyPk` as optional and takes the
 * newest item when it is missing.
 */
export function parseInstagramStory(
  url: string,
): { username?: string; storyPk?: string; highlightId?: string } | null {
  const hi = url.match(/instagram\.com\/stories\/highlights\/(\d+)/)
  if (hi) return { highlightId: hi[1] }
  const st = url.match(/instagram\.com\/stories\/([\w.-]+)\/(\d+)/)
  if (st) return { username: st[1], storyPk: st[2] }
  // `highlights` is a path segment, not an account, so it must not fall through
  // to here as a username once the id-bearing form above has missed.
  const user = url.match(/instagram\.com\/stories\/([\w.-]+)\/?(?:[?#]|$)/)
  if (user && user[1] !== 'highlights') return { username: user[1] }
  return null
}

/**
 * Extracts the 11-character YouTube video id from any common URL shape:
 * watch?v=…, youtu.be/…, /shorts/…, /embed/…, /live/…, /v/….
 */
export function parseYouTubeId(url: string): string | null {
  const patterns = [
    /youtu\.be\/([\w-]{11})/,
    /[?&]v=([\w-]{11})/,
    /\/shorts\/([\w-]{11})/,
    /\/embed\/([\w-]{11})/,
    /\/live\/([\w-]{11})/,
    /\/v\/([\w-]{11})/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match && match[1]) return match[1]
  }
  return null
}
