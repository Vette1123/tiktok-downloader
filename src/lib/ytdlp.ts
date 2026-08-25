import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readdir, mkdir, copyFile, access } from 'node:fs/promises'
import { nativeMediaAvailable } from './nativeMedia'

/**
 * yt-dlp integration. yt-dlp runs the extraction locally (from this process's
 * IP), which — unlike the public Cobalt/Piped instances on datacenter IPs —
 * YouTube does not bot-block when running from a residential connection. It is
 * therefore the most reliable YouTube source when the binary is available
 * (local dev / a self-hosted box). When it isn't (e.g. the Vercel serverless
 * runtime, where the binary isn't shipped), every call here fails gracefully so
 * the caller can fall back to the public extractors / embed.
 *
 * The binary is provided by the `youtube-dl-exec` dependency (downloaded on
 * install). Merging/transcoding uses the ffmpeg shipped by
 * `@ffmpeg-installer/ffmpeg`.
 */

type YtdlpFn = (url: string, flags: Record<string, unknown>) => Promise<unknown>

let cachedYtdlp: YtdlpFn | null = null

async function loadYtdlp(): Promise<YtdlpFn> {
  if (cachedYtdlp) return cachedYtdlp
  const mod = (await import('youtube-dl-exec')) as unknown as
    | YtdlpFn
    | { default: YtdlpFn }
  cachedYtdlp = (typeof mod === 'function' ? mod : mod.default) as YtdlpFn
  return cachedYtdlp
}

// Directory holding the ffmpeg binary, passed to yt-dlp so it can merge
// adaptive video+audio streams and transcode audio to mp3.
//
// Windows gotcha: yt-dlp (via youtube-dl-exec) builds a cmd.exe command string
// in which option *values* aren't quoted, so a `--ffmpeg-location` containing a
// space (this project lives under "C:\High Speed\...") silently breaks with
// "The system cannot find the path specified." When the bundled binary's path
// has a space, copy it into a space-free temp dir and point yt-dlp there.
// Resolved once and cached (null = not yet resolved).
let cachedFfmpegDir: string | undefined | null = null

async function ffmpegDir(): Promise<string | undefined> {
  if (cachedFfmpegDir !== null) return cachedFfmpegDir
  cachedFfmpegDir = undefined
  try {
    const mod = (await import('@ffmpeg-installer/ffmpeg')) as unknown as
      | { path?: string }
      | { default?: { path?: string } }
    const ffmpegPath =
      (mod as { path?: string }).path ??
      (mod as { default?: { path?: string } }).default?.path
    if (!ffmpegPath) return undefined

    if (!ffmpegPath.includes(' ')) {
      cachedFfmpegDir = path.dirname(ffmpegPath)
      return cachedFfmpegDir
    }

    const safeDir = path.join(os.tmpdir(), 'ttd-ffmpeg')
    const safeBin = path.join(safeDir, path.basename(ffmpegPath))
    // tmpdir is space-free on a normal install; bail out if it isn't.
    if (safeBin.includes(' ')) return undefined
    try {
      await access(safeBin)
    } catch {
      await mkdir(safeDir, { recursive: true })
      await copyFile(ffmpegPath, safeBin)
    }
    cachedFfmpegDir = safeDir
    return cachedFfmpegDir
  } catch {
    cachedFfmpegDir = undefined
    return undefined
  }
}

export interface YtInfo {
  title?: string
  uploader?: string
  duration?: number
  thumbnail?: string
}

/**
 * Resolve basic video info. Doubles as a fast availability probe: if it returns
 * a value, yt-dlp is present AND able to reach the video from here, so it's safe
 * to offer real downloads. Returns null on any failure (binary missing, video
 * blocked/unavailable, network error).
 */
