import { afterEach, describe, expect, it, vi } from 'vitest'
import { Downloader, firstResult, parseTwitchClipSlug } from './downloader'
import { detectPlatform, unwrapLoginWall } from './validator'

/**
 * The platforms that have no bespoke extractor upstream of them and used to be
 * Cobalt's job. The public instance now refuses most of them, so each of these
 * reads the platform's own embed surface instead — and each surface has one
 * detail that is easy to get wrong and impossible to notice without a test:
 * Twitch's unsigned URL 401s, reddit's muxed MP4s live in an attribute past the
 * generic scanner's window, Pinterest names renditions rather than listing
 * them, and Threads answers a browser with an empty app shell.
 *
 * Reached through casts because the methods are private; the alternative is
 * asserting on a re-implementation of the parsing rather than on what ships.
 */
type PrivateDownloader = {
  tryTwitchClip(url: string): Promise<VideoDataLike | null>
  tryRedditEmbed(url: string): Promise<VideoDataLike | null>
  tryPinterestPin(url: string): Promise<VideoDataLike | null>
  tryThreadsEmbed(url: string): Promise<VideoDataLike | null>
  tryVimeo(url: string): Promise<VideoDataLike | null>
  resolveRedirect(url: string): Promise<string>
  parseFacebookHtml(html: string, url: string): VideoDataLike | null
  downloadFacebook(url: string): Promise<VideoDataLike>
  tryFacebookPhoto(
    resolvedUrl: string,
    originalUrl: string,
  ): Promise<VideoDataLike | null>
}
interface VideoDataLike {
  title: string
  author: string
  duration: number
  thumbnail: string
  downloadUrl: string
  embedUrl?: string
  images?: Array<{ url: string }>
}

function priv(downloader: Downloader): PrivateDownloader {
  return downloader as unknown as PrivateDownloader
}

/** One canned response for every request, which is all any of these make. */
function stubFetch(body: unknown, init?: ResponseInit) {
  const json = typeof body === 'string' ? body : JSON.stringify(body)
  const headers = {
    'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  const spy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(json, { ...init, headers }),
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Twitch clip slug', () => {
  it('reads both link shapes', () => {
    expect(parseTwitchClipSlug('https://clips.twitch.tv/HappyPandaKappa-x1')).toBe(
      'HappyPandaKappa-x1',
    )
    expect(
      parseTwitchClipSlug('https://www.twitch.tv/someone/clip/HappyPandaKappa-x1'),
    ).toBe('HappyPandaKappa-x1')
  })

  /** A VOD is HLS, which this deployment cannot turn into a file. */
  it('refuses VODs and channels', () => {
    expect(parseTwitchClipSlug('https://www.twitch.tv/videos/40464143')).toBeNull()
    expect(parseTwitchClipSlug('https://www.twitch.tv/someone')).toBeNull()
  })
})

describe('the Twitch clip extractor', () => {
  const clip = {
    data: {
      clip: {
        title: 'caught lookin',
        durationSeconds: 9,
        thumbnailURL: 'https://clips-media.example/preview.jpg',
        broadcaster: { displayName: 'Streamer' },
        videoQualities: [
          { quality: '480', sourceURL: 'https://cdn.example/480.mp4' },
          { quality: '1080', sourceURL: 'https://cdn.example/1080.mp4' },
          { quality: '720', sourceURL: 'https://cdn.example/720.mp4' },
        ],
        playbackAccessToken: { signature: 'sig123', value: '{"a":1}' },
      },
    },
  }

  it('signs the highest rendition', async () => {
    stubFetch(clip)
    const result = await priv(new Downloader()).tryTwitchClip(
      'https://clips.twitch.tv/HappyPandaKappa-x1',
    )
    expect(result?.downloadUrl).toBe(
      `https://cdn.example/1080.mp4?sig=sig123&token=${encodeURIComponent('{"a":1}')}`,
    )
    expect(result?.author).toBe('Streamer')
    expect(result?.duration).toBe(9)
  })

  it('takes the smallest rendition in SD', async () => {
    stubFetch(clip)
    const result = await priv(new Downloader({ quality: 'sd' })).tryTwitchClip(
      'https://clips.twitch.tv/HappyPandaKappa-x1',
    )
    expect(result?.downloadUrl).toContain('480.mp4')
  })

  /** Without the token the URL answers 401, so a tokenless clip is no result. */
  it('returns null when no access token comes back', async () => {
    stubFetch({
      data: { clip: { ...clip.data.clip, playbackAccessToken: null } },
    })
    await expect(
      priv(new Downloader()).tryTwitchClip('https://clips.twitch.tv/x-1'),
    ).resolves.toBeNull()
  })
})

