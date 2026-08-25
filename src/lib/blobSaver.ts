/**
 * Save a fetched body under our own filename via a throwaway object URL.
 *
 * The single place for the click-to-save dance; previously hand-rolled in
 * BatchPanel and DownloaderApp separately.
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
