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
 *
 * The map and storage logic moved to `platformMemory` when format needed the
 * same shape; what is left here is the naming, which is the part call sites
 * read. The exported names are unchanged.
 */

import { isQuality, type Quality } from './prefsCore'
import {
  effectiveFor,
  platformMemory,
  removeFor,
  upsertFor,
  type PlatformMap,
} from './platformMemory'
import type { SupportedPlatform } from './validator'

export type QualityMap = PlatformMap<Quality>

const store = platformMemory<Quality>('smd:platq', isQuality)

/** Insert/update one entry, returning a new map. No-op when unchanged. */
export function upsertQuality(
  map: QualityMap,
  platform: SupportedPlatform,
  quality: Quality,
): QualityMap {
  return upsertFor(map, platform, quality)
}

/** Remove one entry; absent entries are fine. */
export function removeQuality(
  map: QualityMap,
  platform: SupportedPlatform,
): QualityMap {
  return removeFor(map, platform)
}

/** Override wins; without one the global pref answers. */
export function effectiveQuality(
  globalQuality: Quality,
  platform: SupportedPlatform | null | undefined,
  map: QualityMap,
): Quality {
  return effectiveFor(globalQuality, platform, map)
}

export function rememberPlatformQuality(
  platform: SupportedPlatform,
  quality: Quality,
): void {
  store.remember(platform, quality)
}

export function clearPlatformQuality(platform: SupportedPlatform): void {
  store.clear(platform)
}

export function getStoredQualityMap(): QualityMap {
  return store.all()
}
