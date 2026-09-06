/**
 * Getting a link into the app without aiming at the field first.
 *
 * Two ways in, both of which used to require finding and clicking the input:
 * dragging a link onto the page (from a tab, a bookmark, a note, a chat) and
 * pressing paste with nothing focused. Both end in the same place as typing
 * would, so the parsing lives here rather than inside the component — a pure
 * module the tests can hold still, away from a `DataTransfer` that only exists
 * mid-gesture in a real browser.
 */

/** The first http(s) URL in a string, or null. Mirrors the field's own parsing. */
function firstUrl(text: string): string | null {
  if (!text) return null
  const match = text.match(/https?:\/\/[^\s]+/i)
  const candidate = (match ? match[0] : text).trim()
  return /^https?:\/\//i.test(candidate) ? candidate : null
}

/** The shape of `DataTransfer` this module reads, so a test can supply one. */
export interface DroppedData {
  getData(format: string): string
}

/**
 * Whether a drag could be carrying a link.
 *
 * Read from `types` rather than `getData`, because a browser will not hand over
 * the contents of a drag until it is dropped — during `dragenter` and
 * `dragover`, the list of formats is all there is to go on. Which is enough:
 * this only decides whether to light the ring and accept the drop, and a text
 * drag with no URL in it simply does nothing when it lands.
 */
export function carriesText(transfer: { types: readonly string[] } | null): boolean {
  if (!transfer) return false
  return (
    transfer.types.includes('text/plain') ||
    transfer.types.includes('text/uri-list')
  )
}

/**
 * The link inside a drag, if there is one.
 *
 * `text/uri-list` is what a browser attaches to a dragged anchor, tab or
 * bookmark. Dragging *selected text* — from a note, a chat message, a
 * description — carries only `text/plain`, which is why both are read and why
 * plain text is not treated as a lesser source.
 *
 * The uri-list format (RFC 2483) permits several lines and `#` comments, so
 * this walks it rather than trusting the whole blob: dropping a link means the
 * first real URL in it, and a comment line beginning with `http` inside a
 * comment is not one.
 */
export function droppedLink(transfer: DroppedData | null): string | null {
  if (!transfer) return null
  for (const line of transfer.getData('text/uri-list').split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue
    const found = firstUrl(line)
    if (found) return found
  }
  return firstUrl(transfer.getData('text/plain'))
}

/**
 * Whether a paste belongs to something the visitor is typing in.
 *
 * The page-level paste handler is a convenience, never an interception: the URL
 * field, the filename-template box, the batch textarea and any future input all
 * keep their own pastes. Erring toward "leave it alone" is the safe direction —
 * a paste this returns true for simply behaves the way it always has.
 *
 * Reads the two properties rather than testing `instanceof HTMLElement`. That
 * check has no meaning in this module's own test environment (Node, no DOM),
 * and it silently returns false for an element from another realm — an iframe,
 * or a portal into one — which would hand that field's paste to the page.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const node = target as { tagName?: unknown; isContentEditable?: unknown }
  if (node.isContentEditable === true) return true
  const tag = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : ''
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
