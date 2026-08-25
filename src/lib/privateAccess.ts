/**
 * Private-instance authentication shared by the Cloudflare entrypoint and the
 * plain Request/Response API handlers.
 *
 * Two independent credentials are supported:
 *   - WEB_USERNAME + WEB_PASSWORD create a short signed browser session;
 *   - SHORTCUT_API_KEY authenticates automation through a request header.
 *
 * None of these values are ever returned to the browser, written to a URL, or
 * logged. The browser session cookie contains only an expiry and a random
 * nonce, signed with SESSION_SECRET. Instagram cookies are separate secrets
 * and are never handled by this module.
 */

export interface PrivateAccessEnv {
  WEB_USERNAME?: string
  WEB_PASSWORD?: string
  SESSION_SECRET?: string
  SHORTCUT_API_KEY?: string
}

export const PRIVATE_AUTH_HEADER = 'X-SMD-Private-Auth'
export const PRIVATE_SESSION_COOKIE = 'smd_private_session'

const SESSION_SECONDS = 7 * 24 * 60 * 60
const LOGIN_WINDOW_MS = 10 * 60 * 1000
const LOGIN_MAX_FAILURES = 5
const MIN_SECRET_LENGTH = 32

type LoginAttempt = { failures: number; resetAt: number }
const loginAttempts = new Map<string, LoginAttempt>()

export type PrivateAuthKind = 'web' | 'api'

export interface PrivateAuthResult {
  ok: boolean
  kind?: PrivateAuthKind
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function utf8(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer as ArrayBuffer
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(value)))
}

/** Constant-time comparison after hashing so differing lengths leak nothing. */
async function secretEquals(candidate: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(candidate), sha256(expected)])
  let diff = 0
  for (let index = 0; index < left.length; index++) diff |= left[index] ^ right[index]
  return diff === 0
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return base64Url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(value))),
  )
}

function cookieValue(request: Request, name: string): string {
  const cookie = request.headers.get('cookie') || ''
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() !== name) continue
    return part.slice(separator + 1).trim()
  }
  return ''
}

function configurationIssues(env: PrivateAccessEnv): string[] {
  const username = text(env.WEB_USERNAME)
  const password = text(env.WEB_PASSWORD)
  const sessionSecret = text(env.SESSION_SECRET)
  const shortcutApiKey = text(env.SHORTCUT_API_KEY)
  const issues: string[] = []
  if (!username) issues.push('WEB_USERNAME 未配置')
  if (!password) issues.push('WEB_PASSWORD 未配置')
  if (sessionSecret.length < MIN_SECRET_LENGTH) {
    issues.push('SESSION_SECRET 未配置或少于 32 个字符')
  }
  if (shortcutApiKey.length < MIN_SECRET_LENGTH) {
    issues.push('SHORTCUT_API_KEY 未配置或少于 32 个字符')
  }
  if (
    sessionSecret.length >= MIN_SECRET_LENGTH &&
    shortcutApiKey.length >= MIN_SECRET_LENGTH &&
    sessionSecret === shortcutApiKey
  ) {
    issues.push('SESSION_SECRET 与 SHORTCUT_API_KEY 不能相同')
  }
  return issues
}

function configured(env: PrivateAccessEnv): boolean {
  return configurationIssues(env).length === 0
}

async function createSession(env: PrivateAccessEnv): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(18)))
  const value = `v1.${expires}.${nonce}`
  return `${value}.${await sign(value, text(env.SESSION_SECRET))}`
}

async function verifySession(token: string, env: PrivateAccessEnv): Promise<boolean> {
  const parts = token.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') return false
  const expires = Number(parts[1])
  if (!Number.isFinite(expires) || expires <= Math.floor(Date.now() / 1000)) {
    return false
  }
  const value = parts.slice(0, 3).join('.')
  const expected = await sign(value, text(env.SESSION_SECRET))
  return secretEquals(parts[3], expected)
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') || ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return text(match?.[1] || request.headers.get('x-api-key'))
}

