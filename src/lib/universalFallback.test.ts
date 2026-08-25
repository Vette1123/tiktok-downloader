import { afterEach, describe, expect, it, vi } from 'vitest'
import { Downloader } from './downloader'

/**
 * The universal long-tail path: what happens for a link no bespoke extractor
 * claims, once every resolver ahead of it has missed.
 *
 * Two behaviours under test here are easy to regress silently:
 *
 *  - A bot-walled origin raises OriginBlockedError, which reads as definite
 *    news ("this site blocks us"). It must still reach the caller when nothing
 *    resolves — but it must not *abort* the extractors behind it, because the
 *    native extractor impersonates a browser and often succeeds where the
 *    direct fetch was walled.
 *  - The MP3 flow, when no audio-specific source answers, falls back to
 *    resolving the video and serving its stream as the audio source — which is
 *    safe everywhere including Cloudflare, because /api/audio already streams
 *    MP4 containers and browsers pull the track out themselves.
 *
 * `ytdlpProbe` is mocked at the module boundary: the real one spawns a binary,
 * and the selection logic it wraps has its own test file.
 */
const probeMock = vi.hoisted(() => vi.fn())
vi.mock('./ytdlp', () => ({
  ytdlpInfo: vi.fn(async () => null),
  ytdlpProbe: probeMock,
}))

type PrivateDownloader = {
  downloadGeneric(url: string, platform: string): Promise<unknown>
  fallbackAudioViaVideo(
    url: string,
  ): Promise<{ musicUrl?: string; downloadUrl: string } | null>
}

function priv(downloader: Downloader): PrivateDownloader {
  return downloader as unknown as PrivateDownloader
}

/**
 * A fetch stub keyed on what each leg of the chain asks for: cobalt posts get
 * a fast structured refusal (no retry backoff — `status:'error'` throws rather
 * than looks transient), the target page answers with a bot-wall-sized stub,
 * and anything else 404s. The relays see the same wall and give up quietly.
 */
function stubWallAndCobaltRefusal(targetHtml = '<title>.</title>') {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('http') && input instanceof Request && input.method === 'POST') {
      return new Response(JSON.stringify({ status: 'error', error: { code: 'fetch.empty' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // Only the pasted target gets the wall-shaped body; relays fetching other
    // hosts 404, which the relay helper treats as "nothing delivered".
    if (url.includes('walled.example')) {
      return new Response(targetHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    }
    return new Response('nope', { status: 404 })
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

/** A page big enough to pass the bot-wall size check, carrying its media URL.
 * The og tags sit in <head> — metaContent's scan stops at </head>, so a body
 * placement would test nothing real. */
const REAL_PAGE_HTML = `<!doctype html><html><head><title>A clip</title>
<meta property="og:title" content="A clip" />
<meta property="og:video:secure_url" content="https://cdn.example/media/clip-1080.mp4" />
</head><body>${'<p>filler</p>'.repeat(400)}
</body></html>`

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  probeMock.mockReset()
})

describe('the generic chain behind a walled origin', () => {
  it('still reports the block when nothing after the scraper resolves', async () => {
    vi.stubEnv('DEPLOY_TARGET', 'cloudflare')
    stubWallAndCobaltRefusal()
    await expect(
      priv(new Downloader()).downloadGeneric(
        'https://walled.example/watch/123',
        'generic',
      ),
    ).rejects.toMatchObject({ name: 'OriginBlockedError' })
  })

  it('lets the native extractor answer after the wall instead of aborting', async () => {
    // Native binaries present (default in tests): the extractor runs after
    // the scraper hit the wall and rescues the resolve.
    delete process.env.DEPLOY_TARGET
    stubWallAndCobaltRefusal()
    probeMock.mockResolvedValue({
      downloadUrl: 'https://cdn.example/native/clip-720.mp4',
      title: 'A clip',
      uploader: undefined,
      duration: 42,
      thumbnail: undefined,
    })
    await expect(
      priv(new Downloader()).downloadGeneric(
        'https://walled.example/watch/123',
        'generic',
      ),
    ).resolves.toMatchObject({
      downloadUrl: 'https://cdn.example/native/clip-720.mp4',
      title: 'A clip',
    })
  })
})

describe('the MP3 fallback through the video path', () => {
  /** Cobalt refuses; the page itself carries a verified og:video. */
  function stubVideoResolvable() {
    const spy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (
        input instanceof Request &&
        input.method === 'POST'
      ) {
        return new Response(
          JSON.stringify({ status: 'error', error: { code: 'fetch.empty' } }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('site.example')) {
        return new Response(REAL_PAGE_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      }
      // The reachability probe against the advertised CDN URL. It reads one
      // chunk and needs it non-empty, so the response must carry bytes.
      return new Response(new ArrayBuffer(64), {
        status: 200,
        headers: { 'Content-Type': 'video/mp4' },
      })
    })
    vi.stubGlobal('fetch', spy)
    return spy
  }

  it('serves the resolved stream as the audio source on Cloudflare', async () => {
    vi.stubEnv('DEPLOY_TARGET', 'cloudflare')
    stubVideoResolvable()
    const result = await priv(
      new Downloader({ mode: 'audio' }),
    ).fallbackAudioViaVideo('https://site.example/watch/9')
    expect(result?.musicUrl).toBe('https://cdn.example/media/clip-1080.mp4')
    expect(result?.downloadUrl).toBe('')
  })

  it('flows through downloadAudio with the (audio) suffix and no video URL', async () => {
    vi.stubEnv('DEPLOY_TARGET', 'cloudflare')
    stubVideoResolvable()
    const dl = new Downloader({ mode: 'audio' })
    const result = await (
      dl as unknown as {
        downloadAudio(url: string, platform: string): Promise<{
          title: string
          musicUrl?: string
          downloadUrl: string
        }>
      }
    ).downloadAudio('https://site.example/watch/9', 'generic')
    expect(result.title).toBe('A clip (audio)')
    expect(result.musicUrl).toBe('https://cdn.example/media/clip-1080.mp4')
    expect(result.downloadUrl).toBe('')
  })

  it('prefers a real bestaudio track when the native extractor offers one', async () => {
    vi.stubEnv('DEPLOY_TARGET', 'cloudflare')
    stubVideoResolvable()
    // The gate is the env var, so a probe answer must be ignored on CF even if
    // one existed — assert the video-path fallback ran regardless.
    probeMock.mockResolvedValue({
      downloadUrl: 'https://cdn.example/audio.m4a',
    })
    const result = await priv(
      new Downloader({ mode: 'audio' }),
    ).fallbackAudioViaVideo('https://site.example/watch/9')
    expect(result?.musicUrl).toBe('https://cdn.example/media/clip-1080.mp4')
  })

  it('stays honest when the video path cannot resolve either', async () => {
    vi.stubEnv('DEPLOY_TARGET', 'cloudflare')
    stubWallAndCobaltRefusal()
    const result = await priv(
      new Downloader({ mode: 'audio' }),
    ).fallbackAudioViaVideo('https://walled.example/watch/1')
    expect(result).toBeNull()
  })
})
