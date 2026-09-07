/**
 * "Remember this choice for this platform."
 *
 * Quality was the first thing that needed it: one global toggle for eleven
 * platforms is a fight, because somebody archiving short dances wants data
 * saver and somebody pulling lectures wants the best available. Format is the
 * second — MP3 from YouTube and video from TikTok is an ordinary way to use
 * this site, and it became a more ordinary one once YouTube video stopped being
 * obtainable here at all and the MP3 became the whole point.
 *
 * Two is where a shape earns a name. The map operations and the storage
 * wrapper live here once; `platformQuality` and `platformFormat` are the thin
 * instantiations, keeping their own names so call sites read as what they mean
 * rather than as a generic.
 *
 * Local-only by design, both of them. This is device taste — bandwidth, and
 * what this particular browser is being used for — not account taste, and
 * syncing it would carry a phone's data-saver choice onto a desktop.
 */

import type { SupportedPlatform } from './validator'

export type PlatformMap<T> = Partial<Record<SupportedPlatform, T>>

/** Insert/update one entry, returning a new map. No-op when unchanged. */
export function upsertFor<T>(
  map: PlatformMap<T>,
  platform: SupportedPlatform,
  value: T,
): PlatformMap<T> {
  if (map[platform] === value) return map
  return { ...map, [platform]: value }
}

/** Remove one entry; absent entries are fine. */
export function removeFor<T>(
  map: PlatformMap<T>,
  platform: SupportedPlatform,
): PlatformMap<T> {
  if (!(platform in map)) return map
  const next = { ...map }
  delete next[platform]
  return next
}

/** Override wins; without one the global preference answers. */
export function effectiveFor<T>(
  globalValue: T,
  platform: SupportedPlatform | null | undefined,
  map: PlatformMap<T>,
): T {
  if (!platform) return globalValue
  return map[platform] ?? globalValue
}

/**
 * The storage half: read, write, remember, clear, all bound to one key and one
 * validator.
 *
 * The validator is not decoration. This reads whatever is in localStorage,
 * which may have been written by an older build, hand-edited, or shared with a
 * different key by accident — and an unrecognised value would otherwise be
 * handed to a resolver as though somebody had chosen it.
 */
export function platformMemory<T>(
  key: string,
  isValue: (value: unknown) => value is T,
) {
  function read(): PlatformMap<T> {
    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) return {}
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed !== 'object' || parsed === null) return {}
      const out: PlatformMap<T> = {}
      for (const [platform, value] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        if (isValue(value)) out[platform as SupportedPlatform] = value
      }
      return out
    } catch {
      return {}
    }
  }

  function write(map: PlatformMap<T>): void {
    try {
      window.localStorage.setItem(key, JSON.stringify(map))
    } catch {
      // Storage blocked — the memory just does not persist.
    }
  }

  return {
    all: read,
    remember(platform: SupportedPlatform, value: T): void {
      write(upsertFor(read(), platform, value))
    },
    clear(platform: SupportedPlatform): void {
      write(removeFor(read(), platform))
    },
  }
}
