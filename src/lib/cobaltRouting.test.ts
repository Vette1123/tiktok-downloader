import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  Downloader,
  publicCobaltServes,
  resetCobaltCooldown,
} from './downloader'

/**
 * Which cobalt instances a resolve is allowed to spend a subrequest on.
 *
 * Both rules here exist for CPU, not correctness: on Workers every subrequest
 * is billed to the 10 ms budget, a refusal costs the same handshake as an
 * answer, and each attempt is retried twice before the loop moves on.
 */

type PrivateDownloader = {
  tryCobaltInstances(url: string): Promise<unknown>
}

const GENERIC = 'https://example.com/watch/123'
const SUPPORTED = 'https://www.tiktok.com/@someone/video/7000000000000000000'

let calls: string[]

/** A cobalt answer per instance, keyed by the host in the request URL. */
function stubCobalt(byHost: Record<string, () => Response>) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | Request) => {
      const url = typeof input === 'string' ? input : input.url
      calls.push(url)
      const host = new URL(url).host
      const responder = byHost[host]
      if (!responder) throw new Error(`unexpected request to ${url}`)
      return responder()
    }),
  )
}

const tunnel = () =>
  new Response(
    JSON.stringify({ status: 'tunnel', url: 'https://cdn.test/f.mp4', filename: 'f.mp4' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
const serverError = () =>
  new Response('upstream is unwell', { status: 530 })

const resolve = (url: string) =>
  (new Downloader({}) as unknown as PrivateDownloader).tryCobaltInstances(url)

beforeEach(() => {
  resetCobaltCooldown()
  delete process.env.COBALT_API_URL
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.COBALT_API_URL
})

it('knows which hosts the public instances serve', () => {
  for (const url of [
    'https://www.tiktok.com/@a/video/1',
    'https://vm.tiktok.com/ZMabc/',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://x.com/a/status/1',
    'https://www.pinterest.co.uk/pin/1/',
    'https://soundcloud.com/a/b',
  ]) {
    expect(publicCobaltServes(url), url).toBe(true)
  }

  for (const url of [
    'https://example.com/watch/123',
    'https://www.socialdownloader.space/',
    'not a url',
    'https://notyoutube.com/watch',
  ]) {
    expect(publicCobaltServes(url), url).toBe(false)
  }
})

it('spends no subrequest on a public instance for a host it does not serve', async () => {
  stubCobalt({})

  await expect(resolve(GENERIC)).resolves.toBeNull()
  expect(calls).toEqual([])
})

it('still tries a self-hosted instance for that same host', async () => {
  process.env.COBALT_API_URL = 'https://mine.test/'
  stubCobalt({ 'mine.test': tunnel })

  await expect(resolve(GENERIC)).resolves.toMatchObject({
    downloadUrl: 'https://cdn.test/f.mp4',
  })
  expect(calls).toEqual(['https://mine.test/'])
})

it('still asks the public instances for a host they do serve', async () => {
  stubCobalt({
    'co.otomir23.me': tunnel,
  })

  await expect(resolve(SUPPORTED)).resolves.toMatchObject({
    downloadUrl: 'https://cdn.test/f.mp4',
  })
  expect(calls).toEqual(['https://co.otomir23.me/'])
})

it('leaves an instance alone after it fails transiently', async () => {
  process.env.COBALT_API_URL = 'https://sick.test/ https://well.test/'
  stubCobalt({ 'sick.test': serverError, 'well.test': tunnel })

  await resolve(GENERIC)
  // Three attempts at the sick one (the retry policy), then the healthy one.
  expect(calls.filter((c) => c.includes('sick.test'))).toHaveLength(3)

  calls.length = 0
  await resolve(GENERIC)
  expect(calls).toEqual(['https://well.test/'])
})

it('tries every instance again rather than failing on the memo alone', async () => {
  process.env.COBALT_API_URL = 'https://sick.test/'
  stubCobalt({ 'sick.test': serverError })

  await resolve(GENERIC)
  calls.length = 0

  // The only instance there is has just failed. Skipping it here would turn a
  // five-minute memo into a five-minute outage.
  await resolve(GENERIC)
  expect(calls.length).toBeGreaterThan(0)
})
