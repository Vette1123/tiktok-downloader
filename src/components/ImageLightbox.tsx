'use client'

import { useEffect, useCallback } from 'react'
import { DownloadIcon } from './icons'

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
}

export function ImageLightbox({
  images,
  activeIndex,
  onClose,
  onPrev,
  onNext,
}: ImageLightboxProps) {
  const current = images[activeIndex]

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onPrev()
      else if (e.key === 'ArrowRight') onNext()
    },
    [onClose, onPrev, onNext],
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

  const handleDownloadOne = async () => {
    try {
      const res = await fetch(current.url)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `social-image-${activeIndex + 1}-${Date.now()}.jpg`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(blobUrl)
    } catch (err) {
      console.error('Single image download failed:', err)
    }
  }

  if (!current) return null

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4'
      onClick={onClose}
      role='dialog'
      aria-modal='true'
      aria-label='Image preview'
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className='absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xl transition-colors'
        aria-label='Close preview'
      >
        ×
      </button>

      {images.length > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPrev()
            }}
            className='absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 md:w-12 md:h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-2xl transition-colors'
            aria-label='Previous image'
          >
            ‹
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNext()
            }}
            className='absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 md:w-12 md:h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-2xl transition-colors'
            aria-label='Next image'
          >
            ›
          </button>
        </>
      )}

      <div
        className='flex flex-col items-center gap-4 max-h-full max-w-full'
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={current.url}
          alt={`Slide ${activeIndex + 1} of ${images.length}`}
          className='max-h-[80vh] max-w-full object-contain rounded-lg shadow-2xl'
        />

        <div className='flex items-center gap-3 bg-white/10 backdrop-blur-md rounded-full px-4 py-2'>
          <span className='text-white text-sm font-medium tabular-nums'>
            {activeIndex + 1} / {images.length}
          </span>
          <button
            onClick={handleDownloadOne}
            className='flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-pink-500 to-violet-500 hover:from-pink-600 hover:to-violet-600 text-white text-sm font-medium rounded-full transition-all'
          >
            <DownloadIcon className='w-4 h-4' />
            Download
          </button>
        </div>
      </div>
    </div>
  )
}
