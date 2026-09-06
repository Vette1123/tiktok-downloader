'use client'

/**
 * Passing a collection link from the paste bar to the batch queue.
 *
 * The two live in sibling components with no parent state between them, and
 * lifting one up to hold a single string would put a re-render of the whole
 * page behind every keystroke in a field that neither of them owns. The rest of
 * this app answers that question with a tiny external store (prefs, history,
 * download progress), so this is the fourth of the same shape.
 *
 * It exists because `linkAdvice` can now recognise a playlist, a board or a
 * subreddit the moment it is pasted — and the useful thing to do with that is
 * not an error message, it is to hand it to the feature that expands it.
 */

import { useSyncExternalStore } from 'react'

let pending: string | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): string | null {
  return pending
}

/** Nothing is ever pending during a prerender; there has been no paste. */
function getServerSnapshot(): null {
  return null
}

/**
 * Ask the batch panel to expand this collection.
 *
 * The value is left in place rather than cleared on read. Clearing would have
 * to happen from inside the panel's render or an effect — the first is a side
 * effect during render and the second is `setState` in an effect, which this
 * codebase bans for the reason lib/prefs.ts describes. Instead the panel keeps
 * the last seed it applied and ignores a repeat, which is the same guard
 * without the write.
 */
export function requestCollectionImport(url: string): void {
  if (pending === url) return
  pending = url
  emit()
}

export function usePendingCollectionImport(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
