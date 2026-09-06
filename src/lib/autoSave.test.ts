import { describe, expect, it } from 'vitest'
import { autoSaveTarget } from './autoSave'
import { normalisePrefs } from './prefsCore'

const BASE = {
  format: 'video' as const,
  hasVideo: true,
  hasAudio: true,
  isGallery: false,
}

describe('what auto-save saves', () => {
  it('takes the video on an ordinary result', () => {
    expect(autoSaveTarget(BASE)).toBe('video')
  })

  it('takes the MP3 when the visitor asked for MP3s', () => {
    expect(autoSaveTarget({ ...BASE, format: 'audio' })).toBe('audio')
  })

  /**
   * A YouTube link that cannot be extracted still resolves with its audio
   * track and an embed. The MP3 is then the only file on the card, so this is
   * the case the fallback exists for, not an edge one.
   */
  it('takes the MP3 when there is no video to take', () => {
    expect(autoSaveTarget({ ...BASE, hasVideo: false })).toBe('audio')
  })

  /**
   * A carousel is a set with a selection to make. Auto-firing twenty downloads
   * is not "less standing over it"; it is a mess to clean up.
   */
  it('leaves a gallery alone', () => {
    expect(autoSaveTarget({ ...BASE, isGallery: true })).toBeNull()
    expect(
      autoSaveTarget({ ...BASE, isGallery: true, format: 'audio' }),
    ).toBeNull()
  })

  it('does nothing when the result carries no file at all', () => {
    expect(
      autoSaveTarget({ ...BASE, hasVideo: false, hasAudio: false }),
    ).toBeNull()
  })

  /** Audio mode does not quietly fall back to a video download. */
  it('does not hand a video to somebody who asked for audio', () => {
    expect(
      autoSaveTarget({ ...BASE, format: 'audio', hasAudio: false }),
    ).toBeNull()
  })
})

describe('storing the preference', () => {
  it('keeps a true', () => {
    expect(
      normalisePrefs({ quality: 'hd', format: 'video', autoSave: true })
        ?.autoSave,
    ).toBe(true)
  })

  /**
   * Off is an absent key, never a stored `false` — so somebody who has never
   * seen the toggle and somebody who turned it back off are the same state,
   * and the stored object keeps the shape it has always had.
   */
  it.each([false, 'true', 1, null, undefined])(
    'stores nothing for %p',
    (value) => {
      const prefs = normalisePrefs({
        quality: 'hd',
        format: 'video',
        autoSave: value,
      })
      expect(prefs?.autoSave).toBeUndefined()
      expect('autoSave' in (prefs ?? {})).toBe(false)
    },
  )

  /** A junk value must not take quality and format down with it. */
  it('never poisons the rest of the preferences', () => {
    expect(normalisePrefs({ quality: 'sd', format: 'audio', autoSave: 'yes' })).toEqual(
      { quality: 'sd', format: 'audio' },
    )
  })
})
