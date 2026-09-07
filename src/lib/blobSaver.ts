import { correctExtension } from './mediaFormat'

/**
 * Save media under a name the bytes actually justify.
 *
 * The extension is chosen before a single byte arrives — the audio button says
 * `.mp3`, the video button says `.mp4` — and that is wrong often enough to
 * matter: the fallback path re-serves a source's own track, which is AAC in an
 * MP4 container from YouTube and Opus in WebM elsewhere. A file called `.mp3`
 * that is neither gets refused by players and misread by taggers.
 *
 * Reading sixteen bytes is the whole cost, and `correctExtension` hands the
 * name straight back for anything it cannot identify — every image and archive
 * included — so this is safe to route every media save through. Returns the
 * name actually used, which the caller needs when it goes on to describe the
 * file it just wrote.
 */
export async function saveMedia(blob: Blob, filename: string): Promise<string> {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
  const name = correctExtension(filename, head)
  saveBlob(blob, name)
  return name
}

/**
 * Save a fetched body under our own filename via a throwaway object URL.
 *
 * The single place for the click-to-save dance; previously hand-rolled in
 * BatchPanel and DownloaderApp separately. Prefer `saveMedia` for anything
 * that came off the network — this one takes the name on trust.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const blobUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(blobUrl)
}
