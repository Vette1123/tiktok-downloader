/**
 * YouTube captions, without yt-dlp.
 *
 * The Innertube player response already carries everything needed: a track
 * list (`captions.playerCaptionsTracklistRenderer.captionTracks`) whose every
 * entry names a language and points at a timed-text URL. Adding `&fmt=json3`
 * to that URL yields small JSON events rather than XML, which converts to SRT
 * or VTT with plain string work — comfortably inside a Worker's CPU budget,
 * no binary anywhere.
 *
 * Everything here is pure so the conversion can be unit-tested against real
 * event shapes.
 */

export interface CaptionTrack {
  languageCode: string
  /** Human label ("English", "English (auto-generated)"). */
  name: string
  /** True for YouTube's automatic speech recognition tracks. */
  auto: boolean
}

interface RawCaptionTrack {
  baseUrl?: string
  languageCode?: string
  kind?: string
  name?: { runs?: Array<{ text?: string }> }
}

interface Json3Event {
  tStartMs?: number
  dDurationMs?: number
  segs?: Array<{ utf8?: string }>
}

/** The subset of the Innertube player response this module reads. */
export interface PlayerResponseWithCaptions {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: RawCaptionTrack[]
    }
  }
  videoDetails?: { title?: string }
}

function trackName(track: RawCaptionTrack): string {
  const runs = track.name?.runs ?? []
  const text = runs.map((run) => run.text ?? '').join('').trim()
  if (!text) return track.languageCode || 'unknown'
  return track.kind === 'asr' ? `${text} (auto)` : text
}

/**
 * The usable tracks, ordered: manual languages first (they are human-written),
 * then ASR, each alphabetically. Empty when the video has none — which is the
 * honest answer, not an error.
 */
export function extractCaptionTracks(
  data: PlayerResponseWithCaptions,
): CaptionTrack[] {
  const raw = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
  const tracks: Array<CaptionTrack & { baseUrl: string }> = []
  for (const track of raw) {
    if (!track.baseUrl || !track.languageCode) continue
    tracks.push({
      languageCode: track.languageCode,
      name: trackName(track),
      auto: track.kind === 'asr',
      baseUrl: track.baseUrl,
    })
  }
  // Stable two-tier sort without a nested ternary: manual before auto, then
  // by display name.
  return tracks
    .sort((a, b) => {
      const byAuto = Number(a.auto) - Number(b.auto)
      return byAuto !== 0 ? byAuto : a.name.localeCompare(b.name)
    })
    .map(({ baseUrl: _baseUrl, ...track }) => track)
}

/** Look up one track's baseUrl by language code (+ ASR flag). */
export function findTrackUrl(
  data: PlayerResponseWithCaptions,
  languageCode: string,
  auto: boolean,
): string | null {
  const raw = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
  for (const track of raw) {
    if (
      track.baseUrl &&
      track.languageCode === languageCode &&
      (track.kind === 'asr') === auto
    ) {
      return track.baseUrl
    }
  }
  return null
}

/** SRT stamp: `00:01:02,480`. */
function srtStamp(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const millis = total % 1000
  const pad = (n: number, width: number) => String(n).padStart(width, '0')
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`
}

/** WebVTT stamp: `00:01:02.480`. */
function vttStamp(ms: number): string {
  return srtStamp(ms).replace(',', '.')
}

function cueText(event: Json3Event): string {
  return (event.segs ?? [])
    .map((seg) => seg.utf8 ?? '')
    .join('')
    .replace(/\r/g, '')
    .trim()
}

/**
 * Convert json3 events into SRT or VTT. Overlaps are left as-is — both
 * formats tolerate them and re-timing cues is a lossy judgement call this
 * tool has no business making.
 */
export function eventsToSubtitle(
  events: Json3Event[],
  format: 'srt' | 'vtt',
): string {
  const stamp = format === 'srt' ? srtStamp : vttStamp
  const lines: string[] = []
  if (format === 'vtt') lines.push('WEBVTT', '')

  let index = 1
  for (const event of events) {
    const text = cueText(event)
    if (!text || typeof event.tStartMs !== 'number') continue
    const start = event.tStartMs
    const end = start + Math.max(1, event.dDurationMs ?? 1500)
    if (format === 'srt') lines.push(String(index))
    lines.push(`${stamp(start)} --> ${stamp(end)}`)
    lines.push(text)
    lines.push('')
    index += 1
  }
  return lines.join('\n')
}

/** Parse a json3 timed-text body. Returns [] for anything malformed. */
export function parseJson3(body: string): Json3Event[] {
  try {
    const parsed = JSON.parse(body) as { events?: Json3Event[] }
    return Array.isArray(parsed.events) ? parsed.events : []
  } catch {
    return []
  }
}
