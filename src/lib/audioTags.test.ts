import { describe, expect, it } from 'vitest'
import { audioTagsFor } from './audioTags'
import type { VideoMetadata } from './appReducer'

const post = (extra: Partial<VideoMetadata> = {}): VideoMetadata => ({
  title: 'Sunset from the roof',
  author: 'someone',
  duration: 30,
  thumbnail: '',
  ...extra,
})

describe('tagging an extracted MP3', () => {
  /**
   * Without a named track there is only the post, and its own title and
   * uploader are the honest answer.
   */
  it('falls back to the post itself', () => {
    expect(audioTagsFor(post(), 'https://example.com/p/1')).toEqual({
      title: 'Sunset from the roof',
      artist: 'someone',
      sourceUrl: 'https://example.com/p/1',
    })
  })

  /**
   * The distinction the whole function exists for: a platform that names the
   * sound a clip was made with is naming the song being extracted — the caption
   * above it is not the track's title.
   */
  it('lets a named track outrank the caption', () => {
    const tags = audioTagsFor(
      post({ musicTitle: 'Nightcall', musicAuthor: 'Kavinsky' }),
    )
    expect(tags.title).toBe('Nightcall')
    expect(tags.artist).toBe('Kavinsky')
    // Where it came from, without pretending to be the song's name.
    expect(tags.album).toBe('Sunset from the roof')
  })

  it('credits the uploader when the track has no artist of its own', () => {
    const tags = audioTagsFor(post({ musicTitle: 'original sound' }))
    expect(tags.artist).toBe('someone')
  })

  /** No album without a track: an invented one sorts a library into nonsense. */
  it('leaves the album out of an ordinary post', () => {
    expect(audioTagsFor(post()).album).toBeUndefined()
  })

  it('treats blank fields as absent', () => {
    const tags = audioTagsFor(
      post({ title: '  ', author: '', musicTitle: '   ' }),
      '',
    )
    expect(tags).toEqual({
      title: undefined,
      artist: undefined,
      sourceUrl: undefined,
    })
  })

  it('says nothing at all without a result', () => {
    expect(audioTagsFor(null)).toEqual({})
    expect(audioTagsFor(undefined, 'https://example.com')).toEqual({})
  })
})
