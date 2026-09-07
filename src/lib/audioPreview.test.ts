import { describe, expect, it } from 'vitest'
import { audioPreviewLabel, shouldOfferAudioPreview } from './audioPreview'

const subject = (over: Partial<Parameters<typeof shouldOfferAudioPreview>[0]> = {}) => ({
  hasAudio: true,
  hasVideo: false,
  hasEmbed: false,
  isCarousel: false,
  imageCount: 0,
  ...over,
})

describe('when a result is worth a listen', () => {
  /**
   * The case the player never covered, and now the common one: YouTube video
   * is unobtainable from this host, so a YouTube link resolves to audio, and
   * picking MP3 anywhere lands in the same place.
   */
  it('offers one for an audio-only result', () => {
    expect(shouldOfferAudioPreview(subject())).toBe(true)
  })

  it('has nothing to offer without audio', () => {
    expect(shouldOfferAudioPreview(subject({ hasAudio: false }))).toBe(false)
  })

  /**
   * The rule: is there already something here that can be heard. A video
   * preview plays its own sound and an embed plays the original, so a second
   * player is noise in both cases.
   */
  it('stays out of the way of anything already audible', () => {
    expect(shouldOfferAudioPreview(subject({ hasVideo: true }))).toBe(false)
    expect(shouldOfferAudioPreview(subject({ hasEmbed: true }))).toBe(false)
  })

  /**
   * The exception the player was built for: a carousel's soundtrack is a
   * separate thing from its stills, so the gallery cannot stand in for it —
   * even alongside a video, which a slideshow result can also carry.
   */
  it('keeps the carousel soundtrack in every case', () => {
    expect(shouldOfferAudioPreview(subject({ isCarousel: true, imageCount: 8 })))
      .toBe(true)
    expect(
      shouldOfferAudioPreview(
        subject({ isCarousel: true, hasVideo: true, imageCount: 8 }),
      ),
    ).toBe(true)
  })

  /** A gallery that is not a carousel is still a set of files to pick from. */
  it('skips a plain gallery', () => {
    expect(shouldOfferAudioPreview(subject({ imageCount: 4 }))).toBe(false)
  })
})

describe('what to call the track', () => {
  /**
   * Same rule as the file's tags: when a platform names the sound a clip was
   * made with, that is the thing being listened to.
   */
  it('lets a named track outrank the caption', () => {
    expect(
      audioPreviewLabel({
        title: 'a video of my cat',
        author: 'someone',
        musicTitle: 'Nightcall',
        musicAuthor: 'Kavinsky',
      }),
    ).toEqual({ title: 'Nightcall', subtitle: 'Kavinsky' })
  })

  /** A carousel's own title describes the pictures, not the sound. */
  it('does not call a slideshow soundtrack by the post title', () => {
    expect(
      audioPreviewLabel({ title: 'my trip', isPhotoCarousel: true }),
    ).toEqual({ title: 'Slideshow soundtrack', subtitle: undefined })
  })

  it('falls back to the post for an ordinary audio result', () => {
    expect(audioPreviewLabel({ title: 'Some song', author: 'a channel' }))
      .toEqual({ title: 'Some song', subtitle: 'a channel' })
  })

  it('always has something to print', () => {
    expect(audioPreviewLabel(null).title).toBe('Audio track')
    expect(audioPreviewLabel({ title: '   ', author: '  ' })).toEqual({
      title: 'Audio track',
      subtitle: undefined,
    })
  })
})

/**
 * The extractors fill an unknown uploader with the literal 'Unknown'. Printing
 * it claims to name somebody and then does not; an absent byline says the same
 * thing without the pretence. Shared with the result card — see lib/byline.
 */
describe('an author nobody knows', () => {
  it('prints no byline instead of a credit to nobody', () => {
    expect(audioPreviewLabel({ title: 'A clip', author: 'Unknown' }).subtitle)
      .toBeUndefined()
    expect(
      audioPreviewLabel({ musicTitle: 'A sound', musicAuthor: 'unknown' })
        .subtitle,
    ).toBeUndefined()
  })

  it('still prints a real one', () => {
    expect(audioPreviewLabel({ title: 'A clip', author: 'Unknown Mortal Orchestra' })
      .subtitle).toBe('Unknown Mortal Orchestra')
  })
})

describe('not repeating the card heading', () => {
  /**
   * The fallback branch prints the post's title, and the player sits directly
   * under a heading that already says it. Repeating identifies nothing the
   * reader is missing, so the block names itself instead.
   */
  it('says what the block is rather than echoing', () => {
    expect(
      audioPreviewLabel({ title: 'Some song', author: 'a channel' }, 'Some song')
        .title,
    ).toBe('Preview')
  })

  it('keeps a title the card is not already showing', () => {
    expect(
      audioPreviewLabel({ title: 'Some song' }, 'A different heading').title,
    ).toBe('Some song')
  })

  /** A named track is never an echo — it is the thing the card does not say. */
  it('never touches a named track', () => {
    expect(
      audioPreviewLabel({ title: 'x', musicTitle: 'Nightcall' }, 'Nightcall')
        .title,
    ).toBe('Nightcall')
  })
})
