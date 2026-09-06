'use client'

/**
 * Read-once facts about the browser, exposed as hooks.
 *
 * All of these used to be written as `useState(false)` plus
 * `useEffect(() => setSomething(true), [])`. That works, but it is a render →
 * effect → setState → re-render cascade for a value that never actually
 * changes, and React's `react-hooks/set-state-in-effect` rule rejects it.
 *
 * `useSyncExternalStore` is the intended replacement. React calls the *server*
 * snapshot while rendering on the server and again during hydration, then
 * switches to the client snapshot immediately after mount — which is precisely
 * the "false on the server, real value in the browser" behaviour the effect was
 * faking, minus the extra state and with no hydration mismatch.
 *
 * Every snapshot here must return a primitive (or a cached object). Snapshots
 * are compared by reference, so a fresh object each call re-renders forever.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'

/**
 * These values are fixed for the life of the page, so there is nothing to
 * subscribe to. The unsubscribe callback is required by the signature.
 */
const neverChanges = () => () => {}

const serverFalse = () => false

function userAgent(): string {
  return window.navigator.userAgent || ''
}

/**
 * Safari on iPhone/iPad — deliberately excluding Chrome/Firefox/Edge for iOS.
 *
 * Those browsers spoof a desktop-ish UA and, more importantly, never fire
 * `beforeinstallprompt`, so the only install route we can offer on real iOS
 * Safari is the manual "Add to Home Screen" hint.
 */
function detectIOSSafari(): boolean {
  const ua = userAgent()
  return /iphone|ipad|ipod/i.test(ua) && !/crios|fxios|edgios/i.test(ua)
}

/**
 * Any iOS-like device, including iPadOS.
 *
 * Broader than {@link detectIOSSafari} on purpose: this one gates the
 * "downloads land in Files, here's how to get them into Photos" hint, which is
 * true of every browser on the platform. iPadOS 13+ reports a Macintosh UA, so
 * a touch-capable "Mac" is counted as an iPad.
 */
function detectIOSLike(): boolean {
  const ua = userAgent()
  if (/iphone|ipad|ipod/i.test(ua) && !/crios|fxios/i.test(ua)) return true
  return /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1
}

/**
 * `Date.now()`, wrapped.
 *
 * `react-hooks/purity` flags a bare `Date.now()` anywhere reachable from a
 * component body — even inside an async handler — as impure-during-render.
 * Module scope puts it outside that analysis without changing behaviour.
 * Shared here now that a third call site (AccountPanel) needs it, alongside
 * PastDueBanner and DownloaderApp.
 */
export function nowMs(): number {
  return Date.now()
}

/**
 * `12 August`-style date, the one format every account-facing date uses, with
 * the year added once the date is not obviously in the coming months.
 *
 * An annual subscriber renews on the same calendar day they bought, so the
 * short form renders "renews August 8" to someone reading it on August 8. That
 * is exactly a year out and reads as today. Anything past this December gets
 * the year; a monthly renewal, which is what the short form was written for,
 * still does not.
 */
export function formatDate(at: number): string {
  const date = new Date(at)
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }
  if (date.getFullYear() !== new Date(nowMs()).getFullYear()) options.year = 'numeric'
  return date.toLocaleDateString(undefined, options)
}

/** Guards anything that touches `window`/`document` — false until hydrated. */
export function useHydrated(): boolean {
  return useSyncExternalStore(neverChanges, () => true, serverFalse)
}

/** See {@link detectIOSSafari}. */
export function useIsIOSSafari(): boolean {
  return useSyncExternalStore(neverChanges, detectIOSSafari, serverFalse)
}

/** See {@link detectIOSLike}. */
export function useIsIOSLike(): boolean {
  return useSyncExternalStore(neverChanges, detectIOSLike, serverFalse)
}

/**
 * A mouse and a hardware keyboard, rather than a finger.
 *
 * The one thing this gates so far is putting focus back in the link field after
 * a download, which is a courtesy on a laptop and an ambush on a phone: focusing
 * an input there raises the on-screen keyboard over the result the visitor just
 * saved. `(hover: hover)` alone would catch a tablet with a trackpad, which is
 * fine — it has a keyboard too.
 */
