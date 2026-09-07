/**
 * Per-platform format memory: video or MP3, remembered per site.
 *
 * The same argument as quality, one step further. "MP3 from YouTube, video from
 * TikTok" is an ordinary way to use this site — and it stopped being a nicety
 * when YouTube video became unobtainable from this host, because the MP3 is now
 * the whole of what a YouTube link can give. Somebody who picks it once should
 * not have to pick it on every link.
 *
 * Set the same way quality is: by an explicit re-pick on a result, which is a
 * statement about that platform rather than about that post. The paste-bar
 * toggle keeps owning the global default.
 *
 * Local-only, for the same reason: what a browser is being used for is device
 * taste, and syncing it would push a phone's habits onto a desktop.
 */

import { isFormat, type Format } from './prefsCore'
import {
  effectiveFor,
  platformMemory,
  removeFor,
  upsertFor,
  type PlatformMap,
} from './platformMemory'
import type { SupportedPlatform } from './validator'

export type FormatMap = PlatformMap<Format>

const store = platformMemory<Format>('smd:platfmt', isFormat)

export function upsertFormat(
  map: FormatMap,
  platform: SupportedPlatform,
  format: Format,
): FormatMap {
  return upsertFor(map, platform, format)
}

export function removeFormat(
  map: FormatMap,
  platform: SupportedPlatform,
): FormatMap {
  return removeFor(map, platform)
}

export function effectiveFormat(
  globalFormat: Format,
  platform: SupportedPlatform | null | undefined,
  map: FormatMap,
): Format {
  return effectiveFor(globalFormat, platform, map)
}

export function rememberPlatformFormat(
  platform: SupportedPlatform,
  format: Format,
): void {
  store.remember(platform, format)
}

export function clearPlatformFormat(platform: SupportedPlatform): void {
  store.clear(platform)
}

export function getStoredFormatMap(): FormatMap {
  return store.all()
}
