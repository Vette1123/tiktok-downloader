/**
 * The file this tab most recently wrote to disk, kept so it can be sent on.
 *
 * A module store rather than component state, for the same reason
 * `downloadProgress` is one: the value is written from deep inside a download —
 * several handlers, one of which the auto-save effect starts on its own — and
 * read in one place. Routing it through `useState` would put a state update on
 * a path an effect calls, which is the cascading-render shape React's own lint
 * rule exists to stop.
 *
 * It holds a whole file, which is the point and also the constraint: the bytes
 * are released as soon as the result they belong to goes away, so nothing here
 * outlives the card that produced it. Peak memory is unchanged — the download
 * already buffers the entire body (capped) before writing it out; this only
 * decides how soon that buffer is dropped.
 */

export interface LastSaved {
  /** Null until something has been saved in this tab, and again after a reset. */
  file: File | null
  /**
   * Whether the last attempt to hand it to another app actually failed.
   *
   * Deliberately not "was shared": closing the share sheet rejects exactly like
   * a broken one does, and a dismissal is a decision rather than a fault. Only
   * a real failure is worth saying out loud.
   */
  failed: boolean
}

const EMPTY: LastSaved = Object.freeze({ file: null, failed: false })

let current: LastSaved = EMPTY
const listeners = new Set<() => void>()

function commit(next: LastSaved): void {
  if (next.file === current.file && next.failed === current.failed) return
  current = next
  for (const listener of listeners) listener()
}

/** Record a file that has just been written. Clears any earlier failure. */
export function rememberSaved(file: File): void {
  commit({ file, failed: false })
}

/** Drop the held file — the result it belongs to is gone. */
export function forgetSaved(): void {
  commit(EMPTY)
}

/** The share sheet refused, as opposed to the visitor closing it. */
export function noteShareFailed(): void {
  if (!current.file) return
  commit({ file: current.file, failed: true })
}

export function subscribeSaved(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSavedSnapshot(): LastSaved {
  return current
}

/**
 * Nothing is ever saved during prerender, and the frozen constant keeps the
 * server and first client renders identical by identity as well as by value.
 */
export function getSavedServerSnapshot(): LastSaved {
  return EMPTY
}
