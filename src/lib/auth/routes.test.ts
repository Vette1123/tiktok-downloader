import { describe, expect, it, vi } from 'vitest'
import type { WorkerEnv } from '../workerEnv'
import { handleAccount, handleAuthCallback, packAuthState, unpackAuthState } from './routes'
import type { UserRow } from './session'

describe('the OAuth state cookie', () => {
  it('round-trips an ordinary path', () => {
    expect(unpackAuthState(packAuthState('abc123', '/account'))).toEqual({
      state: 'abc123',
      target: '/account',
    })
  })

  it('round-trips a dotted path, which a `.` separator truncated', () => {
    expect(unpackAuthState(packAuthState('abc123', '/pro.html')).target).toBe('/pro.html')
  })

  it('round-trips a query string', () => {
    expect(unpackAuthState(packAuthState('abc123', '/account?checkout=success')).target).toBe(
      '/account?checkout=success',
    )
  })

  it('falls back to the home page for a malformed percent-sequence, rather than throwing', () => {
    expect(unpackAuthState('abc123|%E0%A4%A')).toEqual({ state: 'abc123', target: '/' })
  })

  it('reads a missing cookie as no state at all', () => {
    expect(unpackAuthState(null)).toEqual({ state: '', target: '/' })
  })
})

/** Enough of D1 for loadSession plus one write. */
function fakeDb(user: UserRow | null) {
  const statements: string[] = []
  const calls: { sql: string; args: unknown[] }[] = []
  const db = {
    prepare(sql: string) {
      statements.push(sql)
      const call: { sql: string; args: unknown[] } = { sql, args: [] }
      calls.push(call)
      const stmt = {
        bind: (...args: unknown[]) => {
          call.args = args
          return stmt
        },
        first: async () => user,
        all: async () => ({ results: [] }),
        run: async () => ({}),
      }
      return stmt
    },
  }
  return { env: { DB: db } as unknown as WorkerEnv, statements, calls }
}

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'user-uuid',
    google_sub: 'sub',
    email: 'buyer@example.com',
    created_at: 0,
    prefs: null,
    sub_id: null,
    sub_status: null,
    sub_variant: null,
    sub_renews_at: null,
    sub_ends_at: null,
    sub_past_due_since: null,
    sub_updated_at: null,
    ...overrides,
  } as UserRow
}

function deleteRequest(): Request {
  return new Request('https://example.com/api/account', {
    method: 'POST',
    headers: { Cookie: 'smd_session=raw-session-value', 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: true }),
  })
}

/**
 * A callback with no usable state cookie is the common mobile failure: the
 * sign-in started in an in-app webview and Google handed the callback to
 * Chrome, or the trip through the consent and 2FA screens outlived the
 * cookie. It used to answer that with raw JSON on a blank page, which is a
 * dead end for the one person who most needs a retry button.
 */
describe('handleAuthCallback — a sign-in that cannot be completed', () => {
  // `loadSession` short-circuits on a request with no session cookie, so the
  // duplicate-delivery check below never reaches this stand-in.
  const env = { DB: {} } as unknown as WorkerEnv

  function callback(headers: Record<string, string> = {}): Request {
    return new Request('https://www.socialdownloader.space/api/auth/callback?code=x&state=y', {
      headers,
    })
  }

  it('sends a browser to the account page with a reason it can act on', async () => {
    const response = await handleAuthCallback(callback({ 'Sec-Fetch-Mode': 'navigate' }), undefined, env)

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(
      'https://www.socialdownloader.space/account?signin=expired',
    )
  })

  it('clears the stale OAuth cookies so the retry starts clean', async () => {
    const response = await handleAuthCallback(callback({ 'Sec-Fetch-Mode': 'navigate' }), undefined, env)

    const cookies = response.headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    for (const cookie of cookies) expect(cookie).toContain('Max-Age=0')
  })

  it('still answers a programmatic caller with JSON', async () => {
    const response = await handleAuthCallback(
      callback({ Accept: 'application/json' }),
      undefined,
      env,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ success: false })
  })
})

/**
 * Android delivers the callback URL to more than one place — a sign-in started
 * in Chrome is handed to the installed app too, because the callback is an
 * in-scope URL. Both fetch it, one redeems the single-use code, and the other
 * fails. The loser used to tell a signed-in person their sign-in had failed.
 */
