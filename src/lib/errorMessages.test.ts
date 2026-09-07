import { describe, expect, it } from 'vitest'
import { friendlyError } from './errorMessages'

describe('turning an extractor error into something worth reading', () => {
  it('names the common refusals', () => {
    expect(friendlyError('This account is private').title).toBe(
      'This post is private or login-only',
    )
    expect(friendlyError('HTTP 429 too many requests').title).toBe(
      'Temporarily rate-limited',
    )
    expect(friendlyError('video was deleted').title).toBe('Post unavailable')
  })

  /** A story link is diagnosable from the URL alone, before any error text. */
  it('reads an Instagram story from the link itself', () => {
    expect(
      friendlyError('', 'https://instagram.com/stories/nasa/123').title,
    ).toBe('Stories need a logged-in session')
  })

  it('never hides a novel error', () => {
    expect(friendlyError('kettle overheated').hint).toBe('kettle overheated')
  })

  /**
   * The two phrasings a dropped connection actually produces. Neither contains
   * the word "network", so both used to fall through to the generic branch and
   * put the browser's own internal wording in front of somebody.
   */
  it('recognises what a dropped connection really says', () => {
    expect(friendlyError('Failed to fetch').title).toBe('Network hiccup')
    expect(friendlyError('Load failed').title).toBe('Network hiccup')
    expect(friendlyError('TypeError: fetch failed').title).toBe('Network hiccup')
  })

  describe('being offline', () => {
    /**
     * It outranks everything the text could say: the request never left the
     * device, so nothing about the post is known. Telling somebody their link
     * might be private while their wifi is off sends them to check the wrong
     * thing entirely.
     */
    it('beats every other classification', () => {
      const offline = { online: false }
      expect(friendlyError('This account is private', undefined, offline).title)
        .toBe('You are offline')
      expect(
        friendlyError('', 'https://instagram.com/stories/nasa/1', offline).title,
      ).toBe('You are offline')
    })

    /**
     * `navigator.onLine === true` only means an interface is up — a captive
     * portal reports it too — so a truthy value must change nothing.
     */
    it('is only ever consulted in the negative', () => {
      expect(friendlyError('This account is private', undefined, { online: true }).title)
        .toBe('This post is private or login-only')
      expect(friendlyError('This account is private', undefined, {}).title)
        .toBe('This post is private or login-only')
    })
  })
})