describe('the reddit embed extractor', () => {
  const packaged = {
    playbackMp4s: {
      duration: 16,
      permutations: [
        {
          source: {
            url: 'https://packaged-media.redd.it/abc/pb/m2-res_360p.mp4?s=sig',
            dimensions: { width: 288, height: 360 },
          },
        },
        {
          source: {
            url: 'https://packaged-media.redd.it/abc/pb/m2-res_1080p.mp4?s=sig',
            dimensions: { width: 864, height: 1080 },
          },
        },
      ],
    },
  }
  // The attribute is HTML-escaped and sits behind a lot of markup, exactly as
  // the live page ships it.
  const page = `<html><body>${'<div class="filler"></div>'.repeat(50)}<shreddit-player packaged-media-json="${JSON.stringify(
    packaged,
  ).replace(/"/g, '&quot;')}"></shreddit-player></body></html>`

  it('takes the tallest pre-muxed mp4', async () => {
    stubFetch(page)
    const result = await priv(new Downloader()).tryRedditEmbed(
      'https://www.reddit.com/r/oddlysatisfying/comments/1vhp8n5/taking_a_walk_in_the_rain/',
    )
    expect(result?.downloadUrl).toBe(
      'https://packaged-media.redd.it/abc/pb/m2-res_1080p.mp4?s=sig',
    )
    expect(result?.duration).toBe(16)
    expect(result?.author).toBe('r/oddlysatisfying')
    expect(result?.title).toBe('Taking a walk in the rain')
  })

  it('asks the embed host, not the post host', async () => {
    const spy = stubFetch(page)
    await priv(new Downloader()).tryRedditEmbed(
      'https://www.reddit.com/r/aww/comments/abc123/some_title/',
    )
    expect(String(spy.mock.calls[0][0])).toBe(
      'https://embed.reddit.com/r/aww/comments/abc123/',
    )
  })

  /** An image or text post carries no packaged media; that is not an error. */
  it('returns null for a post with no muxed mp4', async () => {
    stubFetch('<html><body>no media here</body></html>')
    await expect(
      priv(new Downloader()).tryRedditEmbed(
        'https://www.reddit.com/r/aww/comments/abc123/t/',
      ),
    ).resolves.toBeNull()
  })
})

describe('the Pinterest pin extractor', () => {
  it('prefers a video rendition, tallest first', async () => {
    stubFetch({
      data: [
        {
          grid_title: 'A clip',
          pinner: { username: 'someone' },
          images: { orig: { url: 'https://i.pinimg.example/orig.jpg' } },
          videos: {
            video_list: {
              V_HLSV4: { url: 'https://v.pinimg.example/hls.m3u8', height: 1080 },
              V_720P: { url: 'https://v.pinimg.example/720.mp4', height: 720 },
              V_480P: { url: 'https://v.pinimg.example/480.mp4', height: 480 },
            },
          },
        },
      ],
    })
    const result = await priv(new Downloader()).tryPinterestPin(
      'https://www.pinterest.com/pin/214343263495052387/',
    )
    // The manifest is taller than every file and must still lose: it is not
    // something this deployment can save.
    expect(result?.downloadUrl).toBe('https://v.pinimg.example/720.mp4')
    expect(result?.author).toBe('someone')
  })

  it('falls back to the image, so a photo pin is a gallery not a failure', async () => {
    stubFetch({
      data: {
        pins: [
          {
            description: 'Baked fusilli',
            images: {
              '236x': { url: 'https://i.pinimg.example/236.jpg', height: 236 },
              '564x': { url: 'https://i.pinimg.example/564.jpg', height: 564 },
            },
          },
        ],
      },
    })
    const result = await priv(new Downloader()).tryPinterestPin(
      'https://www.pinterest.com/pin/1/',
    )
    expect(result?.downloadUrl).toBe('')
    expect(result?.images).toEqual([
      {
        id: '1_0',
        url: 'https://i.pinimg.example/564.jpg',
        thumbnail: 'https://i.pinimg.example/564.jpg',
      },
    ])
  })
})

