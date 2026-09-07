import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cobaltMediaKind,
  Downloader,
  instagramCaptionAuthor,
  instagramCaptionTitle,
  instagramLinkIsVideo,
  instagramUrlDuration,
  parseInstagramCrawlerMedia,
  resetCobaltCooldown,
  resetInstagramCrawlerCooldown,
  stillsAreJustTheCover,
} from './downloader'

/**
 * The defect this file exists for: paste a reel link, download a JPEG.
 *
 * A public Cobalt instance that cannot extract a clip does not fail. It answers
 * `status: "tunnel"` with `filename: "instagram_<code>.jpg"` and streams the
 * post's cover image, and every check the resolver had was satisfied by that —
 * a status of tunnel, a URL, and bytes on the wire. `/api/video` then forces
 * `video/mp4` onto it, so the visitor's file was a picture with an `.mp4` name.
 * Reproduced against production on 2026-09-06 with
 * `instagram.com/reel/DKcalTzoftf/`, whose first bytes came back `ff d8 ff e0`.
 *
 * Two independent guards close it, and both are asserted here: the filename
 * Cobalt itself names (free, no request), and the first bytes of the stream
 * (the net for a source that names a file badly).
 */

interface VideoDataLike {
  title: string
  author: string
  duration: number
  downloadUrl: string
  thumbnail: string
  images?: Array<{ url: string; kind?: string }>
}

type PrivateDownloader = {
  tryCobaltInstance(baseUrl: string, url: string): Promise<VideoDataLike | null>
  tryInstagramCrawlerView(
    shortcode: string,
    url: string,
  ): Promise<VideoDataLike | null>
  tryInstagramMediaInfo(
    shortcode: string,
    url: string,
  ): Promise<VideoDataLike | null>
  probeStream(
    url: string,
    opts?: { rejectHtml?: boolean; expect?: 'video' },
  ): Promise<{ verdict: 'ok' | 'unreachable' | 'wrong-type'; sizeBytes?: number }>
}

function priv(downloader: Downloader): PrivateDownloader {
  return downloader as unknown as PrivateDownloader
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetCobaltCooldown()
  resetInstagramCrawlerCooldown()
})

