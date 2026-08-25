import {
  isLocale,
  isRtl,
  translate,
  type TKey,
  type Locale,
} from './i18n'
import { useSyncExternalStore, useCallback } from 'react'

/**
 * The locale as an external store — the codebase's sanctioned shape for
 * "localStorage-backed value read by React" (see proSignals/history): the
 * server snapshot is always 'en', so prerender and hydration agree, and
 * useSyncExternalStore re-renders with the stored choice after mount without
 * a setState-in-effect anywhere.
 *
 * `document` mirroring (lang + dir for Arabic) happens imperatively beside
 * the store write, outside React's rendering.
 */

const LOCALE_KEY = 'smd:lang'

let current: Locale = 'en'
const listeners = new Set<() => void>()

function mirrorDocument(locale: Locale): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale
  document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr'
}

// Hydrate once at first client import. Module init is outside rendering, so
// this is a store load rather than a state update during render.
if (typeof window !== 'undefined') {
  try {
    const stored = window.localStorage.getItem(LOCALE_KEY)
    if (isLocale(stored)) {
      current = stored
      mirrorDocument(current)
    }
  } catch {
    // private mode / disabled storage — English until changed this session.
  }
}

export function getLocaleSnapshot(): Locale {
  return current
}

/** Prerender and hydration always speak English; the store takes over after. */
export function getLocaleServerSnapshot(): Locale {
  return 'en'
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setLocale(next: Locale): void {
  if (next === current) return
  current = next
  try {
    window.localStorage.setItem(LOCALE_KEY, next)
  } catch {
    // storage disabled — the choice lives for this session only.
  }
  mirrorDocument(next)
  for (const listener of listeners) listener()
}

/**
 * `const t = useT()` → `t('viewAll', { n: 12 })`. Re-renders its user when
 * the locale changes; falls back per-key to English for anything a dictionary
 * has not caught up with yet.
 */
export function useT(): (
  key: TKey,
  vars?: Record<string, string | number>,
) => string {
  const locale = useSyncExternalStore(
    subscribeLocale,
    getLocaleSnapshot,
    getLocaleServerSnapshot,
  )
  return useCallback(
    (key: TKey, vars?: Record<string, string | number>) =>
      translate(locale, key, vars),
    [locale],
  )
}
