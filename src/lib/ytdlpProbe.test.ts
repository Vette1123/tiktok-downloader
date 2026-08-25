import { afterEach, describe, expect, it, vi } from 'vitest'
import type { YtdlpDump } from './ytdlp'

/**
 * The universal extractor's format selection. yt-dlp itself is mocked at the
 * module boundary (the real one spawns a process); what is under test is the
 * pure logic that turns its dump into one URL this app can actually serve:
 *
 *  - progressive http(s) only — HLS/DASH manifests cannot be re-served or
 *    played without ffmpeg, so they must never win;
 *  - video: H.264 outranks resolution (HEVC renders audio-only in a <video>
 *    tag), capped at 1080p;
 *  - audio: m4a/mp3 only (containers every browser decodes), loudest first;
 *  - playlists resolve to their first playable entry.
 */

// Native media must read as available for the probe to run at all.
process.env.DEPLOY_TARGET = ''

const dumpJson = vi.hoisted(() => vi.fn())
vi.mock('youtube-dl-exec', () => ({ default: dumpJson }))

import { ytdlpProbe } from './ytdlp'

afterEach(() => {
  dumpJson.mockReset()
})

const muxed = (
  id: string,
  height: number,
  vcodec: string,
  protocol = 'https',
  ext = 'mp4',
) => ({
  url: `https://cdn.example/${id}`,
  ext,
  protocol,
  vcodec,
  acodec: 'mp4a.40.2',
  height,
})

