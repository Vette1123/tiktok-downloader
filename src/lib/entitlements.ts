'use client'

/**
 * Pro state, as the app sees it.
 *
 * Two hooks over the account store, deliberately narrow: consumers ask "is this
 * visitor Pro" and "what token do I send", and know nothing about sessions,
 * subscriptions or how any of it is stored.
 *
 * The ad-free half of Pro is enforced client-side and is trivially bypassable.
 * That is accepted: the honest subscriber is the customer, and the entitlement
 * that actually costs us something (priority resolve) is checked server-side
 * against a signed token.
 */

import { useEffect } from 'react'
import { currentAccessToken, ensureFreshToken, useAccount } from './account'
import { usePrefs } from './prefs'

/**
 * Free on the server and during hydration, so the markup never differs.
 * Consumers that render something whose presence must never flash (the sponsor
 * card) additionally gate on `useHydrated()` themselves — see PromoSlot —
 * because this hook alone only guarantees no hydration mismatch, not that the
 * client value is known on the very first client render.
 */
export function useTier(): 'free' | 'pro' {
  const account = useAccount()
  useEffect(() => {
    ensureFreshToken()
  }, [])
  return account.pro ? 'pro' : 'free'
}

/**
 * The saved-filename shape to actually use, or undefined for the built-in one.
 *
 * One place decides this, because the alternative is every download call site
 * remembering to check the tier — and the one that forgot would quietly give
 * the feature away, or quietly withhold it from someone who supports the
 * project. Both are worse than a hook.
 *
 * Enforced client-side, like the ad-free half of Pro and for the same reason:
 * a filename costs us nothing, so the honest supporter is the whole audience.
 * The entitlements that actually cost something (priority resolve, the batch
 * queue's server work) are checked against a signed token instead.
 */
export function useFilenameTemplate(): string | undefined {
  const tier = useTier()
  const { filenameTemplate } = usePrefs()
  return tier === 'pro' ? filenameTemplate : undefined
}

/**
 * Whether a resolved link should start saving on its own.
 *
 * Same shape and same reasoning as `useFilenameTemplate`: one place decides, so
 * the answer cannot drift between the paste bar, the share-target hand-off and
 * the recent list. Client-side, because the download itself is something a free
 * visitor can already do with one more tap — what is being sold is the tap, not
 * the file.
 */
export function useAutoSave(): boolean {
  const tier = useTier()
  const { autoSave } = usePrefs()
  return tier === 'pro' && autoSave === true
}

/**
 * Whether returning to the tab should resolve the link on the clipboard.
 *
 * The one entitlement here that reads something the visitor did not hand over,
 * so it is gated twice: on the tier, and on the preference being switched on
 * deliberately. `usePrefs` defaults it to absent and nothing turns it on but
 * the toggle in the account panel.
 */
export function useClipboardWatch(): boolean {
  const tier = useTier()
  const { clipboardWatch } = usePrefs()
  return tier === 'pro' && clipboardWatch === true
}

/**
 * Whether the card offers to save the video and the MP3 in one tap.
 *
 * Unlike the two above there is no preference behind it: there is nothing to
 * configure, only a button that either appears or does not. Still a hook rather
 * than a bare `useTier() === 'pro'` at the call site, so that every entitlement
 * is asked the same question in the same place and a future change of rule has
 * one home.
 */
export function useSaveBoth(): boolean {
  return useTier() === 'pro'
}

export function useProToken(): string | null {
  // Subscribing to the account store is what re-renders this when a refresh
  // lands; the token itself is read imperatively because it is not part of the
  // snapshot (a fresh string each call would re-render forever).
  useAccount()
  return currentAccessToken()
}
