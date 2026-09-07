import { describe, expect, it } from 'vitest'
import { missesHeading, missesRetryLabel, shortLink } from './missedLinks'

describe('shortening a link for a list', () => {
  it('keeps the part that identifies the post', () => {
    expect(shortLink('https://www.instagram.com/p/C8yQ8kZs1Zn/')).toBe(
      'instagram.com/p/C8yQ8kZs1Zn',
    )
    expect(shortLink('https://vimeo.com/76979871')).toBe('vimeo.com/76979871')
  })

  /**
   * The query string on these is signing and tracking. Dropping it is what
   * lets the identifying half survive being truncated to one line on a phone.
   */
  it('drops the signing and tracking tail', () => {
    expect(
      shortLink('https://www.tiktok.com/@a/video/123?is_from_webapp=1&sender=x'),
    ).toBe('tiktok.com/@a/video/123')
  })

  /**
   * Whatever was pasted is what somebody has to recognise, so an unparseable
   * string comes back exactly as it went in rather than as a placeholder.
   */
  it('hands back anything it cannot parse', () => {
    expect(shortLink('not a url at all')).toBe('not a url at all')
    expect(shortLink('')).toBe('')
  })
})

describe('counting the ones that got away', () => {
  it('does not say "1 links"', () => {
    expect(missesHeading(1)).toBe('One link did not resolve')
    expect(missesRetryLabel(1)).toBe('Try it again')
  })

  it('names the number when there is more than one', () => {
    expect(missesHeading(6)).toBe('6 links did not resolve')
    expect(missesRetryLabel(6)).toBe('Try those 6 again')
  })
})
