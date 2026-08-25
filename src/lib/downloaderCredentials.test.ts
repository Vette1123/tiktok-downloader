import { afterEach, describe, expect, it, vi } from 'vitest'
import { Downloader, instagramMediaId } from './downloader'

/**
 * The one line that decides whether our own Instagram session leaves this
 * Worker, and the only entitlement in the codebase that touches a credential.
 *
 * It is worth a file of its own because every other guard around it is
 * advisory. The token claim can be re-issued, the grant can be set by hand, the
 * route can be refactored — but if this getter ever returns the cookie for an
 * uncredentialed instance, every anonymous visitor's Instagram resolve starts
 * carrying it, which is exactly the state this replaced.
 *
 * Reached through a cast because the getter is private: `private` is a
 * compile-time marker in TypeScript, and a boundary this load-bearing should be
 * asserted on the value that actually ships rather than on a re-implementation
 * of it in the test.
 */
function sessionIdOf(downloader: Downloader): string {
  return (downloader as unknown as { instagramSessionId: string }).instagramSessionId
}

function cookieOf(downloader: Downloader): string {
  return (downloader as unknown as { instagramCookie: string }).instagramCookie
}

function facebookCookieOf(downloader: Downloader): string {
  return (downloader as unknown as { facebookCookie: string }).facebookCookie
}

const COOKIE = 'test-session-cookie-value'

const IG_VARS = [
  'IG_SESSIONID',
  'IG_CSRFTOKEN',
  'IG_DS_USER_ID',
  'IG_DID',
  'IG_MID',
  'IG_DATR',
  'IG_RUR',
  'IG_WD',
]

const FB_VARS = [
  'FB_COOKIE_HEADER',
  'FB_DATR',
  'FB_SB',
  'FB_C_USER',
  'FB_XS',
  'FB_FR',
  'FB_WD',
]

afterEach(() => {
  for (const key of IG_VARS) delete process.env[key]
  for (const key of FB_VARS) delete process.env[key]
})

describe('the Facebook credential gate', () => {
  it('withholds Facebook Cookie from an anonymous instance', () => {
    process.env.FB_C_USER = '12345'
    process.env.FB_XS = 'session-value'
    expect(facebookCookieOf(new Downloader())).toBe('')
  })

  it('assembles the named Facebook cookies only when credentialed', () => {
    process.env.FB_DATR = 'datr-v'
    process.env.FB_SB = 'sb-v'
    process.env.FB_C_USER = '12345'
    process.env.FB_XS = 'xs-v'
    process.env.FB_FR = 'fr-v'
    process.env.FB_WD = '1920x1080'

    expect(facebookCookieOf(new Downloader({ credentialed: true }))).toBe(
      'datr=datr-v; sb=sb-v; c_user=12345; xs=xs-v; fr=fr-v; wd=1920x1080',
    )
  })

  it('prefers a full header and rejects newline injection', () => {
    process.env.FB_COOKIE_HEADER = 'c_user=12345; xs=xs-v; extra=1'
    process.env.FB_C_USER = 'different'
    expect(facebookCookieOf(new Downloader({ credentialed: true }))).toBe(
      'c_user=12345; xs=xs-v; extra=1',
    )

    process.env.FB_COOKIE_HEADER = 'c_user=12345\nInjected: yes'
    expect(facebookCookieOf(new Downloader({ credentialed: true }))).toBe(
      'c_user=different',
    )
  })
})

