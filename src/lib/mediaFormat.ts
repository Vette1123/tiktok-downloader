/**
 * Name a saved file after what is actually in it.
 *
 * The download buttons choose an extension before a single byte has arrived:
 * the audio button says `.mp3`, the video button says `.mp4`. That is right
 * most of the time and wrong in a way nobody notices until it matters. A
 * Cobalt tunnel really does hand back MP3, but the fallback path re-serves the
 * source's own audio track — AAC in an MP4 container from YouTube, Opus in
 * WebM from others — and calling that `.mp3` produces a file that some players
 * refuse and every tagger misreads. The extension is a promise the bytes have
 * to keep.
 *
 * Containers only. There is no attempt to identify a codec: the extension is
 * about which player opens the file, and that is decided by the container.
 */

/** What the first few bytes say the container is. */
export type Container = 'mp3' | 'iso' | 'webm' | 'ogg'

/** Extensions that mean "this is audio", for choosing inside a container. */
const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'opus',
  'wav',
  'flac',
  'weba',
])

function startsWith(head: Uint8Array, ascii: string, at = 0): boolean {
  if (head.length < at + ascii.length) return false
  for (let i = 0; i < ascii.length; i++) {
    if (head[at + i] !== ascii.charCodeAt(i)) return false
  }
  return true
}

/**
 * The container these bytes are in, or null when it is not one we name.
 *
 * Null is the common and correct answer for everything else this app saves —
 * JPEG, PNG, ZIP — and it means "leave the filename alone", which is exactly
 * right for a format whose extension was never in doubt.
 */
export function sniffContainer(head: Uint8Array): Container | null {
  // An ID3 tag can only be on an MPEG audio stream in anything we produce.
  if (startsWith(head, 'ID3')) return 'mp3'
  // MPEG frame sync: eleven set bits.
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return 'mp3'
  // ISO base media (MP4, M4A) puts its brand box at offset 4.
  if (startsWith(head, 'ftyp', 4)) return 'iso'
  // Matroska/WebM's EBML magic.
  if (
    head.length >= 4 &&
    head[0] === 0x1a &&
    head[1] === 0x45 &&
    head[2] === 0xdf &&
    head[3] === 0xa3
  ) {
    return 'webm'
  }
  if (startsWith(head, 'OggS')) return 'ogg'
  return null
}

/** The extension a container takes, given whether the file is audio. */
function extensionFor(container: Container, audio: boolean): string {
  if (container === 'mp3') return 'mp3'
  if (container === 'ogg') return 'ogg'
  // The two containers that hold either. `.webm` covers audio-only WebM
  // everywhere that matters; `.weba` exists but is understood by almost
  // nothing, so naming an Opus stream `.webm` is the friendlier truth.
  if (container === 'webm') return 'webm'
  return audio ? 'm4a' : 'mp4'
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase()
}

/**
 * The filename with its extension corrected to match the bytes.
 *
 * Returns the original string whenever there is nothing to say — an
 * unrecognised container, no extension to replace, or bytes that already agree
 * with the name — so a caller can hand every save through this without
 * checking first.
 *
 * Whether the file is audio is read from the extension the caller chose, not
 * from the bytes: an MP4 container holds both, and the button that was pressed
 * is the only thing that knows which one was wanted.
 */
export function correctExtension(filename: string, head: Uint8Array): string {
  const current = extensionOf(filename)
  if (!current) return filename
  const container = sniffContainer(head)
  if (!container) return filename
  const wanted = extensionFor(container, AUDIO_EXTENSIONS.has(current))
  if (wanted === current) return filename
  return `${filename.slice(0, filename.length - current.length)}${wanted}`
}
