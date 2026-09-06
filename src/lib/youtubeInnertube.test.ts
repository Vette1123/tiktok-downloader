import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Innertube's second client.
 *
 * ANDROID_VR is the only client that publishes a muxed progressive stream, and
 * it is also the one Google rate-limits on a shared Cloudflare address: 2 of 12
 * identical calls from the same edge came back `403` with the "Sorry..." abuse
 * page. Before there was a fallback, that took `/api/subtitles` down with it —
 * a supporter asking for captions on a public video was told it "may be private
 * or unavailable" one time in six, because `fetchPlayerResponse` had nothing
 * else to ask.
 *
 * These pin the two halves of the fix: the common path still spends exactly one
 * subrequest, and a blocked ANDROID_VR does not end the attempt.
 */

interface Ask {
  clientName: string
  userAgent: string
  videoId: string
}

const asks: Ask[] = []
let responder: (ask: Ask) => { status: number; data: unknown } = () => ({
  status: 200,
  data: null,
})

vi.mock('./httpClient', () => ({
  http: {
    post: vi.fn(
      async (
        _url: string,
        body: { videoId: string; context: { client: { clientName: string } } },
        config: { headers: Record<string, string> },
      ) => {
        const ask: Ask = {
          clientName: body.context.client.clientName,
          userAgent: config.headers['User-Agent'],
          videoId: body.videoId,
        }
        asks.push(ask)
        const { status, data } = responder(ask)
        return { status, data, headers: {} }
      },
    ),
  },
}))

const { fetchPlayerResponse, tryYouTubeInnertube } = await import(
  './youtubeInnertube'
)
const { extractCaptionTracks } = await import('./subtitles')

/** Google's abuse page: an HTML body under a 403, not JSON. */
const BLOCKED = { status: 403, data: '<html><title>Sorry...</title></html>' }

const CAPTION_TRACKS = [
  {
    baseUrl: 'https://youtube.com/api/timedtext?lang=en',
    languageCode: 'en',
    name: { runs: [{ text: 'English' }] },
  },
]

function playable(extra: Record<string, unknown> = {}) {
  return {
    status: 200,
    data: {
      playabilityStatus: { status: 'OK' },
      videoDetails: {
        title: 'Never Gonna Give You Up',
        author: 'Rick Astley',
        lengthSeconds: '213',
      },
      captions: {
        playerCaptionsTracklistRenderer: { captionTracks: CAPTION_TRACKS },
      },
      ...extra,
    },
  }
}

/** What ANDROID_VR returns: itag 18, muxed, unsigned. */
const MUXED = {
  streamingData: {
    formats: [
      {
        itag: 18,
        url: 'https://googlevideo.test/muxed.mp4',
        mimeType: 'video/mp4',
        bitrate: 500_000,
        qualityLabel: '360p',
      },
    ],
    adaptiveFormats: [
      {
        itag: 140,
        url: 'https://googlevideo.test/vr-audio.m4a',
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: 130_677,
      },
    ],
  },
}

/** What IOS returns: adaptive only, no muxed stream at any bitrate. */
const ADAPTIVE_ONLY = {
  streamingData: {
    formats: [],
    adaptiveFormats: [
      {
        itag: 251,
        url: 'https://googlevideo.test/ios-audio.webm',
        mimeType: 'audio/webm; codecs="opus"',
        bitrate: 136_544,
      },
      {
        itag: 140,
        url: 'https://googlevideo.test/ios-audio.m4a',
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: 130_677,
      },
    ],
  },
}

beforeEach(() => {
  asks.length = 0
  responder = () => ({ status: 200, data: null })
})

