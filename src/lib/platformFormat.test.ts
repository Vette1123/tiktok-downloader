import { describe, expect, it } from 'vitest'
import {
  effectiveFormat,
  removeFormat,
  upsertFormat,
  type FormatMap,
} from './platformFormat'
import { effectiveQuality, upsertQuality } from './platformQuality'

/**
 * Per-platform format, the sibling of per-platform quality.
 *
 * "MP3 from YouTube, video from TikTok" is an ordinary habit, and on YouTube it
 * is no longer even a preference: video is unobtainable from this host, so the
 * MP3 is the whole of what a link there can give. Somebody who picks it once
 * should not pick it on every link.
 */
describe('the platform format map (pure core)', () => {
  it('remembers a choice for one platform only', () => {
    const map = upsertFormat({}, 'youtube', 'audio')
    expect(effectiveFormat('video', 'youtube', map)).toBe('audio')
    expect(effectiveFormat('video', 'tiktok', map)).toBe('video')
  })

  /**
   * The memory beats the global toggle, in both directions. Somebody whose
   * global is MP3 can still pin video for the one platform they watch.
   */
  it('overrides the global in either direction', () => {
    const map = upsertFormat({}, 'tiktok', 'video')
    expect(effectiveFormat('audio', 'tiktok', map)).toBe('video')
    expect(effectiveFormat('audio', 'instagram', map)).toBe('audio')
  })

  it('falls back to the global with no platform to go on', () => {
    expect(effectiveFormat('audio', null, { youtube: 'video' })).toBe('audio')
    expect(effectiveFormat('audio', undefined, {})).toBe('audio')
  })

  it('forgets on request, and tolerates forgetting what it never knew', () => {
    const map: FormatMap = { youtube: 'audio', tiktok: 'video' }
    expect(removeFormat(map, 'youtube')).toEqual({ tiktok: 'video' })
    expect(removeFormat(map, 'vimeo')).toBe(map)
  })

  /** An unchanged write returns the same object, so React skips the re-render. */
  it('is identity-stable when nothing changed', () => {
    const map = upsertFormat({}, 'youtube', 'audio')
    expect(upsertFormat(map, 'youtube', 'audio')).toBe(map)
  })
})

/**
 * The two memories are one shape (`platformMemory`) with two names. This is
 * what keeps that generalisation honest: they must stay independent, because a
 * shared store keyed the same way would have made "MP3 for YouTube" also mean
 * "data saver for YouTube".
 */
describe('format and quality do not touch each other', () => {
  it('keeps separate maps', () => {
    const formats = upsertFormat({}, 'youtube', 'audio')
    const qualities = upsertQuality({}, 'youtube', 'sd')
    expect(effectiveFormat('video', 'youtube', formats)).toBe('audio')
    expect(effectiveQuality('hd', 'youtube', qualities)).toBe('sd')
    // Neither map has the other's key in it.
    expect(Object.values(formats)).toEqual(['audio'])
    expect(Object.values(qualities)).toEqual(['sd'])
  })
})