describe('the Instagram credential gate', () => {
  it('withholds the session from a default instance', () => {
    process.env.IG_SESSIONID = COOKIE
    expect(sessionIdOf(new Downloader())).toBe('')
  })

  it('withholds it when constructed with no opts at all', () => {
    process.env.IG_SESSIONID = COOKIE
    expect(sessionIdOf(new Downloader({ quality: 'hd', mode: 'auto' }))).toBe('')
  })

  /**
   * The pairing that must never collapse into one flag. `priority` is a
   * supporter's entitlement and changes resolver ordering; the session is not
   * for sale at any price. A supporter's request is `priority` and never
   * `credentialed`, so this is the shape of every paid request that exists.
   */
  it('withholds it from a priority request', () => {
    process.env.IG_SESSIONID = COOKIE
    expect(sessionIdOf(new Downloader({ priority: true }))).toBe('')
  })

  it('attaches it only when explicitly credentialed', () => {
    process.env.IG_SESSIONID = COOKIE
    expect(sessionIdOf(new Downloader({ credentialed: true }))).toBe(COOKIE)
  })

  it('is empty when credentialed but the deployment has no session configured', () => {
    expect(sessionIdOf(new Downloader({ credentialed: true }))).toBe('')
  })

  it('trims a session pasted with surrounding whitespace', () => {
    process.env.IG_SESSIONID = `  ${COOKIE}  `
    expect(sessionIdOf(new Downloader({ credentialed: true }))).toBe(COOKIE)
  })

  /**
   * `credentialed` comes from a JSON token claim, so it can arrive as anything
   * a forged-but-unverified payload contains. The constructor compares against
   * `true` rather than testing truthiness, which is what keeps a stray
   * `"false"`, `1` or `{}` from switching the cookie on.
   */
  it.each([
    ['the string "true"', 'true'],
    ['the number 1', 1],
    ['an object', {}],
    ['undefined', undefined],
    ['null', null],
  ])('does not accept %s as credentialed', (_label, value) => {
    process.env.IG_SESSIONID = COOKIE
    const downloader = new Downloader({
      credentialed: value as unknown as boolean,
    })
    expect(sessionIdOf(downloader)).toBe('')
  })
})

/**
 * The companion cookies exist to make a credentialed request look like the
 * browser that created the session. They are behind the same gate as the
 * session itself — an uncredentialed instance must leak none of them, since a
 * `ds_user_id` identifies the account just as well as a `sessionid` does.
 */
describe('the Instagram companion cookies', () => {
  it('sends nothing at all without the credential', () => {
    process.env.IG_SESSIONID = COOKIE
    process.env.IG_DS_USER_ID = '12345'
    process.env.IG_MID = 'mid-value'
    expect(cookieOf(new Downloader())).toBe('')
  })

  /**
   * The companions are worthless on their own and identifying on their own, so
   * a deployment that filled them but not the session must send neither.
   */
  it('sends nothing when companions are set but the session is not', () => {
    process.env.IG_DS_USER_ID = '12345'
    process.env.IG_MID = 'mid-value'
    expect(cookieOf(new Downloader({ credentialed: true }))).toBe('')
  })

  it('falls back to the session alone when no companion is configured', () => {
    process.env.IG_SESSIONID = COOKIE
    expect(cookieOf(new Downloader({ credentialed: true }))).toBe(`sessionid=${COOKIE}`)
  })

  it('includes each configured companion, and the session last', () => {
    process.env.IG_SESSIONID = COOKIE
    process.env.IG_DATR = 'datr-v'
    process.env.IG_DID = 'did-v'
    process.env.IG_MID = 'mid-v'
    process.env.IG_CSRFTOKEN = 'csrf-v'
    process.env.IG_DS_USER_ID = '12345'
    process.env.IG_RUR = 'rur-v'
    process.env.IG_WD = '1920x1080'

    expect(cookieOf(new Downloader({ credentialed: true }))).toBe(
      'datr=datr-v; ig_did=did-v; mid=mid-v; csrftoken=csrf-v; ' +
        `ds_user_id=12345; rur=rur-v; wd=1920x1080; sessionid=${COOKIE}`,
    )
  })

  /**
   * A blank var is omitted rather than sent as `mid=`. An empty cookie value is
   * something a browser does not produce, so sending one would undo the point
   * of the whole list.
   */
  it('omits a blank companion instead of sending an empty value', () => {
    process.env.IG_SESSIONID = COOKIE
    process.env.IG_MID = ''
    process.env.IG_DS_USER_ID = '   '
    process.env.IG_DATR = 'datr-v'

    const cookie = cookieOf(new Downloader({ credentialed: true }))
    expect(cookie).toBe(`datr=datr-v; sessionid=${COOKIE}`)
    expect(cookie).not.toContain('mid=')
    expect(cookie).not.toContain('ds_user_id=')
  })

  it('trims whitespace off a pasted value', () => {
    process.env.IG_SESSIONID = COOKIE
    process.env.IG_MID = '  mid-v  '
    expect(cookieOf(new Downloader({ credentialed: true }))).toBe(
      `mid=mid-v; sessionid=${COOKIE}`,
    )
  })
})

/**
 * `csrftoken` is the one cookie that can also be harvested at runtime, so it is
 * the one that can end up in the header twice. Two `csrftoken` pairs is
 * malformed and reads as automation on its own.
 */
