// Local, privacy-friendly download history.
//
// Persists a small list of successfully-resolved links in localStorage so a user
// can re-open something they grabbed before without re-pasting. We store the
// ORIGINAL post URL + light metadata — never the resolved CDN/stream URL, which
// is short-lived and signed. Re-downloading re-runs the normal resolve flow.
//
// Everything is guarded for SSR (no window during prerender) and degrades to a
// no-op if storage is unavailable (private mode, quota, disabled).

import type { SupportedPlatform } from '@/lib/validator'

export interface HistoryEntry {
  /** Stable key — the original post URL. */
  url: string
  title: string
  author: string
  platform?: SupportedPlatform
  thumbnail?: string
  /** Epoch ms; set by the caller (module can't call Date.now during render). */
  ts: number
  /**
   * When a file for this link was actually saved, if one ever was.
   *
   * Deliberately separate from `ts`, which is set the moment a link *resolves*.
   * Resolving and saving are different events — a visitor pastes several links,
   * looks at the cards, downloads two of them — and "have I already got this
   * one" is a question only the second answers. Absent on every entry written
   * before this field existed, which reads correctly as "not known to be
   * saved".
   */
  savedAt?: number
}

const KEY = 'smd:history:v1'
// Keep a generous backlog so "View all" is worth opening; the Recent list shows
// a handful by default and expands to the rest.
const MAX = 30

function canUse(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage
}

export function loadHistory(): HistoryEntry[] {
  if (!canUse()) return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    // Keep only well-shaped entries — tolerate schema drift from older versions.
    //
    // Sorted here rather than trusted, because this is the single read path and
    // the stored array's order is only ever as good as whatever last wrote it:
    // an older build, a hand-edited export, a partial write. Newest first is
    // the one thing the Recent list promises, so it is asserted on read instead
    // of assumed. Thirty entries — the cap — cost nothing to sort.
    return parsed
      .filter(
        (e): e is HistoryEntry =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as HistoryEntry).url === 'string' &&
          typeof (e as HistoryEntry).ts === 'number',
      )
      .sort((a, b) => b.ts - a.ts)
      .slice(0, MAX)
  } catch {
    return []
  }
}

/**
 * Prepend an entry (most-recent-first), dedupe by URL, cap the list, persist.
 * Returns the new list so the caller can update state without a re-read.
 */
export function addHistory(entry: HistoryEntry): HistoryEntry[] {
  if (!canUse()) return []
  const current = loadHistory()
  // Pasting a link again does not un-download the file. Without this, the
  // "already saved" mark is wiped by the very act of looking the post up
  // again — which is exactly the moment somebody wants to be told.
  const previous = current.find((e) => e.url === entry.url)
  const merged =
    previous?.savedAt && !entry.savedAt
      ? { ...entry, savedAt: previous.savedAt }
      : entry
  const existing = current.filter((e) => e.url !== entry.url)
  const next = [merged, ...existing].slice(0, MAX)
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // quota / disabled — history is best-effort, ignore.
  }
  commit(next)
  return next
}

/**
 * Record that a file was saved for this link.
 *
 * Only ever stamps a row that already exists: every download is preceded by the
 * resolve that wrote the row, so a missing one means the history was cleared
 * mid-download, and inventing an entry there would put a link back in a list
 * somebody had just emptied.
 *
 * `addHistory` is not reused because it moves the row to the top, and saving a
 * file is not the same event as pasting a link — a download that finishes after
 * three later pastes should not reorder them.
 */
export function markSaved(url: string, at: number): HistoryEntry[] {
  if (!canUse()) return []
  const current = loadHistory()
  let found = false
  const next = current.map((entry) => {
    if (entry.url !== url) return entry
    found = true
    return { ...entry, savedAt: at }
  })
  if (!found) return current
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // quota / disabled — the in-memory list is still correct for this tab.
  }
  commit(next)
  return next
}

export function removeHistory(url: string): HistoryEntry[] {
  if (!canUse()) return []
  const next = loadHistory().filter((e) => e.url !== url)
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
  commit(next)
  return next
}

export function clearHistory(): void {
  if (!canUse()) return
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
  commit([])
}

/** The shape one exported entry takes — identical to what we store. */
export type ExportedEntry = HistoryEntry

/**
 * Serialise the current list. A plain JSON array of the stored entries, so an
 * import is the exact inverse and a user can read the file.
 */
export function exportHistory(): string {
  return JSON.stringify(loadHistory(), null, 2)
}

function isEntry(value: unknown): value is HistoryEntry {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as HistoryEntry).url === 'string' &&
    typeof (value as HistoryEntry).title === 'string' &&
    typeof (value as HistoryEntry).ts === 'number'
  )
}

/**
 * Fold imported entries into `existing`: newest first, incoming wins on URL
 * collisions (an export is usually taken from another device precisely because
 * it is newer), capped at MAX. Pure — tested directly, since localStorage does
 * not exist in every environment this module loads in.
 */
export function mergeEntries(
  existing: HistoryEntry[],
  incoming: unknown[],
  max = MAX,
): { list: HistoryEntry[]; added: number } {
  const valid = incoming.filter(isEntry)
  if (valid.length === 0) return { list: existing, added: 0 }

  // Snapshot of what existed before, for the added-count below: identity is
  // how an untouched row is told apart from one an import replaced.
  const oldByUrl = new Map(existing.map((e) => [e.url, e]))
  const byUrl = new Map(oldByUrl)
  for (const entry of valid) {
    // Same rule as addHistory: an import must not un-download a file. An export
    // taken before this field existed carries no `savedAt` at all, and it would
    // otherwise clear the mark on every row it replaced.
    const previous = oldByUrl.get(entry.url)
    byUrl.set(
      entry.url,
      previous?.savedAt && !entry.savedAt
        ? { ...entry, savedAt: previous.savedAt }
        : entry,
    )
  }

  const list = [...byUrl.values()]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, max)
  // A row counts as added when the url was not there before, or when an
  // incoming entry replaced it — which shows up as a different object than
  // the snapshot held, since untouched rows keep their exact identity.
  let added = 0
  for (const item of list) {
    if (oldByUrl.get(item.url) !== item) added += 1
  }
  return { list, added }
}

/**
 * Parse an exported file and fold it into the live history.
 * Returns null when the file is not readable JSON at all; otherwise reports
 * how many entries were newly added.
 */
export function importHistory(
  json: string,
): { added: number; total: number } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null

  const { list, added } = mergeEntries(loadHistory(), parsed)
  if (added > 0) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list))
    } catch {
      // quota / disabled — nothing to do but report honestly below.
      return { added: 0, total: loadHistory().length }
    }
    commit(list)
  }
  return { added, total: list.length }
}

/**
 * Subscription layer, so components can read the list with
 * `useSyncExternalStore` instead of seeding `useState` from a mount effect.
 *
 * The parse above is not free and localStorage is synchronous, so the result is
 * cached and only re-derived when we ourselves change it — every mutator here
 * already computes the next list, so there is nothing to re-read.
 */
const listeners = new Set<() => void>()

// Stable identity for the prerender/hydration pass: snapshots are compared by
// reference, and a new [] each call would loop.
const EMPTY: readonly HistoryEntry[] = Object.freeze([])

let cache: HistoryEntry[] | null = null

function commit(next: HistoryEntry[]): void {
  cache = next
  for (const listener of listeners) listener()
}

export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getHistorySnapshot(): readonly HistoryEntry[] {
  cache ??= loadHistory()
  return cache
}

export function getHistoryServerSnapshot(): readonly HistoryEntry[] {
  return EMPTY
}
