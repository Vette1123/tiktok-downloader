/**
 * "Copy a link anywhere, come back, and it is already resolving."
 *
 * The loop this removes is the one a heavy user actually spends their evening
 * on: copy a link in the app, switch to the tab, tap Paste, tap Download,
 * switch back. With this on — and auto-save alongside it — the middle three
 * steps are gone: copy, switch, and the file is saving.
 *
 * The decision of *whether* to act on what the clipboard holds is here, pure
 * and tested, because it is the part that can go wrong quietly. Reading the
 * clipboard at all is the component's job, and only ever when the tab is
 * focused: `navigator.clipboard.readText()` rejects otherwise, and a page that
 * could read the clipboard in the background would be a page nobody should
 * leave open.
 */

export interface ClipboardDecision {
  /** The link to resolve, or null to do nothing. */
  resolve: string | null
  /**
   * What to remember as "already seen", whether or not it was resolved.
   *
   * Always the raw clipboard text, never the extracted URL: the same copy read
   * twice must look the same both times, and a visitor who copies a message
   * containing a link they already saved should not have it fire again.
   */
  seen: string
}

export interface ClipboardContext {
  /** Raw clipboard text, as read. */
  text: string
  /** The last text this watcher acted on or dismissed. */
  lastSeen: string | null
  /** The link currently on the card, so a re-copy of it is not a new job. */
  currentUrl: string
  /** True while something is already resolving or downloading. */
  busy: boolean
}

const URL_PATTERN = /https?:\/\/[^\s]+/i

/**
 * Whether a clipboard read is worth acting on, and what to remember.
 *
 * Four reasons to do nothing, and every one of them is a real report waiting to
 * happen if it is missed:
 *
 *   - Same text as last time. A focus event fires every time the tab is
 *     clicked, so without this the same link resolves on every alt-tab.
 *   - Something is already in flight. Interrupting a download in progress to
 *     start a different one is the opposite of helpful.
 *   - The clipboard holds no link. Copying a paragraph of text must not clear
 *     the card or show an error; it is simply not for us.
 *   - The link is the one already on the card. Copying the result's own URL,
 *     which the Copy link button exists to do, must not re-resolve it.
 *
 * The first two still record what was seen. Dismissing text without remembering
 * it means re-reading and re-rejecting it on every focus for as long as the tab
 * is open.
 */
export function clipboardDecision(context: ClipboardContext): ClipboardDecision {
  const text = context.text.trim()
  const seen = text
  if (!text || text === context.lastSeen) return { resolve: null, seen }
  if (context.busy) return { resolve: null, seen }

  const match = text.match(URL_PATTERN)
  const link = match?.[0] ?? null
  if (!link) return { resolve: null, seen }
  if (link === context.currentUrl) return { resolve: null, seen }
  return { resolve: link, seen }
}
