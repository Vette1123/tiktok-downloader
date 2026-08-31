import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractMediaFromHtml,
  FAST_SCAN_BYTES,
  fetchThroughRelay,
  filenameTitle,
  isDirectMediaType,
  looksLikeBotWall,
  MAX_SCAN_BYTES,
  MIN_REAL_PAGE_BYTES,
  readCappedText,
  scrapeTitle,
  unlockerUrl,
} from './pageScrape'

const BASE = 'https://example.com/watch/123'

describe('picking the real file over a preview', () => {
  it('prefers the player source over an og:video preview clip', () => {
    // The reported bug: og:video routinely holds a short teaser so social
    // embeds autoplay something cheap. Taking it first fetched the preview.
    const html = `
      <meta property="og:video" content="https://cdn.example.com/preview/clip.mp4">
      <video><source src="https://cdn.example.com/full/movie-1080p.mp4"></video>
    `
    expect(extractMediaFromHtml(html, BASE)?.mediaUrl).toBe(
      'https://cdn.example.com/full/movie-1080p.mp4',
    )
  })

  it('rejects a preview even when it is the only tagged candidate but a better one exists inline', () => {
    const html = `
      <meta property="og:video" content="https://cdn.example.com/teaser.mp4">
      <script>var player = {file: "https://cdn.example.com/video/full.mp4"}</script>
    `
    expect(extractMediaFromHtml(html, BASE)?.mediaUrl).toBe(
      'https://cdn.example.com/video/full.mp4',
    )
  })

  it('still returns a preview when the page offers nothing else', () => {
    // Degraded, but a short clip beats reporting failure on a page that really
    // does only publish one file.
    const html = `<meta property="og:video" content="https://cdn.example.com/preview.mp4">`
    expect(extractMediaFromHtml(html, BASE)?.mediaUrl).toBe(
      'https://cdn.example.com/preview.mp4',
    )
  })

  it('picks the highest resolution among several <source> qualities', () => {
    const html = `
      <video>
        <source src="https://cdn.example.com/v/360p.mp4">
        <source src="https://cdn.example.com/v/1080p.mp4">
        <source src="https://cdn.example.com/v/720p.mp4">
      </video>
    `
    expect(extractMediaFromHtml(html, BASE)?.mediaUrl).toBe(
      'https://cdn.example.com/v/1080p.mp4',
    )
  })

  it('prefers a progressive file over an HLS manifest', () => {
    const html = `
      <video>
        <source src="https://cdn.example.com/v/master.m3u8">
        <source src="https://cdn.example.com/v/file.mp4">
      </video>
    `
    const result = extractMediaFromHtml(html, BASE)
    expect(result?.mediaUrl).toBe('https://cdn.example.com/v/file.mp4')
    expect(result?.isStream).toBe(false)
  })
})

describe('download links beat player URLs', () => {
  it('prefers an <a href> download link over the JSON-LD contentUrl', () => {
    // Measured on a live page: its /dload/ anchors serve real bytes to any IP
    // with no Referer, while the contentUrl the same page advertises
    // answers 403. A download link is the site saying where the file is.
    const html = `
      <script type="application/ld+json">{"contentUrl":"https://gvideo.example.com/x/x.mp4"}</script>
      <a href="/dload/x/720/1234-720p.mp4">Download 720p</a>
    `
    expect(extractMediaFromHtml(html, BASE)?.mediaUrl).toBe(
      'https://example.com/dload/x/720/1234-720p.mp4',
    )
  })

  it('picks the highest quality among several download links', () => {
    const html = `
      <a href="/dload/x/240/f-240p.mp4">240</a>
      <a href="/dload/x/720/f-720p.mp4">720</a>
      <a href="/dload/x/480/f-480p.mp4">480</a>
    `
    expect(extractMediaFromHtml(html, BASE)?.mediaUrl).toBe(
      'https://example.com/dload/x/720/f-720p.mp4',
    )
  })

  it('prefers H.264 over the AV1 rendition at the same quality', () => {
    // AV1 is smaller but still decodes poorly in older players, and the point
    // of this app is a file that opens anywhere.
    const html = `
      <a href="/dload/x/720/f-720p-av1.mp4">720 av1</a>
      <a href="/dload/x/720/f-720p.mp4">720</a>
    `
    expect(extractMediaFromHtml(html, BASE)?.mediaUrl).toBe(
      'https://example.com/dload/x/720/f-720p.mp4',
    )
  })

  it('ranks a 240p rendition below everything else', () => {
    // A site advertising its smallest file in og:video is the reported bug:
    // "it catches only small preview".
    const html = `
      <meta property="og:video" content="https://cdn.example.com/240P_1000K_x.mp4">
      <a href="/dload/x/720/f-720p.mp4">720</a>
    `
    expect(extractMediaFromHtml(html, BASE)?.mediaUrl).toBe(
      'https://example.com/dload/x/720/f-720p.mp4',
    )
  })
})

