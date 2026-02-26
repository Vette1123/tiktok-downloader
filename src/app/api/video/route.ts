import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const videoUrl = searchParams.get('url')

    if (!videoUrl) {
      return NextResponse.json(
        { error: 'Video URL is required' },
        { status: 400 },
      )
    }

    // Validate that we have a proper URL
    if (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
      return NextResponse.json(
        { error: 'Invalid video URL format' },
        { status: 400 },
      )
    }

    console.log('Proxying video from:', videoUrl)

    // Fetch the video from the external URL with proper headers
    const response = await fetch(videoUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://www.tiktok.com/',
        Accept:
          'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'identity',
        Range: 'bytes=0-',
      },
    })

    if (!response.ok) {
      console.error(
        'Failed to fetch video:',
        response.status,
        response.statusText,
      )
      return NextResponse.json(
        { error: `Failed to fetch video: ${response.status}` },
        { status: response.status },
      )
    }

    // Get the video buffer
    const videoBuffer = await response.arrayBuffer()
    console.log('Video buffer size:', videoBuffer.byteLength)

    // Always serve as video/mp4 regardless of what the upstream CDN declares.
    // Some CDNs return audio/* or application/octet-stream which causes browsers
    // to render the file as audio-only. Forcing video/mp4 fixes that.
    const contentType = 'video/mp4'

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `tiktok-video-${timestamp}.mp4`

    return new NextResponse(videoBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': videoBuffer.byteLength.toString(),
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  } catch (error) {
    console.error('Video proxy error:', error)
    return NextResponse.json(
      {
        error:
          'Failed to fetch video: ' +
          (error instanceof Error ? error.message : 'Unknown error'),
      },
      { status: 500 },
    )
  }
}
