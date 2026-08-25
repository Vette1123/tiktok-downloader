import { describe, expect, it } from 'vitest'
import {
  handleDownload,
  handleShortcutResolve,
  resolveCacheKey,
  resolveFailure,
} from './apiRoutes'

describe('resolveCacheKey', () => {
  it('produces equal keys for identical inputs', () => {
    const a = resolveCacheKey('video', 'hd', 'auto', 'https://x.com/a')
    const b = resolveCacheKey('video', 'hd', 'auto', 'https://x.com/a')
    expect(a).toBe(b)
  })

  it('differs when any input differs', () => {
    const base = resolveCacheKey('video', 'hd', 'auto', 'https://x.com/a')
    expect(resolveCacheKey('image', 'hd', 'auto', 'https://x.com/a')).not.toBe(base)
    expect(resolveCacheKey('video', 'sd', 'auto', 'https://x.com/a')).not.toBe(base)
    expect(resolveCacheKey('video', 'hd', 'audio', 'https://x.com/a')).not.toBe(base)
    expect(resolveCacheKey('video', 'hd', 'auto', 'https://x.com/b')).not.toBe(base)
  })

  /**
   * The key deliberately carries no tier. A resolve returns the same payload
   * whoever asks — Pro buys resolver ordering, never reach — so a Pro request
   * and a free one must land on one shared entry. A tier component creeping
   * back in would mean some entitlement had started changing what a resolve
   * can see, which is the shape no merchant of record will underwrite.
   */
  it('is identical regardless of who is asking', () => {
    expect(resolveCacheKey('video', 'hd', 'auto', 'https://x.com/a')).toBe(
      'video|hd|auto|https://x.com/a',
    )
  })
})

/**
 * A private Instagram post is not a server fault, and answering it with 500
 * made a healthy day of people pasting private links read as seventeen
 * server errors in Cloudflare's dashboard — burying anything real.
 */
describe('handleDownload failure statuses', () => {
  async function statusFor(url: string): Promise<number> {
    const request = new Request('https://example.com/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    const response = await handleDownload(request)
    return response.status
  }

  it('rejects a missing url as a client error', async () => {
    expect(await statusFor('')).toBe(400)
  })

  it('rejects a string that is not a url as a client error', async () => {
    // Rejected by validateUrl before any extractor runs, so this case makes no
    // network call. Anything that does reach an extractor is covered by the
    // resolveFailure cases below instead.
    expect(await statusFor('not a url at all')).toBe(400)
  })
})

describe('shortcut API protection', () => {
  it('rejects direct calls that were not authenticated by the Worker', async () => {
    const response = await handleShortcutResolve(
      new Request('https://example.com/api/shortcut/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://www.instagram.com/p/example/' }),
      }),
    )
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ success: false })
  })
})

describe('resolveFailure', () => {
  it('calls a deliberate extraction failure unprocessable, not broken', () => {
    expect(resolveFailure(new Error('This post is private'), 'x').status).toBe(422)
  })

  it('keeps 500 for a genuine bug, so it still shows up as one', () => {
    // What reading a property of undefined throws. If this ever became 422,
    // real exceptions would hide among the private-link noise.
    expect(resolveFailure(new TypeError('undefined is not an object'), 'x').status).toBe(500)
  })

  it('calls an upstream that never answered a gateway timeout', () => {
    const aborted = new Error('The operation was aborted')
    aborted.name = 'AbortError'
    expect(resolveFailure(aborted, 'x').status).toBe(504)
  })

  it('treats a site that blocks us as content, not a fault', () => {
    const blocked = new Error('example.com blocks automated requests')
    blocked.name = 'OriginBlockedError'
    expect(resolveFailure(blocked, 'x').status).toBe(422)
  })

  it('keeps the extractor message, which the client turns into its banner', async () => {
    const response = resolveFailure(new Error('This post is private'), 'fallback')
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'This post is private',
    })
  })

  it('falls back when something that is not an Error is thrown', async () => {
    const response = resolveFailure('a bare string', 'fallback')
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'fallback' })
  })
})