function detectFinePointer(): boolean {
  return (
    window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false
  )
}

/** See {@link detectFinePointer}. */
export function useHasFinePointer(): boolean {
  return useSyncExternalStore(neverChanges, detectFinePointer, serverFalse)
}

/**
 * Whether we may offer a PWA install at all: not already installed, and not
 * previously dismissed.
 *
 * Cached rather than recomputed per call so the snapshot stays referentially
 * stable, and so a dismissal later in the session doesn't retroactively change
 * a value React expects to be constant — the component tracks that in its own
 * state instead.
 */
let installOfferable: boolean | null = null

export const INSTALL_DISMISS_KEY = 'smd:install-dismissed'

function dismissedEarlier(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_DISMISS_KEY) === '1'
  } catch {
    // Storage blocked (private mode, cookie policy) — treat as not-dismissed.
    return false
  }
}

function runningStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    nav.standalone === true
  )
}

function detectInstallOfferable(): boolean {
  installOfferable ??= !runningStandalone() && !dismissedEarlier()
  return installOfferable
}

export function useInstallOfferable(): boolean {
  return useSyncExternalStore(neverChanges, detectInstallOfferable, serverFalse)
}

/**
 * Run `fn` every time this page becomes visible again.
 *
 * Sign-in state can change in a context this document never hears from. The
 * OAuth round trip leaves the origin entirely, and on Android it can come back
 * into the installed app rather than into the tab that started it — the app and
 * the tab share one cookie jar and one localStorage, so the session is real
 * either way, but only the document that received the callback knows it yet.
 * Re-reading on the way back is what stops the other one showing "Sign in" to
 * somebody who is already signed in (and vice versa, after a sign-out
 * elsewhere).
 *
 * `pageshow` is here for the bfcache: coming back with the Back button restores
 * a document without ever firing `visibilitychange`.
 *
 * The callback is held in a ref so a caller may pass an inline closure without
 * re-subscribing the listeners on every render.
 */
export function useOnPageVisible(fn: () => void): void {
  const latest = useRef(fn)
  useEffect(() => {
    latest.current = fn
  })

  useEffect(() => {
    const run = (): void => {
      if (document.visibilityState === 'visible') latest.current()
    }
    document.addEventListener('visibilitychange', run)
    window.addEventListener('pageshow', run)
    return () => {
      document.removeEventListener('visibilitychange', run)
      window.removeEventListener('pageshow', run)
    }
  }, [])
}

/** Below this a corner control overlaps content; above it there is room to spare. */
const PHONE = '(max-width: 39.99rem)'
/** Ignore the jitter of a finger resting on a scrolling page. */
const SCROLL_THRESHOLD = 8
/** Never hide anything while the top of the page is still in view. */
const SCROLL_FLOOR = 80

/**
 * Take a fixed corner control away on the way down the page and bring it back
 * on the way up, so it is reachable without sitting on top of what someone is
 * reading. Both corner slots use it — the account control and the home button.
 *
 * The class is written straight to the node through a ref. This is the reason a
 * scroll here costs nothing: React never re-renders, so the work per frame is
 * one `classList.toggle` behind a rAF gate, on a listener that is passive and
 * only attached on the viewports that need it. Storing the position in state
 * instead would re-render the tree on every frame of every scroll, on every
 * page of the site, which is what the ban on scroll handlers is about.
 *
 * The `--away` class it toggles is defined once in globals.css against
 * `.corner-slot`, so both controls leave and return together.
 */
export function usePeekOnScroll(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    const node = ref.current
    if (!node) return

    node.classList.remove('corner-slot--away')
    if (!enabled || !window.matchMedia(PHONE).matches) return

    let previous = window.scrollY
    let frame = 0

    const update = (): void => {
      frame = 0
      const y = window.scrollY
      const delta = y - previous
      if (Math.abs(delta) < SCROLL_THRESHOLD) return
      previous = y
      node.classList.toggle('corner-slot--away', delta > 0 && y > SCROLL_FLOOR)
    }

    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
      node.classList.remove('corner-slot--away')
    }
  }, [ref, enabled])
}
