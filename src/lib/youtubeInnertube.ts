/**
 * YouTube extraction via Innertube, YouTube's own private player API.
 *
 * This is what finally makes YouTube downloads work on the free Cloudflare
 * plan. Every previous route was blocked for a structural reason: yt-dlp needs
 * Python and ffmpeg, which workerd cannot run; the public Cobalt instance
 * answers `error.api.youtube.login`; and a self-hosted resolver needs a host we
 * don't have (Back4app's free tier destroyed the deployment, and Cloudflare
 * Containers is paid). Innertube needs none of that — it is one JSON POST.
 *
 * Measured on a deployed Worker before this was written, because both of the
 * things that could have killed it are unknowable from a dev machine:
 *
 *   - Egress. A residential IP tells you nothing about how YouTube treats a
 *     Cloudflare datacenter IP. Probed from a real edge isolate (colo MRS):
 *     ANDROID_VR returns `playabilityStatus: OK` with 27 formats.
 *   - CPU. The probe costs 1-2 ms against the 10 ms budget, which fits.
 *
 * Client choice is the whole trick, and it is worth being explicit about why:
 *
 *   ANDROID_VR  OK   — 27 formats, every one carrying a plain `url`
 *   IOS         OK   — 16 formats, but adaptive only (no muxed progressive)
 *   ANDROID     400  — rejected outright
 *   MWEB        UNPLAYABLE ("The page needs to be reloaded")
 *   TVHTML5     ERROR ("no longer supported in this application")
 *   WEB_EMBEDDED ERROR ("This video is unavailable")
 *
 * ANDROID_VR is the one client that still returns unsigned URLs. That matters
 * enormously: the WEB client returns `signatureCipher` instead, which can only
 * be unscrambled by downloading and interpreting YouTube's player JavaScript —
 * hundreds of milliseconds of CPU, two orders of magnitude past the budget.
 *
 * Verified end to end: URLs extracted from the Marseille edge play back from a
 * completely different IP (`206 Partial Content`, correct Content-Type), so
 * googlevideo is not binding them to the extracting address.
 *
 * KNOWN CEILING: 360p. YouTube only publishes one muxed progressive stream
 * (itag 18) — everything higher is adaptive, i.e. separate video and audio
 * tracks that have to be muxed back together with ffmpeg. We cannot mux on
 * workerd, so 360p is the honest limit for video here. Audio is unaffected and
 * comes back at full quality, because an audio-only adaptive stream needs no
 * muxing at all.
 */

import { http } from './httpClient'
import type { VideoData } from './types'

const PLAYER_ENDPOINT = 'https://www.youtube.com/youtubei/v1/player'

/**
 * The Oculus YouTube app. Version string is sent verbatim; YouTube rejects
 * clients it does not recognise, so this is a real released version rather than
 * something plausible-looking.
 */
const ANDROID_VR_CLIENT = {
  clientName: 'ANDROID_VR',
  clientVersion: '1.62.27',
  androidSdkVersion: 32,
  deviceMake: 'Oculus',
  deviceModel: 'Quest 3',
  osName: 'Android',
  osVersion: '12',
  hl: 'en',
  gl: 'US',
}

const ANDROID_VR_UA =
  'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12; GB) gzip'

/** Give up rather than hold a Worker subrequest open indefinitely. */
const TIMEOUT_MS = 12_000

interface InnertubeFormat {
  itag?: number
  url?: string
  mimeType?: string
  bitrate?: number
  qualityLabel?: string
  audioQuality?: string
  contentLength?: string
  /** Present on WEB-client responses; its existence means we cannot use it. */
  signatureCipher?: string
}

interface InnertubePlayerResponse {
  playabilityStatus?: { status?: string; reason?: string }
  videoDetails?: {
    title?: string
    author?: string
    lengthSeconds?: string
    shortDescription?: string
    thumbnail?: { thumbnails?: Array<{ url?: string; width?: number }> }
  }
  streamingData?: {
    formats?: InnertubeFormat[]
    adaptiveFormats?: InnertubeFormat[]
  }
}

