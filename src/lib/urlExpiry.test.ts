import { describe, expect, it } from 'vitest'
import { EXPIRY_MARGIN_MS, cacheableForMs, earliestUrlExpiry } from './urlExpiry'

const NOW = 1_788_731_796_813

/** A real Cobalt tunnel, as it appears inside a serialised resolve payload. */
function tunnel(expMs: number): string {
  return JSON.stringify({
    success: true,
    downloadUrl: `/api/video?url=${encodeURIComponent(
      `https://co.otomir23.me/tunnel?id=V7wnoD373ihwyIDneFz8t&exp=${expMs}&sig=0b7DGNRQRtqjE`,
    )}`,
    metadata: {
      directVideoUrl: `https://co.otomir23.me/tunnel?id=V7wnoD373ihwyIDneFz8t&exp=${expMs}&sig=0b7DGNRQRtqjE`,
    },
  })
}

describe('reading the expiry off a payload', () => {
  /**
   * The proxied copy is percent-encoded and the direct copy is not, so the same
   * tunnel appears in two spellings. Only the raw one is readable, and one is
   * enough — but this is why the scan must not assume every URL is parseable.
   */
  it('finds a Cobalt tunnel expiry', () => {
    expect(earliestUrlExpiry(tunnel(1_788_731_889_069))).toBe(1_788_731_889_069)
  })

  /** Most CDNs stamp Unix seconds; Cobalt stamps milliseconds. */
  it('reads seconds and milliseconds alike', () => {
    expect(earliestUrlExpiry('https://cdn.test/v.mp4?expires=1788731889')).toBe(
      1_788_731_889_000,
    )
    expect(earliestUrlExpiry('https://cdn.test/v.mp4?exp=1788731889069')).toBe(
      1_788_731_889_069,
    )
  })

  /** A payload holds several links; the first one to die decides. */
  it('takes the soonest of several', () => {
    const body = JSON.stringify({
      a: 'https://a.test/v?exp=1788731889069&sig=x',
      b: 'https://b.test/v?expires=1788731000',
      c: 'https://c.test/v?x-expires=1788732500&k=1',
    })
    expect(earliestUrlExpiry(body)).toBe(1_788_731_000_000)
  })

  /**
   * A URL whose last parameter is the expiry is followed by a quote inside a
   * JSON payload, not by `&`. Requiring one of those matched a Cobalt tunnel
   * (where `sig` comes after `exp`) and missed every provider that puts the
   * expiry last.
   */
  it('reads an expiry that ends the URL', () => {
    expect(
      earliestUrlExpiry('{"downloadUrl":"https://cdn.test/v.mp4?exp=1788731889"}'),
    ).toBe(1_788_731_889_000)
  })

  it('says nothing for a payload of plain links', () => {
    expect(earliestUrlExpiry('{"downloadUrl":"https://cdn.test/plain.mp4"}')).toBeNull()
    expect(earliestUrlExpiry('')).toBeNull()
  })

  /**
   * A false match is worse than a missing one: it would make an entry look
   * already dead and silently switch caching off for that platform.
   */
  it('does not match an unrelated number', () => {
    expect(earliestUrlExpiry('https://cdn.test/v.mp4?width=1788731889')).toBeNull()
    expect(earliestUrlExpiry('https://cdn.test/v.mp4?id=1788731889069')).toBeNull()
    // Substrings of a longer parameter name are not the parameter.
    expect(earliestUrlExpiry('https://cdn.test/v.mp4?noexp=1788731889')).toBeNull()
  })

  /** A global regex keeps `lastIndex` between calls unless it is used correctly. */
  it('gives the same answer twice in a row', () => {
    const body = tunnel(1_788_731_889_069)
    expect(earliestUrlExpiry(body)).toBe(earliestUrlExpiry(body))
  })
})

describe('how long a payload may be cached', () => {
  const TTL = 3 * 60 * 1000

  /**
   * The bug this exists for. A tunnel measured in production lives 92 seconds;
   * the isolate cache held it for 180. Everyone served in the last 88 seconds
   * got a download button that answered 404.
   */
  it('never outlives the tunnel it is holding', () => {
    const body = tunnel(NOW + 92_000)
    expect(cacheableForMs(body, TTL, NOW)).toBe(92_000 - EXPIRY_MARGIN_MS)
  })

  it('still obeys its own TTL when the URL outlives it', () => {
    expect(cacheableForMs(tunnel(NOW + 60 * 60 * 1000), TTL, NOW)).toBe(TTL)
  })

  /**
   * Zero means do not cache. Storing a payload whose links die before anybody
   * can press Download is strictly worse than a miss, because a miss
   * re-resolves and works.
   */
  it('refuses to store a payload that is already useless', () => {
    expect(cacheableForMs(tunnel(NOW - 1), TTL, NOW)).toBe(0)
    expect(cacheableForMs(tunnel(NOW + 5_000), TTL, NOW)).toBe(0)
    expect(cacheableForMs(tunnel(NOW + EXPIRY_MARGIN_MS), TTL, NOW)).toBe(0)
  })

  it('leaves a payload with no stated expiry to the caller’s TTL', () => {
    expect(cacheableForMs('{"downloadUrl":"/api/video?url=x"}', TTL, NOW)).toBe(TTL)
  })
})
