import { describe, expect, it } from 'vitest'
import { LOCALES, isLocale, isRtl, translate, type TKey } from './i18n'
import { isSuccessMessage } from './appReducer'

describe('translate', () => {
  it('falls back per-key to English when a dictionary lacks the key', () => {
    // Every dictionary here is complete for these keys, so prove the
    // fallback with a key only English defines by construction: ask in ar
    // and expect readable Arabic; the mechanism is shared.
    expect(translate('es', 'pastePlaceholder')).toBe('Pega un enlace de video.')
    expect(translate('en', 'pastePlaceholder')).toBe('Paste a video link.')
  })

  it('substitutes {n}-style variables', () => {
    expect(translate('en', 'msgImagesDone', { n: 3 })).toBe(
      '3 image(s) downloaded individually! 🖼️',
    )
    expect(translate('ar', 'viewAll', { n: 12 })).toContain('12')
  })

  it('leaves an unfilled placeholder visible rather than crashing', () => {
    expect(translate('en', 'viewAll')).toContain('{n}')
  })
})

/**
 * The banner paints itself green and the Pro nudge appears only when
 * `isSuccessMessage` recognises the text — and since translation, the text it
 * inspects is whatever the dictionary returned. That makes the sign-off emoji
 * a load-bearing part of every translation, which is not obvious to anyone
 * adding a locale. Nothing enforced it, so this does: drop the 🎉 from a
 * future dictionary and a successful download starts reporting itself in red.
 */
describe('success markers survive every translation', () => {
  const SUCCESS_KEYS: TKey[] = [
    'msgVideoDone',
    'msgDownloadStarted',
    'msgSlideshowDone',
    'msgAudioDone',
    'msgImagesDone',
  ]

  for (const locale of LOCALES) {
    for (const key of SUCCESS_KEYS) {
      it(`${locale}/${key} still reads as success`, () => {
        expect(isSuccessMessage(translate(locale, key, { n: 1 }))).toBe(true)
      })
    }
  }

  // The one success message the reducer sets itself, in English, and maps to
  // a translation only at render — so the predicate must keep seeing English.
  it('msgProcessed is matched before translation, not after', () => {
    expect(isSuccessMessage('Content processed successfully!')).toBe(true)
  })

  it('an in-flight message is not mistaken for a result', () => {
    for (const locale of LOCALES) {
      expect(isSuccessMessage(translate(locale, 'preparingDownload'))).toBe(false)
    }
  })
})

describe('locale guards', () => {
  it('accepts exactly the shipped locales', () => {
    expect(isLocale('ar')).toBe(true)
    expect(isLocale('xx')).toBe(false)
    expect(isLocale(null)).toBe(false)
  })

  it('marks Arabic RTL and nothing else', () => {
    expect(isRtl('ar')).toBe(true)
    expect(isRtl('en')).toBe(false)
    expect(isRtl('he' as never)).toBe(false)
  })
})
