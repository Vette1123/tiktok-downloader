import { describe, expect, it } from 'vitest'
import { linkAdvice } from './linkAdvice'

/**
 * The rule that matters most is the negative one. A false positive here refuses
 * a real post before a single request is made, which is far worse than letting
 * the occasional profile through to the old generic error — so every shape this
 * claims has to be one that cannot possibly be a post.
 */
describe('links that are not a post', () => {
  it.each([
    ['Instagram profile', 'https://www.instagram.com/nasa/', 'profile'],
    ['TikTok profile', 'https://www.tiktok.com/@nasa', 'profile'],
    ['YouTube handle', 'https://www.youtube.com/@NASA', 'profile'],
    ['YouTube channel id', 'https://www.youtube.com/channel/UCLA_DiR1FfKNvjuUpBHmylQ', 'profile'],
    ['X profile', 'https://x.com/NASA', 'profile'],
    ['Threads profile', 'https://www.threads.net/@zuck', 'profile'],
    ['Facebook page', 'https://www.facebook.com/NASA', 'profile'],
    ['Instagram home', 'https://www.instagram.com/', 'home'],
    ['TikTok home', 'https://www.tiktok.com', 'home'],
  ])('%s', (_label, url, kind) => {
    expect(linkAdvice(url)?.kind).toBe(kind)
  })

  /** The importer can expand these, so they get an answer, not a redirect. */
  it.each([
    ['YouTube playlist', 'https://www.youtube.com/playlist?list=PLiuUQ9asub3TaJXKmZ0Y6h_2gtLGXcxUY'],
    ['subreddit', 'https://www.reddit.com/r/oddlysatisfying/'],
    ['reddit user', 'https://www.reddit.com/user/spez/submitted'],
    ['Pinterest board', 'https://www.pinterest.com/nasa/space-photos/'],
  ])('%s is a collection', (_label, url) => {
    expect(linkAdvice(url)?.kind).toBe('collection')
  })

  it('names the thing it found', () => {
    expect(linkAdvice('https://www.instagram.com/nasa/')?.title).toContain(
      'Instagram profile',
    )
    expect(
      linkAdvice(
        'https://www.youtube.com/playlist?list=PLiuUQ9asub3TaJXKmZ0Y6h_2gtLGXcxUY',
      )?.title,
    ).toContain('playlist')
  })
})

describe('links it must leave alone', () => {
  it.each([
    ['Instagram post', 'https://www.instagram.com/p/CmUv48DLvxd/'],
    ['Instagram reel', 'https://www.instagram.com/reel/DKcalTzoftf/'],
    ['Instagram reel under a handle', 'https://www.instagram.com/nasa/reel/DKcalTzoftf/'],
    ['Instagram story', 'https://www.instagram.com/stories/nasa/3212345/'],
    ['TikTok video', 'https://www.tiktok.com/@scout2015/video/6718335390845095173'],
    ['YouTube watch', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['YouTube short', 'https://www.youtube.com/shorts/abc123'],
    ['X status', 'https://x.com/NASA/status/2094078415376658588'],
    ['Facebook reel', 'https://www.facebook.com/reel/1536569814605331/'],
    ['Pinterest pin', 'https://www.pinterest.com/pin/214343263495052387/'],
    ['reddit permalink', 'https://www.reddit.com/r/oddlysatisfying/comments/1vhp8n5/x/'],
    ['Twitch clip', 'https://clips.twitch.tv/IncredulousAbstemiousFennelImGlitch'],
    ['a long-tail site', 'https://example.com/videos/12345'],
  ])('%s resolves normally', (_label, url) => {
    expect(linkAdvice(url)).toBeNull()
  })

  /**
   * One path segment is a profile on Instagram and a *video* on Vimeo and
   * youtu.be, which is why each platform is matched on its own shape rather
   * than by a shared segment count.
   */
  it.each([
    ['vimeo video', 'https://vimeo.com/76979871'],
    ['youtu.be short link', 'https://youtu.be/dQw4w9WgXcQ'],
  ])('%s is a video, not a profile', (_label, url) => {
    expect(linkAdvice(url)).toBeNull()
  })

  it('says nothing about text that is not a URL', () => {
    expect(linkAdvice('hello world')).toBeNull()
    expect(linkAdvice('')).toBeNull()
    expect(linkAdvice('   ')).toBeNull()
  })

  /** An unknown host's front page is not ours to have an opinion about. */
  it('leaves an unknown site’s home page alone', () => {
    expect(linkAdvice('https://example.com/')).toBeNull()
  })
})
