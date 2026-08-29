/**
 * Buy Me a Coffee webhooks: supporter status, granted without a human in the
 * loop.
 *
 * Written to be lifted into another project unchanged. Everything specific to
 * this one — which levels exist, what they grant, where the secret lives — is
 * configuration passed to `bmcWebhook`; the only import that ties the file to
 * this repo is the thin `handleBmcWebhook` wrapper at the bottom, which is the
 * ten lines a copy replaces. The contract a host project owes it is two tables
 * (`supporters` from migration 0008, and a `users` table with `email` and a
 * comma-separated `grants` column) and nothing else.
 *
 * What the provider gives us, and what it does not:
 *
 * - Every event shares an envelope of `event_id`, `type`, `live_mode`,
 *   `created` (epoch seconds), `attempt` and `data`.
 * - The signature is a hex HMAC-SHA256 of the raw body under
 *   `x-signature-sha256`, with a secret per endpoint.
 * - The field names *inside* `data` are only published in an OpenAPI file
 *   behind the dashboard login, and differ per event. So the email and level
 *   are pulled by looking through a list of plausible keys rather than by
 *   naming one, and an event that yields no email is logged with its keys so
 *   the first real delivery settles the question instead of a guess deciding
 *   it. See docs/buymeacoffee-setup.md.
 *
 * One Buy Me a Coffee account serves several projects, and support belongs to
 * exactly one of them. What separates them is the name of the thing bought —
 * a membership level or an item on the Extras shelf, treated alike here because
 * the question is the same. Each project tags its own offers and configures
 * only those, so an event for a sibling project reaches this endpoint, matches
 * nothing, and grants nothing. That is the reason `fallback` defaults to `null`
 * rather than to a grant: on a shared account an event we cannot attribute is
 * more likely to belong to a sibling project than to this one, and granting it
 * would hand every project away for one membership on any of them.
 *
 * The three failure modes worth naming, because they cost money quietly:
 *
 * - **Paid before signing in.** Common, since nothing on the page asks for an
 *   account first. The grant is recorded in `supporters` regardless and claimed
 *   by `claimSupporterGrants` when the account appears.
 * - **Paid under a different address.** Unfixable by any code: the provider
 *   knows one address, Google knows another, and nothing links them. Those stay
 *   manual, which is why the welcome note asks for the sign-in address.
 * - **Paid for a level this endpoint does not know.** A renamed level, or a
 *   payload whose level name we failed to read. Nothing is granted and the
 *   level name is logged; the fix is one key in `levels`.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { SUPPORT_LIFETIME, SUPPORT_MEMBERSHIP } from '../../config/support'
import { requireDb, type WorkerEnv } from '../workerEnv'
import { withGrant, withoutGrant } from './entitlement'
import { MAX_WEBHOOK_BYTES, readBounded, verifyWebhookSignature } from './hmacWebhook'

/** The header Buy Me a Coffee carries the hex HMAC in. */
export const SIGNATURE_HEADER = 'x-signature-sha256'

/** What one membership level is worth. */
export interface BmcLevel {
  /** Grant name written into `users.grants`, e.g. `pro`. */
  grant: string
  /**
   * True for a level that is paid once. A cancellation event for it is
   * recorded and ignored rather than acted on.
   */
  lifetime?: boolean
}

export interface BmcConfig {
  /** The endpoint's signing secret, from the provider's webhook dashboard. */
  secret: string
  /**
   * Level name → what it grants. Keys are matched case- and space-insensitively
   * against the level name in the payload, so `Lifetime` and `lifetime` are the
   * same key. These are *this project's* level names; a level belonging to
   * another project on the same account will not be in here, which is exactly
   * how the two stay separate.
   */
  levels?: Record<string, BmcLevel>
  /**
   * What a level not in `levels` grants, including an event that carries no
   * readable level name. Defaults to `null` — grant nothing, log it.
   *
   * Set it to a level only on an account that will never serve a second
   * project. There the asymmetry runs the other way: an unattributable event is
   * someone who paid *here*, and ignoring it silently means an angry email.
   */
  fallback?: BmcLevel | null
  /** Extra event types that grant, beyond `GRANT_EVENTS`. */
  grantEvents?: readonly string[]
  /** Extra event types that revoke, beyond `REVOKE_EVENTS`. */
  revokeEvents?: readonly string[]
  /** Recorded in `supporters.source`. Defaults to `bmc`. */
  source?: string
}

/**
 * Events that mean "this person is a supporter right now".
 *
 * `membership.updated` is in here because a level change arrives as an update,
 * and re-granting is idempotent.
 *
 * Purchases from the Extras shelf are *not* here. They arrive as
 * `extra_purchase.created`, which also fires for every other shop item an
 * account sells, so a project turns it on through `grantEvents` only once it
 * has an extra of its own to recognise — as this one does for its Lifetime.
 */
