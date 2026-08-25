'use client'

import { useState } from 'react'

/**
 * Copy the original post link. The smallest possible "take it with you" —
 * pairs with Share where that exists, stands in for it where it doesn't.
 */
export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // clipboard permission denied — nothing useful to say; the URL is on screen.
    }
  }

  return (
    <button
      type='button'
      onClick={() => void handleCopy()}
      className='rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:text-white'
    >
      {copied ? 'Copied ✓' : 'Copy link'}
    </button>
  )
}
