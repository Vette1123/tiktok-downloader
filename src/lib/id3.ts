/**
 * Write ID3 tags into an extracted MP3.
 *
 * An MP3 pulled out of a post arrives anonymous: no title, no artist, no cover.
 * Dropped into a music library it shows up as a filename, sorted under nothing,
 * next to everything else that was saved that week. The information to fix that
 * is already on screen — the card knows the track, the uploader and has the
 * artwork loaded — so the only thing standing between the two is forty lines of
 * byte layout, which is what this file is.
 *
 * ID3v2.3, not v2.4, and UTF-16 rather than UTF-8. v2.3 is the version every
 * player, phone and car stereo reads; v2.4's UTF-8 text is the tidier format
 * and is still refused by a long tail of hardware. Titles here are routinely
 * not Latin — Arabic, Japanese, emoji — so the Latin-1 encoding v2.3 also
 * offers is not an option, which leaves UTF-16 with a byte-order mark.
 *
 * Everything here is bytes in, bytes out. No network, no DOM: the artwork
 * arrives as JPEG bytes the caller already has.
 */

export interface AudioTags {
  title?: string
  artist?: string
  album?: string
  /** Where it came from, written to WOAS (official source webpage). */
  sourceUrl?: string
  /** Cover art. JPEG only — the caller re-encodes, so the type is known. */
  coverJpeg?: Uint8Array
}

const HEADER_BYTES = 10

/** ASCII for a frame id or a MIME string — never free text. */
function ascii(text: string): number[] {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 0x7f)
  return out
}

/**
 * UTF-16LE with a byte-order mark and a null terminator.
 *
 * JS strings are already UTF-16 code units, so this is a copy rather than a
 * conversion — surrogate pairs included, which is what carries emoji through
 * intact.
 */
function utf16le(text: string): number[] {
  const out: number[] = [0xff, 0xfe]
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    out.push(code & 0xff, (code >> 8) & 0xff)
  }
  out.push(0, 0)
  return out
}

/** Four bytes, seven bits each — the tag length format ID3 uses throughout. */
export function synchsafe(size: number): number[] {
  return [
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]
}

/** Plain big-endian. v2.3 frame sizes are NOT synchsafe; v2.4's are. */
function beUint32(size: number): number[] {
  return [(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff]
}

function frame(id: string, payload: number[]): number[] {
  return [...ascii(id), ...beUint32(payload.length), 0, 0, ...payload]
}

/** A text frame: encoding byte 0x01 (UTF-16 with BOM), then the text. */
function textFrame(id: string, value: string): number[] {
  return frame(id, [0x01, ...utf16le(value)])
}

/**
 * The size of a leading ID3v2 tag, or 0 when there is not one.
 *
 * Needed because sources hand back MP3s that are already tagged, and a second
 * tag glued in front of the first is not a tag — it is 400 bytes of garbage
 * inside what the player thinks is the audio stream.
 */
export function id3v2Length(head: Uint8Array): number {
  if (head.length < HEADER_BYTES) return 0
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0 // 'ID3'
  const size =
    ((head[6] & 0x7f) << 21) |
    ((head[7] & 0x7f) << 14) |
    ((head[8] & 0x7f) << 7) |
    (head[9] & 0x7f)
  // Bit 4 of the flags byte marks a 10-byte footer, which counts too.
  const footer = head[5] & 0x10 ? HEADER_BYTES : 0
  return HEADER_BYTES + size + footer
}

/**
 * Whether these bytes are an MP3 at all.
 *
 * The audio button says `.mp3` for everything, but the proxy path re-serves a
 * video's own audio track, which is usually AAC in an MP4 container. Tagging
 * that would corrupt it, so the bytes get the last word rather than the name.
 *
 * Known and accepted limit: a raw AAC stream with an ID3 tag already on the
 * front reads as MP3 here. Nothing this app talks to produces one.
 */
export function looksLikeMp3(head: Uint8Array): boolean {
  if (id3v2Length(head) > 0) return true
  // MPEG frame sync: eleven set bits.
  return head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0
}

/** Non-empty tag values only — an empty frame is worse than an absent one. */
function hasAnything(tags: AudioTags): boolean {
  return !!(
    tags.title?.trim() ||
    tags.artist?.trim() ||
    tags.album?.trim() ||
    tags.sourceUrl ||
    tags.coverJpeg?.length
  )
}

/** The complete ID3v2.3 tag, header included, ready to sit in front of audio. */
export function buildId3Tag(tags: AudioTags): Uint8Array<ArrayBuffer> {
  const body: number[] = []
  if (tags.title?.trim()) body.push(...textFrame('TIT2', tags.title.trim()))
  if (tags.artist?.trim()) body.push(...textFrame('TPE1', tags.artist.trim()))
  if (tags.album?.trim()) body.push(...textFrame('TALB', tags.album.trim()))
  if (tags.sourceUrl) {
    // URL frames carry no encoding byte and are Latin-1 by definition, so the
    // link is percent-encoded rather than trusted to be ASCII already.
    body.push(...frame('WOAS', ascii(encodeURI(tags.sourceUrl))))
  }
  if (tags.coverJpeg?.length) {
    body.push(
      ...frame('APIC', [
        0x00, // description encoding: Latin-1, because the description is empty
        ...ascii('image/jpeg'),
        0x00,
        0x03, // picture type: cover (front)
        0x00, // empty description
        ...tags.coverJpeg,
      ]),
    )
  }
  const header = [...ascii('ID3'), 0x03, 0x00, 0x00, ...synchsafe(body.length)]
  return Uint8Array.from([...header, ...body])
}

/**
 * Return the same audio with our tag on the front, or the original untouched.
 *
 * Untouched is the answer whenever tagging would be a guess or a corruption:
 * bytes that are not MP3, and tags with nothing in them. Both are ordinary —
 * the first is every YouTube audio-only fallback — so neither is an error.
 */
export async function tagMp3(blob: Blob, tags: AudioTags): Promise<Blob> {
  if (!hasAnything(tags)) return blob
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (!looksLikeMp3(bytes)) return blob
  const audio = bytes.subarray(id3v2Length(bytes))
  return new Blob([buildId3Tag(tags), audio], {
    type: blob.type || 'audio/mpeg',
  })
}

/**
 * The bytes behind a `data:` URL, or null when it is not one.
 *
 * Lives here because the cover art reaches this module as a canvas export, and
 * a canvas only hands back a data URL.
 */
export function bytesFromDataUrl(dataUrl: string): Uint8Array<ArrayBuffer> | null {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || comma < 0) return null
  if (!dataUrl.slice(0, comma).includes(';base64')) return null
  try {
    const binary = atob(dataUrl.slice(comma + 1))
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}
