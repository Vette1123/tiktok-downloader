import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILENAME_TEMPLATE,
  FILENAME_TEMPLATE_PRESETS,
  buildDownloadFilename,
  formatBytes,
  isFilenameTemplate,
  slugify,
  unknownFilenameTokens,
} from './filename'
import { normalisePrefs } from './prefsCore'

const AT = new Date(2026, 5, 8, 14, 30, 52)
const POST = {
  platform: 'instagram',
  author: 'nasagoddard',
  title: 'Ancient space rocks',
  date: AT,
}

describe('the built-in name', () => {
  it('leads with a timestamp so a folder sorts in download order', () => {
    expect(buildDownloadFilename({ ...POST, ext: 'mp4' })).toBe(
      '2026-06-08_143052_instagram_nasagoddard_ancient-space-rocks.mp4',
    )
  })

  /**
   * The stamp used to stop at minutes, so two files saved in the same minute
   * fell back to sorting by platform, then author, then title — and a clip
   * grabbed later could land above one grabbed first. That is the "why is this
   * one in a weird position" report.
   */
  it('separates two saves made in the same minute', () => {
    const first = buildDownloadFilename({
      ...POST,
      title: 'zebra',
      ext: 'mp4',
      date: new Date(2026, 5, 8, 14, 30, 10),
    })
    const second = buildDownloadFilename({
      ...POST,
      title: 'apple',
      ext: 'mp4',
      date: new Date(2026, 5, 8, 14, 30, 40),
    })
    expect([second, first].sort()).toEqual([first, second])
  })

  it('pads a carousel index so ten slides sort after nine', () => {
    const names = [9, 10].map((index) =>
      buildDownloadFilename({ ...POST, ext: 'jpg', index, total: 12 }),
    )
    expect(names[0].endsWith('_09.jpg')).toBe(true)
    expect([...names].sort()).toEqual(names)
  })

  it('drops parts the post does not have', () => {
    expect(
      buildDownloadFilename({ title: 'just a title', ext: 'mp3', date: AT }),
    ).toBe('2026-06-08_143052_just-a-title.mp3')
  })
})

describe('a supporter’s template', () => {
  it('is what the built-in shape already was', () => {
    expect(
      buildDownloadFilename({
        ...POST,
        ext: 'mp4',
        template: DEFAULT_FILENAME_TEMPLATE,
      }),
    ).toBe(buildDownloadFilename({ ...POST, ext: 'mp4' }))
  })

  it('rearranges the parts', () => {
    expect(
      buildDownloadFilename({
        ...POST,
        ext: 'mp4',
        template: '{author} - {title}',
      }),
    ).toBe('nasagoddard - ancient-space-rocks.mp4')
  })

  /** An absent value takes its own separator with it. */
  it('does not leave a dangling separator where a part was missing', () => {
    expect(
      buildDownloadFilename({
        title: 'orphan',
        ext: 'mp4',
        date: AT,
        template: '{author} - {title}',
      }),
    ).toBe('orphan.mp4')
    expect(
      buildDownloadFilename({
        ...POST,
        platform: undefined,
        ext: 'mp4',
        template: '{platform}_{author}_{title}',
      }),
    ).toBe('nasagoddard_ancient-space-rocks.mp4')
  })

  /**
   * Every preset has to survive a post with nothing on it, or a supporter
   * picks one and their next anonymous download saves as ".mp4".
   */
  it.each(FILENAME_TEMPLATE_PRESETS)(
    'gives the preset "$label" a usable name for a bare post',
    ({ template }) => {
      const name = buildDownloadFilename({ ext: 'mp4', date: AT, template })
      expect(name).not.toBe('.mp4')
      expect(name.endsWith('.mp4')).toBe(true)
    },
  )

  /**
   * The extension is never the template's to choose. Naming an MP4 `.jpg` is
   * the failure lessons/2026-09-06-the-tunnel-that-served-a-jpeg.md is about;
   * a settable {ext} would be the same thing, self-inflicted.
   */
  it('cannot set the extension', () => {
    expect(isFilenameTemplate('{title}.{ext}')).toBe(false)
    expect(
      buildDownloadFilename({
        ...POST,
        ext: 'mp4',
        template: '{title}.{ext}',
      }),
    ).toBe('2026-06-08_143052_instagram_nasagoddard_ancient-space-rocks.mp4')
  })

  /**
   * A carousel keeps its position whatever the template says, or twenty slides
   * overwrite one another in the downloads folder.
   */
  it('adds the index a template forgot', () => {
    expect(
      buildDownloadFilename({
        ...POST,
        ext: 'jpg',
        index: 3,
        total: 12,
        template: '{title}',
      }),
    ).toBe('ancient-space-rocks_03.jpg')
  })

  it('honours an index the template placed itself', () => {
    expect(
      buildDownloadFilename({
        ...POST,
        ext: 'jpg',
        index: 3,
        total: 12,
        template: '{index}-{title}',
      }),
    ).toBe('03-ancient-space-rocks.jpg')
  })

  /**
   * This value ends up in a `download` attribute, so a traversal in it is a
   * real hazard rather than a cosmetic one.
   */
  it('cannot escape the downloads folder', () => {
    const name = buildDownloadFilename({
      ...POST,
      ext: 'mp4',
      template: '../../{title}',
    })
    expect(name).not.toContain('/')
    expect(name).not.toContain('\\')
    expect(name.startsWith('.')).toBe(false)
  })

  it('falls back to the built-in shape when every part is empty', () => {
    expect(
      buildDownloadFilename({ ext: 'mp4', date: AT, template: '{title}' }),
    ).toBe('2026-06-08_143052.mp4')
  })
})

