import { describe, expect, it } from 'vitest'
import {
  appReducer,
  autoOpensPreview,
  initialState,
  isResolvingOrDownloading,
  isSuccessMessage,
  retryTarget,
  type ImageData,
} from './appReducer'

const base = {
  platform: 'tiktok' as const,
  hasVideo: true,
  hasEmbed: false,
  isCarousel: false,
}

describe('autoOpensPreview', () => {
  it('opens for a known platform with a downloadable video', () => {
    expect(autoOpensPreview(base)).toBe(true)
  })

  it('opens for a generic link the server verified as media', () => {
    // The server only returns a generic downloadUrl after confirming it serves
    // a file and not a web page, so by this point "is it really video" is
    // answered — staying shut would cost every long-tail site a click.
    expect(autoOpensPreview({ ...base, platform: 'generic' })).toBe(true)
  })

  it('stays shut when the platform is missing', () => {
    expect(autoOpensPreview({ ...base, platform: undefined })).toBe(false)
  })

  it('stays shut for an embed, which would load the third-party player', () => {
    expect(
      autoOpensPreview({ ...base, platform: 'youtube', hasEmbed: true }),
    ).toBe(false)
  })

  it('stays shut for a carousel, which has no video to preview', () => {
    expect(autoOpensPreview({ ...base, isCarousel: true })).toBe(false)
  })

  it('stays shut when there is nothing to play', () => {
    expect(autoOpensPreview({ ...base, hasVideo: false })).toBe(false)
  })

  it('keeps unknown payload shapes shut even when every other signal says open', () => {
    // Guards the ordering: `undefined` (an older/foreign result shape) must
    // not be rescued by hasVideo.
    expect(
      autoOpensPreview({
        platform: undefined,
        hasVideo: true,
        hasEmbed: false,
        isCarousel: false,
      }),
    ).toBe(false)
  })
})

/**
 * Two things read this: the status banner picks green or red, and the
 * post-download Pro nudge only appears after something actually saved. A false
 * positive shows a paying-customer pitch under a failure message.
 */
describe('isSuccessMessage', () => {
  it.each([
    'Video downloaded successfully! 🎉',
    'Download started. Check your downloads. 🎉',
    'Slideshow video rendered and downloaded! 🎬',
    'Audio extracted 🎵',
    '3 image(s) downloaded individually! 🖼️',
    'Saved 2 of 3 links to Recent — tap any to download. 🎉',
  ])('reads %s as a win', (message) => {
    expect(isSuccessMessage(message)).toBe(true)
  })

  it.each([
    'Failed to download video file',
    'Couldn’t resolve any of those 3 links. Check they’re public post URLs and try again.',
    'Preparing your download…',
    'Rendering slideshow video... this takes ~30 seconds.',
    '',
  ])('reads %s as not a win', (message) => {
    expect(isSuccessMessage(message)).toBe(false)
  })
})

/**
 * The banner's second gate. `isSuccessMessage` alone cannot tell a failure
 * from a running commentary — "Preparing your download…" is not a win either —
 * so the retry offer also asks whether anything is still in flight. Without
 * this, every transfer in progress renders a button offering to restart it.
 */
describe('isResolvingOrDownloading', () => {
  const idle = {
    loading: false,
    downloading: false,
    downloadingAudio: false,
    downloadingImages: false,
  }

  it('is false only when nothing at all is running', () => {
    expect(isResolvingOrDownloading(idle)).toBe(false)
  })

  it.each([
    'loading',
    'downloading',
    'downloadingAudio',
    'downloadingImages',
  ] as const)('is true while %s is set', (flag) => {
    expect(isResolvingOrDownloading({ ...idle, [flag]: true })).toBe(true)
  })

  it('suppresses the retry offer under an in-flight message', () => {
    const message = 'Preparing your download…'
    const state = { ...idle, downloading: true }
    // Exactly the banner's condition: not a win, but not a result either.
    expect(isSuccessMessage(message)).toBe(false)
    expect(!isSuccessMessage(message) && !isResolvingOrDownloading(state)).toBe(false)
  })

  it('offers the retry once a failure has settled', () => {
    const message = 'Failed to download video file'
    expect(!isSuccessMessage(message) && !isResolvingOrDownloading(idle)).toBe(true)
  })
})

/**
 * The gallery opens by itself for a post that has one, and it used to open with
 * nothing ticked — so its own action read "Download selected (0)", disabled,
 * and the panel did nothing until the visitor found the "All" button.
 */
describe('a resolved carousel', () => {
  const resolved = (images: ImageData[]) =>
    appReducer(initialState, {
      type: 'SET_DOWNLOAD_SUCCESS',
      payload: {
        downloadUrl: '',
        audioUrl: '',
        originalUrl: 'https://www.instagram.com/p/x/',
        metadata: {
          title: 't',
          author: 'a',
          duration: 0,
          thumbnail: '',
          images,
        },
      },
    })

  it('arrives with every slide selected', () => {
    const state = resolved([
      { id: '1', url: 'a.jpg', thumbnail: 'a.jpg', selected: false },
      { id: '2', url: 'b.mp4', thumbnail: 'b.jpg', selected: false, kind: 'video' },
    ])
    expect(state.videoMetadata?.images?.every((i) => i.selected)).toBe(true)
    expect(state.showImageGallery).toBe(true)
  })

  it('carries the kind through so the gallery knows what each slide is', () => {
    const state = resolved([
      { id: '1', url: 'a.jpg', thumbnail: 'a.jpg', selected: false },
      { id: '2', url: 'b.mp4', thumbnail: 'b.jpg', selected: false, kind: 'video' },
    ])
    expect(state.videoMetadata?.images?.map((i) => i.kind)).toEqual([
      undefined,
      'video',
    ])
  })

  it('leaves a plain video result alone', () => {
    const state = resolved([])
    expect(state.showImageGallery).toBe(false)
  })
})

describe('what a retry re-runs', () => {
  /**
   * The bug this exists for. `RESET_DOWNLOAD_STATE` clears `originalUrl` at the
   * start of every attempt, so a resolve that failed leaves it empty — and the
   * banner's retry button, whose entire reason for existing is a failed
   * resolve, was gated on it and therefore never rendered.
   */
  it('falls back to the attempted link when the resolve failed', () => {
    expect(retryTarget({ originalUrl: '', url: 'https://x.com/i/status/1' }))
      .toBe('https://x.com/i/status/1')
  })

  /**
   * After a *download* failure there is a result on screen, and re-resolving
   * its link is what gets fresh URLs for an expired tunnel — so the result's
   * own link wins over whatever is left in the field.
   */
  it('prefers the resolved link when there is one', () => {
    expect(retryTarget({ originalUrl: 'https://a.test/p/1', url: 'typing…' }))
      .toBe('https://a.test/p/1')
  })

  it('offers nothing to retry when there is nothing', () => {
    expect(retryTarget({ originalUrl: '', url: '' })).toBe('')
    expect(retryTarget({ originalUrl: '', url: '   ' })).toBe('')
  })
})