describe('reaching sites the old version missed', () => {
  it('finds media that sits past the fast window but inside the full one', () => {
    // Measured on a live page: 1.4 MB of markup with og:video at byte 100,601.
    // The 64 KB fast window finds nothing, so the wide sweep runs.
    const filler = '<p>x</p>'.repeat(Math.ceil(FAST_SCAN_BYTES / 8) + 200)
    const html = `${filler}<video src="https://cdn.example.com/deep.mp4"></video>`
    expect(html.length).toBeGreaterThan(FAST_SCAN_BYTES)
    expect(html.length).toBeLessThan(MAX_SCAN_BYTES)
    expect(extractMediaFromHtml(html, BASE)?.mediaUrl).toBe(
      'https://cdn.example.com/deep.mp4',
    )
  })

  it('accepts an extension-less signed CDN URL from a trusted tag', () => {
    // Requiring a file extension rejected every token-signed URL, which is a
    // large share of "it does not work everywhere".
    const html = `<meta property="og:video:secure_url" content="https://cdn.example.com/v/9f21c?token=abc123">`
    expect(extractMediaFromHtml(html, BASE)?.mediaUrl).toBe(
      'https://cdn.example.com/v/9f21c?token=abc123',
    )
  })

  it('does not accept an extension-less URL scraped from loose script text', () => {
    const html = `<video></video><script>var tracking = "https://analytics.example.com/collect?id=9"</script>`
    expect(extractMediaFromHtml(html, BASE)).toBeNull()
  })

  it('reads a data-src on a player element', () => {
    const html = `<video data-src="https://cdn.example.com/lazy.mp4" poster="/p.jpg"></video>`
    expect(extractMediaFromHtml(html, BASE)?.mediaUrl).toBe(
      'https://cdn.example.com/lazy.mp4',
    )
  })

  it('reads several JSON-LD contentUrls and ranks between them', () => {
    const html = `<script type="application/ld+json">{"@type":"VideoObject",
      "contentUrl":"https:\\/\\/cdn.example.com\\/sd\\/480p.mp4",
      "video":{"contentUrl":"https:\\/\\/cdn.example.com\\/hd\\/1080p.mp4"}}</script>`
    expect(extractMediaFromHtml(html, BASE)?.mediaUrl).toBe(
      'https://cdn.example.com/hd/1080p.mp4',
    )
  })

  it('rejects an embed page offered as a media URL', () => {
    const html = `<meta property="og:video" content="https://example.com/embed/123">`
    expect(extractMediaFromHtml(html, BASE)).toBeNull()
  })

  it('rejects javascript: and data: candidates outright', () => {
    const html = `<video src="javascript:alert(1)"></video><video src="data:video/mp4;base64,AAAA"></video>`
    expect(extractMediaFromHtml(html, BASE)).toBeNull()
  })
})