describe('validating a template', () => {
  it('accepts every preset', () => {
    for (const preset of FILENAME_TEMPLATE_PRESETS) {
      expect(isFilenameTemplate(preset.template)).toBe(true)
    }
  })

  it('refuses a template with no placeholder in it', () => {
    // Every file in a carousel would be handed the same constant name.
    expect(isFilenameTemplate('my-downloads')).toBe(false)
    expect(isFilenameTemplate('')).toBe(false)
    expect(isFilenameTemplate('   ')).toBe(false)
  })

  it('refuses a typo rather than baking it into every filename', () => {
    expect(isFilenameTemplate('{titel}')).toBe(false)
    expect(unknownFilenameTokens('{titel}_{author}')).toEqual(['titel'])
    expect(unknownFilenameTokens(DEFAULT_FILENAME_TEMPLATE)).toEqual([])
  })

  it('refuses anything that is not a string, or is absurdly long', () => {
    expect(isFilenameTemplate(null)).toBe(false)
    expect(isFilenameTemplate(42)).toBe(false)
    expect(isFilenameTemplate(`{title}${'x'.repeat(200)}`)).toBe(false)
  })

  /**
   * Storage and the builder must agree: a template the builder would ignore
   * must never reach the account, or the preferences screen would show a
   * setting that does nothing.
   */
  it('is the same predicate the stored preferences use', () => {
    expect(
      normalisePrefs({ quality: 'hd', format: 'video', filenameTemplate: '{titel}' })
        ?.filenameTemplate,
    ).toBeUndefined()
    expect(
      normalisePrefs({
        quality: 'hd',
        format: 'video',
        filenameTemplate: '  {author} - {title}  ',
      })?.filenameTemplate,
    ).toBe('{author} - {title}')
  })

  /** A bad template must not take quality and format down with it. */
  it('never poisons the rest of the preferences', () => {
    expect(
      normalisePrefs({ quality: 'sd', format: 'audio', filenameTemplate: 12 }),
    ).toEqual({ quality: 'sd', format: 'audio' })
  })
})

describe('slugify', () => {
  it('strips diacritics and punctuation', () => {
    expect(slugify('Café — “Déjà vu”!')).toBe('cafe-deja-vu')
  })

  it('does not cut a word in half when truncating', () => {
    expect(slugify('ancient space rocks and what they told us', 20)).toBe(
      'ancient-space-rocks',
    )
  })
})

describe('formatBytes', () => {
  it('reads the way a file browser does', () => {
    expect(formatBytes(12_345_678)).toBe('12.3 MB')
    expect(formatBytes(870_000)).toBe('870 KB')
    expect(formatBytes(1_500_000_000)).toBe('1.5 GB')
    expect(formatBytes(512)).toBe('512 B')
  })

  /** One decimal below 100, none above: "947.3 MB" is noise. */
  it('drops the decimal once it stops carrying information', () => {
    expect(formatBytes(947_300_000)).toBe('947 MB')
    expect(formatBytes(9_400_000)).toBe('9.4 MB')
  })

  /** Nothing at all beats "0 B" or "NaN MB" on the card. */
  it('says nothing rather than something wrong', () => {
    expect(formatBytes(undefined)).toBe('')
    expect(formatBytes(0)).toBe('')
    expect(formatBytes(-5)).toBe('')
    expect(formatBytes(Number.NaN)).toBe('')
  })
})
