/**
 * Reporting the links a multi-link paste could not resolve.
 *
 * They used to be dropped on the floor. A run said "Saved 14 of 20" and
 * stopped there, which is not an answer — it is a number somebody has to turn
 * back into links by comparing the summary against a Recent list. In practice
 * the six are a couple of private posts and a typo, and which is which is only
 * visible if the links themselves are shown.
 *
 * Pure, so the wording and the shortening are testable; the panel that uses
 * them is not.
 */

/** How many to list before summarising the rest. */
export const MISSES_SHOWN = 5

/**
 * A link short enough for a list, without hiding which link it is.
 *
 * Host and path only. The query string on these is signing and tracking, and
 * dropping it is what lets the identifying half survive being truncated to one
 * line on a phone. Anything unparseable comes back untouched — it is still the
 * text somebody pasted, which is the thing they need to recognise.
 */
export function shortLink(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./i, '')
    return `${host}${parsed.pathname}`.replace(/\/$/, '')
  } catch {
    return url
  }
}

export function missesHeading(count: number): string {
  return count === 1
    ? 'One link did not resolve'
    : `${count} links did not resolve`
}

export function missesRetryLabel(count: number): string {
  return count === 1 ? 'Try it again' : `Try those ${count} again`
}
