import { describe, expect, it } from 'vitest'
import { isVideoShapedLink, worthCaching } from './cacheWorthy'

const REEL = 'https://www.instagram.com/reel/DKcalTzoftf/'
const POST = 'https://www.instagram.com/p/CmUv48DLvxd/'

describe('links that can only be a video', () => {
  it.each([
    'https://www.instagram.com/reel/DKcalTzoftf/',
    'https://www.instagram.com/reels/DKcalTzoftf/',
    'https://www.instagram.com/nasa/tv/ABC123/',
    'https://www.tiktok.com/@scout2015/video/6718335390845095173',
    'https://www.facebook.com/reel/1536569814605331/',
    'https://www.facebook.com/nasa/videos/123456/',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/abc123',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://clips.twitch.tv/IncredulousAbstemiousFennelImGlitch',
    'https://vimeo.com/76979871',
  ])('recognises %s', (url) => {
    expect(isVideoShapedLink(url)).toBe(true)
  })

  /**
   * A missing pattern costs nothing (the link caches as before); a wrong one
   * disables caching for a whole platform and does it invisibly. So the ones
   * that could go either way must not be claimed.
   */
  it.each([
    'https://www.instagram.com/p/CmUv48DLvxd/',
    'https://x.com/NASA/status/2094078415376658588',
    'https://www.pinterest.com/pin/214343263495052387/',
    'https://www.reddit.com/r/oddlysatisfying/comments/1vhp8n5/x/',
    'https://example.com/some/video/page',
  ])('does not claim %s', (url) => {
    expect(isVideoShapedLink(url)).toBe(false)
  })
})

describe('deciding whether to store an answer', () => {
  it('stores a reel that resolved to a stream', () => {
    expect(worthCaching(REEL, { downloadUrl: '/api/video?url=x' })).toBe(true)
  })

  /**
   * The bug. A rate-limited reel comes back `success: true` with the post's
   * cover image and no video — and that answer was then served to the next
   * seven callers. One unlucky resolve became minutes of everyone getting a
   * JPEG for a video link.
   */
  it('refuses a reel that resolved to nothing but a cover image', () => {
    expect(worthCaching(REEL, { metadata: {} })).toBe(false)
    expect(worthCaching(REEL, {})).toBe(false)
  })

  /**
   * YouTube answers with a playable embed and no stream every single time,
   * because Google refuses this host. That is stable, not a fluke, and it is
   * the most expensive resolve on the site — it must stay cacheable.
   */
  it('stores a YouTube link that could only produce an embed', () => {
    expect(
      worthCaching('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
        metadata: { embedUrl: 'https://www.youtube-nocookie.com/embed/x' },
      }),
    ).toBe(true)
  })

  /** An audio-mode resolve got what it came for. */
  it('stores a video link that produced only audio', () => {
    expect(worthCaching(REEL, { audioUrl: '/api/audio?url=x' })).toBe(true)
  })

  /**
   * A carousel of stills is the right answer for a `/p/` link, and there is
   * nothing to compare it against — so nothing changes for those.
   */
  it('stores anything for a link that does not name a video', () => {
    expect(worthCaching(POST, {})).toBe(true)
    expect(worthCaching(POST, { metadata: {} })).toBe(true)
  })
})
