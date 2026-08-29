/**
 * The auth surface: five handlers, all shaped like every other route in
 * API_ROUTES so the Worker can dispatch them without initialising Next.
 *
 * The reconcile path is dynamically imported inside the handler that needs it.
 * An isolate that only ever serves downloads must never evaluate it — see
 * src/lib/auth/google.ts for the CPU budget this is all in service of.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { requireDb, type WorkerEnv } from '../workerEnv'
import type { WaitUntilContext } from '../edgeCache'
import { ACCESS_TOKEN_TTL_MS, signToken } from '../proToken'
import { hasGrant, isEntitled, isProAt } from '../billing/entitlement'
import { claimSupporterGrants } from '../billing/bmc'
import {
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  createAuthorizationUrl,
  decodeIdToken,
  exchangeAuthorizationCode,
  oauthTempCookie,
  randomToken,
  safeRedirect,
} from './google'
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  clearCookieHeaders,
  createSession,
  deleteAllSessions,
  deleteSession,
  loadSession,
  readCookie,
  sessionCookieHeaders,
} from './session'

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ Location: location })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(null, { status: 302, headers })
}

/**
 * Whether a human is looking at this response.
 *
 * Both auth endpoints are reached by a browser following a redirect, so their
 * failures are rendered by a browser — and a browser renders
 * `{"success":false,"error":"Sign-in could not be completed."}` as exactly
 * that, on a blank page, with no way back and no way to retry.
 */
function isNavigation(request: Request): boolean {
  if (request.headers.get('Sec-Fetch-Mode') === 'navigate') return true
  return (request.headers.get('Accept') ?? '').includes('text/html')
}

/**
 * Hand a failed sign-in back to the account page, which renders the reason
 * above a working "Sign in with Google" button. The expired cookies go with it
 * so a retry starts from a clean slate rather than re-failing on the same
 * stale state.
 */
function authFailure(
  request: Request,
  reason: 'expired' | 'failed' | 'email',
  error: string,
): Response {
  const cookies = [oauthTempCookie(OAUTH_STATE_COOKIE, ''), oauthTempCookie(OAUTH_VERIFIER_COOKIE, '')]
  if (!isNavigation(request)) {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    for (const cookie of cookies) headers.append('Set-Cookie', cookie)
    return new Response(JSON.stringify({ success: false, error }), { status: 400, headers })
  }
  return redirect(new URL(`/account?signin=${reason}`, request.url).toString(), cookies)
}

/**
 * The state cookie packs two fields into one value, so the separator has to be
 * a character `encodeURIComponent` escapes and an OAuth state (base64url) can
 * never contain. `.` was neither, which silently truncated `/pro.html` to
 * `/pro`; `%7C` is what an encoded target turns a `|` into.
 */
const STATE_SEPARATOR = '|'

export function packAuthState(state: string, target: string): string {
  return `${state}${STATE_SEPARATOR}${encodeURIComponent(target)}`
}

/**
 * The inverse. Never throws: a malformed percent-sequence in a cookie must fail
 * to the safe default, not 500 the callback. The returned target is still
 * untrusted — `safeRedirect` is what makes it safe to follow.
 */
export function unpackAuthState(cookie: string | null): { state: string; target: string } {
  const [state = '', encodedTarget = ''] = (cookie ?? '').split(STATE_SEPARATOR)
  try {
    return { state, target: decodeURIComponent(encodedTarget) || '/' }
  } catch {
    return { state, target: '/' }
  }
}

/**
 * Google sends `email_verified` as a boolean, and older tokens as a string.
 * Only an explicit negative rejects: an absent claim is not evidence of
 * anything, and `users.email` is what billing matches on.
 */
function emailUnverified(value: unknown): boolean {
  return value === false || value === 'false'
}

interface IdTokenClaims {
  sub?: string
  email?: string
  email_verified?: unknown
  name?: unknown
  picture?: unknown
}

/**
 * A profile claim, bounded. Google is the only writer here and is not hostile,
 * but these two strings are the one part of the ID token that goes into the
 * database unvalidated and comes back out into a page — so they are length-
 * capped at the boundary rather than trusted to be sane.
 */
function claimText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

