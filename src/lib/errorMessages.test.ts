import { describe, expect, it } from 'vitest'
import { friendlyError } from './errorMessages'

describe('friendlyError', () => {
  it('does not mislabel a failed public Instagram resolver as a private post', () => {
    expect(
      friendlyError(
        'Available public Instagram resolvers could not extract this post. The fallback may be temporarily rate-limited.',
      ),
    ).toEqual({
      title: 'Instagram public resolver unavailable',
      hint: 'The post may still be public. Instagram or the fallback service refused this request; wait a moment and try again.',
    })
  })
})
