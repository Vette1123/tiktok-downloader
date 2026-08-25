'use client'

/**
 * The confirmation step for anything destructive.
 *
 * Built on the native `<dialog>` element rather than a headless UI library.
 * `showModal()` already gives us the whole checklist a hand-rolled modal gets
 * wrong: focus moves into the dialog and is trapped there, the rest of the page
 * goes inert to both the pointer and the accessibility tree, Escape closes it,
 * and focus returns to whatever opened it. A dependency would ship a few
 * kilobytes to reimplement that in JavaScript.
 *
 * It replaces `window.confirm`, which blocked the main thread, could not be
 * styled, is suppressible by the browser, and reads as a browser error rather
 * than as part of the product.
 *
 * Cancel is deliberately the autofocused control, so Enter on a keyboard and a
 * mis-aimed tap both resolve to the safe answer. The destructive button is
 * never the default.
 */

import { useEffect, useRef } from 'react'
import { Surface } from '@/components/Surface'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  /** The consequence, in plain words — this is the part people actually read. */
  body: string
  confirmLabel: string
  /**
   * The safe answer, when "Cancel" would be ambiguous.
   *
   * On a dialog that cancels a subscription, both buttons otherwise read as a
   * cancel — "Cancel" to back out, "Cancel my plan" to go through — and the
   * word means opposite things one button apart. Naming the outcome ("Keep my
   * plan") is what makes the pair readable at a glance.
   */
  dismissLabel?: string
  /** `danger` paints the confirm red. `neutral` is for merely inconvenient. */
  tone?: 'danger' | 'neutral'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  dismissLabel = '取消',
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  // `open` is a prop, but showModal()/close() are imperative — this is the one
  // place the two have to be reconciled. Guarded both ways: calling showModal()
  // on an already-open dialog throws.
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby='confirm-dialog-title'
      // Escape fires `cancel`. Prevented so the element does not close itself
      // behind the prop's back — the owner flips `open`, and the effect above
      // closes it, so the two can never disagree.
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      // A click that lands on the dialog element itself is a click on the
      // backdrop: the panel inside covers everything else.
      onClick={(event) => {
        if (event.target === ref.current) onCancel()
      }}
      className='m-auto w-[min(28rem,calc(100vw-2rem))] border-0 bg-transparent p-0 text-white backdrop:bg-black/70 backdrop:backdrop-blur-sm'
    >
      {/* A direct child of the <dialog>, which is what `animate-dialog-in`
          selects on — the panel and the backdrop animate separately because
          `::backdrop` cannot inherit an animation from its element. */}
      <Surface radius='3xl' elevation='raised' className='animate-dialog-in p-6'>
        <h2 id='confirm-dialog-title' className='text-lg font-semibold text-white'>
          {title}
        </h2>
        <p className='mt-2 text-sm leading-relaxed text-white/70'>{body}</p>

        <div className='mt-6 flex flex-wrap justify-end gap-3'>
          <button
            type='button'
            autoFocus
            onClick={onCancel}
            className='btn-ghost btn-press rounded-xl px-4 py-2 text-sm font-medium'
          >
            {dismissLabel}
          </button>
          <button
            type='button'
            onClick={onConfirm}
            className={`btn-press rounded-xl px-4 py-2 text-sm font-semibold ${
              tone === 'danger' ? 'btn-danger' : 'btn-grad'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </Surface>
    </dialog>
  )
}