describe('the Threads embed extractor', () => {
  const embed = `<html><head><title>Threads</title></head><body><video poster="https://cdn.example/p.jpg" src="https://cdn.example/clip.mp4"></video></body></html>`

  it('reads the embed view as a link crawler', async () => {
    const spy = stubFetch(embed)
    const result = await priv(new Downloader()).tryThreadsEmbed(
      'https://www.threads.com/@someone/post/Db-50iLEbpn/',
    )
    expect(String(spy.mock.calls[0][0])).toBe(
      'https://www.threads.com/@someone/post/Db-50iLEbpn/embed',
    )
    const headers = spy.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['User-Agent']).toContain('facebookexternalhit')
    expect(result?.downloadUrl).toBe('https://cdn.example/clip.mp4')
    expect(result?.title).toBe('Threads post by @someone')
  })
})

/**
 * The TikTok chain races tikwm against Cobalt rather than waiting on tikwm
 * first, which is only safe if a loser's null or throw cannot end the race.
 */
describe('racing two extractors', () => {
  const after = <T,>(ms: number, value: T) => () =>
    new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))

  it('answers with the faster one', async () => {
    expect(
      await firstResult([after(40, 'slow'), after(1, 'fast')]),
    ).toBe('fast')
  })

  it('waits for a winner when the other answers null or throws', async () => {
    expect(
      await firstResult([
        after(1, null),
        async () => {
          throw new Error('upstream down')
        },
        after(20, 'winner'),
      ]),
    ).toBe('winner')
  })

  it('is null only when every one of them fails', async () => {
    expect(
      await firstResult([
        after(1, null),
        async () => {
          throw new Error('upstream down')
        },
      ]),
    ).toBeNull()
  })
})

/**
 * Facebook's own share sheet produces `fb.watch/<code>` and
 * `facebook.com/share/<v|r>/<code>`, and both answer a browser user agent with
 * 400 — so the canonical URL every Facebook extractor needs was never reached.
 */
describe('the Facebook short-link resolver', () => {
  it.each([
    'https://www.facebook.com/share/r/14p4MjFM5jX/',
    'https://fb.watch/aBcDeF/',
  ])('asks for %s as a crawler, with HEAD', async (url) => {
    const spy = stubFetch('')
    await priv(new Downloader()).resolveRedirect(url)
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('HEAD')
    expect((init.headers as Record<string, string>)['User-Agent']).toContain(
      'facebookexternalhit',
    )
  })

  /**
   * The plugin embed is the only Facebook surface that answers without a login,
   * and it ships neither og tags nor a real title — so the card's poster and
   * name have to come out of its markup, past two images that are not the
   * poster.
   */
  it('takes the poster and no title from a plugin embed', () => {
    const plugin =
      '<html><head><title>Facebook</title></head><body>' +
      '<img class="img" src="https://static.xx.fbcdn.net/rsrc.php/v4/yN/spacer.gif">' +
      '<img class="img" src="https://scontent.example.fna.fbcdn.net/v/t15.5256-10/poster.jpg?a=1&amp;b=2">' +
      '<img class="img" src="https://scontent.example.fna.fbcdn.net/v/t39.30808-1/avatar.jpg">' +
      '<script>{"hd_src":"https://video.example.fna.fbcdn.net/clip.mp4"}</script>' +
      '</body></html>'
    const result = priv(new Downloader()).parseFacebookHtml(
      plugin,
      'https://www.facebook.com/reel/1536569814605331/',
    )
    expect(result?.downloadUrl).toBe('https://video.example.fna.fbcdn.net/clip.mp4')
    expect(result?.thumbnail).toBe(
      'https://scontent.example.fna.fbcdn.net/v/t15.5256-10/poster.jpg?a=1&b=2',
    )
    // "Facebook" is the plugin page's own title, not the video's.
    expect(result?.title).toBe('Facebook Video')
  })

  it('leaves every other link on the browser path', async () => {
    const spy = stubFetch('')
    await priv(new Downloader()).resolveRedirect(
      'https://www.instagram.com/share/BAbCdEfGh12/',
    )
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['User-Agent']).toContain(
      'Chrome',
    )
  })
})

/**
 * A share link resolved logged-out ends at Meta's login wall, so the redirect
 * follower's answer was the wall rather than the post — losing the shortcode
 * every Instagram extractor keys on and leaving Cobalt as the only path.
 */
