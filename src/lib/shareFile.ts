/**
 * Hand a saved file to another app.
 *
 * On a phone — which is most of this site's traffic — "download" is only half
 * the job. The file lands in a Downloads folder, and the thing the visitor
 * actually wanted was to put it in a chat, a story, or a note. Every mobile OS
 * has a share sheet for exactly that, and the browser can reach it.
 *
 * The catch that shapes this module: `navigator.share` needs a live user
 * gesture, and Safari's expires within a few seconds. Sharing at the *end* of a
 * download therefore fails on iOS for anything but the smallest file — the
 * gesture that started it is long gone. So nothing here fetches. The caller
 * keeps the bytes it already had in hand (the download buffers the whole body
 * anyway, capped, before writing it out) and this runs inside the click on a
 * button that only appears once the file exists. Instant, and the activation is
 * still warm.
 *
 * `navigator.canShare` is the only honest capability test — support varies by
 * OS, browser and file type, and every static check is a guess. It is asked
 * with the real file, not a probe.
 */

/** The slice of `navigator` this needs, so tests can pass a fake. */
export interface ShareCapableNavigator {
  share?: (data: ShareData) => Promise<void>
  canShare?: (data: ShareData) => boolean
}

export type ShareOutcome = 'shared' | 'dismissed' | 'failed'

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  opus: 'audio/opus',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  zip: 'application/zip',
  srt: 'text/plain',
  vtt: 'text/vtt',
}

/**
 * A content type for a filename we chose ourselves.
 *
 * Needed because a `Blob` read off a tunnel often carries no type at all, and a
 * typeless file is refused by every share sheet — it is the type, not the
 * extension, that decides which apps are offered. Unknown extensions get the
 * generic binary type rather than a guess, which `canShare` will usually
 * decline, and declining is the correct outcome for something we cannot name.
 */
export function mimeForFilename(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  const ext = filename.slice(dot + 1).toLowerCase()
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream'
}

/**
 * Wrap saved bytes as a `File` the share sheet will accept.
 *
 * The blob's own type wins when it has one — it came from the server that
 * actually produced the bytes — and the filename fills in when it does not.
 */
export function fileFromBlob(blob: Blob, filename: string): File {
  return new File([blob], filename, {
    type: blob.type || mimeForFilename(filename),
  })
}

/**
 * The payload to share, or null when this file cannot be shared at all.
 *
 * A title is worth having (Android puts it in the message draft) but some
 * platforms refuse a title alongside files, and `canShare` reports that as a
 * flat no. So the richer payload is offered first and the bare one is the
 * fallback — asking twice costs nothing and turns a refusal into a share.
 */
export function sharePayload(
  file: File,
  title: string,
  nav: ShareCapableNavigator | undefined,
): ShareData | null {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') {
    return null
  }
  const check = (data: ShareData): boolean => {
    try {
      return nav.canShare!(data)
    } catch {
      // Some engines throw on an unexpected member instead of returning false.
      return false
    }
  }
  if (title && check({ files: [file], title })) return { files: [file], title }
  if (check({ files: [file] })) return { files: [file] }
  return null
}

/** Whether the "send to an app" button is worth rendering for this file. */
export function canShareFile(
  file: File,
  title: string,
  nav: ShareCapableNavigator | undefined,
): boolean {
  return sharePayload(file, title, nav) !== null
}

/**
 * Closing the share sheet rejects the same promise a real failure does.
 *
 * Telling them apart matters: a dismissal is a decision, and answering it with
 * "could not share" would call the visitor's own choice an error. The spec
 * names the dismissal `AbortError`; anything else is ours to report.
 */
export function shareOutcomeForError(error: unknown): 'dismissed' | 'failed' {
  const name = (error as { name?: unknown } | null)?.name
  return name === 'AbortError' ? 'dismissed' : 'failed'
}

/** Open the OS share sheet for an already-saved file. Never throws. */
export async function shareFile(
  file: File,
  title: string,
  nav: ShareCapableNavigator | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator,
): Promise<ShareOutcome> {
  const payload = sharePayload(file, title, nav)
  if (!payload || !nav?.share) return 'failed'
  try {
    await nav.share(payload)
    return 'shared'
  } catch (error) {
    return shareOutcomeForError(error)
  }
}
