// Turn a raw backend/extractor error string into a clear, specific, human
// message for the results banner. The backend already returns fairly specific
// text; this classifier normalises the common failure modes into a consistent
// voice and adds an actionable hint, without swallowing genuinely novel errors.

export interface FriendlyError {
  /** Short headline shown in bold. */
  title: string
  /** One-line actionable hint. */
  hint: string
}

const PRIVATE = /private|login|log in|logged[- ]in|sign[- ]in|authenticat/i
const AGE = /age[- ]restrict|18\+|nsfw|sensitive/i
const REGION = /region|geo[- ]?block|not available in your|country/i
const GONE = /deleted|removed|unavailable|not found|no longer|404/i
const UNSUPPORTED = /unsupported|invalid url|couldn'?t? (parse|recogni)|not a valid/i
const RATE = /rate[- ]?limit|too many|429|blocking requests|blocked/i
// "Failed to fetch" (Chrome/Firefox) and "Load failed" (Safari) are what a
// dropped connection actually reads as at the call site, and neither contains
// the word "network" — so this used to fall through to the generic branch and
// show somebody the browser's own internal phrasing.
const NETWORK =
  /network|timeout|timed out|econn|fetch failed|failed to fetch|load failed|socket/i
const STORY = /story|stories|highlight/i

export interface ErrorContext {
  /**
   * False only when the browser is certain there is no connection.
   *
   * One-directional on purpose: `navigator.onLine === false` means definitely
   * offline, while `true` only means an interface is up — a captive portal or a
   * dead uplink still reports it. So this answers "offline" and never "online".
   */
  online?: boolean
}

/**
 * Map a raw error to a friendly headline + hint. Falls back to the raw text
 * (trimmed) as the hint so nothing is ever hidden from the user.
 */
export function friendlyError(
  raw: string | undefined,
  url?: string,
  context: ErrorContext = {},
): FriendlyError {
  const text = (raw || '').trim()
  const looksInstagramStory = !!url && /instagram\.com\/(stories|s)\//i.test(url)

  // First, because it outranks everything the text could say: with no
  // connection the request never reached us, so nothing about the post is
  // known — and telling somebody their link might be private when their wifi
  // is off sends them to check the wrong thing.
  if (context.online === false) {
    return {
      title: 'You are offline',
      hint: 'This link needs a connection to resolve. Reconnect and try again — nothing about the post is wrong.',
    }
  }

  if (looksInstagramStory || (STORY.test(text) && PRIVATE.test(text))) {
    return {
      title: 'Stories need a logged-in session',
      hint: 'Instagram only serves stories & highlights to signed-in accounts, so they can’t be fetched anonymously here.',
    }
  }
  if (AGE.test(text)) {
    return {
      title: 'Age-restricted content',
      hint: 'The platform gates this behind an age check, so it can’t be resolved without a logged-in account.',
    }
  }
  if (PRIVATE.test(text)) {
    return {
      title: 'This post is private or login-only',
      hint: 'Only public posts can be downloaded. Make sure the account and post are public, then try again.',
    }
  }
  if (REGION.test(text)) {
    return {
      title: 'Region-locked content',
      hint: 'The source restricts this by country and blocks our server’s region.',
    }
  }
  if (GONE.test(text)) {
    return {
      title: 'Post unavailable',
      hint: 'It may have been deleted or made private. Double-check the link opens in a browser.',
    }
  }
  if (UNSUPPORTED.test(text)) {
    return {
      title: 'Unsupported or malformed link',
      hint: 'Paste a full post URL (e.g. the share link) from a supported platform.',
    }
  }
  if (RATE.test(text)) {
    return {
      title: 'Temporarily rate-limited',
      hint: 'The source is throttling requests right now. Wait a minute and try again.',
    }
  }
  if (NETWORK.test(text)) {
    return {
      title: 'Network hiccup',
      hint: 'The request timed out. Check your connection and try again.',
    }
  }
  return {
    title: 'Couldn’t process this link',
    hint: text || 'Something went wrong resolving the media. Try again in a moment.',
  }
}
