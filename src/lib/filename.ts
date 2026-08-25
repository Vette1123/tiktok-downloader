// Builds descriptive, chronologically-sortable download filenames, e.g.
//   2026-06-08_1430_instagram_nasagoddard_ancient-space-rocks.mp4
//
// The leading `YYYY-MM-DD_HHMM` stamp means sorting a folder by name lists
// files in download order, while the platform/author/title tail keeps each
// file recognisable. Plain strings + Date only, so it is safe to import on
// both the client and the server.

const PLATFORM_LABEL: Record<string, string> = {
  douyin: 'douyin',
  kuaishou: 'kuaishou',
  bilibili: 'bilibili',
  xiaohongshu: 'xiaohongshu',
  tiktok: 'tiktok',
  twitter: 'x',
  instagram: 'instagram',
  facebook: 'facebook',
  youtube: 'youtube',
  pinterest: 'pinterest',
  reddit: 'reddit',
  threads: 'threads',
  snapchat: 'snapchat',
  twitch: 'twitch',
  vimeo: 'vimeo',
}

// Kebab-case slug for free text (titles/captions): strip diacritics, drop
// quotes, collapse everything else to single hyphens, then truncate.
export function slugify(input: string, maxLen = 40): string {
  const slug = input
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/['’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length <= maxLen) return slug
  // Truncate, then drop a trailing partial word so we don't cut mid-word
  // (e.g. "…rock-nasas-cu" → "…rock-nasas").
  const cut = slug.slice(0, maxLen).replace(/-+$/g, '')
  const lastHyphen = cut.lastIndexOf('-')
  return lastHyphen > maxLen * 0.5 ? cut.slice(0, lastHyphen) : cut
}

// Usernames keep their dots/underscores (e.g. the.literary.rebel) so they
// stay recognisable.
function slugUsername(input: string, maxLen = 30): string {
  return input
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, maxLen)
}

function timeStamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `_${p(date.getHours())}${p(date.getMinutes())}`
  )
}

export interface FilenameParts {
  platform?: string
  author?: string
  title?: string
  ext: string
  /** 1-based position within a carousel; appended as a zero-padded suffix. */
  index?: number
  /** Total items, used to pick the zero-pad width so names sort correctly. */
  total?: number
  /** Download timestamp; defaults to now. */
  date?: Date
}

export function buildDownloadFilename({
  platform,
  author,
  title,
  ext,
  index,
  total,
  date = new Date(),
}: FilenameParts): string {
  const parts: string[] = [timeStamp(date)]

  const plat = platform
    ? (PLATFORM_LABEL[platform] ?? slugify(platform, 12))
    : ''
  if (plat) parts.push(plat)

  const auth = author ? slugUsername(author) : ''
  if (auth && auth !== 'unknown') parts.push(auth)

  const ttl = title ? slugify(title, 40) : ''
  if (ttl) parts.push(ttl)

  const base = parts.filter(Boolean).join('_')
  const indexed =
    typeof index === 'number'
      ? `${base}_${String(index).padStart(Math.max(2, String(total ?? index).length), '0')}`
      : base

  return `${indexed}.${ext.replace(/^\./, '')}`
}