describe('parsing basics', () => {
  it('decodes &amp; so signed query strings survive intact', () => {
    const html = `<video src="https://cdn.example.com/v.mp4?a=1&amp;b=2"></video>`
    expect(extractMediaFromHtml(html, BASE)?.mediaUrl).toBe(
      'https://cdn.example.com/v.mp4?a=1&b=2',
    )
  })

  it('absolutises a relative src against the page URL', () => {
    const html = `<video src="/media/clip.mp4"></video>`
    expect(extractMediaFromHtml(html, BASE)?.mediaUrl).toBe(
      'https://example.com/media/clip.mp4',
    )
  })

  it('absolutises a protocol-relative src', () => {
    const html = `<meta property="og:video" content="//cdn.example.com/p.mp4">`
    expect(extractMediaFromHtml(html, BASE)?.mediaUrl).toBe(
      'https://cdn.example.com/p.mp4',
    )
  })

  it('flags an m3u8 as a stream, since it cannot be saved as a file', () => {
    const html = `<meta property="og:video" content="https://cdn.example.com/live.m3u8">`
    expect(extractMediaFromHtml(html, BASE)?.isStream).toBe(true)
  })

  it('returns null when the page advertises no media at all', () => {
    expect(extractMediaFromHtml('<html><body>nothing</body></html>', BASE)).toBeNull()
  })

  it('carries the og:image through as the thumbnail', () => {
    const html = `
      <video src="https://cdn.example.com/a.mp4"></video>
      <meta property="og:image" content="/thumb.jpg">
    `
    expect(extractMediaFromHtml(html, BASE)?.thumbnail).toBe(
      'https://example.com/thumb.jpg',
    )
  })
})

describe('CPU budget guards', () => {
  // The Worker gets 10 ms of CPU per request, shared with the rest of the
  // resolve. Raising this constant is the easiest way to silently spend it.
  it('keeps the fast window at or below 64 KB', () => {
    // The wide window is a transfer bound (I/O, not CPU). This one is the CPU
    // bound: it is what every page that resolves normally actually pays.
    expect(FAST_SCAN_BYTES).toBeLessThanOrEqual(65_536)
  })

  it('rejects a media-free page without running any extractor', () => {
    const html = `<html><head><title>An Article</title></head><body>${'word '.repeat(13_000)}</body></html>`
    expect(extractMediaFromHtml(html, BASE)).toBeNull()
  })

  it('ignores media that only appears past the full scan cap', () => {
    const filler = '<p>x</p>'.repeat(Math.ceil(MAX_SCAN_BYTES / 8) + 100)
    const html = `${filler}<meta property="og:video" content="https://cdn.example.com/late.mp4">`
    expect(extractMediaFromHtml(html, BASE)).toBeNull()
  })
})

describe('readCappedText', () => {
  it('stops reading at the cap instead of buffering the whole body', async () => {
    const body = 'a'.repeat(MAX_SCAN_BYTES * 3)
    const text = await readCappedText(new Response(body))
    expect(text.length).toBe(MAX_SCAN_BYTES)
  })

  it('returns a short body whole', async () => {
    expect(await readCappedText(new Response('<html>hi</html>'))).toBe(
      '<html>hi</html>',
    )
  })

  it('returns empty string for a body-less response', async () => {
    expect(await readCappedText(new Response(null, { status: 204 }))).toBe('')
  })
})

describe('scrapeTitle', () => {
  it('prefers og:title', () => {
    expect(
      scrapeTitle(`<meta property="og:title" content="Real Title"><title>Fallback</title>`),
    ).toBe('Real Title')
  })

  it('falls back to <title>', () => {
    expect(scrapeTitle(`<title>  Just This  </title>`)).toBe('Just This')
  })

  it('never returns an empty string, so the result card always has a label', () => {
    expect(scrapeTitle('<html></html>')).toBe('Video')
  })
})

describe('a link that is already the file', () => {
  it('recognises video and audio content types', () => {
    expect(isDirectMediaType('video/mp4')).toBe(true)
    expect(isDirectMediaType('audio/mpeg')).toBe(true)
    expect(isDirectMediaType('video/webm; codecs="vp9"')).toBe(true)
  })

  it('does not treat a page as its own media', () => {
    expect(isDirectMediaType('text/html; charset=UTF-8')).toBe(false)
    expect(isDirectMediaType('image/jpeg')).toBe(false)
    expect(isDirectMediaType('')).toBe(false)
  })

  it('titles a direct link from its filename', () => {
    expect(filenameTitle('https://cdn.example.com/clips/mov_bbb.mp4')).toBe('mov_bbb')
  })

  it('decodes a percent-encoded filename', () => {
    expect(filenameTitle('https://x.test/a/My%20Holiday.mp4')).toBe('My Holiday')
  })

  it('never returns an empty title for a trailing-slash or unparseable URL', () => {
    expect(filenameTitle('https://example.com/')).toBe('Video')
    expect(filenameTitle('not a url')).toBe('Video')
  })
})

