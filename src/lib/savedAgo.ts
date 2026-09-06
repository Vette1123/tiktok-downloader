/**
 * "You already saved this" — how long ago, in words.
 *
 * The result card can now say that a link has been downloaded before, which is
 * the question somebody working through a folder of posts actually has: not
 * "have I seen this" but "have I already got it". The phrasing has to be
 * readable at a glance and honest at every distance, so it degrades from
 * minutes to hours to days to a plain date rather than pretending "3,417
 * minutes ago" is useful.
 *
 * `Intl.RelativeTimeFormat` does the wording and the language; nothing here
 * hard-codes English, which matters because the core flow follows the footer's
 * language picker.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** Past a week, "6 days ago" stops helping and a date starts. */
const RELATIVE_LIMIT = 7 * DAY

/**
 * The largest unit that still describes the gap without exaggerating it.
 *
 * Ordered longest-first so the first match wins, which is what keeps "2 hours
 * ago" from rendering as "120 minutes ago".
 */
const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', DAY],
  ['hour', HOUR],
  ['minute', MINUTE],
]

/**
 * How long ago `at` was, or null when it is too long ago to phrase relatively.
 *
 * Null is the caller's cue to fall back to a date. It is also what a clock
 * running backwards produces — a device whose time was corrected, an entry
 * imported from a machine an hour ahead — because "in 40 minutes" on a file you
 * already have is worse than saying nothing.
 */
export function savedAgo(at: number, now: number, locale?: string): string | null {
  const elapsed = now - at
  if (elapsed < 0) return null
  if (elapsed >= RELATIVE_LIMIT) return null
  if (elapsed < MINUTE) return relative(0, 'minute', locale)

  for (const [unit, size] of UNITS) {
    if (elapsed >= size) return relative(-Math.floor(elapsed / size), unit, locale)
  }
  return null
}

/**
 * `numeric: 'auto'` is what turns -1 day into "yesterday" and 0 minutes into
 * "this minute" in every language that has a word for it, rather than the
 * literal count.
 */
function relative(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  locale?: string,
): string {
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    value,
    unit,
  )
}
