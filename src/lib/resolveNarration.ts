/**
 * What to say while a link is resolving.
 *
 * This is the longest wait in the app — several seconds on a good day, longer
 * when a source is slow — and until now it was a pulsing grey shape and
 * nothing else. A shape says "something is happening"; it does not say what,
 * or whether waiting is still the right thing to do, which is the question
 * somebody actually has at eight seconds.
 *
 * Every line here has to be true. It is tempting to narrate stages — "asking
 * the CDN", "picking the best quality" — but the extractor chain does not
 * report where it is, so those would be invented. What is genuinely known is
 * the platform (from the link, before any request) and how long it has taken,
 * and that is enough to be useful without making anything up.
 */

import type { SupportedPlatform } from './validator'

/**
 * How each platform names itself, and what it calls the thing being fetched.
 *
 * The noun is not decoration: a site whose users say "video" does not say
 * "post", and getting that wrong is the kind of small wrongness that reads as
 * a translation of somebody else's product. Pinterest has pins, Twitch has
 * clips, YouTube has videos.
 *
 * Partial by design: 'generic' and 'unknown' are real members of the union and
 * have no name to give — a link this app cannot place should not be announced
 * under an invented one.
 */
const PLATFORMS: Partial<
  Record<SupportedPlatform, { name: string; noun: string }>
> = {
  tiktok: { name: 'TikTok', noun: 'video' },
  twitter: { name: 'X', noun: 'post' },
  instagram: { name: 'Instagram', noun: 'post' },
  facebook: { name: 'Facebook', noun: 'post' },
  youtube: { name: 'YouTube', noun: 'video' },
  pinterest: { name: 'Pinterest', noun: 'pin' },
  reddit: { name: 'Reddit', noun: 'post' },
  threads: { name: 'Threads', noun: 'post' },
  snapchat: { name: 'Snapchat', noun: 'video' },
  twitch: { name: 'Twitch', noun: 'clip' },
  vimeo: { name: 'Vimeo', noun: 'video' },
}

/** The platform's own name, as it writes it. Null for anything unrecognised. */
export function platformLabel(
  platform: SupportedPlatform | null | undefined,
): string | null {
  if (!platform) return null
  return PLATFORMS[platform]?.name ?? null
}

/** "TikTok video", "Pinterest pin" — the platform and what it calls this. */
export function platformSubject(
  platform: SupportedPlatform | null | undefined,
): string | null {
  if (!platform) return null
  const entry = PLATFORMS[platform]
  return entry ? `${entry.name} ${entry.noun}` : null
}

/** After this, "reading the post" has stopped being a description. */
const STILL_WORKING_MS = 5000
/** After this, the honest thing to offer is a reason to keep waiting. */
const TAKING_A_WHILE_MS = 15000

export function resolveNarration(
  platform: SupportedPlatform | null | undefined,
  elapsedMs: number,
): string {
  if (elapsedMs >= TAKING_A_WHILE_MS) {
    // Both halves are true: the resolve always terminates in a result or a
    // message, and knowing that is what makes leaving the tab open reasonable
    // instead of a gamble.
    return 'Still going. You can leave this open — it will finish or say why.'
  }
  if (elapsedMs >= STILL_WORKING_MS) {
    return 'Still working — some sources answer slowly.'
  }
  const subject = platformSubject(platform)
  return subject ? `Reading the ${subject}…` : 'Reading the link…'
}
