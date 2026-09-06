// Builds descriptive, chronologically-sortable download filenames, e.g.
//   2026-06-08_143052_instagram_nasagoddard_ancient-space-rocks.mp4
//
// The leading `YYYY-MM-DD_HHMMSS` stamp means sorting a folder by name lists
// files in the order they were downloaded, while the platform/author/title tail
// keeps each file recognisable. Plain strings + Date only, so it is safe to
// import on both the client and the server.
//
// Supporters can replace that shape with one of their own — see
// `FILENAME_TOKENS` and the `template` part below. Absent, which is every free
// visitor and every pre-existing caller, nothing changes.

const PLATFORM_LABEL: Record<string, string> = {
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
  const cut = slug.slice(0, maxLen).replace(/-+$/g, '')
  // A cut that landed on a word boundary already ends on a whole word — losing
  // one more to a rule meant for mid-word cuts just makes the name vaguer.
  if (slug[maxLen] === '-' || slug[maxLen - 1] === '-') return cut
  // Otherwise drop the trailing partial word (e.g. "…rock-nasas-cu" →
  // "…rock-nasas"), unless that would take away most of the name.
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

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function dayStamp(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/**
 * `HHMMSS`, and the seconds are the point.
 *
 * With minutes alone, two files saved in the same minute fell back to sorting
 * by whatever came after the stamp — platform, then author, then title — so a
 * clip grabbed twenty seconds later could land above one grabbed first, and a
 * folder sorted by name stopped matching the order things were downloaded in.
 * Seconds make name order and download order the same order.
 */
function clockStamp(date: Date): string {
  return `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
}

function timeStamp(date: Date): string {
  return `${dayStamp(date)}_${clockStamp(date)}`
}

/**
 * The placeholders a saved-filename template may use.
 *
 * `{ext}` is deliberately absent, and that is not an oversight: the extension
 * has to describe what the bytes actually are. A template that could set it
 * would let somebody name an MP4 `.jpg` — the exact failure
 * `lessons/2026-09-06-the-tunnel-that-served-a-jpeg.md` is about, except
 * self-inflicted. The caller passes `ext`, and it is always what gets appended.
 */
export const FILENAME_TOKENS = [
  'date',
  'time',
  'platform',
  'author',
  'title',
  'index',
] as const

export type FilenameToken = (typeof FILENAME_TOKENS)[number]

/** What this tool has always named files, written out as a template. */
export const DEFAULT_FILENAME_TEMPLATE =
  '{date}_{time}_{platform}_{author}_{title}'

/** Ready-made shapes, so nobody has to learn the syntax before using it. */
export const FILENAME_TEMPLATE_PRESETS: Array<{
  label: string
  template: string
}> = [
  { label: 'Dated', template: DEFAULT_FILENAME_TEMPLATE },
  { label: 'Who and what', template: '{author} - {title}' },
  { label: 'By platform', template: '{platform}_{author}_{title}' },
  { label: 'Day and author', template: '{date}_{author}_{title}' },
  { label: 'Title only', template: '{title}' },
]

const TOKEN_PATTERN = /\{([a-z]+)\}/g
const MAX_TEMPLATE_LENGTH = 120

/**
 * Whether a string is a template this code will honour.
 *
 * Rejects rather than repairs. A typo'd token should be reported in the editor,
 * not silently baked into every filename from then on as a literal `{titel}`.
 * And a template naming no token at all is refused, because every file in a
 * carousel would come out with the same constant name.
 */
export function isFilenameTemplate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_TEMPLATE_LENGTH) return false
  const tokens = [...trimmed.matchAll(TOKEN_PATTERN)].map((m) => m[1])
  if (tokens.length === 0) return false
  return tokens.every((t) => (FILENAME_TOKENS as readonly string[]).includes(t))
}

/** The tokens in a template that this build does not know. For the editor. */
export function unknownFilenameTokens(template: string): string[] {
  return [...template.matchAll(TOKEN_PATTERN)]
    .map((m) => m[1])
    .filter((t) => !(FILENAME_TOKENS as readonly string[]).includes(t))
}

/**
 * Everything a filesystem, a browser download or a ZIP entry must not be given.
 *
 * Path separators first — a `download` attribute carrying `../` is a real
 * hazard, not a cosmetic one — then the Windows-reserved punctuation, then the
 * separators and dots left stranded at either end. Separators *inside* the name
 * are left exactly as the template wrote them: someone who typed
 * `{author} - {title}` asked for that spacing, and tidying it away would be the
 * editor overruling them.
 */
function sanitiseFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]+/g, '')
    .replace(/^[.\-_ ]+|[.\-_ ]+$/g, '')
    .slice(0, 150)
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
  /**
   * A supporter's saved-filename shape. Absent — every free visitor, and every
   * caller that predates this — keeps the built-in naming exactly as it was.
   */
  template?: string
}

export function buildDownloadFilename({
  platform,
  author,
  title,
  ext,
  index,
  total,
  date = new Date(),
  template,
}: FilenameParts): string {
  const plat = platform
    ? (PLATFORM_LABEL[platform] ?? slugify(platform, 12))
    : ''
  const auth = author ? slugUsername(author) : ''
  const suffix =
    typeof index === 'number'
      ? String(index).padStart(Math.max(2, String(total ?? index).length), '0')
      : ''

  const values: Record<FilenameToken, string> = {
    date: dayStamp(date),
    time: clockStamp(date),
    platform: plat,
    author: auth && auth !== 'unknown' ? auth : '',
    title: title ? slugify(title, 40) : '',
    index: suffix,
  }

  const cleanExt = ext.replace(/^\./, '')

  if (template && isFilenameTemplate(template)) {
    // Each token is matched together with the text that leads up to it, so a
    // token that resolves to nothing takes its own separator with it: an
    // anonymous post under `{author} - {title}` comes out "a-title", not
    // "- a-title". Substituting the tokens alone and tidying up afterwards
    // cannot tell a stranded separator from one the author typed on purpose.
    const filled = template.replace(
      /([^{}]*)\{([a-z]+)\}/g,
      (_, lead: string, token: string) => {
        const value = values[token as FilenameToken] ?? ''
        return value ? `${lead}${value}` : ''
      },
    )
    const safe = sanitiseFilename(filled)
    // A template whose every token came back empty — an untitled post by an
    // unknown author — would otherwise produce a bare ".mp4". Fall through to
    // the built-in shape, which always has a timestamp to fall back on.
    if (safe) {
      // A carousel needs its position in the name whatever the template says,
      // or twenty slides overwrite each other in the downloads folder.
      const needsIndex = suffix && !template.includes('{index}')
      return `${safe}${needsIndex ? `_${suffix}` : ''}.${cleanExt}`
    }
  }

  const parts = [timeStamp(date), values.platform, values.author, values.title]
  const base = parts.filter(Boolean).join('_')
  const indexed = suffix ? `${base}_${suffix}` : base

  return `${indexed}.${cleanExt}`
}

/**
 * A file size the way a person reads one: "12.4 MB", "870 KB".
 *
 * Base 1000, not 1024, because that is what every operating system's file
 * browser shows and what a download manager counts down in — matching the
 * pedantic definition would make our number disagree with the one the visitor
 * sees a second later.
 *
 * Returns '' for absent or nonsense, so the card renders nothing rather than
 * "0 B" or "NaN MB". A wrong size is worse than no size to somebody deciding
 * whether to spend mobile data on it.
 */
export function formatBytes(bytes: number | undefined): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1000) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  // One decimal below 100, none above: "9.4 MB" is useful, "947.3 MB" is noise.
  return `${value < 100 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
