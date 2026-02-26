import { NextRequest, NextResponse } from 'next/server'

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

    const response = await fetch(videoUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://www.tiktok.com/',
        Accept: 'audio/*,video/*;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'identity',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.statusText}`)
    }

    const audioBuffer = await response.arrayBuffer()

    // Determine whether the source is already an audio-only file or a video.
    // Either way we serve it as audio/mpeg so the browser treats it as audio.
    const upstreamType = response.headers.get('content-type') || ''
    const isAudioOnly = upstreamType.startsWith('audio/')

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `tiktok-audio-${timestamp}.mp3`

    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': isAudioOnly ? upstreamType : 'audio/mpeg',
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
