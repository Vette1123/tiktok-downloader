import { NextRequest, NextResponse } from 'next/server'
import { Downloader } from '../../../lib/downloader'
import { validateUrl, detectPlatform } from '../../../lib/validator'

export async function POST(request: NextRequest) {
  try {
    const { url, type = 'video' } = await request.json()

    if (!url) {
      return NextResponse.json(
        { success: false, error: 'URL is required' },
        { status: 400 },
      )
    }

    if (!validateUrl(url)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid URL. Please paste a TikTok or Twitter/X link.',
        },
        { status: 400 },
      )
    }

    const platform = detectPlatform(url)
    console.log(`Processing ${platform} URL:`, url, 'Type:', type)

    const downloader = new Downloader()
    const videoData = await downloader.downloadVideo(url)

    if (!videoData || (!videoData.downloadUrl && !videoData.isPhotoCarousel)) {
      return NextResponse.json(
        { success: false, error: 'Failed to extract video download URL' },
        { status: 500 },
      )
    }

    // Video proxy: forces video/mp4 content-type so browsers render a proper video player.
    // Audio proxy: re-serves the video stream OR slideshow music as audio/mpeg.
    const videoProxyUrl = videoData.downloadUrl
      ? `/api/video?url=${encodeURIComponent(videoData.downloadUrl)}`
      : undefined

    // Prefer the dedicated music track (photo carousels / some videos) — falls back to
    // re-serving the video stream as audio when no separate track is available.
    const audioSourceUrl = videoData.musicUrl || videoData.downloadUrl
    const audioProxyUrl = audioSourceUrl
      ? `/api/audio?url=${encodeURIComponent(audioSourceUrl)}`
      : undefined

    return NextResponse.json({
      success: true,
      downloadUrl: videoProxyUrl,
      audioUrl: audioProxyUrl,
      metadata: {
        title: videoData.title,
        author: videoData.author,
        duration: videoData.duration,
        thumbnail: videoData.thumbnail,
        platform,
        isPhotoCarousel: videoData.isPhotoCarousel ?? false,
        musicTitle: videoData.musicTitle,
        musicAuthor: videoData.musicAuthor,
        // Raw (non-proxied) URLs needed by the /api/slideshow renderer
        rawMusicUrl: videoData.musicUrl,
        images:
          videoData.images?.map((img) => ({
            ...img,
            selected: false,
          })) || [],
      },
    })
  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to process video',
      },
      { status: 500 },
    )
  }
}
