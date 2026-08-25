import { afterEach, describe, expect, it, vi } from 'vitest'
import { handlePlaylist } from './apiRoutes'
import { signToken, type TokenPayload } from './proToken'

/**
 * The playlist expansion endpoint's contract: Pro-only, YouTube-playlist-only,
 * and honest about playlists that expand to nothing. The page fetch itself is
 * stubbed at the `fetch` boundary with a minimal ytInitialData-shaped body —
 * the parsing lives in playlist.test.ts.
 */

const SECRET = 'test-secret'

// The handler reads the signing secret from the environment, exactly as the
// Worker does; without it no token can verify.
function withSecret(): void {
  vi.stubEnv('PRO_TOKEN_SECRET', SECRET)
}

async function proToken(): Promise<string> {
  const payload: TokenPayload = {
    u: 'user-1',
    exp: Date.now() + 60_000,
    p: true,
  }
  return signToken(payload, SECRET)
}

function playlistPage(ids: string[]): string {
  const renderers = ids
    .map(
      (id) =>
        `"playlistVideoRenderer":{"videoId":"${id}","thumbnail":{},"title":{"runs":[{"text":"t-${id}"}]}}`,
    )
    .join(',')
  return `<html><script>var data = {"contents":[${renderers}]};</script></html>`
}

function request(token?: string, url?: unknown): Request {
  return new Request('https://example.com/api/playlist', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Pro-Token': token } : {}),
    },
    body: JSON.stringify({ url }),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('handlePlaylist', () => {
  it('refuses an anonymous caller before doing anything', async () => {
    const response = await handlePlaylist(request(undefined, 'https://www.youtube.com/playlist?list=PL123456789012'))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ success: false })
  })

  it('refuses a token without the pro claim', async () => {
    withSecret()
    const free = await signToken({ u: 'u', exp: Date.now() + 60_000, p: false }, SECRET)
    const response = await handlePlaylist(request(free, 'https://www.youtube.com/playlist?list=PL123456789012'))
    expect(response.status).toBe(403)
  })

  it('rejects a non-playlist link as a client error', async () => {
    withSecret()
    const token = await proToken()
    const response = await handlePlaylist(request(token, 'https://youtu.be/dQw4w9WgXcQ'))
    expect(response.status).toBe(400)
  })

  it('expands a playlist page into watch URLs', async () => {
    withSecret()
    const spy = vi.fn(async (..._args: unknown[]) =>
      new Response(playlistPage(['aaaaaaaaaaa', 'bbbbbbbbbbb']), {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    vi.stubGlobal('fetch', spy)

    const token = await proToken()
    const response = await handlePlaylist(
      request(token, 'https://www.youtube.com/playlist?list=PL123456789012'),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { success: boolean; videos: Array<{ url: string; title: string }> }
    expect(body.success).toBe(true)
    expect(body.videos.map((v) => v.url)).toEqual([
      'https://www.youtube.com/watch?v=aaaaaaaaaaa',
      'https://www.youtube.com/watch?v=bbbbbbbbbbb',
    ])
    // The fetch went to the canonical playlist URL with English forced, so
    // titles do not come back geo-localised.
    const firstCall = spy.mock.calls[0]
    expect(String(firstCall?.[0])).toContain(
      'https://www.youtube.com/playlist?list=PL123456789012&hl=en',
    )
  })

  it('answers 422 when the page has no videos', async () => {
    withSecret()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html><body>not found</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })))
    const token = await proToken()
    const response = await handlePlaylist(
      request(token, 'https://www.youtube.com/playlist?list=PL123456789012'),
    )
    expect(response.status).toBe(422)
  })

  it('answers 502 when YouTube does not serve the page', async () => {
    withSecret()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    const token = await proToken()
    const response = await handlePlaylist(
      request(token, 'https://www.youtube.com/playlist?list=PL123456789012'),
    )
    expect(response.status).toBe(502)
  })
})
