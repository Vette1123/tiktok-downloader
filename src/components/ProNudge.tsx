'use client'

import Link from 'next/link'
import { Surface } from '@/components/Surface'
import { CloseIcon } from '@/components/icons'
import { useTier } from '@/lib/entitlements'
import { dismissNudge, useProSignals } from '@/lib/proSignals'

/**
 * The one shape every in-product ask takes.
 *
 * There are two places worth making the case — the moment someone pastes more
 * links than the one-at-a-time flow handles, and the moment a download finishes
 * — and they were always going to be the same component. Two hand-rolled
 * banners would have drifted in wording, spacing and dismissal behaviour within
 * a week, and the wording is the part with a constraint on it.
 *
 * **Nothing here may claim the extras reach more than the plain site does.**
 * They change how much standing-over-it the same work needs: a queue instead of
 * one at a time, a ZIP instead of twelve files, the priority resolver first, no
 * sponsor card. A nudge that says "unlock" or implies otherwise is the clause
 * that got the store closed — and it stays banned now that there is no store,
 * because it would be equally untrue.
 */

export interface ProNudgeProps {
  /** Stable id, used to remember a dismissal. Never reuse one for new copy. */
  id: string
  /** The observation — what the visitor is doing right now. */
  lede: React.ReactNode
  /** The button. Names the job, not the plan: "Run as a queue" beats "Get Pro". */
  action: string
  /** Where the button goes. Defaults to the pitch page. */
  href?: string
  /** `inline` sits inside the flow; `attached` reads as a footnote to the thing above it. */
  tone?: 'inline' | 'attached'
  dismissible?: boolean
}

export function ProNudge({
  id,
  lede,
  action,
  href = '/pro',
  tone = 'inline',
  dismissible = true,
}: ProNudgeProps) {
  const tier = useTier()
  const { dismissed } = useProSignals()

  // Self-hiding, so no call site needs a conditional — the same contract
  // BatchPanel already has. Someone who already supports this must never be
  // asked again.
  if (tier === 'pro') return null
  if (dismissible && dismissed.includes(id)) return null

  return (
    // Stacked on a phone, side by side from `sm`. Never `flex-wrap`: with a
    // shrink-0 button the row does not wrap, it squeezes the sentence into a
    // four-word-wide column beside the button.
    <Surface
      tone='accent'
      radius={tone === 'attached' ? '2xl' : '3xl'}
      className={`animate-section-in relative flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 ${
        tone === 'attached' ? 'mt-2' : 'mt-3'
      }`}
    >
      {/* Room for the dismiss button, which is pinned to the corner and would
          otherwise sit on top of the last word of the first line. */}
      <p
        className={`min-w-0 flex-1 text-sm text-pretty text-white/75 ${
          dismissible ? 'pr-7 sm:pr-0' : ''
        }`}
      >
        {lede}
      </p>

      <Link
        href={href}
        className='btn-grad btn-press shrink-0 self-start rounded-xl px-4 py-2 text-sm font-semibold whitespace-nowrap sm:self-auto'
      >
        {action}
      </Link>

      {/* Pinned to the corner on a phone, where the stacked layout leaves it
          nowhere sensible inline; an ordinary last item in the row from `sm`,
          where parking it over the CTA's corner would be worse. One element
          either way — the lowest-value control here must never become two
          buttons that both dismiss. */}
      {dismissible && (
        <button
          type='button'
          onClick={() => dismissNudge(id)}
          aria-label='Dismiss'
          className='absolute top-1 right-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/10 hover:text-white/80 sm:static'
        >
          <CloseIcon className='h-4 w-4' />
        </button>
      )}
    </Surface>
  )
}

/**
 * One line in the hero card, above the paste bar.
 *
 * Deliberately a line of text rather than a card: the hero's job is the paste
 * bar, and a second panel above it would be asking somebody who has not been
 * helped yet.
 *
 * It leads with what is free, because that is both true and the reason the rest
 * of the sentence is believable — and because "free, no account, no limits" is
 * the entire pitch for the site itself, not a lead-in to a price.
 */
export function ProHeroLine() {
  const tier = useTier()
  if (tier === 'pro') return null

  return (
    <p className='mb-7 text-xs text-white/50 md:text-sm'>
      Free, no account, no limits.{' '}
      <Link
        href='/pro'
        className='font-medium text-cyan-300 underline-offset-4 transition-colors hover:text-cyan-200 hover:underline'
      >
        Support the project →
      </Link>
    </p>
  )
}
