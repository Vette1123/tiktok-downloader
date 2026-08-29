/**
 * Cancelling a subscription at the end of the period that has been paid for.
 *
 * Creem's customer portal has its own Cancel, and it cancels *now*: the status
 * goes straight to `canceled` with `current_period_end_date` still months out,
 * which on an annual plan is eleven months somebody paid for and no longer has.
 * So cancelling is done here instead, through the API in `scheduled` mode, and
 * the portal is left to the two things it is actually good at — changing a card
 * and reading invoices.
 *
 * This is the belt; `isProAt` is the braces. Entitlement treats `canceled` as
 * paid-through as well, so a customer who digs into the portal and cancels there
 * keeps their months regardless. What this endpoint adds is that the common path
 * also tells *Creem* the right thing, rather than leaving their records saying
 * "cancelled" while ours say "running" and hoping nobody reconciles the two.
 *
 * No CSRF token: the session cookie is `SameSite=Lax`, so a cross-site POST
 * arrives with no cookie and lands on the 401 below. Same reasoning as
 * `/api/auth/logout`.
 */

import { requireDb, type WorkerEnv } from '../workerEnv'
import { loadSession, sessionCookieOf } from '../auth/session'
import { creemApi, creemHeaders } from './creem'
import { paidThrough } from './entitlement'
import {
  applySubscriptionPatch,
  patchFromSubscription,
  type CreemSubscription,
} from './webhook'

function fail(error: string, status: number): Response {
  return Response.json({ success: false, error }, { status })
}

/** POST /api/billing/cancel */
export async function handleCancel(
  request: Request,
  _ctx?: unknown,
  env?: WorkerEnv,
): Promise<Response> {
  const db = requireDb(env)
  if (db instanceof Response) return db

  const apiKey = process.env.CREEM_API_KEY?.trim()
  if (!apiKey) return fail('Billing is not configured on this deployment.', 503)

  const now = Date.now()
  const user = await loadSession(db, sessionCookieOf(request), now)
  if (!user) return fail('Please sign in again.', 401)
  if (!user.sub_id) return fail('There is no subscription on this account.', 404)

  let subscription: CreemSubscription | null = null
  try {
    const response = await fetch(
      `${creemApi(apiKey)}/subscriptions/${encodeURIComponent(user.sub_id)}/cancel`,
      {
        method: 'POST',
        headers: { ...creemHeaders(apiKey), 'Content-Type': 'application/json' },
        // `scheduled` is the entire point of this endpoint existing. `onExecute`
        // says what happens when that schedule fires: end it, rather than
        // `pause`, which is Creem's other option and would leave a subscription
        // nobody is billing and nobody has cancelled.
        body: JSON.stringify({ mode: 'scheduled', onExecute: 'cancel' }),
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!response.ok) throw new Error('upstream')
    subscription = (await response.json()) as CreemSubscription
  } catch {
    return fail('We could not cancel just now. Please try again in a minute.', 502)
  }

  // Applied here rather than waited for. Creem emits a subscription event for
  // this and that remains the durable writer, but the person who just pressed
  // Cancel is looking at the page, and a plan card that still says "renews" for
  // the next few seconds reads as a cancel that silently failed. This is the same
  // patch the webhook would apply, and `patchFromSubscription`'s replay guard
  // makes whichever of the two lands second a no-op.
  const patch = patchFromSubscription(subscription ?? {}, user, now, now)
  if (patch) {
    try {
      await applySubscriptionPatch(db, user.id, patch)
    } catch {
      // Creem has accepted the cancellation, which is the part that cannot be
      // retried from here. Reporting a failure now would invite a second cancel
      // for a subscription already cancelled; the webhook and the reconcile
      // repair both still write this row.
    }
  }

  // `endsAt` is echoed so the account page can say the date without waiting for
  // its own refresh to come back.
  const endsAt = patch?.sub_ends_at ?? user.sub_ends_at
  return Response.json({
    success: true,
    status: patch?.sub_status ?? subscription?.status ?? null,
    endsAt,
    /** Whether Pro is still running, i.e. whether anything was actually kept. */
    paidThrough: paidThrough(endsAt, now),
  })
}
