import { describe, expect, it, vi } from 'vitest'
import {
  canShareFile,
  fileFromBlob,
  mimeForFilename,
  shareFile,
  shareOutcomeForError,
  sharePayload,
  type ShareCapableNavigator,
} from './shareFile'

const clip = () => new File([new Uint8Array([1, 2, 3])], 'clip.mp4', {
  type: 'video/mp4',
})

/** A navigator that accepts everything `accept` says yes to. */
function fakeNavigator(
  accept: (data: ShareData) => boolean,
  share: (data: ShareData) => Promise<void> = () => Promise.resolve(),
): ShareCapableNavigator {
  return { canShare: accept, share }
}

describe('naming the bytes', () => {
  it('maps the extensions this app actually writes', () => {
    expect(mimeForFilename('a.mp4')).toBe('video/mp4')
    expect(mimeForFilename('a.MP3')).toBe('audio/mpeg')
    expect(mimeForFilename('a.zip')).toBe('application/zip')
  })

  /**
   * Not a guess. An unknown extension gets the generic type, which share sheets
   * decline — and declining is right for something we cannot name.
   */
  it('refuses to invent a type', () => {
    expect(mimeForFilename('mystery.qqq')).toBe('application/octet-stream')
    expect(mimeForFilename('noextension')).toBe('application/octet-stream')
  })

  /** A tunnel body often arrives typeless; the filename is the fallback. */
  it('prefers the blob type and falls back to the filename', () => {
    expect(fileFromBlob(new Blob(['x'], { type: 'video/webm' }), 'a.mp4').type)
      .toBe('video/webm')
    expect(fileFromBlob(new Blob(['x']), 'a.mp3').type).toBe('audio/mpeg')
  })
})

describe('deciding whether a share is possible', () => {
  it('says no without the API at all', () => {
    expect(canShareFile(clip(), 'Clip', undefined)).toBe(false)
    expect(canShareFile(clip(), 'Clip', {})).toBe(false)
    expect(canShareFile(clip(), 'Clip', { share: () => Promise.resolve() }))
      .toBe(false)
  })

  it('says no when the platform refuses this file', () => {
    expect(canShareFile(clip(), 'Clip', fakeNavigator(() => false))).toBe(false)
  })

  /**
   * The reason `sharePayload` asks twice: a platform that refuses a title
   * alongside files reports the whole payload as unshareable, and dropping the
   * title turns that refusal into a working share.
   */
  it('drops the title rather than the share', () => {
    const filesOnly = (data: ShareData) => !data.title && !!data.files
    const payload = sharePayload(clip(), 'Clip', fakeNavigator(filesOnly))
    expect(payload).toEqual({ files: [expect.any(File)] })
    expect(payload?.title).toBeUndefined()
  })

  it('keeps the title where it is welcome', () => {
    const payload = sharePayload(clip(), 'Clip', fakeNavigator(() => true))
    expect(payload?.title).toBe('Clip')
  })

  /** Some engines throw on an unexpected member instead of returning false. */
  it('survives a canShare that throws', () => {
    const nav = fakeNavigator(() => {
      throw new TypeError('nope')
    })
    expect(canShareFile(clip(), 'Clip', nav)).toBe(false)
  })
})

describe('reading the result', () => {
  /**
   * A closed sheet rejects exactly like a broken one. Reporting "could not
   * share" for a deliberate dismissal calls the visitor's own choice an error.
   */
  it('tells a dismissal apart from a failure', () => {
    const aborted = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    expect(shareOutcomeForError(aborted)).toBe('dismissed')
    expect(shareOutcomeForError(new TypeError('boom'))).toBe('failed')
    expect(shareOutcomeForError(null)).toBe('failed')
  })

  it('shares, and reports what happened', async () => {
    const share = vi.fn(() => Promise.resolve())
    const nav = fakeNavigator(() => true, share)
    await expect(shareFile(clip(), 'Clip', nav)).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({
      files: [expect.any(File)],
      title: 'Clip',
    })
  })

  it('reports a dismissal without calling it a failure', async () => {
    const nav = fakeNavigator(() => true, () =>
      Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })),
    )
    await expect(shareFile(clip(), 'Clip', nav)).resolves.toBe('dismissed')
  })

  it('never throws at the call site', async () => {
    const nav = fakeNavigator(() => true, () => Promise.reject(new Error('x')))
    await expect(shareFile(clip(), 'Clip', nav)).resolves.toBe('failed')
    await expect(shareFile(clip(), 'Clip', undefined)).resolves.toBe('failed')
  })
})
