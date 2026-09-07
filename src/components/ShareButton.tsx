'use client'

import { useState } from 'react'

/**
 * Native share for a resolved result, where the platform supports it
 * (every mobile browser, some desktops). Renders nothing elsewhere — a
 * copy-to-clipboard fallback would be a second button teaching the same
 * action as the address bar.
 */
export function ShareButton({
  title,
  url,
}: {
  title: string
  url: string
}) {
  const [available] = useState(
    () => typeof navigator !== 'undefined' && typeof navigator.share === 'function',
  )
  const [failed, setFailed] = useState(false)

  if (!available) return null

  const handleShare = async () => {
    try {
      await navigator.share({ title, url })
    } catch {
      // A dismissed sheet throws too — only mark real failures visible.
      setFailed(true)
    }
  }

  return (
    <button
      type='button'
      onClick={() => void handleShare()}
      className='rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:text-white'
    >
      {/* "Share link", not "Share". Once a save offers "Send to an app" — which
          hands over the actual file — a bare "Share" on the card is one of two
          buttons with the same verb and different objects, and the one that
          sends a URL when somebody wanted the video is the worse surprise. */}
      {failed ? 'Could not share' : 'Share link'}
    </button>
  )
}
