import { describe, expect, it } from 'vitest'
import {
  bytesFromDataUrl,
  buildId3Tag,
  id3v2Length,
  looksLikeMp3,
  synchsafe,
  tagMp3,
} from './id3'

/** Eleven set bits: the MPEG frame sync every MP3 opens with. */
const MP3_HEAD = [0xff, 0xfb, 0x90, 0x00]
const mp3Blob = (extra: number[] = []) =>
  new Blob([Uint8Array.from([...MP3_HEAD, ...extra])], { type: 'audio/mpeg' })

function readString(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length))
}

/** Read a tag body back out as UTF-16, the way a player would. */
function textOf(bytes: Uint8Array, id: string): string | null {
  for (let i = 10; i < bytes.length - 10; ) {
    const frameId = readString(bytes, i, 4)
    const size =
      (bytes[i + 4] << 24) | (bytes[i + 5] << 16) | (bytes[i + 6] << 8) | bytes[i + 7]
    const payload = bytes.subarray(i + 10, i + 10 + size)
    if (frameId === id) {
      // encoding byte, BOM, then LE code units, then a null terminator.
      expect(payload[0]).toBe(0x01)
      expect([payload[1], payload[2]]).toEqual([0xff, 0xfe])
      let out = ''
      for (let j = 3; j < payload.length - 2; j += 2) {
        out += String.fromCharCode(payload[j] | (payload[j + 1] << 8))
      }
      return out
    }
    i += 10 + size
  }
  return null
}

describe('tag length arithmetic', () => {
  it('splits a size across seven-bit bytes', () => {
    expect(synchsafe(0)).toEqual([0, 0, 0, 0])
    expect(synchsafe(127)).toEqual([0, 0, 0, 127])
    // 128 is where a plain byte would have overflowed — the whole reason the
    // format uses seven bits per byte.
    expect(synchsafe(128)).toEqual([0, 0, 1, 0])
    expect(synchsafe(0x1fffff)).toEqual([0, 127, 127, 127])
  })

  it('reads its own header back', () => {
    const tag = buildId3Tag({ title: 'x' })
    expect(id3v2Length(tag)).toBe(tag.length)
  })

  it('reports nothing for audio with no tag', () => {
    expect(id3v2Length(Uint8Array.from(MP3_HEAD))).toBe(0)
    expect(id3v2Length(new Uint8Array(3))).toBe(0)
  })
})

describe('recognising an MP3', () => {
  it('accepts a frame sync and an existing tag', () => {
    expect(looksLikeMp3(Uint8Array.from(MP3_HEAD))).toBe(true)
    expect(looksLikeMp3(buildId3Tag({ title: 'x' }))).toBe(true)
  })

  /**
   * The case this guard exists for: the audio button names everything `.mp3`,
   * but the proxy path re-serves a video's own AAC track in an MP4 container.
   * `ftyp` at offset 4 is that container, and tagging it would corrupt it.
   */
  it('rejects an MP4 container and a WebM', () => {
    const mp4 = Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])
    const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])
    expect(looksLikeMp3(mp4)).toBe(false)
    expect(looksLikeMp3(webm)).toBe(false)
  })
})

describe('building the tag', () => {
  it('carries non-Latin text and emoji through intact', () => {
    // The whole reason for UTF-16 rather than v2.3's Latin-1: titles here are
    // routinely Arabic, Japanese or emoji.
    const tag = buildId3Tag({ title: 'ليلة 🎵', artist: '夜' })
    expect(textOf(tag, 'TIT2')).toBe('ليلة 🎵')
    expect(textOf(tag, 'TPE1')).toBe('夜')
  })

  it('writes only the frames it was given', () => {
    const tag = buildId3Tag({ title: 'Only' })
    expect(textOf(tag, 'TIT2')).toBe('Only')
    expect(textOf(tag, 'TPE1')).toBeNull()
    expect(textOf(tag, 'TALB')).toBeNull()
  })

  it('embeds cover art as a front-cover APIC', () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    const tag = buildId3Tag({ coverJpeg: jpeg })
    const text = readString(tag, 0, tag.length)
    expect(text).toContain('APIC')
    expect(text).toContain('image/jpeg')
    // …0x00 terminator, 0x03 = cover (front), 0x00 empty description, then JPEG.
    const start = text.indexOf('image/jpeg') + 'image/jpeg'.length
    expect([...tag.subarray(start, start + 3)]).toEqual([0x00, 0x03, 0x00])
  })
})

describe('tagging a file', () => {
  it('puts the tag in front and keeps every audio byte', async () => {
    const tagged = await tagMp3(mp3Blob([0x11, 0x22]), { title: 'Song' })
    const bytes = new Uint8Array(await tagged.arrayBuffer())
    const length = id3v2Length(bytes)
    expect(length).toBeGreaterThan(10)
    expect([...bytes.subarray(length)]).toEqual([...MP3_HEAD, 0x11, 0x22])
    expect(textOf(bytes, 'TIT2')).toBe('Song')
  })

  /**
   * Sources hand back MP3s that are already tagged. A second tag glued in front
   * of the first is not a tag — it is bytes inside what the player believes is
   * the audio stream.
   */
  it('replaces an existing tag rather than stacking one on it', async () => {
    const existing = buildId3Tag({ title: 'Old', artist: 'Someone' })
    const blob = new Blob([existing, Uint8Array.from(MP3_HEAD)])
    const tagged = await tagMp3(blob, { title: 'New' })
    const bytes = new Uint8Array(await tagged.arrayBuffer())
    expect(textOf(bytes, 'TIT2')).toBe('New')
    expect(textOf(bytes, 'TPE1')).toBeNull()
    expect([...bytes.subarray(id3v2Length(bytes))]).toEqual(MP3_HEAD)
  })

  it('leaves bytes that are not MP3 completely alone', async () => {
    const mp4 = new Blob([Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])])
    const out = await tagMp3(mp4, { title: 'Song' })
    expect(out).toBe(mp4)
  })

  it('leaves the file alone when there is nothing to say about it', async () => {
    const blob = mp3Blob()
    expect(await tagMp3(blob, {})).toBe(blob)
    expect(await tagMp3(blob, { title: '   ' })).toBe(blob)
  })
})

describe('cover art from a canvas export', () => {
  it('decodes a base64 data URL', () => {
    expect([...(bytesFromDataUrl('data:image/jpeg;base64,//3//w==') ?? [])])
      .toEqual([0xff, 0xfd, 0xff, 0xff])
  })

  it('returns null for anything else', () => {
    expect(bytesFromDataUrl('https://example.com/a.jpg')).toBeNull()
    expect(bytesFromDataUrl('data:image/svg+xml,<svg/>')).toBeNull()
    expect(bytesFromDataUrl('data:image/jpeg;base64,!!!!')).toBeNull()
  })
})