/** GET /api/auth/google */
export async function handleAuthStart(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  if (!clientId) {
    return Response.json(
      { success: false, error: 'Sign-in is not configured on this deployment.' },
      { status: 503 },
    )
  }

  const state = randomToken()
  const verifier = randomToken()
  const authorizationUrl = await createAuthorizationUrl(url.origin, state, verifier)

  // The post-login destination rides in the state cookie's sibling rather than
  // through Google, so it cannot be tampered with in transit.
  const target = safeRedirect(url.searchParams.get('redirect_to'), url.origin)

  return redirect(authorizationUrl, [
    oauthTempCookie(OAUTH_STATE_COOKIE, packAuthState(state, target)),
    oauthTempCookie(OAUTH_VERIFIER_COOKIE, verifier),
  ])
}

/**
 * Whether this callback is a *second* delivery of one that already worked.
 *
 * An OAuth authorization code is single-use. Android delivers the callback URL
 * to more than one place — a sign-in started in Chrome is also handed to the
 * installed app, because the callback is an in-scope URL — so both fetch it,
 * one redeems the code, and the other gets `invalid_grant` from Google. The
 * loser of that race used to render "Google could not complete the sign-in" at
 * somebody who was, at that exact moment, signed in: the winner had already
 * created the session and set the cookie that this request is carrying.
 *
 * So before reporting any callback failure, ask the only question that settles
 * it — is there a live session on this browser? If there is, the sign-in
 * succeeded and this is a duplicate to be swallowed, not an error to report.
 *
 * This grants nothing. No session is created here, and the caller has to hold a
 * valid session cookie to reach the quiet path at all; the worst a forged
 * callback buys is a redirect to a `safeRedirect`-validated path on our own
 * origin, which is where the visitor was going anyway.
 */
async function sessionAlreadyLive(
  db: D1Database,
  request: Request,
  now: number,
): Promise<boolean> {
  const raw = readCookie(request.headers.get('Cookie'), SESSION_COOKIE)
  return (await loadSession(db, raw, now)) !== null
}