describe('telling a bot wall apart from a page with no video', () => {
  // The exact body one walled host served a Cloudflare datacenter IP while the
  // same URL returned 88 KB of real markup from a residential one.
  const WALL = `<!doctype html><html><head><meta charset="utf-8"><title>.</title><script>(function(){var k=23,a=[127,99,99,103,100,45,56,56,96,96,96,57,114,103,120,101,121,114,101,57,116,120,122,56],u="",i=0;for(;i<a.length;i++){u+=String.fromCharCode(a[i]^k);}try{top["loc"+"ation"]["rep"+"lace"](u);}catch(e){window["loc"+"ation"]["href"]=u;}})();</script></head><body></body></html>`

  it('flags the real measured stub', () => {
    expect(looksLikeBotWall(WALL)).toBe(true)
  })

  it('finds no media in it, so the wall check is what the caller reaches', () => {
    expect(extractMediaFromHtml(WALL, BASE)).toBeNull()
  })

  it('does not flag a real page that simply has no video', () => {
    const article = `<html><head><title>An article</title></head><body>${'word '.repeat(
      MIN_REAL_PAGE_BYTES,
    )}</body></html>`
    expect(looksLikeBotWall(article)).toBe(false)
  })

  it('flags an empty or whitespace-only body', () => {
    expect(looksLikeBotWall('')).toBe(true)
    expect(looksLikeBotWall('   \n  ')).toBe(true)
  })
})

/**
 * The unlocker retry. Some hosts answer a Cloudflare datacenter IP with a
 * 369-byte redirect stub while a residential IP gets the real markup, and the
 * block is on datacenter ranges generally — so a VPS or a self-hosted
 * extractor is walled identically. Reading the page through a residential pool
 * is the only thing that changes the answer, and only the page fetch needs it:
 * the media URLs the page publishes serve bytes to any IP.
 */
describe('unlockerUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is off when nothing is configured, so no request is ever spent', () => {
    vi.stubEnv('SCRAPE_UNLOCKER_URL', '')
    expect(unlockerUrl('https://example.com/video-1/')).toBeNull()
  })

  it('percent-encodes the target into the template', () => {
    vi.stubEnv('SCRAPE_UNLOCKER_URL', 'https://api.example.com/?key=K&url={url}')
    expect(unlockerUrl('https://site.example/video-1/?a=b&c=d')).toBe(
      'https://api.example.com/?key=K&url=' +
        encodeURIComponent('https://site.example/video-1/?a=b&c=d'),
    )
  })

  it('refuses a template with no placeholder, rather than fetching the wrong page', () => {
    // Without {url} the request would fetch the provider's own root on every
    // blocked link, spending a credit to learn nothing.
    vi.stubEnv('SCRAPE_UNLOCKER_URL', 'https://api.example.com/?key=K')
    expect(unlockerUrl('https://site.example/v')).toBeNull()
  })
})

