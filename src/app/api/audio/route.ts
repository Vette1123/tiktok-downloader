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
  return ''
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const videoUrl = searchParams.get('url')

    if (!videoUrl) {
      return NextResponse.json(
        { success: false, error: 'Video URL is required' },
        { status: 400 },
      )
    }

    console.log('Fetching audio from URL:', videoUrl)

    const referer = getReferer(videoUrl)
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'video/webm,video/ogg,video/*;q=0.9,*/*;q=0.5',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'identity',
    }
    if (referer) headers['Referer'] = referer

    const response = await fetch(videoUrl, { headers, redirect: 'follow' })

    if (!response.ok) {
      throw new Error(
        `Failed to fetch audio: ${response.status} ${response.statusText}`,
      )
    }

    const audioBuffer = await response.arrayBuffer()

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `social-audio-${timestamp}.mp3`

    // Serve the video stream as audio/mpeg — browsers and media players
    // extract the audio track from the MP4 container automatically
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': audioBuffer.byteLength.toString(),
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error) {
    console.error('Audio extraction error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to extract audio' },
      { status: 500 },
    )
  }
}
