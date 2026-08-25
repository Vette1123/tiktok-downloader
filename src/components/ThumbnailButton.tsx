'use client'

import { useState } from 'react'
import { buildDownloadFilename } from '@/lib/filename'
import { saveBlob } from '@/lib/blobSaver'
import { useT } from '@/lib/i18nStore'

/**
 * Container → file extension. Only the three a thumbnail actually arrives in;
 * anything else is served as JPEG by every CDN this talks to, which is also
 * the safe default for a file the browser will open by extension.
 */
function extensionFor(contentType: string): string {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  return 'jpg'
}

/**
 * Save the resolved result's cover image. The URL is whatever metadata
 * carried — same-origin proxy for Instagram's hotlink-gated CDN, direct CDN
 * for everyone else — so a plain fetch works everywhere this runs.
 */
export function ThumbnailButton({
  url,
  title,
}: {
  url: string
  title?: string
}) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const handleSave = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      const response = await fetch(url)
      if (!response.ok) {
        setFailed(true)
        return
      }
      const type = response.headers.get('Content-Type') ?? 'image/jpeg'
      saveBlob(
        await response.blob(),
        buildDownloadFilename({ title, ext: extensionFor(type) }),
      )
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  // Three states, one at a time — read in priority order rather than nested
  // in the JSX, where the middle branch is the hardest thing on the page.
  function label(): string {
    if (failed) return t('thumbnailUnavailable')
    if (busy) return t('thumbnailSaving')
    return t('thumbnailBtn')
  }

  return (
    <button
      type='button'
      onClick={() => void handleSave()}
      disabled={busy}
      className='rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
    >
      {label()}
    </button>
  )
}