describe('handleAuthCallback — a duplicate delivery of a callback that worked', () => {
  function duplicate(): Request {
    // No state cookie: the delivery that won the race expired it. The session
    // cookie it set is on the request, which is the proof that nothing failed.
    return new Request('https://www.socialdownloader.space/api/auth/callback?code=x&state=y', {
      headers: { Cookie: 'smd_session=raw-session-value', 'Sec-Fetch-Mode': 'navigate' },
    })
  }

  it('sends them where the sign-in was headed, with no failure notice', async () => {
    const { env } = fakeDb(userRow())

    const response = await handleAuthCallback(duplicate(), undefined, env)

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('https://www.socialdownloader.space/')
    expect(response.headers.get('Location')).not.toContain('signin=')
  })

  it('still expires the one-shot OAuth cookies', async () => {
    const { env } = fakeDb(userRow())

    const response = await handleAuthCallback(duplicate(), undefined, env)

    const cookies = response.headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    for (const cookie of cookies) expect(cookie).toContain('Max-Age=0')
  })

  it('still reports a real failure when there is no session to fall back on', async () => {
    // Same request, but the session lookup finds nothing — so this genuinely
    // did fail and the visitor needs to be told.
    const { env } = fakeDb(null)

    const response = await handleAuthCallback(duplicate(), undefined, env)

    expect(response.headers.get('Location')).toBe(
      'https://www.socialdownloader.space/account?signin=expired',
    )
  })
})

describe('handleAccount — deleting an account', () => {
  it('refuses while a subscription is still entitling, so it cannot be stranded', async () => {
    const { env, statements } = fakeDb(userRow({ sub_status: 'active', sub_id: '42' }))

    const response = await handleAccount(deleteRequest(), undefined, env)
    const body = (await response.json()) as { success: boolean; error?: string }

    expect(response.status).toBe(409)
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/billing portal/i)
    expect(statements.some((sql) => sql.startsWith('DELETE FROM users'))).toBe(false)
  })

  it('still refuses a cancelled subscription that has paid time left', async () => {
    const { env } = fakeDb(
      userRow({ sub_status: 'scheduled_cancel', sub_ends_at: Date.now() + 86_400_000 }),
    )

    expect((await handleAccount(deleteRequest(), undefined, env)).status).toBe(409)
  })

  it('deletes once nothing is entitling', async () => {
    const { env, statements } = fakeDb(userRow({ sub_status: 'expired' }))

    const response = await handleAccount(deleteRequest(), undefined, env)

    expect(response.status).toBe(200)
    expect(statements.some((sql) => sql.startsWith('DELETE FROM users'))).toBe(true)
  })
})

/**
 * Moving the deployment to a different Google Cloud project changes every
 * `sub`, because a `sub` names a person within one project rather than
 * globally. Without the re-key below, the first sign-in after the move opens a
 * second row and strands the original — grants, billing columns and all —
 * behind an identifier that will never be presented again.
 *
 * The mock stands in for the round trip to Google; the failure paths in the
 * describes above return before the exchange, so it never reaches them.
 */
vi.mock('./google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./google')>()),
  exchangeAuthorizationCode: async () => 'stand-in-id-token',
  decodeIdToken: () => ({
    sub: 'sub-from-the-new-project',
    email: 'buyer@example.com',
    email_verified: true,
  }),
}))

describe('handleAuthCallback — a sign-in after the OAuth client moved projects', () => {
  function signIn(): Request {
    const state = 'state-token'
    return new Request(
      `https://www.socialdownloader.space/api/auth/callback?code=x&state=${state}`,
      {
        headers: {
          Cookie: `smd_oauth_state=${packAuthState(state, '/account')}; smd_oauth_verifier=v`,
          'Sec-Fetch-Mode': 'navigate',
        },
      },
    )
  }

  it('re-keys the existing row by verified email instead of orphaning it', async () => {
    const { env, calls } = fakeDb(userRow({ google_sub: 'sub-from-the-old-project' }))

    await handleAuthCallback(signIn(), undefined, env)

    const rekey = calls.find((call) => call.sql.startsWith('UPDATE users SET google_sub'))
    expect(rekey).toBeDefined()
    expect(rekey?.args).toEqual([
      'sub-from-the-new-project',
      'buyer@example.com',
      'sub-from-the-new-project',
    ])
  })

  it('re-keys before the INSERT, or the INSERT would have created the orphan first', async () => {
    const { env, statements } = fakeDb(userRow({ google_sub: 'sub-from-the-old-project' }))

    await handleAuthCallback(signIn(), undefined, env)

    const rekey = statements.findIndex((sql) => sql.startsWith('UPDATE users SET google_sub'))
    const insert = statements.findIndex((sql) => sql.startsWith('INSERT INTO users'))
    expect(rekey).toBeGreaterThanOrEqual(0)
    expect(rekey).toBeLessThan(insert)
  })
})
