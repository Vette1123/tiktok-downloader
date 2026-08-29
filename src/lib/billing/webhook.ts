/**
 * Creem webhooks: the fast path for subscription state.
 *
 * Treated as an optimisation rather than the source of truth — a delivery can
 * be lost for good, so src/lib/billing/reconcile.ts repairs whatever this
 * misses. What must never happen is a *forged* event, so the signature is
 * verified over raw bytes before anything is parsed.
 *
 * Two shapes of hostile input are handled here beyond forgery, because the
 * endpoint is unauthenticated until the HMAC clears and the checkout URL is
 * public:
 *
 * - an oversized body, which is why the read is bounded rather than
 *   `request.text()`;
 * - a buyer-chosen email, which is why email is a last-resort binding that may
 *   never take over a row that already holds a subscription.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { requireDb, type WorkerEnv } from '../workerEnv'
import { isProAt, type BillingRow } from './entitlement'
import { MAX_WEBHOOK_BYTES, readBounded, verifyWebhookSignature } from './hmacWebhook'

// Re-exported rather than moved out of sight: these were part of this module's
// surface before src/lib/billing/hmacWebhook.ts existed, and both this file's
// tests and its callers still read them from here.
export { MAX_WEBHOOK_BYTES, verifyWebhookSignature }

/** The header Creem carries the hex HMAC in. */
export const SIGNATURE_HEADER = 'creem-signature'

/**
 * Creem expands `product` and `customer` on webhook payloads but may send a
 * bare id string elsewhere, so every read of them goes through a narrowing
 * helper rather than assuming the expanded shape.
 */
type Expandable<T> = T | string | null

export interface CreemSubscription {
  id?: string
  object?: string
  status?: string
  product?: Expandable<{ id?: string; name?: string }>
  customer?: Expandable<{ id?: string; email?: string }>
  metadata?: { user_id?: string } | null
  current_period_end_date?: string | null
  next_transaction_date?: string | null
  canceled_at?: string | null
  updated_at?: string | null
}

function expanded<T extends object>(value: Expandable<T> | undefined): T | null {
  return value && typeof value === 'object' ? value : null
}

export interface SubscriptionPatch {
  userId: string | null
  email: string | null
  sub_id: string
  sub_customer_id: string | null
  sub_status: string
  sub_variant: string
  sub_renews_at: number | null
  sub_ends_at: number | null
  sub_past_due_since: number | null
  sub_updated_at: number
}

interface CurrentRow {
  sub_updated_at: number | null
  sub_past_due_since: number | null
  /** Read only to be preserved — see `variantOf`. */
  sub_variant?: string | null
}

/**
 * Creem sends ISO strings on the subscription object and an epoch-millis
 * number as the event's own `created_at`, and both feed the replay guard, so
 * this accepts either rather than making each caller remember which it holds.
 */