describe('what Cobalt actually put in the tunnel', () => {
  it('reads a picture off the filename it names', () => {
    expect(cobaltMediaKind('instagram_DKcalTzoftf.jpg')).toBe('image')
    expect(cobaltMediaKind('post.JPEG')).toBe('image')
    expect(cobaltMediaKind('shot.webp')).toBe('image')
  })

  it('reads a clip and a track', () => {
    expect(cobaltMediaKind('instagram_C8CaBfWs1mr.mp4')).toBe('video')
    expect(cobaltMediaKind('song.mp3')).toBe('audio')
  })

  it('says nothing about a filename that carries no extension', () => {
    expect(cobaltMediaKind('tunnel')).toBe('unknown')
    expect(cobaltMediaKind(undefined)).toBe('unknown')
    expect(cobaltMediaKind(42)).toBe('unknown')
  })

  /**
   * The whole defect in one assertion. A `.jpg` tunnel must never land in
   * `downloadUrl`, because everything downstream treats that field as a video.
   */
  it('never hands a jpg tunnel back as the video stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          status: 'tunnel',
          url: 'https://cobalt.example/tunnel?id=abc',
          filename: 'instagram_DKcalTzoftf.jpg',
        }),
      ),
    )

    const result = await priv(new Downloader()).tryCobaltInstance(
      'https://cobalt.example/',
      'https://www.instagram.com/reel/DKcalTzoftf/',
    )

    expect(result?.downloadUrl).toBe('')
    expect(result?.images?.[0]?.url).toBe('https://cobalt.example/tunnel?id=abc')
  })

  it('still hands an mp4 tunnel back as the video stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          status: 'tunnel',
          url: 'https://cobalt.example/tunnel?id=xyz',
          filename: 'instagram_C8CaBfWs1mr.mp4',
        }),
      ),
    )

    const result = await priv(new Downloader()).tryCobaltInstance(
      'https://cobalt.example/',
      'https://www.instagram.com/reel/C8CaBfWs1mr/',
    )

    expect(result?.downloadUrl).toBe('https://cobalt.example/tunnel?id=xyz')
    expect(result?.images).toBeUndefined()
  })

  /**
   * An all-photo picker used to fall through to `items[0]`, which made the
   * post's first JPEG the primary "video". That is the same bug wearing the
   * other status.
   */
  it('leaves the stream empty for a picker with no video in it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          status: 'picker',
          picker: [
            { type: 'photo', url: 'https://cdn.example/1.jpg' },
            { type: 'photo', url: 'https://cdn.example/2.jpg' },
          ],
        }),
      ),
    )

    const result = await priv(new Downloader()).tryCobaltInstance(
      'https://cobalt.example/',
      'https://www.instagram.com/p/CmUv48DLvxd/',
    )

    expect(result?.downloadUrl).toBe('')
    expect(result?.images).toHaveLength(2)
  })

  /**
   * A carousel of clips handed back exactly one of them. The rest are gallery
   * entries now, in the order the post publishes them.
   */
  it('keeps every clip of a mixed picker, in order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          status: 'picker',
          picker: [
            { type: 'photo', url: 'https://cdn.example/1.jpg' },
            { type: 'video', url: 'https://cdn.example/2.mp4' },
            { type: 'video', url: 'https://cdn.example/3.mp4' },
          ],
        }),
      ),
    )

    const result = await priv(new Downloader()).tryCobaltInstance(
      'https://cobalt.example/',
      'https://www.instagram.com/p/DaU7f-CjE1c/',
    )

    expect(result?.downloadUrl).toBe('https://cdn.example/2.mp4')
    expect(result?.images?.map((i) => i.kind)).toEqual([
      'image',
      'video',
      'video',
    ])
    expect(result?.images?.map((i) => i.url)).toEqual([
      'https://cdn.example/1.jpg',
      'https://cdn.example/2.mp4',
      'https://cdn.example/3.mp4',
    ])
  })
})

/**
 * The second guard. A source that names its file badly — or names nothing at
 * all, which is what a bare tunnel does — is caught by what it streams.
 */
describe('probing a candidate stream', () => {
  function stubBytes(bytes: number[], contentType = 'application/octet-stream') {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Uint8Array(bytes), {
            status: 206,
            headers: { 'content-type': contentType },
          }),
      ),
    )
  }

  it('refuses JPEG bytes when a video was asked for', async () => {
    stubBytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
    expect(
      (await priv(new Downloader()).probeStream('https://cdn.example/x', {
        expect: 'video',
      })
    ).verdict).toBe('wrong-type')
  })

  it('refuses PNG bytes too', async () => {
    stubBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(
      (await priv(new Downloader()).probeStream('https://cdn.example/x', {
        expect: 'video',
      })
    ).verdict).toBe('wrong-type')
  })

  it('accepts an MP4', async () => {
    // 'ftyp' at offset 4 — an ISO base media file.
    stubBytes([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
    expect(
      (await priv(new Downloader()).probeStream('https://cdn.example/x', {
        expect: 'video',
      })
    ).verdict).toBe('ok')
  })

  it('accepts a picture when nothing said it had to be a video', async () => {
    stubBytes([0xff, 0xd8, 0xff, 0xe0])
    expect(
      (await priv(new Downloader()).probeStream('https://cdn.example/x')).verdict,
    ).toBe('ok')
  })

  /**
   * Unreachable is a maybe and wrong-type is a no — the caller keeps the first
   * as a last resort and drops the second, so the two must not collapse.
   */
  it('separates unreachable from wrong type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403 })),
    )
    expect(
      (await priv(new Downloader()).probeStream('https://cdn.example/x', {
        expect: 'video',
      })
    ).verdict).toBe('unreachable')
  })
})

