// Turn a raw backend/extractor error string into a clear, specific, human
// message for the results banner. The backend already returns fairly specific
// text; this classifier normalises the common failure modes into a consistent
// voice and adds an actionable hint, without swallowing genuinely novel errors.

export interface FriendlyError {
  /** Short headline shown in bold. */
  title: string
  /** One-line actionable hint. */
  hint: string
}

const PRIVATE = /private|login|log in|logged[- ]in|sign[- ]in|authenticat/i
const AGE = /age[- ]restrict|18\+|nsfw|sensitive/i
const REGION = /region|geo[- ]?block|not available in your|country/i
const GONE = /deleted|removed|unavailable|not found|no longer|404/i
const UNSUPPORTED = /unsupported|invalid url|couldn'?t? (parse|recogni)|not a valid/i
const RATE = /rate[- ]?limit|too many|429|blocking requests|blocked/i
const NETWORK = /network|timeout|timed out|econn|fetch failed|socket/i
const STORY = /story|stories|highlight/i
const PUBLIC_INSTAGRAM_RESOLVER = /public Instagram resolvers/i

/**
 * Map a raw error to a friendly headline + hint. Falls back to the raw text
 * (trimmed) as the hint so nothing is ever hidden from the user.
 */
export function friendlyError(raw: string | undefined, url?: string): FriendlyError {
  const text = (raw || '').trim()
  const looksInstagramStory = !!url && /instagram\.com\/(stories|s)\//i.test(url)

  if (looksInstagramStory || (STORY.test(text) && PRIVATE.test(text))) {
    return {
      title: '快拍需要登录会话',
      hint: 'Instagram 只向已登录账号提供快拍和精选内容，请配置有效的 Instagram Cookie。',
    }
  }
  if (PUBLIC_INSTAGRAM_RESOLVER.test(text)) {
    return {
      title: 'Instagram 公共解析暂不可用',
      hint: '作品可能仍是公开的，但 Instagram 或备用解析服务拒绝了请求；可稍后重试，或配置安全的 Instagram Cookie。',
    }
  }
  if (AGE.test(text)) {
    return {
      title: '内容有年龄限制',
      hint: '平台要求通过年龄验证；请使用符合年龄要求的专用账号 Cookie。',
    }
  }
  if (PRIVATE.test(text)) {
    return {
      title: '作品为私密或需要登录',
      hint: '请确认账号和作品公开；若平台仍要求登录，请配置有效 Cookie 后重试。',
    }
  }
  if (REGION.test(text)) {
    return {
      title: '内容有地区限制',
      hint: '来源平台限制了服务器所在地区，当前无法解析。',
    }
  }
  if (GONE.test(text)) {
    return {
      title: '作品不可用',
      hint: '作品可能已删除或改为私密，请先确认链接能在浏览器中打开。',
    }
  }
  if (UNSUPPORTED.test(text)) {
    return {
      title: '链接不受支持或格式错误',
      hint: '请粘贴受支持平台的完整作品分享链接。',
    }
  }
  if (RATE.test(text)) {
    return {
      title: '请求暂时受限',
      hint: '来源平台正在限制请求频率，请稍候一分钟再试。',
    }
  }
  if (NETWORK.test(text)) {
    return {
      title: '网络请求失败',
      hint: '请求超时，请检查网络连接后重试。',
    }
  }
  return {
    title: '无法解析此链接',
    hint: text || '解析媒体时发生错误，请稍后重试。',
  }
}
