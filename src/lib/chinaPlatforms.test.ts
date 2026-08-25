import { describe, expect, it } from 'vitest'
import {
  parseIfphpPayload,
  parseKuaishouHtml,
  preferXiaohongshuImages,
} from './chinaPlatforms'
import { detectPlatform, extractFirstHttpUrl } from './validator'

describe('Chinese share links', () => {
  it.each([
    ['https://v.douyin.com/tgZMRpn8Zog/', 'douyin'],
    ['https://v.kuaishou.com/7I927ILb', 'kuaishou'],
    ['https://www.bilibili.com/video/BV1FCb864EcA/', 'bilibili'],
    ['https://xhslink.cn/o/7vXtXs5hr7d', 'xiaohongshu'],
  ])('recognises %s as %s', (url, platform) => {
    expect(detectPlatform(url)).toBe(platform)
  })

  it('extracts the URL from a full Douyin share caption', () => {
    const caption =
      '2.84 复制打开抖音，看看【南兮的作品】卡餐小姐 https://v.douyin.com/tgZMRpn8Zog/ y@t.eb'
    expect(extractFirstHttpUrl(caption)).toBe(
      'https://v.douyin.com/tgZMRpn8Zog/',
    )
    expect(detectPlatform(caption)).toBe('douyin')
  })
})

describe('Kuaishou mobile page parser', () => {
  const html = `
    <html><head><title>测试视频 - 快手</title></head><body>
    <script>window.pageData={"userName":"作者甲","playUrl":"https:\\u002F\\u002Fcdn.example\\u002Fclip_b_480.mp4","playUrlH265":"https:\\/\\/cdn.example\\/clip_hd15.mp4","cover":"https://cdn.example/cover.jpg"}</script>
    </body></html>`

  it('takes the HD rendition and unescapes its URL', () => {
    const parsed = parseKuaishouHtml(
      html,
      'https://v.kuaishou.com/abc',
      'https://v.m.chenzhongtech.com/fw/photo?photoId=photo123',
      'hd',
    )
    expect(parsed?.id).toBe('photo123')
    expect(parsed?.author).toBe('作者甲')
    expect(parsed?.downloadUrl).toBe('https://cdn.example/clip_hd15.mp4')
  })

  it('takes the data-saver rendition in SD', () => {
    expect(
      parseKuaishouHtml(html, 'https://v.kuaishou.com/abc', undefined, 'sd')
        ?.downloadUrl,
    ).toBe('https://cdn.example/clip_b_480.mp4')
  })
})

describe('IF-PHP response normalisation', () => {
  it('reads a common Douyin response shape', () => {
    const parsed = parseIfphpPayload(
      {
        code: 200,
        data: {
          aweme_id: '123456',
          title: '作品标题',
          author: { nickname: '作者乙' },
          video: { play_url: 'https://cdn.example/video?id=123' },
          cover: 'https://cdn.example/cover.webp',
        },
      },
      'https://v.douyin.com/example/',
      'douyin',
    )
    expect(parsed).toMatchObject({
      id: '123456',
      title: '作品标题',
      author: '作者乙',
      downloadUrl: 'https://cdn.example/video?id=123',
    })
  })

  it('rejects an API error response', () => {
    expect(
      parseIfphpPayload(
        { code: 401, msg: '密钥无效' },
        'https://v.douyin.com/example/',
        'douyin',
      ),
    ).toBeNull()
  })

  it('normalises an Instagram Reel from the aggregate endpoint', () => {
    const parsed = parseIfphpPayload(
      {
        code: 200,
        data: {
          id: 'DCUBzY0yiKK',
          title: 'Public reel',
          author: { username: 'creator' },
          video: { download_url: 'https://cdn.example/reel.mp4' },
          cover: 'https://cdn.example/reel.jpg',
        },
      },
      'https://www.instagram.com/reel/DCUBzY0yiKK/',
      'instagram',
    )
    expect(parsed).toMatchObject({
      id: 'DCUBzY0yiKK',
      title: 'Public reel',
      author: 'creator',
      downloadUrl: 'https://cdn.example/reel.mp4',
    })
  })

  it('returns Xiaohongshu Live Photos as still images, not a video', () => {
    const parsed = parseIfphpPayload(
      {
        code: 200,
        data: {
          note_id: 'note-live-photo',
          title: '动图笔记',
          live_photo: { video_url: 'https://cdn.example/live-photo.mp4' },
          image_list: [
            { url: 'https://sns-webpic.example/one.jpg' },
            { url: 'https://sns-webpic.example/two.jpg' },
          ],
        },
      },
      'https://xhslink.cn/o/example',
      'xiaohongshu',
    )
    expect(parsed?.downloadUrl).toBe('')
    expect(parsed?.isPhotoCarousel).toBe(false)
    expect(parsed?.images?.map((image) => image.url)).toEqual([
      'https://sns-webpic.example/one.jpg',
      'https://sns-webpic.example/two.jpg',
    ])
  })

  it('keeps a normal Xiaohongshu video when no image list exists', () => {
    const parsed = parseIfphpPayload(
      {
        code: 200,
        data: {
          note_id: 'note-video',
          video: { play_url: 'https://cdn.example/note.mp4' },
          cover: 'https://sns-webpic.example/cover.jpg',
        },
      },
      'https://xhslink.cn/o/video',
      'xiaohongshu',
    )
    expect(parsed?.downloadUrl).toBe('https://cdn.example/note.mp4')
    expect(parsed?.images).toBeUndefined()
  })
})

describe('Xiaohongshu Cobalt fallback normalisation', () => {
  it('drops a motion asset when still images are also available', () => {
    const parsed = preferXiaohongshuImages({
      id: 'note',
      title: '动图',
      url: 'https://xhslink.cn/o/example',
      thumbnail: 'https://cdn.example/thumb.jpg',
      duration: 0,
      author: '作者',
      description: '',
      downloadUrl: 'https://cdn.example/live-photo.mp4',
      tunnel: true,
      isPhotoCarousel: true,
      images: [
        {
          id: 'still',
          url: 'https://cdn.example/still.jpg',
          thumbnail: 'https://cdn.example/still.jpg',
        },
      ],
    })
    expect(parsed.downloadUrl).toBe('')
    expect(parsed.tunnel).toBeUndefined()
    expect(parsed.isPhotoCarousel).toBe(false)
  })
})