describe('the CSRF token precedence', () => {
  function withCsrf(downloader: Downloader, harvested: string): string {
    return (
      downloader as unknown as { instagramCookieWith(csrf: string): string }
    ).instagramCookieWith(harvested)
  }

  function csrfHeader(downloader: Downloader, harvested: string): string {
    return (
      downloader as unknown as { instagramCsrf(csrf: string): string }
    ).instagramCsrf(harvested)
  }

  it('appends the harvested token when none is configured', () => {
    process.env.IG_SESSIONID = COOKIE
    const d = new Downloader({ credentialed: true })
    expect(withCsrf(d, 'harvested')).toBe(`sessionid=${COOKIE}; csrftoken=harvested`)
    expect(csrfHeader(d, 'harvested')).toBe('harvested')
  })

  it('never emits csrftoken twice when one is configured', () => {
    process.env.IG_SESSIONID = COOKIE
    process.env.IG_CSRFTOKEN = 'configured'
    const cookie = withCsrf(new Downloader({ credentialed: true }), 'harvested')
    expect(cookie.match(/csrftoken=/g)).toHaveLength(1)
    expect(cookie).toContain('csrftoken=configured')
    expect(cookie).not.toContain('harvested')
  })

  /**
   * The header and the cookie must agree or Instagram rejects the POST, so the
   * configured value has to win in both places or neither.
   */
  it('keeps the X-CSRFToken header in step with the cookie', () => {
    process.env.IG_SESSIONID = COOKIE
    process.env.IG_CSRFTOKEN = 'configured'
    const d = new Downloader({ credentialed: true })
    expect(csrfHeader(d, 'harvested')).toBe('configured')
    expect(withCsrf(d, 'harvested')).toContain('csrftoken=configured')
  })

  it('sends no cookie at all without the credential, harvested token or not', () => {
    process.env.IG_SESSIONID = COOKIE
    expect(withCsrf(new Downloader(), 'harvested')).toBe('')
  })
})

/**
 * The private media API is keyed on the numeric media id, and the shortcode is
 * base64 (URL alphabet) over exactly that number — so the conversion replaces a
 * lookup request rather than merely formatting one.
 */
describe('the Instagram media id', () => {
  it('decodes a shortcode to its numeric id', () => {
    expect(instagramMediaId('Db9Qn-lgG3X')).toBe('3962396363160841687')
  })

  it('handles both extra alphabet characters', () => {
    // '-' is 62 and '_' is 63; a plain base64 decoder gets these two wrong.
    expect(instagramMediaId('-')).toBe('62')
    expect(instagramMediaId('_')).toBe('63')
  })

  it('rejects anything the alphabet does not cover', () => {
    expect(instagramMediaId('has/slash')).toBeNull()
    expect(instagramMediaId('')).toBeNull()
  })
})

/**
 * The extractor that actually uses the session. It must make no request at all
 * without one: uncredentialed, the endpoint answers with a ~600 KB login wall
 * carrying no media, which is a large download that can never succeed.
 */
describe('the credentialed Instagram extractor', () => {
  const url = 'https://www.instagram.com/reel/Db9Qn-lgG3X/'

  function mediaInfo(downloader: Downloader) {
    return (
      downloader as unknown as {
        tryInstagramMediaInfo(shortcode: string, url: string): Promise<unknown>
      }
    ).tryInstagramMediaInfo('Db9Qn-lgG3X', url)
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not reach Instagram without the credential', async () => {
    process.env.IG_SESSIONID = COOKIE
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(mediaInfo(new Downloader())).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('maps a credentialed reel response onto the shared shape', async () => {
    process.env.IG_SESSIONID = COOKIE
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          items: [
            {
              user: { username: 'someone' },
              caption: { text: 'a caption' },
              video_duration: 3.25,
              video_versions: [{ url: 'https://cdn.example/clip.mp4' }],
              image_versions2: { candidates: [{ url: 'https://cdn.example/poster.jpg' }] },
            },
          ],
        }),
      ),
    )

    expect(await mediaInfo(new Downloader({ credentialed: true }))).toMatchObject({
      title: 'a caption',
      author: 'someone',
      duration: 3,
      downloadUrl: 'https://cdn.example/clip.mp4',
      thumbnail: 'https://cdn.example/poster.jpg',
      url,
    })
  })

  /** A rejected or expired session answers with no items; that must degrade. */
  it('returns null rather than throwing when the session is refused', async () => {
    process.env.IG_SESSIONID = COOKIE
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>login</html>', { status: 200 })),
    )

    await expect(mediaInfo(new Downloader({ credentialed: true }))).resolves.toBeNull()
  })
})
