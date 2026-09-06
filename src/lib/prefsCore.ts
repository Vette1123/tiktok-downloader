/**
 * The preference *values* and their validation — no React, no storage, no
 * `'use client'`.
 *
 * This exists so the Worker can validate a POSTed `prefs` body without loading
 * the client store. `src/lib/prefs.ts` carries the `'use client'` directive and
 * imports React; when the /api/account handler imported `normalisePrefs` from
 * there, the emitted bundle evaluated React's entire module scope on the first
 * account request in every isolate — inside a 10 ms CPU budget — to run a
 * twenty-line validator. One implementation, two importers: the client store
 * re-exports these, the server route imports them directly.
 *
 * The one import here is `./filename`, which is plain strings and `Date` with
 * no imports of its own — the template predicate has to be the *same* one the
 * builder uses, or storage would accept a shape the builder then ignores.
 */

import { isFilenameTemplate } from './filename'

export type Quality = 'hd' | 'sd'
export type Format = 'video' | 'audio'

export interface Prefs {
  quality: Quality
  format: Format
  /**
   * Preferred caption language for the subtitle picker (BCP-47-ish, as YouTube
   * uses them: 'en', 'pt-BR', …). Optional — absent until the visitor downloads
   * their first track — so older stored prefs stay valid untouched.
   */
  subtitleLang?: string
  /**
   * How saved files are named, for supporters who set one. Absent means the
   * built-in dated shape, which is what everyone had before and what a free
   * visitor keeps. Validated with the same predicate the filename builder uses,
   * so a template the builder would refuse never reaches storage.
   */
  filenameTemplate?: string
}

/**
 * Stable reference on purpose. Snapshots are compared by identity, so handing
 * back a fresh object each call would re-render forever.
 */
export const DEFAULTS: Prefs = Object.freeze({ quality: 'hd', format: 'video' })

export function isQuality(value: unknown): value is Quality {
  return value === 'hd' || value === 'sd'
}

export function isFormat(value: unknown): value is Format {
  return value === 'video' || value === 'audio'
}

/** A language code as YouTube's timed-text API issues them. */
export function isSubtitleLang(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/.test(value)
}

/**
 * Validate whatever arrived from the network or the database.
 *
 * Accepts both the parsed object and the raw JSON string, because the `prefs`
 * column stores a string and the API hands back either. A missing field falls
 * back to its default; a *wrong* field is rejected outright, since that means
 * something upstream is confused and silently coercing it would hide the bug.
 */
export function normalisePrefs(value: unknown): Prefs | null {
  if (value === null || value === undefined) return null

  let candidate = value
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate)
    } catch {
      return null
    }
  }
  if (typeof candidate !== 'object' || candidate === null) return null

  const { quality, format, subtitleLang, filenameTemplate } = candidate as {
    quality?: unknown
    format?: unknown
    subtitleLang?: unknown
    filenameTemplate?: unknown
  }
  if (quality !== undefined && !isQuality(quality)) return null
  if (format !== undefined && !isFormat(format)) return null

  const prefs: Prefs = {
    quality: (quality as Quality) ?? DEFAULTS.quality,
    format: (format as Format) ?? DEFAULTS.format,
  }
  // An absent language is the normal case; a present-but-invalid one is
  // dropped rather than rejected wholesale — it must not poison quality/format.
  if (isSubtitleLang(subtitleLang)) prefs.subtitleLang = subtitleLang
  // Same rule for the filename shape, and for a stronger reason: this value is
  // written into a `download` attribute, so an unvalidated one is a path
  // hazard, not a cosmetic problem.
  if (isFilenameTemplate(filenameTemplate)) {
    prefs.filenameTemplate = filenameTemplate.trim()
  }
  return prefs
}

/**
 * Server wins when it has an opinion; otherwise the local choices are carried
 * up. Signing in must never silently change how the tool behaves for someone
 * who already set their preferences in this browser.
 */
export function mergePrefs(local: Prefs, server: Prefs | null): Prefs {
  return server ?? local
}
