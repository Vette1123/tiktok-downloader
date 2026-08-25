import type { ImageData, VideoData } from './types'
import {
  extractFirstHttpUrl,
  parseBilibiliId,
  parseDouyinId,
  type SupportedPlatform,
} from './validator'

export type ChinesePlatform = Extract<
  SupportedPlatform,
  'douyin' | 'kuaishou' | 'bilibili' | 'xiaohongshu'
>

const MOBILE_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36'

const PAGE_HEADERS: Record<string, string> = {
  'User-Agent': MOBILE_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function htmlTitle(html: string): string {
  const value = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function unescapePage(value: string): string {
  return value
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function absoluteMediaUrls(value: string): string[] {
  const decoded = unescapePage(value)
  return unique(
    (decoded.match(/https?:\/\/[^\s"'<>\\]+/gi) ?? [])
      .map((url) => url.replace(/[),;]+$/, ''))
      .filter((url) =>
        /(?:\.mp4|\.m4v|\.mov|\.webm|\.jpg|\.jpeg|\.png|\.webp)(?:[?#]|$)/i.test(
          url,
        ),
      ),
  )
}

async function fetchPage(url: string, referer?: string): Promise<Response> {
  return fetch(url, {
    redirect: 'follow',
    headers: { ...PAGE_HEADERS, ...(referer ? { Referer: referer } : {}) },
    signal: AbortSignal.timeout(12_000),
  })
}

function result(input: {
  id: string
  sourceUrl: string
  title?: string
  author?: string
  video?: string
  thumbnail?: string
  images?: string[]
}): VideoData | null {
  const imageUrls = unique(input.images ?? [])
  const images: ImageData[] = imageUrls.map((url, index) => ({
    id: `${input.id || 'image'}_${index + 1}`,
    url,
    thumbnail: url,
  }))
  if (!input.video && images.length === 0) return null

  return {
    id: input.id || Date.now().toString(),
    title: input.title || '未命名媒体',
    url: input.sourceUrl,
    thumbnail: input.thumbnail || images[0]?.thumbnail || '',
    duration: 0,
    author: input.author || '未知作者',
    description: '',
    downloadUrl: input.video || images[0]?.url || '',
    images: images.length ? images : undefined,
    isPhotoCarousel: images.length > 0,
  }
}

/** Parse the HTML served by Kuaishou's mobile share page. */
export function parseKuaishouHtml(
  html: string,
  sourceUrl: string,
  finalUrl = sourceUrl,
  quality: 'hd' | 'sd' = 'hd',
): VideoData | null {
  const urls = absoluteMediaUrls(html).filter((url) => /\.mp4(?:[?#]|$)/i.test(url))
  if (!urls.length) return null

  const preferred =
    quality === 'sd'
      ? urls.find((url) => /(?:_b_|480|540|sd)/i.test(url))
      : urls.find((url) => /(?:hd15|_hd|1080|2160)/i.test(url))
  const video = preferred || (quality === 'sd' ? urls[0] : urls.at(-1))!
  const decoded = unescapePage(html)
  const author =
    text(decoded.match(/"(?:userName|user_name|authorName)"\s*:\s*"([^"]+)"/i)?.[1]) ||
    '未知作者'
  const id =
    new URL(finalUrl).searchParams.get('photoId') ||
    finalUrl.match(/\/(?:short-video|photo)\/([\w-]+)/)?.[1] ||
    'kuaishou'

  return result({
    id,
    sourceUrl,
    title: htmlTitle(html).replace(/\s*[-_|].*快手.*$/i, '') || '快手视频',
    author,
    video,
    thumbnail: absoluteMediaUrls(html).find((url) => /\.(?:jpe?g|webp|png)(?:[?#]|$)/i.test(url)),
  })
}

type BilibiliView = {
  code?: number
  data?: {
    bvid?: string
    aid?: number
    cid?: number
    title?: string
    pic?: string
    duration?: number
    owner?: { name?: string }
    desc?: string
  }
}

async function resolveBilibili(
  sourceUrl: string,
  quality: 'hd' | 'sd',
): Promise<VideoData | null> {
  let canonical = sourceUrl
  if (/\/\/b23\.tv\//i.test(sourceUrl)) {
    const response = await fetchPage(sourceUrl, 'https://www.bilibili.com/')
    canonical = response.url
  }
  const bvid = parseBilibiliId(canonical)
  if (!bvid) return null

  const headers = {
    'User-Agent': MOBILE_AGENT,
    Referer: `https://www.bilibili.com/video/${bvid}/`,
    Accept: 'application/json',
  }
  const viewResponse = await fetch(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    { headers, signal: AbortSignal.timeout(10_000) },
  )
  if (!viewResponse.ok) return null
  const view = (await viewResponse.json()) as BilibiliView
  if (view.code !== 0 || !view.data?.cid) return null

  // fnval=0 asks for a single muxed MP4. DASH would require ffmpeg to merge
  // separate audio/video streams, which Cloudflare Workers cannot run.
  const qn = quality === 'sd' ? 32 : 64
  const playResponse = await fetch(
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${view.data.cid}&qn=${qn}&fnval=0&fourk=0`,
    { headers, signal: AbortSignal.timeout(10_000) },
  )
  if (!playResponse.ok) return null
  const play = (await playResponse.json()) as {
    code?: number
    data?: { durl?: Array<{ url?: string; length?: number }> }
  }
  const video = text(play.data?.durl?.[0]?.url)
  if (play.code !== 0 || !video) return null

  return {
    id: view.data.bvid || bvid,
    title: view.data.title || '哔哩哔哩视频',
    url: sourceUrl,
    thumbnail: view.data.pic || '',
    duration: view.data.duration || 0,
    author: view.data.owner?.name || '未知作者',
    description: view.data.desc || '',
    downloadUrl: video,
  }
}

function stringAtPath(value: unknown, keys: readonly string[]): string {
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const direct = text(record[key])
    if (direct) return direct
  }
  for (const child of Object.values(record)) {
    const found = stringAtPath(child, keys)
    if (found) return found
  }
  return ''
}

function mediaFromObject(value: unknown): { videos: string[]; images: string[] } {
  const videos: string[] = []
  const images: string[] = []
  const seen = new Set<unknown>()

  const walk = (current: unknown, keyPath = '') => {
    if (seen.has(current)) return
    if (current && typeof current === 'object') seen.add(current)
    if (typeof current === 'string' && /^https?:\/\//i.test(current)) {
      const normalized = unescapePage(current)
      if (
        /(?:video|play|wm|nwm|master|origin|download|url)/i.test(keyPath) &&
        !/\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(normalized)
      ) {
        videos.push(normalized)
      } else if (
        /(?:images?|image_list|photo_list|photos?|pics?)/i.test(keyPath) &&
        /(?:\.(?:jpe?g|png|webp)(?:[?#]|$)|xhscdn|sns-webpic)/i.test(normalized)
      ) {
        images.push(normalized)
      }
      return
    }
    if (Array.isArray(current)) {
      current.forEach((item) => walk(item, keyPath))
      return
    }
    if (current && typeof current === 'object') {
      Object.entries(current as Record<string, unknown>).forEach(([childKey, child]) =>
        walk(child, keyPath ? `${keyPath}.${childKey}` : childKey),
      )
    }
  }
  walk(value)
  return { videos: unique(videos), images: unique(images) }
}

function jsonObjectAfter(html: string, marker: string): unknown | null {
  const markerIndex = html.indexOf(marker)
  if (markerIndex < 0) return null
  const start = html.indexOf('{', markerIndex + marker.length)
  if (start < 0) return null
  let depth = 0
  let quote = ''
  let escaped = false
  for (let index = start; index < html.length; index++) {
    const char = html[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '{') depth++
    if (char === '}') depth--
    if (depth === 0) {
      try {
        return JSON.parse(
          html
            .slice(start, index + 1)
            .replace(/:\s*undefined(?=\s*[,}])/g, ':null'),
        )
      } catch {
        return null
      }
    }
  }
  return null
}

/** Normalise the intentionally loose response shapes used by IF-PHP APIs. */
export function parseIfphpPayload(
  payload: unknown,
  sourceUrl: string,
  platform: ChinesePlatform,
): VideoData | null {
  if (!payload || typeof payload !== 'object') return null
  const code = (payload as Record<string, unknown>).code
  const successfulCodes: unknown[] = [0, 200, '0', '200']
  if (code !== undefined && !successfulCodes.includes(code)) return null
  const media = mediaFromObject(payload)
  return result({
    id:
      stringAtPath(payload, ['aweme_id', 'photoId', 'bvid', 'note_id', 'id']) ||
      `${platform}_${Date.now()}`,
    sourceUrl,
    title: stringAtPath(payload, ['title', 'desc', 'text', 'caption']) || `${platform} 媒体`,
    author: stringAtPath(payload, ['nickname', 'author_name', 'username', 'author']),
    video: media.videos.find((url) => url !== sourceUrl),
    thumbnail: stringAtPath(payload, ['cover', 'thumbnail', 'pic']),
    images: media.images,
  })
}

async function resolveIfphp(
  sourceUrl: string,
  platform: ChinesePlatform,
): Promise<VideoData | null> {
  const key = process.env.IFPHP_API_KEY?.trim()
  if (!key) return null
  const base = (process.env.IFPHP_API_BASE || 'https://api-new.ifphp.com/api').replace(
    /\/$/,
    '',
  )
  const primary = platform === 'douyin' ? 'dyjx' : platform === 'kuaishou' ? 'ksjx' : 'svparse'
  const endpoints = primary === 'svparse' ? [primary] : [primary, 'svparse']
  for (const endpoint of endpoints) {
    try {
      const apiUrl = `${base}/${endpoint}?url=${encodeURIComponent(sourceUrl)}`
      const response = await fetch(apiUrl, {
        headers: { Accept: 'application/json', 'X-API-Key': key },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) continue
      const parsed = parseIfphpPayload(await response.json(), sourceUrl, platform)
      if (parsed) return parsed
    } catch {
      // Try the aggregate endpoint or the next resolver.
    }
  }
  return null
}

async function resolveDouyin(sourceUrl: string): Promise<VideoData | null> {
  try {
    const page = await fetchPage(sourceUrl, 'https://www.douyin.com/')
    const html = await page.text()
    const id = parseDouyinId(page.url) || parseDouyinId(html) || 'douyin'
    const urls = absoluteMediaUrls(html)
    const video = urls.find((url) => /(?:\.mp4|playwm|play_addr|playApi)/i.test(url))
    if (video) {
      return result({
        id,
        sourceUrl,
        title: htmlTitle(html).replace(/\s*[-_|].*抖音.*$/i, '') || '抖音视频',
        video: video.replace(/playwm/gi, 'play'),
        thumbnail: urls.find((url) => /\.(?:jpe?g|webp|png)(?:[?#]|$)/i.test(url)),
      })
    }
  } catch {
    // The current Douyin share page commonly exposes only the item id to
    // datacenter traffic. The keyed API fallback below handles that case.
  }
  return resolveIfphp(sourceUrl, 'douyin')
}

async function resolveKuaishou(
  sourceUrl: string,
  quality: 'hd' | 'sd',
): Promise<VideoData | null> {
  try {
    const page = await fetchPage(sourceUrl, 'https://www.kuaishou.com/')
    if (page.ok) {
      const parsed = parseKuaishouHtml(await page.text(), sourceUrl, page.url, quality)
      if (parsed) return parsed
    }
  } catch {
    // Continue with the configured API fallback.
  }
  return resolveIfphp(sourceUrl, 'kuaishou')
}

async function resolveXiaohongshu(sourceUrl: string): Promise<VideoData | null> {
  try {
    const page = await fetchPage(sourceUrl, 'https://www.xiaohongshu.com/')
    if (page.ok) {
      const html = await page.text()
      const state =
        jsonObjectAfter(html, 'window.__INITIAL_STATE__') ||
        jsonObjectAfter(html, '__INITIAL_STATE__')
      if (!state) return resolveIfphp(sourceUrl, 'xiaohongshu')
      const media = mediaFromObject(state)
      const noteId = page.url.match(/\/(?:discovery\/item|explore)\/([\w-]+)/)?.[1]
      const parsed = result({
        id: stringAtPath(state, ['noteId', 'note_id', 'id']) || noteId || 'xiaohongshu',
        sourceUrl,
        title:
          stringAtPath(state, ['title', 'desc']) ||
          htmlTitle(html).replace(/\s*[-_|].*小红书.*$/i, '') ||
          '小红书笔记',
        author: stringAtPath(state, ['nickname', 'userName', 'username']),
        video: media.videos[0],
        images: media.images,
      })
      if (parsed) return parsed
    }
  } catch {
    // Continue with the configured API fallback.
  }
  return resolveIfphp(sourceUrl, 'xiaohongshu')
}

export async function resolveChinesePlatform(
  input: string,
  platform: ChinesePlatform,
  quality: 'hd' | 'sd' = 'hd',
): Promise<VideoData | null> {
  const sourceUrl = extractFirstHttpUrl(input) ?? input.trim()
  if (platform === 'douyin') return resolveDouyin(sourceUrl)
  if (platform === 'kuaishou') return resolveKuaishou(sourceUrl, quality)
  if (platform === 'bilibili') return resolveBilibili(sourceUrl, quality)
  return resolveXiaohongshu(sourceUrl)
}
