import { describe, expect, it } from 'vitest'
import {
  authorizePrivateRequest,
  handlePrivateLogin,
  handlePrivateLogout,
  handlePrivateStatus,
  PRIVATE_SESSION_COOKIE,
  type PrivateAccessEnv,
} from './privateAccess'

const env: PrivateAccessEnv = {
  WEB_USERNAME: 'owner',
  WEB_PASSWORD: 'correct horse battery staple',
  SESSION_SECRET: 'session-signing-secret-1234567890-abcdef',
  SHORTCUT_API_KEY: 'shortcut-api-key-1234567890-abcdefgh',
}

function loginRequest(body: unknown, ip = '203.0.113.10') {
  return new Request('https://example.com/api/private/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify(body),
  })
}

describe('private access', () => {
  it('fails closed when secrets are missing', async () => {
    const response = await handlePrivateLogin(
      loginRequest({ username: 'x', password: 'y' }, '203.0.113.11'),
      undefined,
      {},
    )
    expect(response.status).toBe(503)
  })

  it('rejects a wrong web password without revealing which field failed', async () => {
    const response = await handlePrivateLogin(
      loginRequest({ username: 'owner', password: 'wrong' }, '203.0.113.12'),
      undefined,
      env,
    )
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: '账号或密码错误。',
    })
  })

  it('creates and verifies an HttpOnly signed browser session', async () => {
    const login = await handlePrivateLogin(
      loginRequest(
        { username: 'owner', password: 'correct horse battery staple' },
        '203.0.113.13',
      ),
      undefined,
      env,
    )
    expect(login.status).toBe(200)
    const setCookie = login.headers.get('set-cookie') || ''
    expect(setCookie).toContain(`${PRIVATE_SESSION_COOKIE}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Strict')

    const cookie = setCookie.split(';')[0]
    const request = new Request('https://example.com/api/private/status', {
      headers: { Cookie: cookie },
    })
    await expect(authorizePrivateRequest(request, env)).resolves.toEqual({
      ok: true,
      kind: 'web',
    })
    const status = await handlePrivateStatus(request, undefined, env)
    await expect(status.json()).resolves.toMatchObject({
      configured: true,
      authenticated: true,
    })
  })

  it('accepts the shortcut key only from a request header', async () => {
    const bearer = new Request('https://example.com/api/shortcut/resolve', {
      headers: { Authorization: `Bearer ${env.SHORTCUT_API_KEY}` },
    })
    await expect(authorizePrivateRequest(bearer, env)).resolves.toEqual({
      ok: true,
      kind: 'api',
    })

    const query = new Request(
      `https://example.com/api/shortcut/resolve?key=${env.SHORTCUT_API_KEY}`,
    )
    await expect(authorizePrivateRequest(query, env)).resolves.toEqual({
      ok: false,
    })
  })

  it('rejects short or reused signing secrets', async () => {
    const short = await handlePrivateLogin(
      loginRequest({ username: 'owner', password: env.WEB_PASSWORD }, '203.0.113.14'),
      undefined,
      { ...env, SHORTCUT_API_KEY: 'too-short' },
    )
    expect(short.status).toBe(503)

    const reused = await handlePrivateLogin(
      loginRequest({ username: 'owner', password: env.WEB_PASSWORD }, '203.0.113.15'),
      undefined,
      { ...env, SHORTCUT_API_KEY: env.SESSION_SECRET },
    )
    expect(reused.status).toBe(503)
  })

  it('reports safe configuration diagnostics without returning secret values', async () => {
    const response = await handlePrivateStatus(
      new Request('https://example.com/api/private/status'),
      undefined,
      { ...env, SHORTCUT_API_KEY: 'short' },
    )
    await expect(response.json()).resolves.toMatchObject({
      configured: false,
      configuration_issues: ['SHORTCUT_API_KEY 未配置或少于 32 个字符'],
    })
  })

  it('clears the browser session cookie on logout', () => {
    const response = handlePrivateLogout()
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})
