import { describe, expect, it } from 'vitest'
import {
  detectImportSource,
  parseRedditListing,
  parseRssItems,
} from './importSources'

describe('detectImportSource', () => {
  it('keeps YouTube playlists and rejects bare watch links', () => {
    expect(detectImportSource('https://www.youtube.com/playlist?list=PLabc123456789')).toEqual({
      kind: 'youtube',
      listId: 'PLabc123456789',
    })
    expect(detectImportSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })

  it('builds the reddit feed URL for a subreddit, honouring a sort', () => {
    expect(detectImportSource('reddit.com/r/EarthPorn/top')).toEqual({
      kind: 'reddit',
      feedUrl: 'https://www.reddit.com/r/EarthPorn/top.json?t=all&limit=50',
    })
    expect(
      detectImportSource('https://www.reddit.com/user/somebody/')?.kind,
    ).toBe('reddit')
  })

  it('refuses reddit pages that are not collections', () => {
    expect(
      detectImportSource('https://www.reddit.com/r/EarthPorn/comments/abc/post_title/'),
    ).toBeNull()
    expect(detectImportSource('https://www.reddit.com/search?q=x')).toBeNull()
  })

  it('maps a pinterest board to its rss feed', () => {
    expect(
      detectImportSource('https://www.pinterest.com/somebody/inspo/'),
    ).toEqual({
      kind: 'pinterest',
      feedUrl: 'https://www.pinterest.com/somebody/inspo.rss',
    })
    expect(detectImportSource('https://www.pinterest.com/somebody/')).toBeNull()
  })

  it('maps vimeo channels and users to their video feeds', () => {
    expect(detectImportSource('https://vimeo.com/channels/staffpicks')).toEqual({
      kind: 'vimeo',
      feedUrl: 'https://vimeo.com/channels/staffpicks/videos/rss',
    })
    expect(detectImportSource('https://vimeo.com/user123456')).toEqual({
      kind: 'vimeo',
      feedUrl: 'https://vimeo.com/user123456/videos/rss',
    })
    // An explicit feed link passes through; site chrome does not.
    expect(detectImportSource('https://vimeo.com/user123456/videos/rss')?.kind).toBe('vimeo')
    expect(detectImportSource('https://vimeo.com/blog')).toBeNull()
  })

  it('returns null for non-source hosts', () => {
    expect(detectImportSource('https://example.com/collection')).toBeNull()
    expect(detectImportSource('not a url')).toBeNull()
  })

  /**
   * The Pinterest and Vimeo branches build their feed URL from the pasted
   * link's own origin, and the server then fetches it. A suffix test would
   * accept any registrable domain ending in those letters, which would make
   * this endpoint fetch arbitrary hosts on our IP. `pinterest` and `vimeo`
   * have to be whole labels.
   */
  it('refuses lookalike domains that merely end in a source name', () => {
    expect(detectImportSource('https://myvimeo.com/channels/x')).toBeNull()
    expect(detectImportSource('https://notpinterest.com/user/board/')).toBeNull()
    expect(detectImportSource('https://evil-youtube.com/playlist?list=PL0123456789ab')).toBeNull()
    expect(detectImportSource('https://fakereddit.com/r/videos')).toBeNull()
    // …and a hostname that merely starts with the real one is not it either.
    expect(detectImportSource('https://pinterest.com.evil.test/u/b/')).toBeNull()
    expect(detectImportSource('https://vimeo.com.evil.test/channels/x')).toBeNull()
  })

  it('still accepts the real hosts, subdomains and country domains', () => {
    expect(detectImportSource('https://vimeo.com/channels/staffpicks')?.kind).toBe('vimeo')
    expect(detectImportSource('https://player.vimeo.com/videos/rss')?.kind).toBe('vimeo')
    expect(detectImportSource('https://www.pinterest.com/user/board/')?.kind).toBe('pinterest')
    expect(detectImportSource('https://pinterest.co.uk/user/board/')?.kind).toBe('pinterest')
    expect(detectImportSource('https://uk.pinterest.com/user/board/')?.kind).toBe('pinterest')
  })
})

const LISTING = JSON.stringify({
  data: {
    children: [
      { data: { stickied: true, title: '[Mod] rules', permalink: '/r/x/comments/pin/' } },
      { data: { is_video: true, title: 'A clip', permalink: '/r/x/comments/aaa/clip/' } },
      { data: { post_hint: 'image', title: 'A pic & more', permalink: '/r/x/comments/bbb/pic/' } },
      { data: { title: 'Text only', permalink: '/r/x/comments/ccc/text/' } },
    ],
  },
})

describe('parseRedditListing', () => {
  it('keeps media posts newest-first shape, drops pins and text posts', () => {
    const items = parseRedditListing(LISTING)
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      url: 'https://www.reddit.com/r/x/comments/aaa/clip/',
      title: 'A clip',
    })
    expect(items[1].title).toBe('A pic & more')
  })

  it('caps and tolerates garbage', () => {
    expect(parseRedditListing('not json')).toEqual([])
    const many = Array.from({ length: 70 }, (_, i) => ({
      data: { is_video: true, title: `t${i}`, permalink: `/r/x/comments/${i}/t/` },
    }))
    expect(parseRedditListing(JSON.stringify({ data: { children: many } }))).toHaveLength(50)
  })
})

const RSS = `<?xml version="1.0"?>
<rss><channel>
<item><title><![CDATA[Pin & one]]></title><link><![CDATA[https://www.pinterest.com/pin/111/]]></link></item>
<item><title>Pin two</title><link>https://www.pinterest.com/pin/222/</link></item>
<item><title>Off-site</title><link>https://external.example/page</link></item>
</channel></rss>`

describe('parseRssItems', () => {
  it('reads CDATA and plain links, decoding entities', () => {
    const items = parseRssItems(RSS, { linkMustInclude: 'pinterest.com' })
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      url: 'https://www.pinterest.com/pin/111/',
      title: 'Pin & one',
    })
  })

  it('returns empty without items or a host filter mismatch', () => {
    expect(parseRssItems('<html>nope</html>', { linkMustInclude: 'pinterest.com' })).toEqual([])
    expect(parseRssItems(RSS, { linkMustInclude: 'vimeo.com' })).toEqual([])
  })
})

/**
 * Two shapes that look like a collection and are a single post.
 *
 * Found by reusing `detectImportSource` to tell a visitor "that link is a whole
 * board, not one post" — it said that about a pin, and about a Vimeo video.
 * Both had been building feed URLs that could never resolve (`/pin/<id>.rss`,
 * `/76979871/videos/rss`), so the importer reported an empty collection for
 * something that was a perfectly good single video.
 */
describe('posts that look like collections', () => {
  it('does not read a pinterest pin as a board', () => {
    expect(
      detectImportSource('https://www.pinterest.com/pin/214343263495052387/'),
    ).toBeNull()
  })

  it('does not read a vimeo video id as a username', () => {
    expect(detectImportSource('https://vimeo.com/76979871')).toBeNull()
    // A username that merely contains digits is still a username.
    expect(detectImportSource('https://vimeo.com/user123456')?.kind).toBe('vimeo')
  })
})