describe('fetchThroughRelay', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const REAL_PAGE = `<html><body>${'word '.repeat(MIN_REAL_PAGE_BYTES)}</body></html>`
  const WALLED = '<html><title>.</title></html>'

  it('spends nothing on the free relays where they refuse our egress', async () => {
    // Measured from the deployed Worker: the reader, the archive and the CORS
    // proxy all refuse Cloudflare egress, so on Workers these three calls are
    // ~750 ms of wall and about 6 ms of CPU buying a guaranteed null.
    vi.stubEnv('DEPLOY_TARGET', 'cloudflare')
    vi.stubEnv('SCRAPE_UNLOCKER_URL', '')
    const fetchMock = vi.fn(async () => new Response(REAL_PAGE))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchThroughRelay('https://site.example/v')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still uses a configured unlocker on Cloudflare, and only that', async () => {
    // The unlocker is an endpoint the operator chose, on egress that is not
    // ours — the reason for the whole mechanism, and unaffected by the above.
    vi.stubEnv('DEPLOY_TARGET', 'cloudflare')
    vi.stubEnv('SCRAPE_UNLOCKER_URL', 'https://unlock.example/?url={url}')
    const fetchMock = vi.fn(async () => new Response(REAL_PAGE))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchThroughRelay('https://site.example/v')).resolves.toContain('word')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://unlock.example/?url=https%3A%2F%2Fsite.example%2Fv',
    )
  })

  it('starts with the reader, and stops there when it works', async () => {
    vi.stubEnv('SCRAPE_UNLOCKER_URL', '')
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(REAL_PAGE))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchThroughRelay('https://site.example/v')).resolves.toContain('word')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://r.jina.ai/https://site.example/v')
  })

  it('asks the reader for HTML, since its default strips the markup away', async () => {
    // Left to itself it returns the page as markdown prose — measured at 361
    // bytes for a page whose markup is 8 KB, with the wanted attribute gone.
    vi.stubEnv('SCRAPE_UNLOCKER_URL', '')
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(REAL_PAGE),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchThroughRelay('https://site.example/v')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { 'X-Return-Format': 'html' },
    })
  })

  it('asks the archive for the bytes as captured, not the rewritten view', async () => {
    // Without `id_` every relative href in the snapshot comes back pointing at
    // web.archive.org, and the caller resolves them against the original URL.
    vi.stubEnv('SCRAPE_UNLOCKER_URL', '')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(WALLED))
      .mockResolvedValueOnce(new Response(REAL_PAGE))
    vi.stubGlobal('fetch', fetchMock)

    await fetchThroughRelay('https://site.example/v')
    expect(fetchMock.mock.calls[1][0]).toContain('/web/2id_/')
  })

  it('spends no unlocker credit when a free relay already answered', async () => {
    vi.stubEnv('SCRAPE_UNLOCKER_URL', 'https://api.example.com/?url={url}')
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(REAL_PAGE))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchThroughRelay('https://site.example/v')).resolves.toContain('word')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reaches the paid unlocker only once every free relay has failed', async () => {
    vi.stubEnv('SCRAPE_UNLOCKER_URL', 'https://api.example.com/?url={url}')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(WALLED))
      .mockResolvedValueOnce(new Response(WALLED))
      .mockResolvedValueOnce(new Response(WALLED))
      .mockResolvedValueOnce(new Response(REAL_PAGE))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchThroughRelay('https://site.example/v')).resolves.toContain('word')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[3][0]).toContain('api.example.com')
  })

  it('returns the markup the unlocker saw', async () => {
    vi.stubEnv('SCRAPE_UNLOCKER_URL', 'https://api.example.com/?url={url}')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(REAL_PAGE)))

    await expect(fetchThroughRelay('https://site.example/v')).resolves.toContain('word')
  })

  it('treats a wall relayed through the unlocker as still blocked', async () => {
    vi.stubEnv('SCRAPE_UNLOCKER_URL', 'https://api.example.com/?url={url}')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html><title>.</title></html>')))

    await expect(fetchThroughRelay('https://site.example/v')).resolves.toBeNull()
  })

  it('swallows an unlocker outage, so the user still gets the block message', async () => {
    vi.stubEnv('SCRAPE_UNLOCKER_URL', 'https://api.example.com/?url={url}')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network') }))

    await expect(fetchThroughRelay('https://site.example/v')).resolves.toBeNull()
  })

  it('treats a non-200 from the unlocker as no answer', async () => {
    vi.stubEnv('SCRAPE_UNLOCKER_URL', 'https://api.example.com/?url={url}')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('over quota', { status: 402 })))

    await expect(fetchThroughRelay('https://site.example/v')).resolves.toBeNull()
  })
})