describe('a link that names a video', () => {
  it('recognises every Instagram video route', () => {
    expect(instagramLinkIsVideo('https://www.instagram.com/reel/ABC123/')).toBe(
      true,
    )
    expect(instagramLinkIsVideo('https://www.instagram.com/reels/ABC123/')).toBe(
      true,
    )
    expect(instagramLinkIsVideo('https://www.instagram.com/tv/ABC123/')).toBe(
      true,
    )
    expect(
      instagramLinkIsVideo('https://www.instagram.com/nasa/reel/ABC123/'),
    ).toBe(true)
  })

  it('says nothing about a /p/ link, which can be either', () => {
    expect(instagramLinkIsVideo('https://www.instagram.com/p/ABC123/')).toBe(
      false,
    )
    expect(
      instagramLinkIsVideo('https://www.instagram.com/stories/nasa/123/'),
    ).toBe(false)
  })
})

/**
 * The extractor that answers the reels the embed page will not: Instagram's
 * own post page, fetched as a link crawler, carries `video_versions`.
 */
describe('the crawler view of a post', () => {
  // The shape of the real page: a JSON payload embedded in HTML, so URLs
  // arrive with escaped solidi and percent escapes written as %.
  const page = (mediaId: string, file: string) =>
    `<html><head><meta property="og:title" content="Martin Garrix on Instagram: &quot;comment your favourite scene&quot;" /></head>` +
    `<body><script type="application/json">{"pk":"${mediaId}","image_versions2":{"candidates":[{"url":"https:\\/\\/cdn.example\\/poster.jpg"}]},` +
    `"video_versions":[{"type":101,"url":"https:\\/\\/cdn.example\\/${file}?efg=eyJ2\\u00253D\\u00253D&oe=1"}]}</script></body></html>`

  it('reads the post’s own clip and poster', () => {
    const found = parseInstagramCrawlerMedia(page('123', 'clip.mp4'), '123')
    expect(found?.videoUrl).toBe('https://cdn.example/clip.mp4?efg=eyJ2%3D%3D&oe=1')
    expect(found?.poster).toBe('https://cdn.example/poster.jpg')
  })

  /**
   * The page also embeds neighbouring posts from the same account, so an
   * unanchored scan can hand back a different clip entirely. The anchor is the
   * post's own numeric id, which is arithmetic over the shortcode.
   */
  it('returns nothing when the page is not about that post', () => {
    expect(parseInstagramCrawlerMedia(page('123', 'clip.mp4'), '999')).toBeNull()
  })

  it('maps the page onto the shared shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(page('3646906711360535391', 'clip.mp4'), {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    )

    const result = await priv(new Downloader()).tryInstagramCrawlerView(
      'DKcalTzoftf',
      'https://www.instagram.com/reel/DKcalTzoftf/',
    )

    expect(result?.downloadUrl).toContain('https://cdn.example/clip.mp4')
    expect(result?.author).toBe('Martin Garrix')
    expect(result?.title).toBe('comment your favourite scene')
    expect(result?.thumbnail).toBe('https://cdn.example/poster.jpg')
  })

  it('degrades to null on a page with no clip in it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html><body>nothing here</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    )

    await expect(
      priv(new Downloader()).tryInstagramCrawlerView(
        'DKcalTzoftf',
        'https://www.instagram.com/reel/DKcalTzoftf/',
      ),
    ).resolves.toBeNull()
  })
})

/**
 * The crawler view publishes no duration field, and neither do the embed's
 * carousel children — but Instagram's own encoder writes the length into the
 * URL it signs, so the URL is the answer of last resort.
 */
describe('a clip’s length read off its URL', () => {
  // `efg` is base64 of the encoder's own JSON blob.
  const efg = Buffer.from(
    JSON.stringify({ vencode_tag: 'xpv_progressive', duration_s: 47 }),
  ).toString('base64')

  it('decodes duration_s out of the efg parameter', () => {
    expect(
      instagramUrlDuration(`https://cdn.example/clip.mp4?_nc_cat=1&efg=${efg}`),
    ).toBe(47)
  })

  it('answers zero rather than a wrong number', () => {
    expect(instagramUrlDuration('')).toBe(0)
    expect(instagramUrlDuration('https://cdn.example/clip.mp4')).toBe(0)
    expect(instagramUrlDuration('https://cdn.example/clip.mp4?efg=not-base64')).toBe(0)
    expect(instagramUrlDuration('not a url at all')).toBe(0)
  })
})

