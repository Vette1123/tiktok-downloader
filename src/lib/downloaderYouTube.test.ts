import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What a YouTube link is worth when the video itself cannot be extracted.
 *
 * That is now the ordinary outcome, not the rare one. Probed from a Cloudflare
 * edge isolate: ANDROID_VR — the one Innertube client that publishes a muxed
 * progressive stream — answers most videos `LOGIN_REQUIRED, "Sign in to confirm
 * you're not a bot"`, and no other client publishes a muxed stream at all.
 * Muxing the adaptive tracks needs ffmpeg, which workerd cannot run.
 *
 * The audio survives all of that: the IOS client hands back unsigned
 * audio-only URLs for the same videos. So the fallback's job is no longer just
 * "keep it viewable" — it is to still finish the download the visitor came for
 * whenever the download is an MP3, which for a music video it usually is.
 */

interface Call {
  url: string
}

const calls: Call[] = []
const oembed: unknown = {
  title: 'Luis Fonsi - Despacito ft. Daddy Yankee',
  author_name: 'LuisFonsiVEVO',
  thumbnail_url: 'https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg',
}

vi.mock('./httpClient', () => ({
  http: {
    get: vi.fn(async (url: string) => {
      calls.push({ url })
      if (url.includes('/oembed')) return { status: 200, data: oembed, headers: {} }
      throw new Error('not stubbed')
    }),
    post: vi.fn(async (url: string) => {
      calls.push({ url })
      throw new Error('not stubbed')
    }),
  },
}))

/** Every Cobalt instance refusing YouTube, which is what they actually do. */
vi.mock('./nativeMedia', () => ({
  nativeMediaAvailable: () => false,
  htmlScrapingAvailable: () => false,
}))

const innertube = vi.hoisted(() => ({
  tryYouTubeInnertube: vi.fn(),
}))
vi.mock('./youtubeInnertube', () => ({
  tryYouTubeInnertube: innertube.tryYouTubeInnertube,
  fetchPlayerResponse: vi.fn(async () => null),
}))

const { Downloader } = await import('./downloader')

type PrivateDownloader = {
  downloadYouTube(url: string): Promise<{
    title: string
    author: string
    duration: number
    downloadUrl: string
    musicUrl?: string
    embedUrl?: string
  }>
}

const LINK = 'https://www.youtube.com/watch?v=kJQP7kiw5Fk'

function run() {
  const downloader = new Downloader() as unknown as PrivateDownloader
  return downloader.downloadYouTube(LINK)
}

const AUDIO_ONLY = {
  id: 'kJQP7kiw5Fk',
  title: 'Despacito',
  url: LINK,
  thumbnail: 'https://i.ytimg.com/vi/kJQP7kiw5Fk/maxres.jpg',
  duration: 282,
  author: 'Luis Fonsi',
  description: '',
  downloadUrl: '',
  musicUrl: 'https://googlevideo.test/audio.m4a',
}

beforeEach(() => {
  calls.length = 0
  innertube.tryYouTubeInnertube.mockReset()
})

describe('a YouTube video that cannot be extracted', () => {
  /**
   * The regression this file exists for. `mode: 'auto'` used to return null
   * whenever there was no muxed stream, and the visitor got an embed with no
   * buttons at all — while the audio had been in that same player response the
   * whole time.
   */
  it('still offers the audio track beside the embed', async () => {
    innertube.tryYouTubeInnertube.mockResolvedValue(AUDIO_ONLY)

    const result = await run()

    expect(result.embedUrl).toBe(
      'https://www.youtube-nocookie.com/embed/kJQP7kiw5Fk',
    )
    expect(result.downloadUrl).toBe('')
    expect(result.musicUrl).toBe('https://googlevideo.test/audio.m4a')
  })

  /** oEmbed is the richer source for the two fields it has; Innertube fills the rest. */
  it('keeps the oEmbed title and takes the duration Innertube knows', async () => {
    innertube.tryYouTubeInnertube.mockResolvedValue(AUDIO_ONLY)

    const result = await run()

    expect(result.title).toBe('Luis Fonsi - Despacito ft. Daddy Yankee')
    expect(result.author).toBe('LuisFonsiVEVO')
    expect(result.duration).toBe(282)
  })

  /**
   * One player call, not two. The audio-only answer is carried down from the
   * same response the video ask made, so reaching the embed must not spend a
   * second Innertube round-trip on a path that has already paid for oEmbed and
   * every Cobalt instance.
   */
  it('asks Innertube exactly once, whatever it answers', async () => {
    innertube.tryYouTubeInnertube.mockResolvedValue(AUDIO_ONLY)

    await run()

    expect(innertube.tryYouTubeInnertube).toHaveBeenCalledTimes(1)
  })

  it('returns the muxed stream, and nothing else, when the video extracted', async () => {
    innertube.tryYouTubeInnertube.mockResolvedValue({
      ...AUDIO_ONLY,
      downloadUrl: 'https://googlevideo.test/muxed.mp4',
    })

    const result = await run()

    expect(result.downloadUrl).toBe('https://googlevideo.test/muxed.mp4')
    expect(innertube.tryYouTubeInnertube).toHaveBeenCalledTimes(1)
    // Not even the oEmbed round-trip: Innertube carries its own metadata.
    expect(calls.some((c) => c.url.includes('/oembed'))).toBe(false)
  })

  /** Nothing at all is still a viewable embed, not an error. */
  it('degrades to a bare embed when even the audio is refused', async () => {
    innertube.tryYouTubeInnertube.mockResolvedValue(null)

    const result = await run()

    expect(result.embedUrl).toContain('kJQP7kiw5Fk')
    expect(result.musicUrl).toBeUndefined()
    expect(result.downloadUrl).toBe('')
  })
})
