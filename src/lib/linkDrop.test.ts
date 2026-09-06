import { describe, expect, it } from 'vitest'
import { carriesText, droppedLink, isEditableTarget } from './linkDrop'

describe('whether a drag is worth accepting', () => {
  it('accepts a dragged link or dragged text', () => {
    expect(carriesText({ types: ['text/uri-list', 'text/plain'] })).toBe(true)
    expect(carriesText({ types: ['text/plain'] })).toBe(true)
  })

  /**
   * A dropped file is the browser's business, not this handler's: claiming the
   * drop would swallow it and do nothing, which is worse than letting the
   * browser open it.
   */
  it('leaves a dragged file to the browser', () => {
    expect(carriesText({ types: ['Files'] })).toBe(false)
    expect(carriesText({ types: [] })).toBe(false)
    expect(carriesText(null)).toBe(false)
  })
})

/** Stands in for a real `DataTransfer`, which only exists inside a live drag. */
function transfer(data: Record<string, string>) {
  return { getData: (format: string) => data[format] ?? '' }
}

const REEL = 'https://www.instagram.com/reel/DMmxU4bKcsR/'

describe('a link dragged onto the page', () => {
  it('reads a dragged tab or bookmark', () => {
    expect(droppedLink(transfer({ 'text/uri-list': REEL }))).toBe(REEL)
  })

  /**
   * Dragging selected text out of a note or a chat message carries no
   * uri-list at all, and that is a normal way to move a link around.
   */
  it('reads a link dragged as plain text', () => {
    expect(droppedLink(transfer({ 'text/plain': `watch this ${REEL} lol` }))).toBe(
      REEL,
    )
  })

  /** RFC 2483: a uri-list may carry several lines, and `#` starts a comment. */
  it('skips the comment lines a uri-list is allowed to carry', () => {
    expect(
      droppedLink(
        transfer({
          'text/uri-list': `# https://example.com/not-this\r\n${REEL}\r\nhttps://second.example/`,
        }),
      ),
    ).toBe(REEL)
  })

  it('prefers the uri-list over the plain-text label beside it', () => {
    // A dragged anchor carries its own visible text as text/plain, which is
    // usually the page title rather than a URL — but not always.
    expect(
      droppedLink(
        transfer({
          'text/uri-list': REEL,
          'text/plain': 'https://example.com/the-anchor-text',
        }),
      ),
    ).toBe(REEL)
  })

  it('says nothing for a drag that carries no link', () => {
    expect(droppedLink(transfer({ 'text/plain': 'just some words' }))).toBeNull()
    expect(droppedLink(transfer({}))).toBeNull()
    expect(droppedLink(null)).toBeNull()
  })

  /** An image or a file dragged in has no text at all; that must not throw. */
  it('survives a drag with no text formats on it', () => {
    expect(droppedLink({ getData: () => '' })).toBeNull()
  })
})

describe('deciding whether a paste was meant for a field', () => {
  /** The two properties the check reads, which is all a DOM node needs here. */
  function el(tagName: string, isContentEditable = false) {
    return { tagName, isContentEditable } as unknown as EventTarget
  }

  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('leaves a %s alone', (tag) => {
    expect(isEditableTarget(el(tag))).toBe(true)
  })

  it('leaves a contenteditable alone', () => {
    expect(isEditableTarget(el('DIV', true))).toBe(true)
  })

  it('claims a paste that landed on the page itself', () => {
    expect(isEditableTarget(el('DIV'))).toBe(false)
    expect(isEditableTarget(el('BODY'))).toBe(false)
  })

  /**
   * An element from an iframe fails `instanceof HTMLElement` in the parent
   * realm, which is why this reads properties instead: getting it wrong here
   * would hand that field's paste to the page.
   */
  it('recognises a field from another realm', () => {
    expect(isEditableTarget(el('input'))).toBe(true)
  })

  /** A paste can arrive with no target, or one that is not an element at all. */
  it('claims nothing when there is no element to judge', () => {
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget({} as EventTarget)).toBe(false)
  })
})