/** Highest-resolution thumbnail Innertube offers, else YouTube's stable path. */
function pickThumbnail(data: InnertubePlayerResponse, videoId: string): string {
  const thumbnails = data.videoDetails?.thumbnail?.thumbnails ?? []
  let best = ''
  let bestWidth = -1
  for (const thumbnail of thumbnails) {
    const width = thumbnail.width ?? 0
    if (thumbnail.url && width > bestWidth) {
      best = thumbnail.url
      bestWidth = width
    }
  }
  return best || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

function byBitrateDesc(a: InnertubeFormat, b: InnertubeFormat): number {
  return (b.bitrate ?? 0) - (a.bitrate ?? 0)
}

/**
 * Best muxed video+audio stream. Only `streamingData.formats` holds these;
 * `adaptiveFormats` is single-track by definition and unusable without ffmpeg.
 */
function pickProgressive(data: InnertubePlayerResponse): InnertubeFormat | undefined {
  const formats = (data.streamingData?.formats ?? []).filter(
    (format) => format.url && !format.signatureCipher,
  )
  return formats.sort(byBitrateDesc)[0]
}

/**
 * Best audio-only stream, preferring MP4/AAC over WebM/Opus.
 *
 * Not a quality judgement — Opus is the better codec at equal bitrate. It is a
 * compatibility one: the audio proxy serves everything as `audio/mpeg` with an
 * `.mp3` name, and Safari/iOS will not decode WebM audio at all, so an m4a body
 * behind that label plays everywhere while a WebM one is silent on Apple
 * devices.
 */
function pickAudio(data: InnertubePlayerResponse): InnertubeFormat | undefined {
  const audio = (data.streamingData?.adaptiveFormats ?? []).filter(
    (format) =>
      format.url && !format.signatureCipher && format.mimeType?.startsWith('audio/'),
  )
  const mp4 = audio.filter((format) => format.mimeType?.includes('mp4'))
  const preferred = mp4.length > 0 ? mp4 : audio
  return preferred.sort(byBitrateDesc)[0]
}

/**
 * One Innertube player call. Shared by stream extraction and the captions
 * path, which read different halves of the same response.
 *
 * Returns null for anything unusable — non-OK playability, network error,
 * non-200 — so callers treat it as "try the next source", never as a throw.
 */
export async function fetchPlayerResponse(
  videoId: string,
): Promise<InnertubePlayerResponse | null> {
  try {
    const response = await http.post<InnertubePlayerResponse>(
      PLAYER_ENDPOINT,
      {
        videoId,
        // Without these, age-gated and "may be inappropriate" videos come back
        // as UNPLAYABLE even when the stream is otherwise available.
        contentCheckOk: true,
        racyCheckOk: true,
        context: { client: ANDROID_VR_CLIENT },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': ANDROID_VR_UA,
          Accept: 'application/json',
        },
        timeout: TIMEOUT_MS,
        validateStatus: () => true,
      },
    )
    if (response.status !== 200) return null
    const data = response.data
    if (data?.playabilityStatus?.status !== 'OK') return null
    return data
  } catch {
    return null
  }
}

/**
 * Resolves a YouTube video through Innertube.
 *
 * Returns null — never throws — for every failure the caller should treat as
 * "try the next extractor": a non-OK playability status (private, age-gated,
 * region-blocked, removed), a network error, or a response with no usable
 * stream. Only the caller knows what to fall back to.
 */
export async function tryYouTubeInnertube(
  videoId: string,
  canonicalUrl: string,
  mode: 'auto' | 'audio',
): Promise<VideoData | null> {
  const data = await fetchPlayerResponse(videoId)
  if (!data) return null

  const audio = pickAudio(data)
  // Audio mode never needs the video track, so a video with no muxed
  // progressive stream can still succeed here.
  if (mode === 'audio') {
    if (!audio?.url) return null
    return {
      ...baseVideoData(data, videoId, canonicalUrl),
      downloadUrl: '',
      musicUrl: audio.url,
    }
  }

  const progressive = pickProgressive(data)
  if (!progressive?.url) return null

  return {
    ...baseVideoData(data, videoId, canonicalUrl),
    downloadUrl: progressive.url,
    // Deliberately no `tunnel: true`. googlevideo serves these inline, with no
    // `Content-Disposition: attachment`, so handing one straight to the browser
    // would play the video instead of saving it. Routing through /api/video
    // gives it the attachment disposition — and repairs Range responses.
    musicUrl: audio?.url,
  }
}

function baseVideoData(
  data: InnertubePlayerResponse,
  videoId: string,
  canonicalUrl: string,
): Omit<VideoData, 'downloadUrl'> {
  const details = data.videoDetails
  return {
    id: videoId,
    title: details?.title || 'YouTube Video',
    url: canonicalUrl,
    thumbnail: pickThumbnail(data, videoId),
    duration: Number(details?.lengthSeconds) || 0,
    author: details?.author || 'YouTube',
    description: details?.shortDescription?.slice(0, 500) || '',
    isPhotoCarousel: false,
  }
}
