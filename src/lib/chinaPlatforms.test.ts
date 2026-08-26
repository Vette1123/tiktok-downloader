import { describe, expect, it } from 'vitest'
import {
  isDouyinImagePage,
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

describe('Douyin image-post detection', () => {
  it('recognises the aweme_images marker and does not mistake soundtrack MP4 for a video', () => {
    expect(
      isDouyinImagePage(
        '<img src="https://p26-sign.douyinpic.com/cover.jpeg?biz_tag=aweme_images"><script src="https://sf26-sign.douyinstatic.com/soundtrack.mp4"></script>',
      ),
    ).toBe(true)
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

  it('keeps a declared Douyin image gallery as images when a soundtrack MP4 is also present', () => {
    const parsed = parseIfphpPayload(
      {
        code: 200,
        data: {
          aweme_id: 'photo-123',
          type: 'image',
          title: '抖音图集',
          image_list: [
            { url: 'https://p3.douyinpic.com/one.jpeg' },
            { url: 'https://p3.douyinpic.com/two.jpeg' },
          ],
          music: { play_url: 'https://sf26.douyinstatic.com/soundtrack.mp4' },
        },
      },
      'https://v.douyin.com/example/',
      'douyin',
    )
    expect(parsed?.downloadUrl).toBe('')
    expect(parsed?.images?.map((image) => image.url)).toEqual([
      'https://p3.douyinpic.com/one.jpeg',
      'https://p3.douyinpic.com/two.jpeg',
    ])
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

  it('returns a single Xiaohongshu static photo as an image, never a video', () => {
    const parsed = parseIfphpPayload(
      {
        code: 200,
        data: {
          note_id: '6a6c647d0000000006006316',
          title: '甬万能旅行拍照姿势美美出片',
          image_list: [
            { url: 'https://sns-webpic.example/static-photo.webp' },
          ],
        },
      },
      'https://xhslink.cn/o/7vXtXs5hr7d',
      'xiaohongshu',
    )
    expect(parsed?.downloadUrl).toBe('')
    expect(parsed?.duration).toBe(0)
    expect(parsed?.images).toHaveLength(1)
    expect(parsed?.images?.[0]?.url).toBe(
      'https://sns-webpic.example/static-photo.webp',
    )
  })

  it('recognises extensionless image URLs from an image-typed Xiaohongshu note', () => {
    const parsed = parseIfphpPayload(
      {
        code: 200,
        data: {
          id: '6a890eda000000003a02d0d8',
          type: 'image',
          title: '普通日子，靠穿搭给自己一点氛围感',
          url: 'https://sns-webpic-qc.xhscdn.com/20260825/example!nd_dft_wlteh_webp_3',
        },
      },
      'https://www.xiaohongshu.com/discovery/item/6a890eda000000003a02d0d8',
      'xiaohongshu',
    )
    expect(parsed?.downloadUrl).toBe('')
    expect(parsed?.images).toHaveLength(1)
    expect(parsed?.images?.[0]?.url).toContain('sns-webpic-qc.xhscdn.com')
  })

  it('recognises XHS img collections without turning a video cover into a gallery', () => {
    const imagePost = parseIfphpPayload(
      {
        code: 200,
        data: {
          type: 'image',
          img: ['https://sns-webpic-qc.xhscdn.com/example-image'],
        },
      },
      'https://www.xiaohongshu.com/discovery/item/image-note',
      'xiaohongshu',
    )
    expect(imagePost?.downloadUrl).toBe('')
    expect(imagePost?.images).toHaveLength(1)

    const videoPost = parseIfphpPayload(
      {
        code: 200,
        data: {
          type: 'video',
          video: { play_url: 'https://sns-video-hs.xhscdn.com/example.mp4' },
          cover: 'https://sns-webpic-qc.xhscdn.com/example-cover',
        },
      },
      'https://www.xiaohongshu.com/discovery/item/video-note',
      'xiaohongshu',
    )
    expect(videoPost?.downloadUrl).toBe(
      'https://sns-video-hs.xhscdn.com/example.mp4',
    )
    expect(videoPost?.images).toBeUndefined()
  })

  it('recognises an extensionless still returned under a generic video-shaped field', () => {
    const parsed = parseIfphpPayload(
      {
        code: 200,
        data: {
          note_type: 'normal',
          note_id: '6a890eda000000003a02d0d8',
          video: {
            url: 'https://sns-img-qc.xhscdn.com/20260825/static!nd_dft_wlteh_webp_3',
          },
          cover: 'https://sns-img-qc.xhscdn.com/20260825/cover!nd_dft_wlteh_webp_3',
        },
      },
      'https://www.xiaohongshu.com/discovery/item/6a890eda000000003a02d0d8',
      'xiaohongshu',
    )
    expect(parsed?.downloadUrl).toBe('')
    expect(parsed?.images).toHaveLength(1)
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

  it('uses the real XHS stream instead of a generic video URL', () => {
    const parsed = parseIfphpPayload(
      {
        code: 200,
        data: {
          type: 'video',
          video: {
            url: 'https://sns-webpic-qc.xhscdn.com/not-a-video',
            media: {
              stream: {
                h264: [{ masterUrl: 'https://sns-video-bd.xhscdn.com/real.mp4' }],
              },
            },
          },
        },
      },
      'https://www.xiaohongshu.com/discovery/item/video-stream',
      'xiaohongshu',
    )
    expect(parsed?.downloadUrl).toBe('https://sns-video-bd.xhscdn.com/real.mp4')
  })

  it('drops Live Photo motion streams when the note is an image list', () => {
    const parsed = parseIfphpPayload(
      {
        code: 200,
        data: {
          type: 'normal',
          imageList: [
            {
              urlDefault: 'https://sns-webpic-qc.xhscdn.com/one',
              stream: { h264: [{ masterUrl: 'https://sns-video-bd.xhscdn.com/one.mp4' }] },
            },
            {
              urlDefault: 'https://sns-webpic-qc.xhscdn.com/two',
              stream: { h264: [{ masterUrl: 'https://sns-video-bd.xhscdn.com/two.mp4' }] },
            },
          ],
        },
      },
      'https://www.xiaohongshu.com/discovery/item/image-stream',
      'xiaohongshu',
    )
    expect(parsed?.downloadUrl).toBe('')
    expect(parsed?.images).toHaveLength(2)
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