export const GRANT_EVENTS = [
  'membership.started',
  'membership.updated',
  'recurring_donation.started',
  'recurring_donation.updated',
] as const

/**
 * Events that end it. `membership.paused` is here because a paused membership
 * is not being charged; the row is deleted either way and re-created whole if
 * they come back, so pause and cancel need no separate state.
 */
export const REVOKE_EVENTS = [
  'membership.cancelled',
  'membership.paused',
  'recurring_donation.cancelled',
] as const

type Json = Record<string, unknown>

interface Envelope {
  event_id?: number
  type?: string
  live_mode?: boolean
  created?: number
  data?: unknown
}

function asRecord(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
}

function firstString(source: Json, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function firstNested(
  source: Json,
  objects: readonly string[],
  keys: readonly string[],
): string | null {
  for (const name of objects) {
    const nested = asRecord(source[name])
    if (!nested) continue
    const found = firstString(nested, keys)
    if (found) return found
  }
  return null
}

const EMAIL_KEYS = [
  'supporter_email',
  'member_email',
  'payer_email',
  'buyer_email',
  'email',
] as const
const EMAIL_OBJECTS = ['supporter', 'member', 'payer', 'buyer', 'customer', 'user'] as const

/**
 * Cheap and deliberately not RFC-shaped. The body is signature-verified before
 * this runs, so the check is against provider oddities — a blank, a display
 * name that leaked into the wrong field — not against an attacker.
 */
function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/** The payer's address, lower-cased, or null if this event carries none. */
export function pickEmail(data: Json): string | null {
  const found = firstString(data, EMAIL_KEYS) ?? firstNested(data, EMAIL_OBJECTS, EMAIL_KEYS)
  if (!found) return null
  const email = found.toLowerCase()
  return validEmail(email) ? email : null
}

// No bare `name` or `title` at this level on purpose: on a donation payload
// those are the *supporter's* name, and reading one as an offer name would look
// up something nobody configured.
//
// The `extra_*` / `item_*` / `product_*` candidates are for the Extras shelf,
// where the one-time Lifetime lives. An extra is not a membership level and
// almost certainly does not arrive under `level_name`, but it is the same
// question — what did they buy — so it is the same lookup.
const LEVEL_KEYS = [
  'level_name',
  'membership_level_name',
  'tier_name',
  'plan_name',
  'extra_name',
  'item_name',
  'product_name',
] as const
const LEVEL_OBJECTS = [
  'level',
  'membership_level',
  'membership',
  'tier',
  'plan',
  'extra',
  'item',
  'product',
] as const
const LEVEL_NESTED_KEYS = ['name', 'title', 'level_name'] as const

/** The name of the thing bought — a membership level or an extra — or null. */
export function pickLevel(data: Json): string | null {
  return firstString(data, LEVEL_KEYS) ?? firstNested(data, LEVEL_OBJECTS, LEVEL_NESTED_KEYS)
}

/**
 * Names are compared with case, spacing and dashes ignored, so
 * `Downloader — Supporter`, `Downloader - Supporter` and `downloader supporter`
 * are one name.
 *
 * The dash folding is not tidiness. The tag is typed into a dashboard field by
 * hand and the separator here is an em dash; a hyphen typed in its place would
 * otherwise stop every grant, and the only symptom would be a log line.
 *
 * Everything that is not a letter or a digit is a separator, rather than a list
 * of the dashes worth folding — there are six characters Unicode calls a dash
 * and they are indistinguishable in an editor, which is exactly the class of
 * bug this is here to absorb. `\p{L}` keeps it script-agnostic, so a tag that
 * is not written in Latin letters survives.
 */
const SEPARATORS = /[^\p{L}\p{N}]+/gu
function normalizeLevel(level: string): string {
  return level
    .toLowerCase()
    .replace(SEPARATORS, ' ')
    .trim()
}

/** What this level is worth under this configuration. */
export function resolveLevel(config: BmcConfig, level: string | null): BmcLevel | null {
  const fallback = config.fallback ?? null
  if (!level) return fallback

  const levels = config.levels ?? {}
  for (const [name, value] of Object.entries(levels)) {
    if (normalizeLevel(name) === normalizeLevel(level)) return value
  }
  return fallback
}

/** Epoch seconds on the envelope, in millis. Falls back to `now`. */
function stampOf(created: number | undefined, now: number): number {
  return typeof created === 'number' && Number.isFinite(created) ? created * 1000 : now
}

interface SupporterRow {
  grants: string
  lifetime: number
  event_id: number | null
  updated_at: number
}

/**
 * Whether this delivery is newer than what the row already holds.
 *
 * Two guards, because they catch different things. The same `event_id` is a
 * redelivery — the provider retries anything that is not a 2xx, and a retry of
 * a cancel that already applied must not be treated as fresh. An older stamp is
 * an out-of-order delivery, which is how a cancelled membership comes back to
 * life: `started` at T1 lands after `cancelled` at T2.
 *
 * Equal stamps pass. `created` has one-second resolution, and refusing a
 * same-second event would drop a real level change that happened to land inside
 * the same second as the event before it.
 */
function isFresh(row: SupporterRow | null, eventId: number | undefined, stamp: number): boolean {
  if (!row) return true
  if (eventId !== undefined && row.event_id === eventId) return false
  return stamp >= row.updated_at
}

/**
 * Push the stored grant onto every account holding this address.
 *
 * Read-modify-write per row rather than one `UPDATE ... SET grants = ?`,
 * because the column is a set that `ig` also lives in — see `withGrant`. Email
 * is not unique (deleting and recreating a Google account leaves two rows), so
 * this loops; in practice it is one row or none.
 */
async function syncAccounts(
  db: D1Database,
  email: string,
  apply: (current: string | null) => string | null,
): Promise<void> {
  const found = await db
    .prepare('SELECT id, grants FROM users WHERE email = ?')
    .bind(email)
    .all<{ id: string; grants: string | null }>()

  for (const row of found.results ?? []) {
    const next = apply(row.grants)
    if (next === row.grants) continue
    await db.prepare('UPDATE users SET grants = ? WHERE id = ?').bind(next, row.id).run()
  }
}

/**
 * Give an account whatever the supporters table already knows about its
 * address. Called on every sign-in, which is what closes the paid-first gap.
 *
 * Cheap enough to run unconditionally: one primary-key lookup that misses for
 * everyone who has never supported the project, and no write unless the set
 * actually changes.
 */
export async function claimSupporterGrants(
  db: D1Database,
  userId: string,
  email: string,
): Promise<void> {
  const supporter = await db
    .prepare('SELECT grants FROM supporters WHERE email = ?')
    .bind(email.trim().toLowerCase())
    .first<{ grants: string }>()
  if (!supporter?.grants) return

  const user = await db
    .prepare('SELECT grants FROM users WHERE id = ?')
    .bind(userId)
    .first<{ grants: string | null }>()
  if (!user) return

  let next = user.grants ?? null
  for (const grant of supporter.grants.split(',')) {
    const name = grant.trim()
    if (name) next = withGrant(next, name)
  }
  if (next === user.grants) return

  await db.prepare('UPDATE users SET grants = ? WHERE id = ?').bind(next, userId).run()
}

/**
 * The provider retries any non-2xx, so every "we are not acting on this" exit
 * has to be a 200 — there is nothing to retry into.
 */
function ok(): Response {
  return new Response('ok', { status: 200 })
}

/**
 * The whole handler, minus where the database and the secret came from.
 *
 * Order is load-bearing: bounded read, then HMAC, then parse. Nothing above the
 * signature check may cost more than a fixed amount of CPU, because nothing
 * above it is authenticated.
 */
export async function bmcWebhook(
  request: Request,
  db: D1Database,
  config: BmcConfig,
): Promise<Response> {
  const raw = await readBounded(request, MAX_WEBHOOK_BYTES)
  if (raw === null) return new Response('too large', { status: 413 })

  const valid = await verifyWebhookSignature(
    raw,
    request.headers.get(SIGNATURE_HEADER),
    config.secret,
  )
  if (!valid) return new Response('bad signature', { status: 401 })

  let payload: Envelope
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response('bad body', { status: 400 })
  }

  const type = payload.type
  if (!type) {
    console.warn('bmc webhook: envelope carried no type', Object.keys(payload).join(','))
    return ok()
  }

  const isGrant =
    (GRANT_EVENTS as readonly string[]).includes(type) ||
    (config.grantEvents ?? []).includes(type)
  const isRevoke =
    (REVOKE_EVENTS as readonly string[]).includes(type) ||
    (config.revokeEvents ?? []).includes(type)
  if (!isGrant && !isRevoke) {
    // Logged rather than dropped in silence, because the two reasons to be here
    // are indistinguishable from the outside: an event we deliberately ignore
    // (a plain coffee), or an event type whose *spelling* does not match what
    // this file expects. The provider's dashboard shows friendly labels — "Extra
    // purchased" — not the string it sends, so a mismatch would otherwise look
    // exactly like a working endpoint that nobody has bought from yet.
    console.warn('bmc webhook: event type not handled', type)
    return ok()
  }

  const data = asRecord(payload.data)
  if (!data) return ok()

  const email = pickEmail(data)
  if (!email) {
    // Not an error we can retry out of, but the one thing worth shouting
    // about: it means the payload's field names are not in the lists above,
    // and every supporter is being dropped until they are. The keys are safe
    // to log; the values are not.
    console.error('bmc webhook: no email in payload', type, Object.keys(data).join(','))
    return ok()
  }

  const now = Date.now()
  const stamp = stampOf(payload.created, now)
  const existing = await db
    .prepare('SELECT grants, lifetime, event_id, updated_at FROM supporters WHERE email = ?')
    .bind(email)
    .first<SupporterRow>()

  if (!isFresh(existing, payload.event_id, stamp)) return ok()

  try {
    if (isRevoke) {
      // A cancellation for a sibling project's level lands on this endpoint too,
      // since the account is shared. A named level that is not ours is not our
      // membership. An *unnamed* one is ambiguous and we act on it anyway:
      // refusing every unnamed cancellation is how a membership becomes
      // permanent, and this endpoint only ever holds rows it granted itself.
      const cancelled = pickLevel(data)
      if (cancelled && !resolveLevel(config, cancelled)) return ok()

      // A one-time purchase has nothing to take back. The provider still emits
      // a cancellation when the member drops the level from their account, and
      // acting on it would revoke something already paid for in full.
      if (existing?.lifetime) return ok()

      await db.prepare('DELETE FROM supporters WHERE email = ?').bind(email).run()
      if (existing) {
        const revoked = existing.grants.split(',').map((name) => name.trim()).filter(Boolean)
        await syncAccounts(db, email, (current) =>
          revoked.reduce<string | null>((set, name) => withoutGrant(set, name), current),
        )
      }
      return ok()
    }

    const level = pickLevel(data)
    const resolved = resolveLevel(config, level)
    if (!resolved) {
      // Expected traffic on a shared account — most of these are a sibling
      // project's membership. Logged anyway, because the other cause is one of
      // *our* levels renamed in the dashboard, and that looks identical from
      // here. The level name is the fix; a null one means `pickLevel` missed.
      console.warn('bmc webhook: level not configured here', type, level ?? '(none)')
      return ok()
    }

    await db
      .prepare(
        `INSERT INTO supporters (email, grants, level, lifetime, source, event_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           grants = excluded.grants,
           level = excluded.level,
           -- Never downgrades. Someone who bought Lifetime and later also holds
           -- a monthly must not have the permanent half quietly expire with it.
           lifetime = MAX(supporters.lifetime, excluded.lifetime),
           source = excluded.source,
           event_id = excluded.event_id,
           updated_at = excluded.updated_at`,
      )
      .bind(
        email,
        resolved.grant,
        level,
        resolved.lifetime ? 1 : 0,
        config.source ?? 'bmc',
        payload.event_id ?? null,
        stamp,
      )
      .run()

    await syncAccounts(db, email, (current) => withGrant(current, resolved.grant))
    return ok()
  } catch (error) {
    // A transient D1 failure. The provider retries, the guards above make the
    // retry a no-op if half of it already landed.
    console.error('bmc webhook: write failed', type, String(error))
    return new Response('retry', { status: 500 })
  }
}

