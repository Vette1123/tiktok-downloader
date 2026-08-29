import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The paste path for a TikTok link runs two resolvers: the browser's own call to
 * tikwm, and POST /api/download. tikwm is the better answer when it is quick —
 * its CDN URL streams straight to the visitor — but it queues its callers under
 * load, and awaiting it outright made every paste wait out that queue before the
 * server was asked at all. These pin the hedge that replaced it.
 */
const browserResolve = vi.hoisted(() => vi.fn())
vi.mock('./tikwmClient', () => ({ resolveTikTokInBrowser: browserResolve }))

const { resolve } = await import('./resolve')

const TIKTOK = 'https://www.tiktok.com/@someone/video/7123456789012345678'

/** What each resolver hands back, distinguishable by title. */
const answer = (title: string) => ({
  success: true as const,
  downloadUrl: `/api/video?url=${title}`,
  audioUrl: '',
  metadata: { title } as never,
})

function stubServer(delayMs: number, title = 'from-server') {
  const spy = vi.fn(
    async () =>
      new Promise<Response>((r) =>
        setTimeout(
          () => r(new Response(JSON.stringify(answer(title)))),
          delayMs,
        ),
      ),
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

const never = new Promise<never>(() => {})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  browserResolve.mockReset()
})

describe('resolving a TikTok link', () => {
  it('never troubles the server when the browser answers first', async () => {
    browserResolve.mockResolvedValue(answer('from-browser'))
    const server = stubServer(0)

    const result = await resolve(TIKTOK)

    expect(result.metadata?.title).toBe('from-browser')
    expect(server).not.toHaveBeenCalled()
  })

  it('falls to the server the moment the browser attempt misses', async () => {
    browserResolve.mockResolvedValue(null)
    stubServer(0)

    const result = await resolve(TIKTOK)

    expect(result.metadata?.title).toBe('from-server')
  })

  it('does not wait out a queueing tikwm', async () => {
    // The failure this replaced: the browser call sat on tikwm's queue and the
    // server was not asked until it gave up.
    browserResolve.mockReturnValue(never)
    stubServer(0)

    const result = await resolve(TIKTOK)

    expect(result.metadata?.title).toBe('from-server')
  })

  it('keeps a late browser answer when the server request fails', async () => {
    // Racing the raw server promise meant a network error settled the race and
    // was thrown at the caller, discarding the browser answer still in flight.
    browserResolve.mockReturnValue(
      new Promise((r) => setTimeout(() => r(answer('from-browser')), 750)),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    const result = await resolve(TIKTOK)

    expect(result.metadata?.title).toBe('from-browser')
  })

  it('cancels the server request the browser beat', async () => {
    browserResolve.mockReturnValue(
      new Promise((r) => setTimeout(() => r(answer('from-browser')), 750)),
    )
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined
        return never
      }),
    )

    const result = await resolve(TIKTOK)

    expect(result.metadata?.title).toBe('from-browser')
    expect(signal?.aborted).toBe(true)
  })

  it('leaves audio mode on the server path, which tikwm cannot serve', async () => {
    stubServer(0)
    await resolve(TIKTOK, { format: 'audio' })
    expect(browserResolve).not.toHaveBeenCalled()
  })

  it('leaves every other platform on the server path', async () => {
    stubServer(0)
    await resolve('https://www.instagram.com/reel/Cabcdefghij/')
    expect(browserResolve).not.toHaveBeenCalled()
  })
})
