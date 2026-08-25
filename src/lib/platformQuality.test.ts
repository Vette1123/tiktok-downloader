import { describe, expect, it } from 'vitest'
import {
  effectiveQuality,
  removeQuality,
  upsertQuality,
  type QualityMap,
} from './platformQuality'

describe('the platform quality map (pure core)', () => {
  it('starts empty and defers to the global pref', () => {
    const map: QualityMap = {}
    expect(effectiveQuality('hd', 'tiktok', map)).toBe('hd')
    expect(effectiveQuality('hd', null, map)).toBe('hd')
  })

  it('remembers per platform without touching the others', () => {
    let map: QualityMap = {}
    map = upsertQuality(map, 'tiktok', 'sd')
    map = upsertQuality(map, 'youtube', 'hd')
    expect(effectiveQuality('hd', 'tiktok', map)).toBe('sd')
    expect(effectiveQuality('hd', 'youtube', map)).toBe('hd')
  })

  it('is a no-op when the value already matches (same reference out)', () => {
    const map: QualityMap = { tiktok: 'sd' }
    expect(upsertQuality(map, 'tiktok', 'sd')).toBe(map)
  })

  it('overwrites and removes cleanly; removing an absent entry is a no-op', () => {
    let map: QualityMap = upsertQuality({}, 'instagram', 'sd')
    map = upsertQuality(map, 'instagram', 'hd')
    expect(map.instagram).toBe('hd')
    const removed = removeQuality(map, 'instagram')
    expect(removed.instagram).toBeUndefined()
    // Same reference when nothing was there to remove.
    expect(removeQuality(removed, 'vimeo')).toBe(removed)
  })
})
