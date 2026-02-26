export type SupportedPlatform = 'tiktok' | 'twitter' | 'unknown'

const platformPatterns: Record<
  Exclude<SupportedPlatform, 'unknown'>,
  RegExp[]
> = {
  tiktok: [
    /^(https?:\/\/)?(www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/,
    /^(https?:\/\/)?(www\.)?tiktok\.com\/[\w.-]+\/video\/\d+/,
    /^(https?:\/\/)?vm\.tiktok\.com\/[\w\d]+/,
    /^(https?:\/\/)?vt\.tiktok\.com\/[\w\d]+/,
    /^(https?:\/\/)?m\.tiktok\.com\/v\/\d+/,
    /^(https?:\/\/)?(www\.)?tiktok\.com\/t\/[\w\d]+/,
  ],
  twitter: [
    /^(https?:\/\/)?(www\.)?(twitter|x)\.com\/[\w]+\/status\/\d+/,
    /^(https?:\/\/)?t\.co\/[\w\d]+/,
  ],
}

export function detectPlatform(url: string): SupportedPlatform {
  if (!url || typeof url !== 'string') return 'unknown'
  const trimmed = url.trim()
  for (const [platform, patterns] of Object.entries(platformPatterns)) {
    if (patterns.some((p) => p.test(trimmed))) {
      return platform as SupportedPlatform
    }
  }
  return 'unknown'
}

export function validateUrl(url: string): boolean {
  return detectPlatform(url) !== 'unknown'
}

export function parseVideoId(url: string): string | null {
  const patterns = [
    /\/video\/(\d+)/,
    /\/v\/(\d+)/,
    /vm\.tiktok\.com\/([\w\d]+)/,
    /vt\.tiktok\.com\/([\w\d]+)/,
    /\/t\/([\w\d]+)/,
    /\/status\/(\d+)/,
    /\/p\/([\w-]+)/,
    /\/reel\/([\w-]+)/,
    /\/videos\/(\d+)/,
    /v=(\d+)/,
    /fb\.watch\/([\w\d-]+)/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match && match[1]) {
      return match[1]
    }
  }

  return null
}