/**
 * What this project's two offers are worth.
 *
 * The names carry the project because the account does not — see
 * `src/config/support.ts` for why the name is the only attribute available.
 * These two keys are the whole of what this site recognises; anything else on
 * the account resolves to nothing here.
 *
 * Both grant `pro`, which is the entitlement `src/config/pro.ts` describes.
 * Neither may ever map to `ig` — see migration 0007 for why that one is not
 * something support can buy.
 */
export const BMC_LEVELS: Record<string, BmcLevel> = {
  [SUPPORT_MEMBERSHIP]: { grant: 'pro' },
  [SUPPORT_LIFETIME]: { grant: 'pro', lifetime: true },
}

/**
 * The Extras shelf, where the one-time Lifetime lives.
 *
 * Off by default in `GRANT_EVENTS` because this event fires for every shop item
 * an account sells, and a mug must not hand out supporter status. Safe to turn
 * on here precisely because the name is tagged: an extra that is not
 * `SUPPORT_LIFETIME` matches nothing and grants nothing, which is the same rule
 * that keeps another project's membership out.
 */
const EXTRA_EVENTS = ['extra_purchase.created'] as const

/** POST /api/billing/bmc */
export async function handleBmcWebhook(
  request: Request,
  _ctx?: unknown,
  env?: WorkerEnv,
): Promise<Response> {
  const db = requireDb(env)
  if (db instanceof Response) return db

  const secret = process.env.BMC_WEBHOOK_SECRET?.trim()
  if (!secret) return new Response('not configured', { status: 503 })

  return bmcWebhook(request, db, { secret, levels: BMC_LEVELS, grantEvents: EXTRA_EVENTS })
}
