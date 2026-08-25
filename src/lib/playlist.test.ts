import { describe, expect, it } from 'vitest'
import {
  extractPlaylistItems,
  parseYouTubePlaylistId,
} from './playlist'

describe('parseYouTubePlaylistId', () => {
  it('reads a plain playlist URL', () => {
    expect(
      parseYouTubePlaylistId('https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'),
    ).toBe('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf')
  })

  it('reads a watch URL carrying a list parameter', () => {
    expect(
      parseYouTubePlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'),
    ).toBe('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf')
  })

  it('accepts music and bare-host forms', () => {
    expect(
      parseYouTubePlaylistId('https://music.youtube.com/playlist?list=OLAK5uy_kMikEl85Vh7ecHfFbYy-urUifuZl8Mq'),
    ).toBe('OLAK5uy_kMikEl85Vh7ecHfFbYy-urUifuZl8Mq')
  })

  it('refuses radio mixes, which are generated, not curated', () => {
    expect(
      parseYouTubePlaylistId('https://www.youtube.com/watch?v=x&list=RDx'),
    ).toBeNull()
  })

  it('refuses non-YouTube hosts and playlist-less links', () => {
    expect(parseYouTubePlaylistId('https://youtu.be/dQw4w9WgXcQ')).toBeNull()
    expect(
      parseYouTubePlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    ).toBeNull()
    expect(parseYouTubePlaylistId('not a url')).toBeNull()
  })
})

/** Two renderers with realistic nested objects (thumbnail sets) between the
 * videoId and the title, plus a sidebar entry that must NOT become an item. */
const PAGE = JSON.stringify({
  contents: [
    { playlistVideoRenderer: { videoId: 'aaaaaaaaaaa', thumbnail: { thumbnails: [{}] }, title: { runs: [{ text: 'First & real' }] } } },
    { playlistVideoRenderer: { videoId: 'bbbbbbbbbbb', thumbnail: {}, title: { runs: [{ text: 'Second \"quoted\" \\ backslash' }] } } },
    { compactVideoRenderer: { videoId: 'ccccccccccc', title: { runs: [{ text: 'Sidebar suggestion' }] } } },
    { playlistVideoRenderer: { videoId: 'aaaaaaaaaaa', title: { runs: [{ text: 'Duplicate' }] } } },
  ],
})

describe('extractPlaylistItems', () => {
  it('pairs ids with titles in order and dedupes', () => {
    const items = extractPlaylistItems(PAGE)
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
      title: 'First & real',
    })
    // JSON escapes decode through JSON.parse — quotes and backslashes survive.
    expect(items[1].title).toBe('Second "quoted" \\ backslash')
  })

  it('falls back to a bare id sweep when no renderer pairs exist', () => {
    const html = '"other":{"videoId":"ddddddddddd"},"later":{"videoId":"eeeeeeeeeee"}'
    const items = extractPlaylistItems(html)
    expect(items.map((i) => i.url)).toEqual([
      'https://www.youtube.com/watch?v=ddddddddddd',
      'https://www.youtube.com/watch?v=eeeeeeeeeee',
    ])
    expect(items[0].title).toBeUndefined()
  })

  it('caps the result at the import limit', () => {
    const html = Array.from({ length: 80 }, (_, i) => {
      const id = String(i).padStart(11, 'a').replace(/a/g, (c) => c)
      return `"playlistVideoRenderer":{"videoId":"${id.slice(0, 11)}","title":{"runs":[{"text":"t"}]}`
    }).join(',')
    void html
    const manyIds = Array.from({ length: 120 }, (_, i) => `"videoId":"id${String(i).padStart(9, '0')}"`).join(',')
    expect(extractPlaylistItems(manyIds)).toHaveLength(50)
  })

  it('returns nothing for a page without videos', () => {
    expect(extractPlaylistItems('<html><body>error</body></html>')).toEqual([])
  })
})