describe('the Meta login wall', () => {
  it('returns the post the wall was hiding', () => {
    expect(
      unwrapLoginWall(
        'https://www.instagram.com/accounts/login/?next=%2Freel%2FDaBcDeFgHiJ%2F',
      ),
    ).toBe('https://www.instagram.com/reel/DaBcDeFgHiJ/')
  })

  it('accepts an absolute next on the same host', () => {
    expect(
      unwrapLoginWall(
        'https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Freel%2F123',
      ),
    ).toBe('https://www.facebook.com/reel/123')
  })

  it('refuses a next pointing somewhere else, which is fetched if returned', () => {
    const offsite =
      'https://www.instagram.com/accounts/login/?next=https%3A%2F%2Fevil.example%2Fx'
    expect(unwrapLoginWall(offsite)).toBe(offsite)
  })

  it.each([
    'https://www.instagram.com/reel/DaBcDeFgHiJ/',
    'https://www.instagram.com/accounts/login/',
    'not a url at all',
  ])('leaves %s alone', (url) => {
    expect(unwrapLoginWall(url)).toBe(url)
  })
})

/**
 * The link shapes Facebook actually puts on a clipboard, all of which were
 * answered with "unsupported platform" because the patterns only listed
 * /videos/, /reel/ and /watch.
 */
describe('the Facebook link shapes', () => {
  it.each([
    'https://www.facebook.com/share/p/1AbCdEfGh2/',
    'https://www.facebook.com/someone/posts/pfbid0abc123',
    'https://www.facebook.com/groups/123456/posts/7891011/',
    'https://www.facebook.com/photo/?fbid=1234567890&set=a.1',
    'https://www.facebook.com/someone/photos/a.100/12345678/',
    'https://www.facebook.com/stories/1234567890123456/',
    'https://mbasic.facebook.com/reel/1536569814605331',
    'https://m.facebook.com/watch/?v=10153231379946729',
  ])('recognises %s', (url) => {
    expect(detectPlatform(url)).toBe('facebook')
  })

  it('says why a story cannot be downloaded rather than failing generically', async () => {
    const spy = stubFetch('')
    await expect(
      priv(new Downloader()).downloadFacebook(
        'https://www.facebook.com/stories/1234567890123456/',
      ),
    ).rejects.toThrow(/logged-in account/)
    // The point of naming it: nothing is even attempted.
    expect(spy).not.toHaveBeenCalled()
  })

  it('answers a photo link with the photo', async () => {
    stubFetch(
      '<html><head><meta property="og:image" content="https://scontent.example/photo.jpg">' +
        '<meta property="og:title" content="A photo"></head><body></body></html>',
    )
    const result = await priv(new Downloader()).tryFacebookPhoto(
      'https://www.facebook.com/photo/?fbid=123',
      'https://www.facebook.com/photo/?fbid=123',
    )
    expect(result?.images).toEqual([
      {
        id: expect.any(String),
        url: 'https://scontent.example/photo.jpg',
        thumbnail: 'https://scontent.example/photo.jpg',
      },
    ])
  })

  /**
   * Every Facebook page publishes an og:image, the poster frame included — so
   * the photo path has to refuse anything that is not named as a photo, or a
   * private video resolves "successfully" as its own thumbnail.
   */
  it('refuses to answer a video link with its poster', async () => {
    const spy = stubFetch(
      '<html><head><meta property="og:image" content="https://scontent.example/poster.jpg"></head></html>',
    )
    const result = await priv(new Downloader()).tryFacebookPhoto(
      'https://www.facebook.com/reel/1536569814605331/',
      'https://www.facebook.com/reel/1536569814605331/',
    )
    expect(result).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('the Vimeo extractor', () => {
  it('offers the embed when only manifests are left', async () => {
    stubFetch({
      video: { title: 'The New Vimeo Player', duration: 62, thumbs: { base: 'https://i.example/t.jpg' } },
      request: { files: { progressive: [], hls: {}, dash: {} } },
    })
    const result = await priv(new Downloader()).tryVimeo('https://vimeo.com/76979871')
    expect(result?.downloadUrl).toBe('')
    expect(result?.embedUrl).toBe('https://player.vimeo.com/video/76979871')
    expect(result?.title).toBe('The New Vimeo Player')
  })

  it('still prefers a progressive rendition when one exists', async () => {
    stubFetch({
      video: { title: 'Clip', duration: 10, thumbs: {} },
      request: {
        files: {
          progressive: [
            { url: 'https://vod.example/540.mp4', height: 540 },
            { url: 'https://vod.example/1080.mp4', height: 1080 },
          ],
        },
      },
    })
    const result = await priv(new Downloader()).tryVimeo('https://vimeo.com/1')
    expect(result?.downloadUrl).toBe('https://vod.example/1080.mp4')
    expect(result?.embedUrl).toBeUndefined()
  })
})
