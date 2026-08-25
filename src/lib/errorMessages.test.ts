import { describe, expect, it } from 'vitest'
import { friendlyError } from './errorMessages'

describe('friendlyError', () => {
  it('does not mislabel a failed public Instagram resolver as a private post', () => {
    expect(
      friendlyError(
        'Available public Instagram resolvers could not extract this post. The fallback may be temporarily rate-limited.',
      ),
    ).toEqual({
      title: 'Instagram 公共解析暂不可用',
      hint: '作品可能仍是公开的，但 Instagram 或备用解析服务拒绝了请求；可稍后重试，或配置安全的 Instagram Cookie。',
    })
  })
})