describe('the caption Instagram publishes to crawlers', () => {
  const og = 'Martin Garrix on Instagram: "comment your favourite scene"'

  it('separates the account from the caption', () => {
    expect(instagramCaptionAuthor(og)).toBe('Martin Garrix')
    expect(instagramCaptionTitle(og, 'DKcalTzoftf')).toBe(
      'comment your favourite scene',
    )
  })

  it('falls back to the shortcode rather than an empty title', () => {
    expect(instagramCaptionAuthor('')).toBe('Instagram')
    expect(instagramCaptionTitle('', 'DKcalTzoftf')).toBe(
      'Instagram video DKcalTzoftf',
    )
  })
})

/**
 * Instagram's rendition lists are ordered by encode family, not by size, so
 * `[0]` is not reliably the best file — and a carousel container carries no
 * duration of its own.
 */
describe('choosing a rendition from the media API', () => {
  const IG_VARS = ['IG_SESSIONID']
  afterEach(() => {
    for (const key of IG_VARS) delete process.env[key]
  })

  it('takes the largest video, not the first listed', async () => {
    process.env.IG_SESSIONID = 'cookie'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          items: [
            {
              user: { username: 'someone' },
              caption: { text: 'a caption' },
              video_duration: 12.4,
              video_versions: [
                { url: 'https://cdn.example/480.mp4', width: 480, height: 852 },
                { url: 'https://cdn.example/1080.mp4', width: 1080, height: 1920 },
              ],
              image_versions2: {
                candidates: [
                  { url: 'https://cdn.example/small.jpg', width: 320, height: 320 },
                  { url: 'https://cdn.example/big.jpg', width: 1080, height: 1080 },
                ],
              },
            },
          ],
        }),
      ),
    )

    const result = await priv(
      new Downloader({ credentialed: true }),
    ).tryInstagramMediaInfo('Db9Qn-lgG3X', 'https://www.instagram.com/reel/x/')

    expect(result?.downloadUrl).toBe('https://cdn.example/1080.mp4')
    expect(result?.thumbnail).toBe('https://cdn.example/big.jpg')
    expect(result?.duration).toBe(12)
  })

  it('keeps every clip of a carousel and reads the duration off the child', async () => {
    process.env.IG_SESSIONID = 'cookie'
    const child = (n: number) => ({
      video_duration: 7.2,
      video_versions: [{ url: `https://cdn.example/clip${n}.mp4` }],
      image_versions2: { candidates: [{ url: `https://cdn.example/p${n}.jpg` }] },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          items: [
            {
              user: { username: 'someone' },
              caption: { text: 'three clips' },
              carousel_media: [
                child(1),
                {
                  image_versions2: {
                    candidates: [{ url: 'https://cdn.example/still.jpg' }],
                  },
                },
                child(2),
              ],
            },
          ],
        }),
      ),
    )

    const result = await priv(
      new Downloader({ credentialed: true }),
    ).tryInstagramMediaInfo('Db9Qn-lgG3X', 'https://www.instagram.com/p/x/')

    expect(result?.downloadUrl).toBe('https://cdn.example/clip1.mp4')
    expect(result?.images?.map((i) => i.kind)).toEqual([
      'video',
      'image',
      'video',
    ])
    expect(result?.duration).toBe(7)
  })
})

/**
 * The difference between a scratch Worker and a busy one.
 *
 * A preview Worker on Cloudflare's network gets 200 and a 731 KB page carrying
 * `video_versions`; production, whose addresses have been serving this site all
 * day, gets `429, 0 chars` for the same URL in the same minute. The limit is on
 * the address, not the post — so the answer is to ask less, not to retry.
 */