export async function ytdlpInfo(url: string): Promise<YtInfo | null> {
  // Skip the probe entirely where the binary cannot exist. The catch below
  // would swallow the failure anyway, but this keeps a doomed dynamic import
  // off the hot path of every resolve.
  if (!nativeMediaAvailable()) return null
  try {
    const ytdlp = await loadYtdlp()
    const info = (await ytdlp(url, {
      dumpSingleJson: true,
      noPlaylist: true,
      noWarnings: true,
      noCheckCertificates: true,
      retries: 2,
    })) as Partial<YtInfo> | null
    if (!info || typeof info !== 'object' || !info.title) return null
    return {
      title: info.title,
      uploader: info.uploader,
      duration: info.duration,
      thumbnail: info.thumbnail,
    }
  } catch {
    return null
  }
}

/**
 * A resolved direct media URL plus the metadata yt-dlp read off the page.
 * `downloadUrl` is a progressive http(s) URL — the only shape that can be
 * re-served through this app's own media proxy and played by a browser without
 * ffmpeg. Manifest-only sources (HLS/DASH) return null rather than a URL that
 * would play for nobody.
 */
export interface YtdlpProbe {
  downloadUrl: string
  title?: string
  uploader?: string
  duration?: number
  thumbnail?: string
}

interface YtdlpFormat {
  url?: string
  ext?: string
  protocol?: string
  vcodec?: string
  acodec?: string
  height?: number
  abr?: number
}

export interface YtdlpDump {
  title?: string
  uploader?: string
  duration?: number
  thumbnail?: string
  // Single-video dumps mirror the chosen format onto the top level, codec
  // fields included.
  url?: string
  protocol?: string
  ext?: string
  vcodec?: string
  acodec?: string
  formats?: YtdlpFormat[]
  entries?: (YtdlpDump | null)[]
  _type?: string
}

