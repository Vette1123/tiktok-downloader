/**
 * A fresh signed customer-portal URL, per click.
 *
 * Creem mints these per request and expires them, so nothing here is cached —
 * a stored URL would be a dead "Manage billing" button by the time anyone
 * pressed it.
 */

import { requireDb, type WorkerEnv } from '../workerEnv'
import { loadSession, sessionCookieOf } from '../auth/session'
import { billingFailure as portalFailure } from './clickResponse'
import { creemApi, creemHeaders } from './creem'

/**
 * Creem documents the field as `customer_portal_link`, but the response is
 * read defensively: a portal click that 502s because the key was renamed is a
 * paying customer who cannot reach their own billing, and the fallbacks cost
 * one property read each.
 */
function portalUrlOf(body: unknown): string | null {
  const record = body as Record<string, unknown> | null
  const candidate = record?.customer_portal_link ?? record?.url ?? record?.link
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

/** GET /api/billing/portal */
export async function handlePortal(
  request: Request,
  _ctx?: unknown,
  env?: WorkerEnv,
): Promise<Response> {
  const db = requireDb(env)
  if (db instanceof Response) return db

  const apiKey = process.env.CREEM_API_KEY?.trim()
  if (!apiKey) {
    return portalFailure(
      request,
      'unavailable',
      'Billing is not configured on this deployment.',
      503,
    )
  }

  const user = await loadSession(db, sessionCookieOf(request), Date.now())
  // Creem generates the portal for a *customer*, so the customer id is what
  // this needs — not the subscription id. Both are written by the same
  // webhook, so a user missing this one has never had a purchase land.
  if (!user?.sub_customer_id) {
    return portalFailure(request, 'none', 'No subscription', 404)
  }

  try {
    const response = await fetch(`${creemApi(apiKey)}/customers/billing`, {
      method: 'POST',
      headers: { ...creemHeaders(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: user.sub_customer_id }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error('upstream')

    const portal = portalUrlOf(await response.json())
    if (!portal) throw new Error('no portal url')

    return new Response(null, { status: 302, headers: { Location: portal } })
  } catch {
    return portalFailure(
      request,
      'unavailable',
      'Could not open the billing portal. Try again.',
      502,
    )
  }
}
