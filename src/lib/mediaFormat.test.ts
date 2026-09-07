import { describe, expect, it } from 'vitest'
import { correctExtension, sniffContainer } from './mediaFormat'

const bytes = (...values: number[]) => Uint8Array.from(values)
const ascii = (text: string, pad = 0) =>
  Uint8Array.from([
    ...new Array(pad).fill(0),
    ...[...text].map((c) => c.charCodeAt(0)),
  ])

const MP3 = bytes(0xff, 0xfb, 0x90, 0x00)
const ID3 = ascii('ID3')
const MP4 = ascii('ftyp', 4)
const WEBM = bytes(0x1a, 0x45, 0xdf, 0xa3)
const OGG = ascii('OggS')
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0)

describe('reading the container off the first bytes', () => {
  it('knows the four this app can produce', () => {
    expect(sniffContainer(MP3)).toBe('mp3')
    expect(sniffContainer(ID3)).toBe('mp3')
    expect(sniffContainer(MP4)).toBe('iso')
    expect(sniffContainer(WEBM)).toBe('webm')
    expect(sniffContainer(OGG)).toBe('ogg')
  })

  /**
   * Null is the right answer for everything else this app saves. It means
   * "leave the name alone", which is correct for a format whose extension was
   * never in question.
   */
  it('says nothing about anything else', () => {
    expect(sniffContainer(ascii('PK'))).toBeNull()
    expect(sniffContainer(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull()
    expect(sniffContainer(new Uint8Array(0))).toBeNull()
  })

  /**
   * A JPEG opens 0xFF 0xD8 — the second byte's top three bits are 110, not
   * 111, so it must not read as an MPEG frame sync. This is the one collision
   * the sniff could plausibly get wrong.
   */
  it('does not mistake a JPEG for MPEG audio', () => {
    expect(sniffContainer(JPEG)).toBeNull()
  })
})

describe('correcting a filename', () => {
  /**
   * The defect this exists for. The audio button names everything `.mp3`
   * before a byte arrives, but the fallback path re-serves the source's own
   * track — AAC in an MP4 container from YouTube. That file is not an MP3, and
   * calling it one makes players refuse it and taggers misread it.
   */
  it('renames an MP4-contained audio track to .m4a', () => {
    expect(correctExtension('song.mp3', MP4)).toBe('song.m4a')
  })

  /** The same container, wanted as video, keeps the video extension. */
  it('reads audio-or-video from the extension that was asked for', () => {
    expect(correctExtension('clip.mp4', MP4)).toBe('clip.mp4')
    expect(correctExtension('clip.mp4', WEBM)).toBe('clip.webm')
    expect(correctExtension('song.mp3', WEBM)).toBe('song.webm')
  })

  it('leaves a name alone when the bytes already agree', () => {
    const name = 'song.mp3'
    expect(correctExtension(name, MP3)).toBe(name)
    expect(correctExtension(name, ID3)).toBe(name)
  })

  it('leaves a name alone when it cannot tell', () => {
    expect(correctExtension('gallery.zip', ascii('PK'))).toBe(
      'gallery.zip',
    )
    expect(correctExtension('photo.jpg', JPEG)).toBe('photo.jpg')
    expect(correctExtension('noextension', MP4)).toBe('noextension')
  })

  /** Filenames here carry dots in the title slug, so only the last one counts. */
  it('replaces only the trailing extension', () => {
    expect(correctExtension('2026-09-07_tiktok_the.literary.rebel.mp3', MP4))
      .toBe('2026-09-07_tiktok_the.literary.rebel.m4a')
  })
})