/** Progressive http(s) only — never an HLS/DASH manifest, never a fragment. */
function isProgressiveHttp(format: YtdlpFormat): boolean {
  if (!format.url || !/^https?:\/\//i.test(format.url)) return false
  const protocol = format.protocol ?? 'https'
  return protocol.startsWith('http') && !protocol.includes('m3u8') && !protocol.includes('dash')
}

/**
 * yt-dlp leaves `vcodec`/`acodec` unset (null) on single muxed files for
 * several hosts — measured on PornHub and Eporner, whose every rendition
 * arrives exactly that way. Null means "unknown", and the file is by
 * construction video+audio together; the only actively dangerous value is the
 * literal `'none'`, which marks a single-track adaptive stream this app
 * cannot use without ffmpeg. So: reject `'none'`, accept everything else.
 */
function carriesBothTracks(format: YtdlpFormat): boolean {
  return format.vcodec !== 'none' && format.acodec !== 'none'
}

function isPlaylist(info: YtdlpDump): boolean {
  return info._type === 'playlist' && Array.isArray(info.entries)
}

function firstEntry(info: YtdlpDump): YtdlpDump | null {
  if (!isPlaylist(info)) return info
  return (info.entries ?? []).find((e): e is YtdlpDump => Boolean(e?.url || e?.formats)) ?? null
}

/** Highest `height` wins; ties prefer mp4 over other containers and demote
 * AV1, whose decode support in older players is still shaky (same reasoning as
 * pageScrape's scorer). Undefined heights sort last.
 *
 * Every term is written "loser minus winner", because this feeds `sort` and a
 * negative result puts `a` first: demoting AV1 is `aAv1 - bAv1` (a penalty for
 * a sorts a later), so preferring mp4 must be `b - a`. Getting that backwards
 * silently picks the container the comment says it avoids. */
function byVideoQuality(a: YtdlpFormat, b: YtdlpFormat): number {
  const ha = a.height ?? 0
  const hb = b.height ?? 0
  if (ha !== hb) return hb - ha
  const aAv1 = /^av1|av01/i.test(a.vcodec ?? '') ? 1 : 0
  const bAv1 = /^av1|av01/i.test(b.vcodec ?? '') ? 1 : 0
  if (aAv1 !== bAv1) return aAv1 - bAv1
  return (b.ext === 'mp4' ? 1 : 0) - (a.ext === 'mp4' ? 1 : 0)
}

/**
 * Resolve ANY link to a direct progressive media URL with real metadata.
 *
 * This is the universal extractor: yt-dlp ships site-specific extractors for
 * hundreds of hosts plus a generic one that reads every player shape they use,
 * so it succeeds where tag-scraping finds nothing. It runs the extraction from
 * this process's IP, so like `ytdlpInfo` it is only ever available where the
 * binary can exist (local dev / a self-hosted box) — every call fails fast on
 * Cloudflare via the same `nativeMediaAvailable()` gate, which keeps the Worker
 * path byte-identical to today's.
 *
 * `kind: 'video'` picks the best progressive video+audio rendition (H.264 and
 * ≤1080p preferred, so what comes back plays in a `<video>` tag everywhere);
 * `kind: 'audio'` picks the best audio-only track in a browser-native container
 * (m4a/mp3). Returns null on any failure or when nothing progressive exists.
 */
export async function ytdlpProbe(
  url: string,
  kind: 'video' | 'audio',
): Promise<YtdlpProbe | null> {
  if (!nativeMediaAvailable()) return null
  try {
    const ytdlp = await loadYtdlp()
    // Chrome impersonation clears the TLS-fingerprint walls several hosts put
    // up (measured: Eporner resets the plain connection mid-metadata and
    // answers an impersonated one in full). The wrapper may predate the
    // option, so a refusal here retries plainly rather than failing the URL.
    const baseFlags = {
      dumpSingleJson: true,
      // The app downloads one file per paste, so only the first entry is ever
      // read (see the unwrap below). `noPlaylist` takes the single video out
      // of a `watch?v=…&list=…` link; `playlistItems: '1'` bounds the case it
      // cannot help with — a bare playlist URL, where a full dump would
      // extract every entry over the network before we discard all but one.
      noPlaylist: true,
      playlistItems: '1',
      noWarnings: true,
      noCheckCertificates: true,
      retries: 2,
    }
    let dump: YtdlpDump | null = null
    try {
      dump = (await ytdlp(url, {
        ...baseFlags,
        impersonate: 'chrome',
      } as Record<string, unknown>)) as YtdlpDump | null
    } catch {
      dump = (await ytdlp(url, baseFlags)) as YtdlpDump | null
    }

    // A playlist URL resolves to many entries; the app downloads one file per
    // paste, so take the first playable entry exactly as the resolver does.
    while (dump && isPlaylist(dump)) {
      const entry = firstEntry(dump)
      if (!entry) return null
      dump = entry
    }
    if (!dump) return null

    let chosen: YtdlpFormat | null = null
    if (kind === 'audio') {
      // m4a (AAC) and mp3 decode in every browser; opus/webm do not survive the
      // audio proxy's audio/mpeg labelling everywhere, so they are skipped.
      const audios = (dump.formats ?? []).filter(
        (f) =>
          isProgressiveHttp(f) &&
          f.vcodec === 'none' &&
          f.acodec !== 'none' &&
          f.acodec != null &&
          (f.ext === 'm4a' || f.ext === 'mp3'),
      )
      chosen =
        audios.sort((a, b) => (b.abr ?? b.height ?? 0) - (a.abr ?? a.height ?? 0))[0] ?? null
    } else {
      // Video+audio in one progressive file. H.264 first (see ytdlpDownload for
      // why HEVC breaks playback), then resolution, capped at 1080p. AV1 loses
      // to anything equal because it is not in the h264 pool — older decoders.
      const videos = (dump.formats ?? []).filter(
        (f) =>
          isProgressiveHttp(f) &&
          carriesBothTracks(f) &&
          (f.height ?? 0) <= 1080,
      )
      const h264 = videos.filter((f) => /^avc/i.test(f.vcodec ?? ''))
      const pool = h264.length > 0 ? h264 : videos
      chosen = pool.sort(byVideoQuality)[0] ?? null
    }

    // Some muxed sources put the single playable stream on the top-level url
    // rather than listing formats (yt-dlp's generic extractor does this for
    // plain <video src> pages).
    const topLevel: YtdlpFormat = {
      url: dump.url,
      ext: dump.ext,
      protocol: dump.protocol,
      vcodec: kind === 'audio' ? 'none' : 'avc1',
      acodec: 'mp4a',
    }
    if (!chosen && isProgressiveHttp(topLevel) && (kind === 'video' || dump.ext === 'm4a' || dump.ext === 'mp3')) {
      chosen = topLevel
    }
    // An audio ask with no listed audio format can still take a muxed file —
    // browsers pull the track out of an mp4 just as well.
    if (!chosen && kind === 'audio') {
      const muxed = (dump.formats ?? []).filter(
        (f) => isProgressiveHttp(f) && carriesBothTracks(f) && (f.ext === 'mp4' || f.ext === 'm4a'),
      )
      chosen = muxed.sort(byVideoQuality)[0] ?? null
    }
    if (!chosen?.url) return null

    return {
      downloadUrl: chosen.url,
      title: dump.title,
      uploader: dump.uploader,
      duration: typeof dump.duration === 'number' ? dump.duration : undefined,
      thumbnail: dump.thumbnail,
    }
  } catch {
    return null
  }
}

export interface YtFile {
  file: string
  contentType: string
  ext: string
}

/**
 * Download a YouTube video to a temp file and return its path. For `video` it
 * merges the best ≤1080p video+audio into an mp4; for `audio` it extracts the
 * best audio track to mp3. The caller is responsible for streaming then
 * deleting the file. Throws on failure.
 */
export async function ytdlpDownload(
  url: string,
  kind: 'video' | 'audio',
): Promise<YtFile> {
  const ytdlp = await loadYtdlp()
  const dir = os.tmpdir()
  const stem = `yt-${randomUUID()}`
  const base = path.join(dir, stem)
  const ffDir = await ffmpegDir()

  const common: Record<string, unknown> = {
    output: `${base}.%(ext)s`,
    noPlaylist: true,
    noWarnings: true,
    noCheckCertificates: true,
    retries: 3,
    ...(ffDir ? { ffmpegLocation: ffDir } : {}),
  }

  if (kind === 'audio') {
    await ytdlp(url, {
      ...common,
      format: 'bestaudio/best',
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: 0,
    })
  } else {
    await ytdlp(url, {
      ...common,
      // Prefer mp4 video + m4a(AAC) audio so the streams copy into an mp4
      // container cleanly — opus/webm audio can't be copied into mp4 and makes
      // the merge fail. Fall back to a muxed mp4, then anything.
      // NOTE: avoid `<`/`>` here — youtube-dl-exec doesn't quote option values,
      // so cmd.exe on Windows would treat `height<=1080` as a redirection and
      // break. Cap the resolution with --format-sort (res:1080) instead.
      format: 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
      // Prefer H.264 (avc1) FIRST, then cap resolution at 1080p. TikTok defaults
      // to h265/bytevc1, which no browser can play in a <video> tag (the stream
      // renders audio-only — the "shows as mp3" bug), and it often offers a
      // higher-res HEVC rendition than its H.264 one — so codec must outrank
      // resolution here, otherwise the bigger HEVC wins and playback breaks.
      // `vcodec:h264` only *prefers* H.264; with no H.264 rendition yt-dlp still
      // falls back to the best available.
      formatSort: 'vcodec:h264,res:1080',
      mergeOutputFormat: 'mp4',
    })
  }

  // yt-dlp names the output `${stem}.<ext>`; locate the produced file rather
  // than assume the extension (a merge may remux to mkv on odd codec combos).
  const produced = (await readdir(dir)).find((f) => f.startsWith(stem))
  if (!produced) throw new Error('yt-dlp produced no output file')

  const isAudio = kind === 'audio'
  return {
    file: path.join(dir, produced),
    contentType: isAudio ? 'audio/mpeg' : 'video/mp4',
    ext: isAudio ? 'mp3' : 'mp4',
  }
}