describe('choosing a client', () => {
  it('asks ANDROID_VR alone when ANDROID_VR answers', async () => {
    responder = () => playable(MUXED)
    const data = await fetchPlayerResponse('dQw4w9WgXcQ')
    expect(data?.videoDetails?.title).toBe('Never Gonna Give You Up')
    expect(asks.map((a) => a.clientName)).toEqual(['ANDROID_VR'])
  })

  /** The whole point: one blocked call used to be the end of the attempt. */
  it('falls back to IOS when ANDROID_VR is rate-limited', async () => {
    responder = (ask) =>
      ask.clientName === 'ANDROID_VR' ? BLOCKED : playable(ADAPTIVE_ONLY)
    const data = await fetchPlayerResponse('dQw4w9WgXcQ')
    expect(data?.playabilityStatus?.status).toBe('OK')
    expect(asks.map((a) => a.clientName)).toEqual(['ANDROID_VR', 'IOS'])
  })

  /**
   * A 200 whose playability is not OK is a fact about the video, not the
   * caller — but the two are indistinguishable from here, and asking a second
   * client costs one subrequest to find out. It is worth it: the block arrives
   * as a 403 today and there is no promise it always will.
   */
  it('tries the standby when the first client says the video is unplayable', async () => {
    responder = (ask) =>
      ask.clientName === 'ANDROID_VR'
        ? { status: 200, data: { playabilityStatus: { status: 'UNPLAYABLE' } } }
        : playable(ADAPTIVE_ONLY)
    expect(await fetchPlayerResponse('dQw4w9WgXcQ')).not.toBeNull()
    expect(asks).toHaveLength(2)
  })

  it('returns null, never throws, when every client fails', async () => {
    responder = () => BLOCKED
    expect(await fetchPlayerResponse('dQw4w9WgXcQ')).toBeNull()
    expect(asks.map((a) => a.clientName)).toEqual(['ANDROID_VR', 'IOS'])
  })

  /**
   * YouTube rejects a client whose user-agent does not match the context it
   * claims, so the pairing has to travel together rather than being one shared
   * default with a swapped clientName.
   */
  it('sends each client its own user-agent', async () => {
    responder = () => BLOCKED
    await fetchPlayerResponse('dQw4w9WgXcQ')
    expect(asks[0].userAgent).toContain('youtube.vr.oculus')
    expect(asks[1].userAgent).toContain('com.google.ios.youtube')
  })
})

describe('what the fallback can and cannot restore', () => {
  /**
   * Read through the real consumer rather than off the response: `/api/subtitles`
   * is the surface that was answering "may be private or unavailable" for
   * public videos, and it reaches the tracks through this function.
   */
  it('recovers the caption tracks a blocked ANDROID_VR would have lost', async () => {
    responder = (ask) =>
      ask.clientName === 'ANDROID_VR' ? BLOCKED : playable(ADAPTIVE_ONLY)
    const data = await fetchPlayerResponse('dQw4w9WgXcQ')
    expect(data).not.toBeNull()
    expect(extractCaptionTracks(data!)).toEqual([
      { languageCode: 'en', name: 'English', auto: false },
    ])
  })

  /** m4a over the higher-bitrate Opus: iOS Safari cannot decode WebM audio. */
  it('recovers audio, preferring the MP4 track', async () => {
    responder = (ask) =>
      ask.clientName === 'ANDROID_VR' ? BLOCKED : playable(ADAPTIVE_ONLY)
    const result = await tryYouTubeInnertube(
      'dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'audio',
    )
    expect(result?.musicUrl).toBe('https://googlevideo.test/ios-audio.m4a')
  })

  /**
   * IOS publishes no muxed stream, so video mode must come back with an empty
   * `downloadUrl` and let the caller reach Cobalt. Handing back an adaptive
   * video track as though it were a file would give somebody a silent MP4.
   *
   * It returns the audio alongside rather than returning null, so the caller
   * gets it without a second player call — see downloaderYouTube.test.ts for
   * what that turns into on the card.
   */
  it('does not pass off an adaptive track as a video, but keeps the audio', async () => {
    responder = (ask) =>
      ask.clientName === 'ANDROID_VR' ? BLOCKED : playable(ADAPTIVE_ONLY)
    const result = await tryYouTubeInnertube(
      'dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'auto',
    )
    expect(result?.downloadUrl).toBe('')
    expect(result?.musicUrl).toBe('https://googlevideo.test/ios-audio.m4a')
  })

  /** Nothing usable at all is still null — the caller must reach the next source. */
  it('returns null when there is neither a muxed stream nor audio', async () => {
    responder = (ask) =>
      ask.clientName === 'ANDROID_VR'
        ? BLOCKED
        : playable({ streamingData: { formats: [], adaptiveFormats: [] } })
    const result = await tryYouTubeInnertube(
      'dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'auto',
    )
    expect(result).toBeNull()
  })

  it('still returns the muxed stream when ANDROID_VR answers', async () => {
    responder = () => playable(MUXED)
    const result = await tryYouTubeInnertube(
      'dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'auto',
    )
    expect(result?.downloadUrl).toBe('https://googlevideo.test/muxed.mp4')
    expect(result?.duration).toBe(213)
  })
})
