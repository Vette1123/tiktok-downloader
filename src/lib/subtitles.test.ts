import { describe, expect, it } from 'vitest'
import {
  eventsToSubtitle,
  extractCaptionTracks,
  findTrackUrl,
  parseJson3,
} from './subtitles'

const playerResponse = {
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&v=x',
          languageCode: 'en',
          name: { runs: [{ text: 'English' }] },
        },
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&kind=asr&v=x',
          languageCode: 'en',
          kind: 'asr',
          name: { runs: [{ text: 'English' }] },
        },
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?lang=de&v=x',
          languageCode: 'de',
          name: { runs: [{ text: 'Deutsch' }] },
        },
        // No baseUrl — an untranslatable entry that must be skipped silently.
        { languageCode: 'fr', name: { runs: [{ text: 'Français' }] } },
      ],
    },
  },
}

describe('extractCaptionTracks', () => {
  it('lists manual tracks before auto-generated ones', () => {
    const tracks = extractCaptionTracks(playerResponse)
    expect(tracks.map((t) => t.name)).toEqual([
      'Deutsch',
      'English',
      'English (auto)',
    ])
    expect(tracks[2].auto).toBe(true)
  })

  it('drops entries without a fetchable baseUrl', () => {
    expect(
      extractCaptionTracks(playerResponse).some((t) => t.languageCode === 'fr'),
    ).toBe(false)
  })

  it('returns empty for a video without captions', () => {
    expect(extractCaptionTracks({})).toEqual([])
  })
})

describe('findTrackUrl', () => {
  it('distinguishes the manual track from the ASR one for the same language', () => {
    const manual = findTrackUrl(playerResponse, 'en', false)
    const asr = findTrackUrl(playerResponse, 'en', true)
    expect(manual).toContain('lang=en&v=x')
    expect(asr).toContain('kind=asr')
  })

  it('returns null when the language has no usable track', () => {
    expect(findTrackUrl(playerResponse, 'fr', false)).toBeNull()
    expect(findTrackUrl({}, 'en', false)).toBeNull()
  })
})

describe('parseJson3 / eventsToSubtitle', () => {
  const body = JSON.stringify({
    events: [
      { tStartMs: 1240, dDurationMs: 2000, segs: [{ utf8: 'hello ' }, { utf8: 'world' }] },
      { segs: [{ utf8: 'no timing' }] },
      { tStartMs: 3620000, dDurationMs: 900, segs: [{ utf8: 'one hour in' }] },
      { tStartMs: 5000, dDurationMs: 1000, segs: [] },
    ],
  })

  it('parses the event array and skips nothing silently', () => {
    expect(parseJson3(body)).toHaveLength(4)
    expect(parseJson3('not json')).toEqual([])
    expect(parseJson3('{}')).toEqual([])
  })

  it('renders sequential SRT cues with comma stamps', () => {
    const srt = eventsToSubtitle(parseJson3(body), 'srt')
    // First usable cue.
    expect(srt).toContain('1\n00:00:01,240 --> 00:00:03,240\nhello world')
    // The hour-long cue proves multi-segment stamping: 1h00m20s. Cues without
    // text (empty segs) are skipped and never consume an index.
    expect(srt).toContain('2\n01:00:20,000 --> 01:00:20,900\none hour in')
  })

  it('renders VTT with a WEBVTT header and dot stamps', () => {
    const vtt = eventsToSubtitle(parseJson3(body), 'vtt')
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true)
    // The hour-long cue proves multi-digit stamping: 01:00:20.000.
    expect(vtt).toContain('01:00:20.000')
    expect(vtt).not.toContain(',')
  })

  it('defaults a cue with no duration to a sane minimum so players show it', () => {
    const srt = eventsToSubtitle([{ tStartMs: 0, segs: [{ utf8: 'x' }] }], 'srt')
    expect(srt).toContain('00:00:00,000 --> 00:00:01,500')
  })
})
