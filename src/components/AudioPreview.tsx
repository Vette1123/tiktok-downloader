'use client'

import { MusicIcon } from '@/components/icons'

/**
 * Hear the track before saving it.
 *
 * One component for two callers — a carousel's soundtrack and an audio-only
 * result — because they were the same card twice, and the second one only
 * existed as a gap. Which results get it is decided by
 * `lib/audioPreview.shouldOfferAudioPreview`, so the condition is testable and
 * this stays presentation.
 */
export function AudioPreview({
  src,
  title,
  subtitle,
}: {
  src: string
  title: string
  subtitle?: string
}) {
  return (
    <div className='animate-fade-in-up space-y-3 rounded-xl border border-white/[0.1] bg-gradient-to-br from-cyan-500/10 to-sky-500/10 p-4'>
      <div className='flex items-center gap-2 text-white'>
        <MusicIcon className='h-5 w-5 text-cyan-300' />
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-semibold'>{title}</p>
          {subtitle && (
            <p className='truncate text-xs text-white/60'>by {subtitle}</p>
          )}
        </div>
      </div>
      {/* preload='none', not 'metadata': every result carrying audio would
          otherwise pull the head of the track through /api/audio for a visitor
          who never pressed play. */}
      <audio src={src} controls preload='none' className='w-full'>
        Your browser does not support the audio element.
      </audio>
    </div>
  )
}
