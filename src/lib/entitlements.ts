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

export function useProToken(): string | null {
  // Subscribing to the account store is what re-renders this when a refresh
  // lands; the token itself is read imperatively because it is not part of the
  // snapshot (a fresh string each call would re-render forever).
  useAccount()
  return currentAccessToken()
}
