import { describe, expect, it } from 'vitest'
import { clipboardDecision } from './clipboardWatch'

const REEL = 'https://www.instagram.com/reel/DMmxU4bKcsR/'

const IDLE = {
  text: '',
  lastSeen: null as string | null,
  currentUrl: '',
  busy: false,
}

describe('acting on what the clipboard holds', () => {
  it('resolves a freshly copied link', () => {
    expect(clipboardDecision({ ...IDLE, text: REEL })).toEqual({
      resolve: REEL,
      seen: REEL,
    })
  })

  it('finds the link inside copied text', () => {
    const copied = `check this out ${REEL} 🔥`
    expect(clipboardDecision({ ...IDLE, text: copied })).toEqual({
      resolve: REEL,
      seen: copied,
    })
  })

  /**
   * A focus event fires every time the tab is clicked. Without this the same
   * link would resolve on every alt-tab for as long as it sat on the clipboard.
   */
  it('ignores the same text twice', () => {
    expect(
      clipboardDecision({ ...IDLE, text: REEL, lastSeen: REEL }).resolve,
    ).toBeNull()
  })

  /** Whitespace differences are not a new copy. */
  it('treats padded text as the same text', () => {
    expect(
      clipboardDecision({ ...IDLE, text: `  ${REEL}\n`, lastSeen: REEL }).resolve,
    ).toBeNull()
  })

  it('does not interrupt a download in progress', () => {
    expect(clipboardDecision({ ...IDLE, text: REEL, busy: true }).resolve).toBeNull()
  })

  /**
   * Copying a paragraph must not clear the card or raise an error. It simply is
   * not for us.
   */
  it('ignores clipboard text with no link in it', () => {
    expect(
      clipboardDecision({ ...IDLE, text: 'remember to buy milk' }).resolve,
    ).toBeNull()
    expect(clipboardDecision({ ...IDLE, text: '   ' }).resolve).toBeNull()
  })

  /** The Copy link button on the result puts that result's own URL here. */
  it('does not re-resolve the link already on the card', () => {
    expect(
      clipboardDecision({ ...IDLE, text: REEL, currentUrl: REEL }).resolve,
    ).toBeNull()
  })

  /**
   * Every path records what it saw. Dismissing text without remembering it
   * means re-reading and re-rejecting it on every focus, forever.
   */
  it.each([
    ['busy', { text: REEL, busy: true }],
    ['no link', { text: 'nothing here' }],
    ['already on the card', { text: REEL, currentUrl: REEL }],
  ])('remembers text it declined to act on (%s)', (_label, overrides) => {
    const decision = clipboardDecision({ ...IDLE, ...overrides })
    expect(decision.resolve).toBeNull()
    expect(decision.seen).toBe(overrides.text.trim())
  })

  it('acts on a second, different link', () => {
    const next = 'https://www.tiktok.com/@nasa/video/7300000000000000000'
    expect(
      clipboardDecision({ ...IDLE, text: next, lastSeen: REEL }).resolve,
    ).toBe(next)
  })
})