describe('ytdlpProbe format selection', () => {
  it('picks progressive H.264 over higher-resolution HEVC', async () => {
    dumpJson.mockResolvedValue({
      title: 't',
      formats: [
        muxed('hevc-2160', 2160, 'hvc1'),
        muxed('h264-1080', 1080, 'avc1'),
        muxed('h264-720', 720, 'avc1'),
      ],
    })
    const probe = await ytdlpProbe('https://site.example/v', 'video')
    expect(probe?.downloadUrl).toBe('https://cdn.example/h264-1080')
  })

  it('never returns an HLS manifest when a progressive file exists', async () => {
    dumpJson.mockResolvedValue({
      title: 't',
      formats: [
        {
          url: 'https://cdn.example/master.m3u8',
          ext: 'mp4',
          protocol: 'm3u8_native',
          vcodec: 'avc1',
          acodec: 'mp4a',
          height: 2160,
        },
        muxed('h264-480', 480, 'avc1'),
      ],
    })
    const probe = await ytdlpProbe('https://site.example/v', 'video')
    expect(probe?.downloadUrl).toBe('https://cdn.example/h264-480')
  })

  it('returns null when only manifests exist', async () => {
    dumpJson.mockResolvedValue({
      title: 't',
      formats: [
        {
          url: 'https://cdn.example/index.mpd',
          protocol: 'dash',
          vcodec: 'avc1',
          acodec: 'mp4a',
        },
        {
          url: 'https://cdn.example/live.m3u8',
          protocol: 'm3u8',
          vcodec: 'avc1',
          acodec: 'mp4a',
        },
      ],
    })
    await expect(ytdlpProbe('https://site.example/v', 'video')).resolves.toBeNull()
  })

  it('caps video at 1080p and prefers mp4 on ties', async () => {
    dumpJson.mockResolvedValue({
      title: 't',
      formats: [muxed('webm-1080', 1080, 'vp9', 'https', 'webm'), muxed('mp4-1080', 1080, 'avc1')],
    })
    const probe = await ytdlpProbe('https://site.example/v', 'video')
    expect(probe?.downloadUrl).toBe('https://cdn.example/mp4-1080')
  })

  // The case above cannot see the container tie-break: its mp4 is also the
  // only H.264 rendition, so the h264 pool decides it before the comparator
  // is consulted. Same codec on both sides is what actually exercises it —
  // and it caught the term being subtracted the wrong way round.
  it('prefers mp4 over webm when codec and resolution are identical', async () => {
    dumpJson.mockResolvedValue({
      title: 't',
      formats: [
        muxed('webm-720', 720, 'avc1', 'https', 'webm'),
        muxed('mp4-720', 720, 'avc1'),
      ],
    })
    const probe = await ytdlpProbe('https://site.example/v', 'video')
    expect(probe?.downloadUrl).toBe('https://cdn.example/mp4-720')
  })

  it('still prefers mp4 on a tie when the mp4 is listed first', async () => {
    dumpJson.mockResolvedValue({
      title: 't',
      formats: [
        muxed('mp4-720', 720, 'avc1'),
        muxed('webm-720', 720, 'avc1', 'https', 'webm'),
      ],
    })
    const probe = await ytdlpProbe('https://site.example/v', 'video')
    expect(probe?.downloadUrl).toBe('https://cdn.example/mp4-720')
  })

  it('takes the loudest m4a for audio and skips opus/webm containers', async () => {
    dumpJson.mockResolvedValue({
      title: 't',
      formats: [
        {
          url: 'https://cdn.example/opus.webm',
          ext: 'webm',
          protocol: 'https',
          vcodec: 'none',
          acodec: 'opus',
          abr: 160,
        },
        {
          url: 'https://cdn.example/low.m4a',
          ext: 'm4a',
          protocol: 'https',
          vcodec: 'none',
          acodec: 'mp4a',
          abr: 64,
        },
        {
          url: 'https://cdn.example/high.m4a',
          ext: 'm4a',
          protocol: 'https',
          vcodec: 'none',
          acodec: 'mp4a',
          abr: 128,
        },
      ],
    })
    const probe = await ytdlpProbe('https://site.example/v', 'audio')
    expect(probe?.downloadUrl).toBe('https://cdn.example/high.m4a')
  })

  it('falls back to a muxed mp4 when no audio-only track is offered', async () => {
    dumpJson.mockResolvedValue({
      title: 't',
      formats: [muxed('only-video', 720, 'avc1')],
    })
    const probe = await ytdlpProbe('https://site.example/v', 'audio')
    expect(probe?.downloadUrl).toBe('https://cdn.example/only-video')
  })

  it('resolves a playlist to its first playable entry with metadata', async () => {
    const entry: YtdlpDump = {
      title: 'first video',
      uploader: 'someone',
      duration: 91,
      thumbnail: 'https://cdn.example/thumb.jpg',
      url: 'https://cdn.example/entry.mp4',
      protocol: 'https',
      ext: 'mp4',
      vcodec: 'avc1',
      acodec: 'mp4a',
    }
    dumpJson.mockResolvedValue({ _type: 'playlist', entries: [null, entry] })
    const probe = await ytdlpProbe('https://site.example/playlist', 'video')
    expect(probe).toMatchObject({
      downloadUrl: 'https://cdn.example/entry.mp4',
      title: 'first video',
      uploader: 'someone',
      duration: 91,
    })
  })

  it('uses a top-level url when the source lists no formats', async () => {
    dumpJson.mockResolvedValue({
      title: 'plain page',
      url: 'https://cdn.example/direct.mp4',
      protocol: 'https',
      ext: 'mp4',
    })
    const probe = await ytdlpProbe('https://site.example/v', 'video')
    expect(probe?.downloadUrl).toBe('https://cdn.example/direct.mp4')
  })

  /**
   * The measuredPornHub shape: every rendition is a muxed mp4 whose vcodec/
   * acodec are null (yt-dlp does not populate them for these), plus an HLS
   * manifest at top level. The null-codec entries must win — rejecting them
   * made this whole host fail while perfect files sat in the list.
   */
  const PORNHUB_LIKE = {
    title: 'measured shape',
    duration: 1725,
    protocol: 'm3u8_native',
    formats: [
      {
        url: 'https://ev.cdn.example/240P_4000K_1.mp4?sig=1',
        ext: 'mp4',
        protocol: 'https',
        vcodec: null,
        acodec: null,
        height: 240,
      },
      {
        url: 'https://ev.cdn.example/720P_4000K_1.mp4?sig=1',
        ext: 'mp4',
        protocol: 'https',
        vcodec: null,
        acodec: null,
        height: 720,
      },
      {
        url: 'https://ev.cdn.example/1080P_4000K_1.mp4?sig=1',
        ext: 'mp4',
        protocol: 'https',
        vcodec: null,
        acodec: null,
        height: 1080,
      },
    ],
  }

  it('selects a muxed format with unset codecs instead of failing', async () => {
    dumpJson.mockResolvedValue(PORNHUB_LIKE)
    const probe = await ytdlpProbe('https://site.example/view_video.php?v=1', 'video')
    expect(probe?.downloadUrl).toBe('https://ev.cdn.example/1080P_4000K_1.mp4?sig=1')
    expect(probe?.title).toBe('measured shape')
  })

  it('never mistakes an unset codec for an audio-only track', async () => {
    // The literal 'none' is what marks single-track streams; null is unknown.
    dumpJson.mockResolvedValue({
      title: 't',
      formats: [
        {
          url: 'https://cdn.example/video-only.mp4',
          ext: 'mp4',
          protocol: 'https',
          vcodec: 'avc1',
          acodec: 'none',
          height: 1080,
        },
        { ...PORNHUB_LIKE.formats[2] },
      ],
    })
    const probe = await ytdlpProbe('https://site.example/v', 'video')
    expect(probe?.downloadUrl).toContain('1080P_4000K_1.mp4')
  })

  it('demotes AV1 renditions to their equal-height H.264 sibling', async () => {
    // Measured on Eporner: each height ships twice, once as AV1.
    dumpJson.mockResolvedValue({
      title: 't',
      formats: [
        {
          url: 'https://cdn.example/720p-av1.mp4',
          ext: 'mp4',
          protocol: 'https',
          vcodec: 'av1',
          acodec: null,
          height: 720,
        },
        {
          url: 'https://cdn.example/720p.mp4',
          ext: 'mp4',
          protocol: 'https',
          vcodec: null,
          acodec: null,
          height: 720,
        },
      ],
    })
    const probe = await ytdlpProbe('https://site.example/v', 'video')
    expect(probe?.downloadUrl).toBe('https://cdn.example/720p.mp4')
  })
})
