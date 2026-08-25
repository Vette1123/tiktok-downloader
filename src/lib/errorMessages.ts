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
const NETWORK = /network|timeout|timed out|econn|fetch failed|socket/i
const STORY = /story|stories|highlight/i
const PUBLIC_INSTAGRAM_RESOLVER = /public Instagram resolvers/i

/**
 * Map a raw error to a friendly headline + hint. Falls back to the raw text
 * (trimmed) as the hint so nothing is ever hidden from the user.
 */
export function friendlyError(raw: string | undefined, url?: string): FriendlyError {
  const text = (raw || '').trim()
  const looksInstagramStory = !!url && /instagram\.com\/(stories|s)\//i.test(url)

  if (looksInstagramStory || (STORY.test(text) && PRIVATE.test(text))) {
    return {
      title: 'Stories need a logged-in session',
      hint: 'Instagram only serves stories & highlights to signed-in accounts, so they can’t be fetched anonymously here.',
    }
  }
  if (PUBLIC_INSTAGRAM_RESOLVER.test(text)) {
    return {
      title: 'Instagram public resolver unavailable',
      hint: 'The post may still be public. Instagram or the fallback service refused this request; wait a moment and try again.',
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
