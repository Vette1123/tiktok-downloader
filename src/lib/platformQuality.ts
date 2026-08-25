/**
 * Per-platform quality memory.
 *
 * The global quality pref is one knob for eleven platforms, but usage is not
 * uniform: someone archiving TikTok dances wants data-saver, someone pulling
 * YouTube lectures wants 1080p. Rather than make the global toggle a fight,
 * an explicit HD/SD re-pick on a *result* is remembered for that platform
 * alone and wins over the global at resolve time. The paste-bar toggle keeps
 * setting the global; a one-line hint under it shows when a platform has its
 * own memory and offers a reset.
 *
 * Local-only by design — this is device taste (bandwidth), not account taste.
 * The map logic is pure (tested); the storage wrappers around it are three
 * lines each.
 */

import type { Quality } from './prefsCore'
import type { SupportedPlatform } from './validator'

const KEY = 'smd:platq'

export type QualityMap = Partial<Record<SupportedPlatform, Quality>>

/** Insert/update one entry, returning a new map. No-op when unchanged. */
export function upsertQuality(
  map: QualityMap,
  platform: SupportedPlatform,
  quality: Quality,
): QualityMap {
  if (map[platform] === quality) return map
  return { ...map, [platform]: quality }
}

/** Remove one entry; absent entries are fine. */
export function removeQuality(map: QualityMap, platform: SupportedPlatform): QualityMap {
  if (!(platform in map)) return map
  const next = { ...map }
  delete next[platform]
  return next
}

/** Override wins; without one the global pref answers. */
export function effectiveQuality(
  globalQuality: Quality,
  platform: SupportedPlatform | null | undefined,
  map: QualityMap,
): Quality {
  if (!platform) return globalQuality
  return map[platform] ?? globalQuality
}

function read(): QualityMap {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: QualityMap = {}
    for (const [platform, q] of Object.entries(parsed as Record<string, unknown>)) {
      if (q === 'hd' || q === 'sd') out[platform as SupportedPlatform] = q
    }
    return out
  } catch {
    return {}
  }
}

function write(map: QualityMap): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    // storage blocked — the memory just does not persist.
  }
}

export function rememberPlatformQuality(
  platform: SupportedPlatform,
  quality: Quality,
): void {
  write(upsertQuality(read(), platform, quality))
}

export function clearPlatformQuality(platform: SupportedPlatform): void {
  write(removeQuality(read(), platform))
}

export function getStoredQualityMap(): QualityMap {
  return read()
}