function parseTime(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Anything not obviously annual is monthly — the two products are ours.
 *
 * A payload with no product at all is a different question from a payload with a
 * monthly one, so it keeps whatever the row already knows. Creem expands
 * `product` on webhooks and on search results, but the cancel endpoint's reply
 * need not, and defaulting there would quietly rewrite an annual subscriber to
 * monthly the moment they cancelled — putting a $3 "Resubscribe" in front of
 * someone who had been paying $24 a year.
 */
function variantOf(name: string | undefined, current: CurrentRow | null): string {
  if (name) return /year|annual/i.test(name) ? 'annual' : 'monthly'
  return current?.sub_variant ?? 'monthly'
}

/**
 * When the grace clock starts.
 *
 * Stamped the first time `past_due` is seen and preserved on every later
 * `past_due` event, so a subscription that emits several failed-payment
 * webhooks does not keep resetting its own 14-day window. Cleared the moment
 * the status is anything else.
 */
function pastDueSince(status: string, current: CurrentRow | null, now: number): number | null {
  if (status !== 'past_due') return null
  return current?.sub_past_due_since ?? now
}

/**
 * The pure subscription → row patch. Returns null for an event that is stale
 * (Creem retries on any non-2xx, so handlers must be idempotent) or unusable.
 *
 * `observedAt` is the event's own timestamp, used only when the subscription
 * object carries no `updated_at` of its own — without some monotonic stamp the
 * replay guard has nothing to compare and every redelivery would reapply.
 *
 * `current` is the *target user's* row, not "the row holding this subscription
 * id" — see `resolveTarget` for why the difference matters.
 */
export function patchFromSubscription(
  subscription: CreemSubscription,
  current: CurrentRow | null,
  now: number,
  observedAt?: string | number | null,
): SubscriptionPatch | null {
  const subscriptionId = subscription.id
  const status = subscription.status
  if (!subscriptionId || !status) return null

  const updatedAt = parseTime(subscription.updated_at) ?? parseTime(observedAt) ?? now
  if (current?.sub_updated_at != null && updatedAt <= current.sub_updated_at) return null

  const customer = expanded(subscription.customer)
  const product = expanded(subscription.product)
  const endsAt = parseTime(subscription.current_period_end_date)

  return {
    userId: subscription.metadata?.user_id ?? null,
    email: customer?.email ?? null,
    sub_id: subscriptionId,
    sub_customer_id: customer?.id ?? null,
    sub_status: status,
    sub_variant: variantOf(product?.name, current),
    // Creem only sends a next charge date while one is actually scheduled, so
    // a subscription set to lapse falls back to the date it lapses on. Both
    // answer the same question for the account page: when does this change?
    sub_renews_at: parseTime(subscription.next_transaction_date) ?? endsAt,
    sub_ends_at: endsAt,
    sub_past_due_since: pastDueSince(status, current, now),
    sub_updated_at: updatedAt,
  }
}

/** The `users` columns the webhook needs before it is allowed to write. */
interface TargetRow extends BillingRow {
  id: string
  sub_id: string | null
  sub_variant: string | null
  sub_updated_at: number | null
}

// `id` is the primary key and `email` is indexed by migration 0002 — D1 bills
// rows scanned, so both lookups touch one row (or the handful sharing an
// address) rather than the table.
const TARGET_COLUMNS =
  'id, sub_id, sub_status, sub_variant, sub_ends_at, sub_past_due_since, sub_updated_at'

/** Which identifier found the row. Email is buyer-supplied; `user_id` is ours. */
export type MatchedBy = 'user_id' | 'email'

interface Target {
  row: TargetRow
  by: MatchedBy
}

/**
 * `email` is NOT unique — deleting and recreating a Google account leaves two
 * rows with the same address — so an ambiguous match is refused rather than
 * guessed. Picking "the first one" would both bill the wrong user and, because
 * `sub_id` is UNIQUE, risk a constraint failure on the write.
 */
function pickByEmail(rows: TargetRow[], subscriptionId: string): TargetRow | null {
  const exact = rows.find((row) => row.sub_id === subscriptionId)
  if (exact) return exact
  if (rows.length === 1) return rows[0]
  return null
}

/**
 * The user this event is about.
 *
 * Resolved *before* anything is compared, because the replay guard has to run
 * against the row we are about to overwrite. Keying it on the incoming
 * subscription id instead — as this handler used to — means an event for a
 * subscription nobody holds finds no row, skips the guard entirely, and applies
 * unconditionally.
 *
 * `user_id` rides in the checkout link's `metadata[user_id]` and should always
 * be present; email is the fallback for the case that should not happen.
 */
async function resolveTarget(
  db: D1Database,
  subscriptionId: string,
  userId: string | null,
  email: string | null,
): Promise<Target | null> {
  if (userId) {
    const row = await db
      .prepare(`SELECT ${TARGET_COLUMNS} FROM users WHERE id = ?`)
      .bind(userId)
      .first<TargetRow>()
    return row ? { row, by: 'user_id' } : null
  }

  if (!email) return null
  const found = await db
    .prepare(`SELECT ${TARGET_COLUMNS} FROM users WHERE email = ?`)
    .bind(email)
    .all<TargetRow>()
  const row = pickByEmail(found.results ?? [], subscriptionId)
  return row ? { row, by: 'email' } : null
}

/**
 * Statuses that mean Creem is charging for this subscription right now.
 *
 * Used below as "this event is about the subscription the customer is actually
 * on", which is the only thing that should be allowed to displace another, and
 * by the reconcile repair to decide whether a stored subscription is still the
 * answer or whether it should go looking for a newer one.
 */
export function isLiveStatus(status: string | undefined): boolean {
  return status === 'active' || status === 'trialing'
}

/**
 * Whether this event may write over the row it resolved to.
 *
 * The row already holding this exact subscription, or holding none, is always
 * fair game. Beyond that:
 *
 * - **Matched by email.** Never. The checkout URL is public, so anyone can buy
 *   a $3 subscription under a victim's address; letting that seize a row would
 *   orphan the victim's real subscription and point their "Manage billing"
 *   button at the attacker's portal.
 * - **Matched by our own `user_id`, event is for a subscription Creem is
 *   billing.** Always. A subscription being charged for supersedes whatever the
 *   row holds, because that is the one the customer is on now.
 * - **Matched by our own `user_id`, event is for a stopped subscription.** Only
 *   if what they hold is already dead. Someone who cancels monthly A and buys
 *   annual B still gets A's `subscription.expired` weeks later, with a newer
 *   timestamp than B — that event must not take Pro away from the annual
 *   subscriber Creem keeps billing.
 *
 * The live-supersedes rule is what makes resubscribing possible at all. Without
 * it the row's own entitlement locks it: a customer whose cancelled annual still
 * runs to next August cannot buy anything, because every event for the new
 * subscription is refused for as long as the old one keeps them Pro. That was
 * survivable while `canceled` revoked immediately and `scheduled_cancel` was
 * rare; it stopped being survivable the moment paid-through became the rule for
 * both — see `isProAt`.
 *
 * Staleness is not the hole it looks like. `patchFromSubscription`'s replay guard
 * drops any event whose timestamp is not newer than what the row already holds,
 * so a late redelivery of the *old* subscription's `active` cannot win this way;
 * only an event that is genuinely newer gets here.
 */
export function mayApply(
  row: BillingRow & { sub_id: string | null },
  subscriptionId: string,
  by: MatchedBy,
  now: number,
  incomingStatus?: string,
): boolean {
  const stored = row.sub_id
  if (!stored || stored === subscriptionId) return true
  if (by === 'email') return false
  if (isLiveStatus(incomingStatus)) return true
  return !isProAt(row, now)
}

/**
 * The one statement that writes subscription state.
 *
 * Shared by the webhook, the reconcile repair and the cancel endpoint. All three
 * write the same eight columns from the same patch, and a column added to one of
 * them but not the others is a divergence nothing would catch — the row would
 * simply be right or wrong depending on which writer got there first.
 *
 * Keyed on the primary key, never on `email`. `sub_customer_id` coalesces rather
 * than overwrites, because a payload that arrives with `customer` unexpanded
 * would otherwise blank the id the billing portal is reached by.
 */
export async function applySubscriptionPatch(
  db: D1Database,
  userId: string,
  patch: SubscriptionPatch,
): Promise<void> {
  await db
    .prepare(
      `UPDATE users SET
         sub_id = ?, sub_customer_id = COALESCE(?, sub_customer_id),
         sub_status = ?, sub_variant = ?, sub_renews_at = ?,
         sub_ends_at = ?, sub_past_due_since = ?, sub_updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      patch.sub_id,
      patch.sub_customer_id,
      patch.sub_status,
      patch.sub_variant,
      patch.sub_renews_at,
      patch.sub_ends_at,
      patch.sub_past_due_since,
      patch.sub_updated_at,
      userId,
    )
    .run()
}

/**
 * `sub_id` is UNIQUE, so a write can fail for a reason no retry
 * will ever clear. Everything else — a timeout, a wedged connection — is worth
 * another delivery.
 */
function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: unknown } | null)?.cause
  return /UNIQUE constraint failed/i.test(`${String(error)} ${String(cause ?? '')}`)
}

/**
 * Creem retries any non-2xx, so every "we are not acting on this" exit has to
 * be a 200 — there is nothing to retry into.
 */
function ok(): Response {
  return new Response('ok', { status: 200 })
}

/**
 * Whether this event is about a subscription.
 *
 * The object's own `object` field is the authoritative discriminator, not
 * `eventType`. `checkout.completed` fires seconds before `subscription.active`
 * and carries a *checkout* whose `id` is a checkout id; applied, it would
 * write that id into `sub_id`, leaving a customer who just paid
 * without Pro and a reconcile that 404s on that id forever.
 *
 * The eventType arm is only reached when the object does not say what it is,
 * which is not the case that bug came from — an unstated type is a payload
 * shape we do not recognise, not a mislabelled one.
 */
function isSubscriptionEvent(objectType: string | undefined, eventType: string | undefined) {
  if (objectType) return objectType === 'subscription'
  return eventType?.startsWith('subscription.') === true
}

/** POST /api/billing/webhook */
export async function handleWebhook(
  request: Request,
  _ctx?: unknown,
  env?: WorkerEnv,
): Promise<Response> {
  const db = requireDb(env)
  if (db instanceof Response) return db

  const secret = process.env.CREEM_WEBHOOK_SECRET?.trim()
  if (!secret) return new Response('not configured', { status: 503 })

  // Bounded read first, then the HMAC, then the parse. Nothing above the
  // signature check may cost more than a fixed amount of CPU, because nothing
  // above it is authenticated.
  const raw = await readBounded(request, MAX_WEBHOOK_BYTES)
  if (raw === null) return new Response('too large', { status: 413 })

  const valid = await verifyWebhookSignature(raw, request.headers.get(SIGNATURE_HEADER), secret)
  if (!valid) return new Response('bad signature', { status: 401 })

  let payload: {
    eventType?: string
    created_at?: number | string
    object?: CreemSubscription
  }
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response('bad body', { status: 400 })
  }

  const subscription = payload.object
  if (!subscription || !isSubscriptionEvent(subscription.object, payload.eventType)) return ok()

  const subscriptionId = subscription.id
  if (!subscriptionId) return ok()

  const target = await resolveTarget(
    db,
    subscriptionId,
    subscription.metadata?.user_id ?? null,
    expanded(subscription.customer)?.email ?? null,
  )
  if (!target) return ok()

  const now = Date.now()
  if (!mayApply(target.row, subscriptionId, target.by, now, subscription.status)) return ok()

  const patch = patchFromSubscription(subscription, target.row, now, payload.created_at)
  if (!patch) return ok()

  try {
    // One row, always the one the guard above just cleared.
    await applySubscriptionPatch(db, target.row.id, patch)
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Another row already holds this subscription. Retrying cannot fix it, and
      // a non-2xx here would stall every later event behind it.
      console.error('billing webhook: subscription already bound elsewhere', subscriptionId)
      return ok()
    }
    return new Response('retry', { status: 500 })
  }

  return ok()
}