export async function authorizePrivateRequest(
  request: Request,
  env: PrivateAccessEnv,
): Promise<PrivateAuthResult> {
  if (!configured(env)) return { ok: false }

  const apiKey = bearerToken(request)
  if (apiKey && (await secretEquals(apiKey, text(env.SHORTCUT_API_KEY)))) {
    return { ok: true, kind: 'api' }
  }

  const session = cookieValue(request, PRIVATE_SESSION_COOKIE)
  if (session && (await verifySession(session, env))) {
    return { ok: true, kind: 'web' }
  }

  return { ok: false }
}

function clientAddress(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

function loginBlocked(request: Request): number {
  const key = clientAddress(request)
  const now = Date.now()
  const current = loginAttempts.get(key)
  if (!current || current.resetAt <= now) {
    loginAttempts.delete(key)
    return 0
  }
  return current.failures >= LOGIN_MAX_FAILURES
    ? Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    : 0
}

function recordLoginFailure(request: Request) {
  const key = clientAddress(request)
  const now = Date.now()
  const current = loginAttempts.get(key)
  const next =
    current && current.resetAt > now
      ? { failures: current.failures + 1, resetAt: current.resetAt }
      : { failures: 1, resetAt: now + LOGIN_WINDOW_MS }
  loginAttempts.set(key, next)

  // Bound isolate memory even under a distributed username-guessing attempt.
  if (loginAttempts.size > 1000) {
    for (const [address, attempt] of loginAttempts) {
      if (attempt.resetAt <= now || loginAttempts.size > 800) loginAttempts.delete(address)
    }
  }
}

function clearLoginFailures(request: Request) {
  loginAttempts.delete(clientAddress(request))
}

function noStoreJson(body: unknown, status = 200, extra?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...(extra || {}) },
  })
}

export async function handlePrivateLogin(
  request: Request,
  _ctx: unknown,
  env: PrivateAccessEnv = {},
): Promise<Response> {
  if (!configured(env)) {
    return noStoreJson(
      {
        success: false,
        error:
          '私人访问尚未正确配置。请添加 WEB_USERNAME、WEB_PASSWORD、SESSION_SECRET 和 SHORTCUT_API_KEY；后两项必须不同且至少 32 个字符。',
      },
      503,
    )
  }

  const retryAfter = loginBlocked(request)
  if (retryAfter) {
    return noStoreJson(
      { success: false, error: '登录失败次数过多，请稍后再试。' },
      429,
      { 'Retry-After': String(retryAfter) },
    )
  }

  let body: { username?: unknown; password?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return noStoreJson({ success: false, error: '请求格式不正确。' }, 400)
  }

  const usernameOk = await secretEquals(
    text(body.username),
    text(env.WEB_USERNAME),
  )
  const passwordOk = await secretEquals(
    typeof body.password === 'string' ? body.password : '',
    text(env.WEB_PASSWORD),
  )
  if (!usernameOk || !passwordOk) {
    recordLoginFailure(request)
    return noStoreJson({ success: false, error: '账号或密码错误。' }, 401)
  }

  clearLoginFailures(request)
  const session = await createSession(env)
  return noStoreJson(
    { success: true },
    200,
    {
      'Set-Cookie': `${PRIVATE_SESSION_COOKIE}=${session}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
    },
  )
}

export async function handlePrivateStatus(
  request: Request,
  _ctx: unknown,
  env: PrivateAccessEnv = {},
): Promise<Response> {
  const auth = await authorizePrivateRequest(request, env)
  const issues = configurationIssues(env)
  return noStoreJson({
    success: true,
    configured: issues.length === 0,
    authenticated: auth.ok && auth.kind === 'web',
    // Names and validation rules only; never return secret values.
    configuration_issues: issues,
  })
}

export function handlePrivateLogout(): Response {
  return noStoreJson(
    { success: true },
    200,
    {
      'Set-Cookie': `${PRIVATE_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
    },
  )
}
