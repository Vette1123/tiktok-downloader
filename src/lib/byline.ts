/**
 * Whether a result has an author worth printing.
 *
 * The extractors fill an unknown uploader with the literal string 'Unknown' —
 * a sensible placeholder inside a data structure, and a strange thing to read
 * on a card: "by Unknown" claims to name somebody and then does not. An absent
 * byline says the same thing without the pretence.
 *
 * One helper rather than a check at each site, because there are two — the
 * result card and the audio preview's subtitle — and a third would otherwise
 * be written without it.
 */

/** What the extractors write when they could not find an uploader. */
const PLACEHOLDERS = new Set(['unknown', 'n/a', 'na', '-', '—', 'null', 'undefined'])

export function namedAuthor(
  author: string | null | undefined,
): string | undefined {
  const trimmed = author?.trim()
  if (!trimmed) return undefined
  return PLACEHOLDERS.has(trimmed.toLowerCase()) ? undefined : trimmed
}
