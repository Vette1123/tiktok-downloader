import { describe, expect, it } from 'vitest'
import { platformLabel, platformSubject, resolveNarration } from './resolveNarration'

describe('naming a platform', () => {
  it('uses the name the platform writes for itself', () => {
    expect(platformLabel('tiktok')).toBe('TikTok')
    expect(platformLabel('twitter')).toBe('X')
    expect(platformLabel('youtube')).toBe('YouTube')
  })

  it('has nothing to say about an unknown one', () => {
    expect(platformLabel(null)).toBeNull()
    expect(platformLabel(undefined)).toBeNull()
  })
})

describe('what to say while a link resolves', () => {
  /**
   * Naming the platform is the one thing genuinely known before any request,
   * and it doubles as a receipt: the link was understood.
   */
  it('opens by naming what it is reading', () => {
    expect(resolveNarration('instagram', 0)).toBe('Reading the Instagram post…')
    expect(resolveNarration('instagram', 4999)).toBe('Reading the Instagram post…')
  })

  /**
   * A site whose users say "video" does not say "post". Getting the noun wrong
   * is the kind of small wrongness that reads as somebody else's product with
   * the names swapped out.
   */
  it('calls the thing what the platform calls it', () => {
    expect(resolveNarration('youtube', 0)).toBe('Reading the YouTube video…')
    expect(resolveNarration('pinterest', 0)).toBe('Reading the Pinterest pin…')
    expect(resolveNarration('twitch', 0)).toBe('Reading the Twitch clip…')
  })

  it('drops the name rather than guessing at one', () => {
    expect(resolveNarration(null, 0)).toBe('Reading the link…')
    expect(resolveNarration('unknown', 0)).toBe('Reading the link…')
    expect(platformSubject('generic')).toBeNull()
  })

  /**
   * "Reading the post" stops being a description after a few seconds — at that
   * point it is a stale caption, and a stale caption reads as a hang.
   */
  it('stops claiming to be reading once it plainly is not', () => {
    expect(resolveNarration('tiktok', 5000)).toBe(
      'Still working — some sources answer slowly.',
    )
    expect(resolveNarration('tiktok', 14999)).toContain('Still working')
  })

  /**
   * The question at fifteen seconds is not "what is happening" but "should I
   * still be here". Both halves of the answer are true: a resolve always ends
   * in a result or a message.
   */
  it('answers the question a long wait actually raises', () => {
    const late = resolveNarration('youtube', 15000)
    expect(late).toContain('leave this open')
    expect(resolveNarration('youtube', 120000)).toBe(late)
  })

  /** Nothing here invents a stage the extractor never reports. */
  it('never claims to know where in the chain it is', () => {
    const everything = [0, 5000, 15000, 60000].map((ms) =>
      resolveNarration('reddit', ms),
    )
    for (const line of everything) {
      expect(line).not.toMatch(/attempt|retry|fallback|server|CDN|quality/i)
    }
  })
})
