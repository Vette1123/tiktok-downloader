'use client'

import { useEffect, useRef, useState } from 'react'
import { AppsIcon, ChevronDownIcon } from '@/components/icons'
import { Surface } from '@/components/Surface'
import { openStoreListing, PLAY_APPS, storeHref, storesLabel } from '@/lib/apps'

/**
 * The footer's "Our apps" menu — the same popover the streaming site's header
 * uses, ported to this footer.
 *
 * It replaces three dot-separated links plus a trailing "apps made by us"
 * caption, which is what buckled the footer row onto three lines at desktop.
 * One trigger costs one slot and has room for each app's tagline, which the
 * inline list never had.
 *
 * Hand-rolled rather than a Radix popover on purpose: this is the only popover
 * on the site, and a positioning dependency would land in the Worker bundle,
 * which CI gates on startup bytes. Rows stay real anchors so middle-click and
 * "open in new tab" keep working; the click handler only prefers the native
 * Play Store app, exactly as the old links did.
 */
export function PlayAppsMenu() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className='relative'>
      <button
        type='button'
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        aria-haspopup='menu'
        className='inline-flex items-center gap-1.5 whitespace-nowrap text-white/70 transition-colors hover:text-white'
      >
        <AppsIcon className='h-4 w-4' />
        Our apps
        <ChevronDownIcon
          className={`h-3.5 w-3.5 text-white/40 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* The positioning lives on this wrapper, not on the Surface: `.surface`
          is unlayered CSS carrying `position: relative`, so it beats an
          `absolute` utility passed in as a class and the panel would sit in
          flow, shoving the footer row apart.

          It is centred while the footer stacks centred on phones, and
          right-aligned from sm up, where the trigger is the last item on the
          right and a centred panel would hang past the edge. */}
      {open && (
        <div className='animate-section-in absolute bottom-full left-1/2 z-30 mb-2 w-72 -translate-x-1/2 sm:right-0 sm:left-auto sm:translate-x-0'>
          <Surface role='menu' radius='xl' elevation='raised' className='p-2 shadow-2xl'>
            <p className='px-2 pt-1 pb-2 text-xs font-medium text-white/45'>
              Our apps
            </p>
            {PLAY_APPS.map((app) => (
              <a
                key={app.androidPackage}
                role='menuitem'
                href={storeHref(app)}
                target='_blank'
                rel='noopener noreferrer'
                onClick={(e) => {
                  e.preventDefault()
                  setOpen(false)
                  openStoreListing(app)
                }}
                // .card-hover, not a translucent white film: rows in a panel are
                // exactly what that primitive is for, and hoverStyles.test.ts
                // fails the ad-hoc version.
                className='card-hover flex items-start gap-3 rounded-lg px-2 py-2 focus-visible:ring-1 focus-visible:ring-cyan-400/40 focus-visible:outline-none'
              >
                <AppsIcon className='mt-0.5 h-4 w-4 shrink-0 text-white/70' />
                <span className='min-w-0'>
                  <span className='block text-sm font-semibold text-white'>
                    {app.name}
                  </span>
                  <span className='block text-xs leading-snug text-white/55'>
                    {app.tagline}
                  </span>
                  <span className='block text-[11px] leading-snug text-white/35'>
                    {storesLabel(app)}
                  </span>
                </span>
              </a>
            ))}
          </Surface>
        </div>
      )}
    </div>
  )
}
