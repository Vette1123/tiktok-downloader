'use client'

/**
 * The two sticky download preferences (quality and format), held in a tiny
 * external store instead of component state.
 *
 * They used to be `useState` defaults rehydrated by a mount effect that read
 * localStorage and called setState. That is the exact cascade
 * `react-hooks/set-state-in-effect` exists to catch, and it also meant the
 * toggles visibly flipped from the default to the stored value a frame after
 * paint.
 *
 * Modelling them as an external store fixes both: `useSyncExternalStore` uses
 * the server snapshot while prerendering and during hydration, then reads the
 * stored value on the very first client pass — no effect, no extra render, and
 * no hydration mismatch. Writes update the cache, persist, and notify.
 *
 * The values and their validation live in ./prefsCore, which imports nothing:
 * the Worker validates a POSTed body with the same code without loading React.
 */

import { useSyncExternalStore } from 'react'
import {
  DEFAULTS,
  type Format,
  type Prefs,
  type Quality,
  isFormat,
  isQuality,
  isSubtitleLang,
  mergePrefs,
  normalisePrefs,
} from './prefsCore'

export { mergePrefs, normalisePrefs }
export type { Format, Prefs, Quality }

const QUALITY_KEY = 'smd:quality'
const FORMAT_KEY = 'smd:format'
const SUBTITLE_LANG_KEY = 'smd:subtitle-lang'

let cache: Prefs | null = null
const listeners = new Set<() => void>()

function readStored(): Prefs {
  try {
    const quality = window.localStorage.getItem(QUALITY_KEY)
    const format = window.localStorage.getItem(FORMAT_KEY)
    const subtitleLang = window.localStorage.getItem(SUBTITLE_LANG_KEY)
    return {
      quality: isQuality(quality) ? quality : DEFAULTS.quality,
      format: isFormat(format) ? format : DEFAULTS.format,
      ...(isSubtitleLang(subtitleLang) ? { subtitleLang } : {}),
    }
  } catch {
    // Storage blocked (private mode, cookie policy) — defaults are fine.
    return DEFAULTS
  }
}

function getSnapshot(): Prefs {
  cache ??= readStored()
  return cache
}

function getServerSnapshot(): Prefs {
  return DEFAULTS
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage blocked — the in-memory value still applies for this session.
  }
}

function commit(next: Prefs): void {
  cache = next
  for (const listener of listeners) listener()
}

export function setQuality(quality: Quality): void {
  const current = getSnapshot()
  if (current.quality === quality) return
  write(QUALITY_KEY, quality)
  commit({ ...current, quality })
}

export function setFormat(format: Format): void {
  const current = getSnapshot()
  if (current.format === format) return
  write(FORMAT_KEY, format)
  commit({ ...current, format })
}

export function setSubtitleLang(lang: string | undefined): void {
  const current = getSnapshot()
  if (current.subtitleLang === lang) return
  if (lang) write(SUBTITLE_LANG_KEY, lang)
  else {
    try {
      window.localStorage.removeItem(SUBTITLE_LANG_KEY)
    } catch {
      // ignore
    }
  }
  commit({ ...current, subtitleLang: lang })
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Called after a refresh with whatever the `prefs` column held. Pushes local
 * values up on a first login, and adopts the server's on every later one.
 */
export function adoptServerPrefs(raw: unknown): void {
  const server = normalisePrefs(raw)
  const merged = mergePrefs(getSnapshot(), server)

  if (!server) {
    void persistPrefs(merged)
    return
  }

  if (merged.quality !== getSnapshot().quality) setQuality(merged.quality)
  if (merged.format !== getSnapshot().format) setFormat(merged.format)
  if (merged.subtitleLang !== getSnapshot().subtitleLang) {
    setSubtitleLang(merged.subtitleLang)
  }
}

/** Write the current preferences to the account, if there is one. */
export async function persistPrefs(prefs: Prefs): Promise<void> {
  try {
    await fetch('/api/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefs }),
    })
  } catch {
    // Local storage already has the value; the next change retries.
  }
}
