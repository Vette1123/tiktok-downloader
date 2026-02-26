import { NextRequest, NextResponse } from 'next/server'

function getReferer(url: string): string {
  if (
    url.includes('tiktok.com') ||
    url.includes('tiktokcdn.com') ||
    url.includes('tiktokv.com')
  )
    return 'https://www.tiktok.com/'
  if (
    url.includes('twimg.com') ||
    url.includes('twitter.com') ||
    url.includes('x.com')
  )
    return 'https://x.com/'
  // cobalt tunnel URLs — no referer needed
  return ''
}

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

    if (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
      return NextResponse.json(
        { error: 'Invalid video URL format' },
        { status: 400 },
      )
    }

    console.log('Proxying video from:', videoUrl)

    const referer = getReferer(videoUrl)
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept:
        'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'identity',
    }
    if (referer) headers['Referer'] = referer

    // Forward Range header if present (enables seeking in the browser player)
    const rangeHeader = request.headers.get('range')
    if (rangeHeader) headers['Range'] = rangeHeader

    const response = await fetch(videoUrl, { headers, redirect: 'follow' })

    if (!response.ok && response.status !== 206) {
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

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `social-video-${timestamp}.mp4`

    const responseHeaders: Record<string, string> = {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Accept-Ranges': 'bytes',
    }

    // Forward content-length and content-range for range requests / seeking
    const contentLength = response.headers.get('content-length')
    if (contentLength) responseHeaders['Content-Length'] = contentLength
    const contentRange = response.headers.get('content-range')
    if (contentRange) responseHeaders['Content-Range'] = contentRange

    // Stream the body directly — never buffer into memory
    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
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
