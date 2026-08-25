'use client'

import { useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, type PanInfo } from 'motion/react'
import { DownloadIcon, CloseIcon } from './icons'
import { buildDownloadFilename } from '@/lib/filename'
import { useHydrated } from '@/lib/clientEnv'

interface LightboxImage {
  id: string
  url: string
  thumbnail: string
}

interface ImageLightboxProps {
  images: LightboxImage[]
  activeIndex: number
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  platform?: string
  author?: string
  title?: string
}

// Direction-aware slide variants. `direction` is +1 when paginating forward
// (next) and -1 when paginating back (prev); the entering image slides in from
// the side the user swiped from, and the exiting image slides out the opposite
// way — so the motion always reads as "follow the finger."
const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? '100%' : '-100%',
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction < 0 ? '100%' : '-100%',
    opacity: 0,
  }),
}

// Either a long-enough drag OR a fast-enough flick triggers pagination. Two
// independent thresholds (not a multiplied "power") so a slow careful drag
// still navigates once the user clearly commits past the halfway mark.
const OFFSET_THRESHOLD = 80
const VELOCITY_THRESHOLD = 400

export function ImageLightbox({
  images,
  activeIndex,
  onClose,
  onPrev,
  onNext,
  platform,
  author,
  title,
}: ImageLightboxProps) {
  const current = images[activeIndex]
  const hasMultiple = images.length > 1

  // Render via a portal to <body>. The lightbox uses `position: fixed` to cover
  // the viewport, but an ancestor in the results card has a CSS `transform`
  // (enter animation) which would otherwise become the containing block — that
  // made `inset-0` size to the card instead of the viewport. Portaling escapes
  // that ancestor entirely.
  // `document` only exists after hydration, so the portal can't be created on
  // the first render pass — see lib/clientEnv for why this isn't an effect.
  const mounted = useHydrated()

  // Track direction so AnimatePresence's enter/exit slides the right way.
  // Update it just before calling onNext/onPrev — React batches both updates so
  // `direction` is already correct when the new activeIndex re-renders.
  const [direction, setDirection] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  const paginate = useCallback(
    (dir: 1 | -1) => {
      setDirection(dir)
      if (dir === 1) onNext()
      else onPrev()
    },
    [onNext, onPrev],
  )

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && hasMultiple) paginate(-1)
      else if (e.key === 'ArrowRight' && hasMultiple) paginate(1)
    },
    [onClose, paginate, hasMultiple],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handleKey)
      document.body.style.overflow = prevOverflow
    }
  }, [handleKey])

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    setIsDragging(false)
    const { offset, velocity } = info
    if (offset.x < -OFFSET_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD) {
      paginate(1)
    } else if (offset.x > OFFSET_THRESHOLD || velocity.x > VELOCITY_THRESHOLD) {
      paginate(-1)
    }
    // Otherwise the image springs back to 0 automatically (constraints 0/0).
  }

  const handleBackdropClick = () => {
    // A pointerup that ends a drag can synthesize a click — don't close then.
    if (isDragging) return
    onClose()
  }

  const handleDownloadOne = async () => {
    try {
      const res = await fetch(current.url)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = buildDownloadFilename({
        platform,
        author,
        title,
        ext: 'jpg',
        index: activeIndex + 1,
        total: images.length,
      })
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(blobUrl)
    } catch (err) {
      console.error('Single image download failed:', err)
    }
  }

  if (!current || !mounted) return null

  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return createPortal(
    <div
      className='fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-md'
      onClick={handleBackdropClick}
      role='dialog'
      aria-modal='true'
      aria-label='图片预览'
    >
      {/* Top bar: counter + close */}
      <div
        className='flex shrink-0 items-center justify-between gap-3 p-4'
        onClick={stop}
      >
        <span className='rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white tabular-nums'>
          {activeIndex + 1} / {images.length}
        </span>
        <button
          onClick={(e) => {
            stop(e)
            onClose()
          }}
          className='flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/15 transition-colors hover:bg-white/20'
          aria-label='关闭预览'
        >
          <CloseIcon className='h-5 w-5' />
        </button>
      </div>

      {/* Image area. `overflow-hidden` clips the exiting image as it slides off
          so it never bleeds into the bars. `touch-action: pan-y` lets us own
          horizontal swipes while letting the browser keep any vertical panning. */}
      <div
        className='relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 sm:px-6'
        style={{ touchAction: 'pan-y' }}
      >
        {hasMultiple && (
          <button
            onClick={(e) => {
              stop(e)
              paginate(-1)
            }}
            className='absolute left-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-2xl leading-none text-white transition-colors hover:bg-white/20 sm:left-4 md:h-12 md:w-12'
            aria-label='上一张图片'
          >
            ‹
          </button>
        )}

        {/* `popLayout` removes the exiting image from layout flow so the new
            image takes the centered slot immediately — no flex-stacking jump. */}
        <AnimatePresence initial={false} custom={direction} mode='popLayout'>
          <motion.img
            key={activeIndex}
            src={current.url}
            alt={`Slide ${activeIndex + 1} of ${images.length}`}
            custom={direction}
            variants={slideVariants}
            initial='enter'
            animate='center'
            exit='exit'
            transition={{
              x: { type: 'spring', stiffness: 280, damping: 32, mass: 0.6 },
              opacity: { duration: 0.18 },
            }}
            drag={hasMultiple ? 'x' : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={1}
            dragMomentum={false}
            onDragStart={() => setIsDragging(true)}
            onDragEnd={handleDragEnd}
            onClick={stop}
            draggable={false}
            className='max-h-full max-w-full cursor-grab rounded-lg object-contain shadow-2xl select-none active:cursor-grabbing'
          />
        </AnimatePresence>

        {hasMultiple && (
          <button
            onClick={(e) => {
              stop(e)
              paginate(1)
            }}
            className='absolute right-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-2xl leading-none text-white transition-colors hover:bg-white/20 sm:right-4 md:h-12 md:w-12'
            aria-label='下一张图片'
          >
            ›
          </button>
        )}
      </div>

      {/* Bottom bar: download */}
      <div className='flex shrink-0 items-center justify-center p-4' onClick={stop}>
        <button
          onClick={handleDownloadOne}
          className='btn-grad flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-[box-shadow,transform] hover:-translate-y-0.5'
        >
          <DownloadIcon className='h-4 w-4' />
          下载图片
        </button>
      </div>
    </div>,
    document.body,
  )
}
