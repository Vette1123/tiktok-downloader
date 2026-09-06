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
 * SECOND CLIENT — and the reason this file no longer delivers video. Re-probed
 * from the same edge on 2026-09-07 across four videos, ANDROID_VR answers three
 * of them `200` with `playabilityStatus: LOGIN_REQUIRED, "Sign in to confirm
 * you're not a bot"` and no streaming data at all. (It also 403s outright with
 * Google's "Sorry..." abuse page on roughly one call in six, but that is the
 * smaller problem.) The single video that still works, `dQw4w9WgXcQ`, is the
 * most-cached video on the internet and is not evidence about any other.
 *
 * No client fixes the video half. IOS, IOS_MUSIC, MWEB, TVHTML5,
 * TVHTML5_SIMPLY_EMBEDDED_PLAYER, ANDROID_UNPLUGGED, ANDROID_TESTSUITE and
 * WEB_CREATOR were all asked for the same blocked videos: every one is blocked,
 * sign-in-walled, or — IOS, the only one that answers OK — adaptive-only. A
 * muxed stream is what we need and ANDROID_VR is the only client that ever had
 * one. So downloadYouTube falls through to Cobalt, and when that fails too, to
 * the embed.
 *
 * IOS still earns its place, because two things were failing that did not have
 * to be:
 *
 *   - `/api/subtitles` reads this same player response, so for most videos it
 *     was telling supporters a public video "may be private or unavailable".
 *   - The audio is right there. IOS returns unsigned audio-only URLs for
 *     exactly the videos ANDROID_VR refuses, so the embed fallback can still
 *     hand over an MP3 instead of a dead end.
 *
 * Verified the way the ANDROID_VR probe above was — extracted from the edge,
 * then fetched from a different address: itag 140 (`audio/mp4`, AAC 130 kbps,
 * the one `pickAudio` wants) gives `206 audio/mp4`, and a caption `baseUrl`
 * gives the real transcript XML. The second call is spent only when the first
 * fails, and the loop stops at the first usable answer.
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
 * One impersonated client. Version strings are sent verbatim; YouTube rejects
 * clients it does not recognise, so these are real released versions rather
 * than something plausible-looking, and the user-agent has to match the client
 * it claims to be.
 */
interface InnertubeClient {
  name: string
  context: Record<string, string | number>
  userAgent: string
}

/** The Oculus YouTube app. The only client that still publishes a muxed stream. */
const ANDROID_VR: InnertubeClient = {
  name: 'ANDROID_VR',
  context: {
    clientName: 'ANDROID_VR',
    clientVersion: '1.62.27',
    androidSdkVersion: 32,
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    osName: 'Android',
    osVersion: '12',
    hl: 'en',
    gl: 'US',
  },
  userAgent:
    'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12; GB) gzip',
}

/** The iPhone app. Adaptive formats only, but answers when ANDROID_VR is blocked. */
const IOS: InnertubeClient = {
  name: 'IOS',
  context: {
    clientName: 'IOS',
    clientVersion: '20.10.4',
    deviceMake: 'Apple',
    deviceModel: 'iPhone16,2',
    osName: 'iPhone',
    osVersion: '18.3.2.22D82',
    hl: 'en',
    gl: 'US',
  },
  userAgent:
    'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; en_US)',
}

/**
 * Tried in order, first usable answer wins. ANDROID_VR leads because it is the
 * only one carrying a muxed progressive stream; IOS is the standby for the
 * calls where ANDROID_VR is rate-limited.
 */
const CLIENTS: readonly InnertubeClient[] = [ANDROID_VR, IOS]

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
 * How one client answered, in a few characters, for the log line below.
 *
 * `LOGIN_REQUIRED` and a `403` mean completely different things — "Google
 * thinks this address is a bot" versus "Google is rate-limiting this address" —
 * and from outside a deployed isolate the two are indistinguishable. Both look
 * like "YouTube doesn't work". This is what tells them apart in `wrangler tail`.
 */
type ClientOutcome = string

/** One player call as one client. Null means "this client cannot serve it". */
async function askClient(
  client: InnertubeClient,
  videoId: string,
  outcomes: ClientOutcome[],
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
        context: { client: client.context },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': client.userAgent,
          Accept: 'application/json',
        },
        timeout: TIMEOUT_MS,
        validateStatus: () => true,
      },
    )
    if (response.status !== 200) {
      outcomes.push(`${client.name}:${response.status}`)
      return null
    }
    const data = response.data
    const status = data?.playabilityStatus?.status
    if (status !== 'OK') {
      outcomes.push(`${client.name}:${status ?? 'no-status'}`)
      return null
    }
    return data
  } catch (error) {
    outcomes.push(`${client.name}:threw(${(error as Error)?.message ?? '?'})`)
    return null
  }
}

/**
 * One usable Innertube player response. Shared by stream extraction and the
 * captions path, which read different halves of it.
 *
 * Asks each client in turn and returns the first that answers usably. Returns
 * null only when every one of them failed — a network error, a non-200 (which
 * on this host usually means Google's abuse page rather than JSON), or a
 * playability status that is not OK because the video really is private,
 * age-gated, region-blocked or removed. Callers treat null as "try the next
 * source", never as a throw.
 *
 * The loop stops at the first success, so the common path still costs exactly
 * one subrequest.
 */
export async function fetchPlayerResponse(
  videoId: string,
): Promise<InnertubePlayerResponse | null> {
  const outcomes: ClientOutcome[] = []
  for (const client of CLIENTS) {
    const data = await askClient(client, videoId, outcomes)
    if (data) return data
  }
  // Only when EVERY client failed, so a working resolve logs nothing. Without
  // it this function is a black box: it swallows a bot-block, a rate limit, a
  // private video and a timeout into the same `null`, and the visitor-facing
  // result for all four is a YouTube embed with no download — which is exactly
  // the shape that hid a total extraction failure until somebody pasted a link
  // and looked. See lessons/2026-09-07-youtube-was-answering-with-an-embed.md.
  console.warn(`Innertube gave up on ${videoId}: ${outcomes.join(' ')}`)
  return null
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
  // No muxed stream — which since the IOS fallback is the ordinary outcome, not
  // an odd one. Report what there IS rather than nothing: `downloadUrl` stays
  // empty, so no caller can mistake an adaptive video track for a playable
  // file, but the audio comes back for whoever wants it. downloadYouTube uses
  // it to put a working MP3 button beside the embed, which would otherwise cost
  // a second player call for a response we are already holding.
  if (!progressive?.url) {
    if (!audio?.url) return null
    return {
      ...baseVideoData(data, videoId, canonicalUrl),
      downloadUrl: '',
      musicUrl: audio.url,
    }
  }

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
