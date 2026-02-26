import { NextRequest, NextResponse } from 'next/server'
import { Downloader } from '../../../lib/downloader'
import { validateUrl } from '../../../lib/validator'

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
        { success: false, error: 'Invalid TikTok URL' },
        { status: 400 },
      )
    }

    console.log('Processing TikTok URL:', url, 'Type:', type)

    const downloader = new Downloader()
    const videoData = await downloader.downloadVideo(url)

    if (!videoData || !videoData.downloadUrl) {
      return NextResponse.json(
        { success: false, error: 'Failed to extract video download URL' },
        { status: 500 },
      )
    }

    // Create proxy URLs for both video and audio.
    // Always point the video proxy at the video stream.
    const videoProxyUrl = `/api/video?url=${encodeURIComponent(
      videoData.downloadUrl,
    )}`

    // For audio, prefer a dedicated audio-only URL (e.g. from tikwm's `music` field)
    // so that the audio proxy never accidentally serves a video stream.
    const audioSourceUrl = videoData.musicUrl || videoData.downloadUrl
    const audioProxyUrl = `/api/audio?url=${encodeURIComponent(audioSourceUrl)}`

    return NextResponse.json({
      success: true,
      downloadUrl: videoProxyUrl,
      audioUrl: audioProxyUrl,
      metadata: {
        title: videoData.title,
        author: videoData.author,
        duration: videoData.duration,
        thumbnail: videoData.thumbnail,
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