describe('the crawler view under a rate limit', () => {
  afterEach(() => {
    resetInstagramCrawlerCooldown()
  })

  it('stops asking after a 429, rather than retrying into it', async () => {
    const fetchSpy = vi.fn(
      async () => new Response('', { status: 429, headers: { 'content-type': 'text/html' } }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    const d = new Downloader()
    await expect(
      priv(d).tryInstagramCrawlerView('DKcalTzoftf', 'https://www.instagram.com/reel/x/'),
    ).resolves.toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Every later resolve in this isolate skips the request entirely: it would
    // be a doomed 731 KB download and another mark against the address.
    await expect(
      priv(d).tryInstagramCrawlerView('C8CaBfWs1mr', 'https://www.instagram.com/reel/y/'),
    ).resolves.toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('is not held back by an ordinary miss', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response('<html>nothing</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    const d = new Downloader()
    await priv(d).tryInstagramCrawlerView('DKcalTzoftf', 'https://www.instagram.com/reel/x/')
    await priv(d).tryInstagramCrawlerView('C8CaBfWs1mr', 'https://www.instagram.com/reel/y/')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})

/**
 * The size is free — the probe already asks for `bytes=0-1024`, and a server
 * answering a range request states the total. It was read past and dropped for
 * as long as the probe has existed.
 */
describe('how big the stream turned out to be', () => {
  const MP4 = [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]

  function stubRanged(headers: Record<string, string>, status = 206) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(MP4), { status, headers })),
    )
  }

  it('reads the total off Content-Range', async () => {
    stubRanged({ 'content-range': 'bytes 0-1024/12345678' })
    const probe = await priv(new Downloader()).probeStream('https://cdn.example/x', {
      expect: 'video',
    })
    expect(probe).toEqual({ verdict: 'ok', sizeBytes: 12345678 })
  })

  /**
   * On a 206 the Content-Length describes the slice, not the file. Reporting
   * "1 KB" for a 40 MB clip is worse than reporting nothing.
   */
  it('refuses a partial response’s Content-Length as the total', async () => {
    stubRanged({ 'content-length': '1025' })
    const probe = await priv(new Downloader()).probeStream('https://cdn.example/x')
    expect(probe.sizeBytes).toBeUndefined()
  })

  it('takes Content-Length on a 200, where it is the whole file', async () => {
    stubRanged({ 'content-length': '4096' }, 200)
    const probe = await priv(new Downloader()).probeStream('https://cdn.example/x')
    expect(probe.sizeBytes).toBe(4096)
  })

  it('says nothing when the server will not say', async () => {
    stubRanged({ 'content-range': 'bytes 0-1024/*' })
    const probe = await priv(new Downloader()).probeStream('https://cdn.example/x')
    expect(probe.sizeBytes).toBeUndefined()
  })
})

/**
 * The cover image, refused.
 *
 * Read from the production log on 2026-09-07:
 *
 *     Instagram gave a reel its cover image:
 *     embed:nothing crawler:nothing media-info:nothing cobalt:stills(1)
 *
 * With the crawler view rate-limited (a 429, then a ten-minute hold) and this
 * reel's embed carrying no `video_url`, Cobalt answered with `images: [cover]`.
 * That walks straight past the `expect: 'video'` probe asserted above, because
 * a gallery never claims to be a stream — the same defect arriving through a
 * door the guard was not standing at.
 */
describe('a gallery offered for a video link', () => {
  it('is the cover when there is exactly one image', () => {
    expect(stillsAreJustTheCover(true, 1)).toBe(true)
  })

  /**
   * More than one is a real carousel that something mislabelled. Dropping it
   * would lose content nobody could get any other way, and a `/reel/` link that
   * somehow yielded four images is a mystery worth handing over rather than
   * swallowing.
   */
  it('is left alone when there are several', () => {
    expect(stillsAreJustTheCover(true, 4)).toBe(false)
  })

  /** A `/p/` link is a carousel by default; one image there is the post. */
  it('is the post itself when the link never promised a video', () => {
    expect(stillsAreJustTheCover(false, 1)).toBe(false)
    expect(stillsAreJustTheCover(false, 10)).toBe(false)
  })

  /** Nothing at all is handled by the caller, not by this rule. */
  it('says nothing about an empty gallery', () => {
    expect(stillsAreJustTheCover(true, 0)).toBe(false)
  })
})