/** GET /api/auth/callback */
export async function handleAuthCallback(
  request: Request,
  _ctx?: WaitUntilContext,
  env?: WorkerEnv,
): Promise<Response> {
  const db = requireDb(env)
  if (db instanceof Response) return db

  const url = new URL(request.url)
  const cookies = request.headers.get('Cookie')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const storedState = readCookie(cookies, OAUTH_STATE_COOKIE)
  const verifier = readCookie(cookies, OAUTH_VERIFIER_COOKIE)

  const now = Date.now()
  const { state: expectedState, target: requestedTarget } = unpackAuthState(storedState)

  /**
   * The quiet ending for a duplicate callback: send them where the sign-in was
   * headed, and expire the one-shot cookies on the way, exactly as the
   * successful branch does. No notice — nothing went wrong.
   */
  const settled = async (): Promise<Response | null> => {
    if (!(await sessionAlreadyLive(db, request, now))) return null
    return redirect(`${url.origin}${safeRedirect(requestedTarget, url.origin)}`, [
      oauthTempCookie(OAUTH_STATE_COOKIE, ''),
      oauthTempCookie(OAUTH_VERIFIER_COOKIE, ''),
    ])
  }

  if (!code || !state || !verifier || !expectedState || state !== expectedState) {
    // The one-shot cookies are cleared by whichever delivery redeemed the code,
    // so a duplicate arriving after that lands here rather than on the exchange
    // below — same non-event, same quiet ending.
    const done = await settled()
    if (done) return done
    // Nearly always a lost cookie rather than an attack: the sign-in was
    // started in a different browser (an in-app webview handing off to
    // Chrome), or the round trip through Google's consent and 2FA screens
    // outlived the temporary cookie. Both are a retry, not an error.
    return authFailure(request, 'expired', 'Sign-in could not be completed. Please try again.')
  }

  let claims: IdTokenClaims
  try {
    const idToken = await exchangeAuthorizationCode(url.origin, code, verifier)
    claims = decodeIdToken(idToken) as IdTokenClaims
  } catch {
    // `invalid_grant`, most often — the code was already redeemed by another
    // delivery of this same callback, in which case the session it created is
    // on this browser right now and there is nothing to report.
    const done = await settled()
    if (done) return done
    return authFailure(request, 'failed', 'Sign-in could not be completed. Please try again.')
  }

  if (!claims.sub || !claims.email) {
    return authFailure(request, 'email', 'Google did not return an email address.')
  }

  // An unverified address must never reach `users.email`: that column is what
  // an orphaned purchase is matched against, so accepting one would let anyone
  // claim someone else's billing row by signing up with their address.
  if (emailUnverified(claims.email_verified)) {
    return authFailure(request, 'email', 'Google did not return a verified email address.')
  }

  // Google's `sub` identifies a person *within one Google Cloud project*, not
  // globally: point the deployment at a different OAuth client and every
  // returning visitor arrives with an unfamiliar `sub`, so the INSERT below
  // would open a second row and leave the first one — its grants, its billing
  // columns, its preferences — stranded behind an identifier nobody will ever
  // present again. `users.email` is only indexed, not unique, so nothing would
  // have complained.
  //
  // Re-keying the existing row by address is safe precisely here, and only
  // here: the address was checked as verified four lines up, which is the same
  // proof of ownership the billing reconcile leans on. `google_sub` is UNIQUE,
  // so if a duplicate pair of rows already exists this updates the first and
  // the second stays where it was — no worse than before.
  //
  // Costs one indexed UPDATE per sign-in that matches nothing once the move is
  // done. Cheap enough to leave in place rather than remember to remove.
  await db
    .prepare('UPDATE users SET google_sub = ? WHERE email = ? AND google_sub != ?')
    .bind(claims.sub, claims.email, claims.sub)
    .run()

  // ON CONFLICT keeps the email, name and avatar current for someone who
  // changed them at Google, without disturbing their billing columns. COALESCE
  // on the two profile fields so a token that omits them (an older account, a
  // consent screen where `profile` was declined) leaves what we already have
  // rather than blanking the avatar.
  await db
    .prepare(
      `INSERT INTO users (id, google_sub, email, name, picture, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(google_sub) DO UPDATE SET
         email = excluded.email,
         name = COALESCE(excluded.name, users.name),
         picture = COALESCE(excluded.picture, users.picture)`,
    )
    .bind(
      crypto.randomUUID(),
      claims.sub,
      claims.email,
      claimText(claims.name, 128),
      claimText(claims.picture, 512),
      now,
    )
    .run()

  const user = await db
    .prepare('SELECT id FROM users WHERE google_sub = ?')
    .bind(claims.sub)
    .first<{ id: string }>()

  if (!user) {
    return Response.json(
      { success: false, error: 'Could not create your account. Please try again.' },
      { status: 500 },
    )
  }

  // Support usually arrives before the account does — nothing on the support
  // page asks anyone to sign in first — so the webhook can only record the
  // grant against an email address. This is where it becomes an entitlement.
  // Run on every sign-in rather than only on creation: someone who supports
  // months after signing up gets it on their next visit without a hand-run
  // UPDATE. A miss is one primary-key lookup, and a failure here must not cost
  // anyone their session.
  try {
    await claimSupporterGrants(db, user.id, claims.email)
  } catch (error) {
    console.error('auth: could not claim supporter grants', String(error))
  }

  const raw = await createSession(db, user.id, now)
  const target = safeRedirect(requestedTarget, url.origin)

  return redirect(`${url.origin}${target}`, [
    ...sessionCookieHeaders(raw, Math.floor(SESSION_TTL_MS / 1000)),
    oauthTempCookie(OAUTH_STATE_COOKIE, ''),
    oauthTempCookie(OAUTH_VERIFIER_COOKIE, ''),
  ])
}

