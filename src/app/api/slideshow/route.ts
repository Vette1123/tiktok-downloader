import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import { createReadStream, type ReadStream } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'

// Node runtime — fluent-ffmpeg spawns a child process and needs fs access
export const runtime = 'nodejs'
// Rendering a slideshow can take 15–60s depending on length
export const maxDuration = 300

ffmpeg.setFfmpegPath(ffmpegInstaller.path)

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function getReferer(url: string): string {
  if (url.includes('tiktok.com') || url.includes('tiktokcdn.com'))
    return 'https://www.tiktok.com/'
  if (url.includes('tikwm.com')) return 'https://www.tikwm.com/'
  if (url.includes('twimg.com') || url.includes('x.com'))
    return 'https://x.com/'
  return ''
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const headers: Record<string, string> = { 'User-Agent': UA }
  const referer = getReferer(url)
  if (referer) headers['Referer'] = referer

  const res = await fetch(url, { headers, redirect: 'follow' })
  if (!res.ok) {
    throw new Error(
      `Failed to download ${url}: ${res.status} ${res.statusText}`,
    )
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await fs.writeFile(dest, buf)
}

interface RenderParams {
  imagePaths: string[]
  audioPath: string | null
  outputPath: string
  perImageSeconds: number
  width: number
  height: number
}

/**
 * Renders a slideshow of images with optional audio into an MP4.
 *
 * Each image is shown for `perImageSeconds` seconds; frames are scaled and
 * padded so heterogeneous photo ratios all fit into the output canvas on a
 * black background. When an audio track is provided, the final clip is
 * trimmed to match the audio length (or the image reel length, whichever
 * is shorter) and uses `-shortest` so playback terminates cleanly.
 */
function renderSlideshow({
  imagePaths,
  audioPath,
  outputPath,
  perImageSeconds,
  width,
  height,
}: RenderParams): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()

    for (const img of imagePaths) {
      cmd.input(img).inputOptions(['-loop', '1', '-t', String(perImageSeconds)])
    }
    if (audioPath) cmd.input(audioPath)

    // Build a filter graph: each image scaled+padded to a common canvas, then concat.
    const scaleFilters = imagePaths
      .map(
        (_, i) =>
          `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v${i}]`,
      )
      .join(';')
    const concatInputs = imagePaths.map((_, i) => `[v${i}]`).join('')
    const filter = `${scaleFilters};${concatInputs}concat=n=${imagePaths.length}:v=1:a=0[outv]`

    cmd.complexFilter(filter)
    cmd.outputOptions([
      '-map',
      '[outv]',
      ...(audioPath ? ['-map', `${imagePaths.length}:a`] : []),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-profile:v',
      'high',
      '-movflags',
      '+faststart',
      ...(audioPath ? ['-c:a', 'aac', '-b:a', '128k', '-shortest'] : []),
    ])

    cmd
      .on('start', (line) => console.log('[slideshow] ffmpeg:', line))
      .on('error', (err) => reject(err))
      .on('end', () => resolve())
      .save(outputPath)
  })
}

export async function POST(request: NextRequest) {
  let workDir: string | null = null
  try {
    const body = await request.json()
    const {
      imageUrls,
      audioUrl,
      perImageSeconds: requestedPerImage,
    } = body as {
      imageUrls?: unknown
      audioUrl?: unknown
      perImageSeconds?: unknown
    }

    if (
      !Array.isArray(imageUrls) ||
      imageUrls.length === 0 ||
      !imageUrls.every((u): u is string => typeof u === 'string')
    ) {
      return NextResponse.json(
        { success: false, error: 'imageUrls (non-empty string array) is required' },
        { status: 400 },
      )
    }
    if (imageUrls.length > 30) {
      return NextResponse.json(
        { success: false, error: 'Maximum of 30 images per slideshow' },
        { status: 400 },
      )
    }

    const perImageSeconds =
      typeof requestedPerImage === 'number' &&
      requestedPerImage > 0 &&
      requestedPerImage <= 30
        ? requestedPerImage
        : 3

    const jobId = randomUUID()
    workDir = path.join(os.tmpdir(), `slideshow-${jobId}`)
    await fs.mkdir(workDir, { recursive: true })

    // Download all media in parallel
    const imagePaths = imageUrls.map((_, i) =>
      path.join(workDir!, `img-${String(i).padStart(3, '0')}.jpg`),
    )
    await Promise.all(
      imageUrls.map((url, i) => downloadTo(url, imagePaths[i])),
    )

    let audioPath: string | null = null
    if (typeof audioUrl === 'string' && audioUrl) {
      audioPath = path.join(workDir, 'audio.mp3')
      try {
        await downloadTo(audioUrl, audioPath)
      } catch (err) {
        console.warn('[slideshow] audio download failed — rendering silent', err)
        audioPath = null
      }
    }

    const outputPath = path.join(workDir, 'out.mp4')
    await renderSlideshow({
      imagePaths,
      audioPath,
      outputPath,
      perImageSeconds,
      width: 1080,
      height: 1920,
    })

    const stat = await fs.stat(outputPath)
    const stream = createReadStream(outputPath) as unknown as ReadStream
    const webStream = (
      stream as unknown as { [Symbol.asyncIterator](): AsyncIterator<Buffer> }
    )[Symbol.asyncIterator]
      ? new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for await (const chunk of stream) {
                controller.enqueue(
                  chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk),
                )
              }
              controller.close()
            } catch (err) {
              controller.error(err)
            } finally {
              void fs.rm(workDir!, { recursive: true, force: true })
            }
          },
          cancel() {
            stream.destroy()
            void fs.rm(workDir!, { recursive: true, force: true })
          },
        })
      : null

    if (!webStream) throw new Error('Failed to build response stream')

    const filename = `slideshow-${Date.now()}.mp4`
    return new NextResponse(webStream, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': stat.size.toString(),
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (err) {
    console.error('[slideshow] render error:', err)
    if (workDir) await fs.rm(workDir, { recursive: true, force: true })
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to render slideshow',
      },
      { status: 500 },
    )
  }
}