/** POST /api/auth/refresh */
export async function handleRefresh(
  request: Request,
  ctx?: WaitUntilContext,
  env?: WorkerEnv,
): Promise<Response> {
  const db = requireDb(env)
  if (db instanceof Response) return db

  const secret = process.env.PRO_TOKEN_SECRET?.trim()
  if (!secret) {
    return Response.json(
      { success: false, error: 'Sign-in is not configured on this deployment.' },
      { status: 503 },
    )
  }

  const now = Date.now()
  const raw = readCookie(request.headers.get('Cookie'), SESSION_COOKIE)
  const user = await loadSession(db, raw, now)

  if (!user) {
    // Clear the hint too, so a client holding a stale hint stops rendering an
    // avatar for a session that no longer exists.
    const headers = new Headers({ 'Content-Type': 'application/json' })
    for (const cookie of clearCookieHeaders()) headers.append('Set-Cookie', cookie)
    return new Response(JSON.stringify({ success: false, error: 'Not signed in' }), {
      status: 401,
      headers,
    })
  }

  // Repair a row webhooks lost. Deferred past the response, so the user waits
  // for nothing, and skipped entirely when the row is fresh — which, when
  // webhooks are working, is always.
  const forced = new URL(request.url).searchParams.get('reconcile') === '1'
  const { needsReconcile, reconcileSubscription } = await import('../billing/reconcile')
  if (needsReconcile(user, now, forced)) {
    // The user row goes with it: a forced reconcile for someone whose webhook
    // was lost has no `sub_id` to look up, and finds the
    // subscription by the address they signed in with instead.
    const work = reconcileSubscription(db, user.sub_id, now, user)
    if (ctx) ctx.waitUntil(work)
    else await work
  }

  // `isEntitled`, not `isProAt`: features come from a subscription or from a
  // hand grant, and with payments withdrawn the grant is the only live source.
  const pro = isEntitled(user, now)
  const exp = now + ACCESS_TOKEN_TTL_MS
  // Minted only when the grant is on the row, and never derived from `pro` —
  // see the `c` claim in proToken.ts. A supporter is Pro and is not this.
  const token = await signToken(
    { u: user.id, exp, p: pro, ...(hasGrant(user, 'ig') ? { c: true } : {}) },
    secret,
  )

  return Response.json({
    success: true,
    token,
    expiresAt: exp,
    // The checkout link has to carry this as `custom_data.user_id`, or the
    // webhook can only match the purchase by email — which is editable at
    // checkout, and is the PayPal account's address when paying that way. An
    // internal UUID handed to its own signed-in owner discloses nothing.
    userId: user.id,
    pro,
    email: user.email,
    name: user.name,
    picture: user.picture,
    plan: {
      status: user.sub_status,
      variant: user.sub_variant,
      renewsAt: user.sub_renews_at,
      endsAt: user.sub_ends_at,
      pastDueSince: user.sub_past_due_since,
    },
    prefs: user.prefs,
  })
}

/** POST /api/auth/logout */
export async function handleLogout(
  request: Request,
  _ctx?: WaitUntilContext,
  env?: WorkerEnv,
): Promise<Response> {
  const db = requireDb(env)
  if (db instanceof Response) return db

  const raw = readCookie(request.headers.get('Cookie'), SESSION_COOKIE)
  const all = new URL(request.url).searchParams.get('all') === '1'

  if (all) {
    const user = await loadSession(db, raw, Date.now())
    if (user) await deleteAllSessions(db, user.id)
  } else {
    await deleteSession(db, raw)
  }

  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const cookie of clearCookieHeaders()) headers.append('Set-Cookie', cookie)
  return new Response(JSON.stringify({ success: true }), { status: 200, headers })
}

/** POST /api/account — { prefs } to save, { delete: true } to close the account. */
export async function handleAccount(
  request: Request,
  _ctx?: WaitUntilContext,
  env?: WorkerEnv,
): Promise<Response> {
  const db = requireDb(env)
  if (db instanceof Response) return db

  const now = Date.now()
  const user = await loadSession(
    db,
    readCookie(request.headers.get('Cookie'), SESSION_COOKIE),
    now,
  )
  if (!user) {
    return Response.json({ success: false, error: 'Not signed in' }, { status: 401 })
  }

  let body: { prefs?: unknown; delete?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ success: false, error: 'Invalid request body' }, { status: 400 })
  }

  if (body.delete === true) {
    // Refuse while the subscription is still entitling. Deleting the row does
    // not cancel anything at Creem: it would keep billing, every later
    // webhook would match zero rows, a fresh sign-in would create a row with a
    // NULL subscription that reconcile cannot repair, and the billing portal
    // would 404 — paying forever with no Pro and no way back.
    if (isProAt(user, now)) {
      return Response.json(
        {
          success: false,
          error:
            'Cancel your subscription in the billing portal first. Deleting the account now would leave it billing you with no way to restore Pro.',
        },
        { status: 409 },
      )
    }

    // Sessions cascade.
    await db.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run()
    const headers = new Headers({ 'Content-Type': 'application/json' })
    for (const cookie of clearCookieHeaders()) headers.append('Set-Cookie', cookie)
    return new Response(JSON.stringify({ success: true }), { status: 200, headers })
  }

  // ../prefsCore, never ../prefs: the latter is a `'use client'` module and
  // pulls React's whole module scope into this isolate to run a validator.
  const { normalisePrefs } = await import('../prefsCore')
  const prefs = normalisePrefs(body.prefs)
  if (!prefs) {
    return Response.json({ success: false, error: 'Invalid preferences' }, { status: 400 })
  }

  await db
    .prepare('UPDATE users SET prefs = ? WHERE id = ?')
    .bind(JSON.stringify(prefs), user.id)
    .run()

  return Response.json({ success: true, prefs })
}
