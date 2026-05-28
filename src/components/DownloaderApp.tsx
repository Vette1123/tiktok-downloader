'use client'

import { ReactNode, useReducer, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { appReducer, initialState } from '@/lib/appReducer'
import {
  CheckIcon,
  DownloadIcon,
  getImagePlaceholderBase64,
  MusicIcon,
  SpinnerIcon,
  TikTokIcon,
  TwitterXIcon,
} from '@/components/icons'
import { ImageLightbox } from '@/components/ImageLightbox'

interface DownloaderAppProps {
  idleLeftSlot: ReactNode
  idleRightSlot: ReactNode
}

export function DownloaderApp({
  idleLeftSlot,
  idleRightSlot,
}: DownloaderAppProps) {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const containerRef = useRef<HTMLDivElement>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [urlError, setUrlError] = useState<string | null>(null)

  const handleProcess = async () => {
    if (!state.url.trim()) {
      setUrlError('Please paste a TikTok or Twitter/X URL first')
      return
    }
    setUrlError(null)

    dispatch({ type: 'SET_LOADING', payload: true })
    dispatch({ type: 'RESET_DOWNLOAD_STATE' })

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: state.url,
          type: state.downloadType,
        }),
      })

      const data = await response.json()

      if (data.success) {
        dispatch({
          type: 'SET_DOWNLOAD_SUCCESS',
          payload: {
            downloadUrl: data.downloadUrl,
            audioUrl: data.audioUrl,
            metadata: data.metadata,
            originalUrl: state.url,
          },
        })

        dispatch({ type: 'SET_URL', payload: '' })

        setTimeout(() => {
          if (containerRef.current) {
            const resultsSection =
              containerRef.current.querySelector('.results-section')
            if (resultsSection) {
              resultsSection.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              })
            }
          }
        }, 500)
      } else {
        dispatch({
          type: 'SET_MESSAGE',
          payload: data.error || 'Failed to process video',
        })
      }
    } catch (err) {
      console.error('Processing error:', err)
      dispatch({
        type: 'SET_MESSAGE',
        payload: 'An error occurred while processing the video',
      })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }

  const handleVideoDownload = async () => {
    if (!state.downloadUrl) return

    dispatch({ type: 'SET_DOWNLOADING', payload: true })

    try {
      const response = await fetch(state.downloadUrl)

      if (!response.ok) {
        throw new Error('Failed to download video')
      }
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)

      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `social-video-${Date.now()}.mp4`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      URL.revokeObjectURL(blobUrl)

      dispatch({
        type: 'SET_MESSAGE',
        payload: 'Video downloaded successfully! 🎉',
      })
      dispatch({ type: 'SET_URL', payload: '' })
    } catch (error) {
      console.error('Download failed:', error)
      dispatch({
        type: 'SET_MESSAGE',
        payload: 'Failed to download video file',
      })
    } finally {
      dispatch({ type: 'SET_DOWNLOADING', payload: false })
    }
  }

  const handleSlideshowRender = async () => {
    const images = state.videoMetadata?.images
    const rawMusicUrl = state.videoMetadata?.rawMusicUrl
    if (!images || images.length === 0) return

    dispatch({ type: 'SET_DOWNLOADING', payload: true })
    dispatch({
      type: 'SET_MESSAGE',
      payload: 'Rendering slideshow video... this takes ~30 seconds.',
    })

    try {
      const response = await fetch('/api/slideshow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrls: images.map((img) => img.url),
          audioUrl: rawMusicUrl,
          perImageSeconds: 3,
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to render slideshow')
      }

      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)

      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `tiktok-slideshow-${Date.now()}.mp4`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(blobUrl)

      dispatch({
        type: 'SET_MESSAGE',
        payload: 'Slideshow video rendered and downloaded! 🎬',
      })
      dispatch({ type: 'SET_URL', payload: '' })
    } catch (error) {
      console.error('Slideshow render failed:', error)
      dispatch({
        type: 'SET_MESSAGE',
        payload:
          error instanceof Error
            ? `Slideshow render failed: ${error.message}`
            : 'Failed to render slideshow video',
      })
    } finally {
      dispatch({ type: 'SET_DOWNLOADING', payload: false })
    }
  }

  const handleAudioDownload = async () => {
    if (!state.audioUrl) return

    dispatch({ type: 'SET_DOWNLOADING_AUDIO', payload: true })

    try {
      const response = await fetch(state.audioUrl)

      if (!response.ok) {
        throw new Error('Failed to download audio')
      }
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)

      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `social-audio-${Date.now()}.mp3`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      URL.revokeObjectURL(blobUrl)

      dispatch({
        type: 'SET_MESSAGE',
        payload: 'Audio downloaded successfully! 🎵',
      })
      dispatch({ type: 'SET_URL', payload: '' })
    } catch (error) {
      console.error('Audio download failed:', error)
      dispatch({
        type: 'SET_MESSAGE',
        payload: 'Failed to download audio file',
      })
    } finally {
      dispatch({ type: 'SET_DOWNLOADING_AUDIO', payload: false })
    }
  }

  const handleImageDownload = async () => {
    if (!state.videoMetadata?.images) return

    const selectedImages = state.videoMetadata.images.filter(
      (img) => img.selected,
    )

    if (selectedImages.length === 0) {
      dispatch({
        type: 'SET_MESSAGE',
        payload: 'Please select at least one image to download',
      })
      return
    }

    dispatch({ type: 'SET_DOWNLOADING_IMAGES', payload: true })

    try {
      const imageUrls = selectedImages.map((img) => img.url)

      if (state.downloadImagesAsZip) {
        const response = await fetch('/api/images', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            imageUrls,
            title: state.videoMetadata.title,
            asZip: true,
          }),
        })

        if (!response.ok) {
          throw new Error('Failed to download images as ZIP')
        }
        const blob = await response.blob()
        const blobUrl = URL.createObjectURL(blob)

        const link = document.createElement('a')
        link.href = blobUrl
        link.download = `social-images-${Date.now()}.zip`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)

        URL.revokeObjectURL(blobUrl)

        dispatch({
          type: 'SET_MESSAGE',
          payload: `${selectedImages.length} image(s) downloaded as ZIP! 🗜️`,
        })
        dispatch({ type: 'SET_URL', payload: '' })
      } else {
        const response = await fetch('/api/images', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            imageUrls,
            asZip: false,
          }),
        })

        if (!response.ok) {
          throw new Error('Failed to get image download URLs')
        }

        const data = await response.json()

        if (!data.success || !data.images) {
          throw new Error('Invalid response from server')
        }

        for (const imageData of data.images) {
          try {
            const imageResponse = await fetch(imageData.url)
            if (!imageResponse.ok) continue

            const blob = await imageResponse.blob()
            const blobUrl = URL.createObjectURL(blob)

            const link = document.createElement('a')
            link.href = blobUrl
            link.download = imageData.filename
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)

            URL.revokeObjectURL(blobUrl)

            await new Promise((resolve) => setTimeout(resolve, 500))
          } catch (error) {
            console.error('Failed to download individual image:', error)
          }
        }
        dispatch({
          type: 'SET_MESSAGE',
          payload: `${selectedImages.length} image(s) downloaded individually! 🖼️`,
        })
        dispatch({ type: 'SET_URL', payload: '' })
      }
    } catch (error) {
      console.error('Image download failed:', error)
      dispatch({
        type: 'SET_MESSAGE',
        payload: 'Failed to download images',
      })
    } finally {
      dispatch({ type: 'SET_DOWNLOADING_IMAGES', payload: false })
    }
  }

  const toggleImageGallery = () => {
    dispatch({ type: 'TOGGLE_IMAGE_GALLERY' })
  }

  const toggleImageSelection = (imageId: string) => {
    dispatch({ type: 'TOGGLE_IMAGE_SELECTION', payload: imageId })
  }

  const selectAllImages = (selected: boolean) => {
    dispatch({ type: 'SELECT_ALL_IMAGES', payload: selected })
  }

  const togglePreview = () => {
    dispatch({ type: 'TOGGLE_PREVIEW' })
  }

  return (
    <div ref={containerRef}>
      <div className='grid gap-6 lg:gap-8 grid-cols-1 lg:grid-cols-2'>
        {/* Input Section */}
        <div className='space-y-4 xl:col-span-1'>
          <div>
            <input
              type='text'
              placeholder='Paste a TikTok or Twitter/X URL...'
              value={state.url}
              onChange={(e) => {
                if (urlError) setUrlError(null)
                dispatch({ type: 'SET_URL', payload: e.target.value })
              }}
              aria-invalid={urlError ? 'true' : 'false'}
              aria-describedby={urlError ? 'url-error' : undefined}
              className={`w-full px-4 py-3 rounded-xl bg-white/10 border text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:border-transparent text-sm md:text-base transition-colors duration-200 ${
                urlError
                  ? 'border-red-400/60 focus:ring-red-400'
                  : 'border-white/20 focus:ring-pink-500'
              }`}
            />
            <AnimatePresence initial={false}>
              {urlError && (
                <motion.p
                  id='url-error'
                  role='alert'
                  initial={{ opacity: 0, y: -4, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -4, height: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className='mt-2 text-xs md:text-sm text-red-300 flex items-center gap-1.5 overflow-hidden'
                >
                  <span aria-hidden>⚠</span>
                  {urlError}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <motion.button
            onClick={handleProcess}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 280, damping: 24, mass: 0.6 }}
            disabled={
              state.loading ||
              state.downloading ||
              state.downloadingAudio ||
              state.downloadingImages
            }
            className='group relative w-full cursor-pointer py-3 px-4 bg-gradient-to-r from-pink-500 via-fuchsia-500 to-violet-500 bg-[length:200%_100%] bg-[position:0%_0%] hover:bg-[position:100%_0%] text-white font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-[background-position,box-shadow] duration-500 ease-out flex items-center justify-center text-sm md:text-base shadow-lg shadow-pink-500/30 hover:shadow-xl hover:shadow-violet-500/40 overflow-hidden'
          >
            <span
              className='pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-1000 ease-out'
              aria-hidden
            />
            {state.loading ? (
              <span className='relative flex items-center'>
                <SpinnerIcon className='-ml-1 mr-3 h-4 w-4 md:h-5 md:w-5 text-white' />
                Processing...
              </span>
            ) : (
              <span className='relative'>Process URL</span>
            )}
          </motion.button>

          {!state.videoMetadata && idleLeftSlot}
        </div>

        {/* Results Section */}
        <div className='results-section space-y-4'>
          {state.message && (
            <div
              className={`p-3 rounded-xl text-center transition-all duration-300 text-sm md:text-base ${
                state.message.includes('success') ||
                state.message.includes('🎉') ||
                state.message.includes('🎵')
                  ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                  : 'bg-red-500/20 text-red-300 border border-red-500/30'
              }`}
            >
              {state.message}
            </div>
          )}

          {!state.videoMetadata && !state.message && idleRightSlot}

          {state.videoMetadata && (
            <div className='p-4 bg-white/10 rounded-xl border border-white/20 space-y-4'>
              <div className='flex items-start space-x-3'>
                {state.videoMetadata.thumbnail && (
                  <img
                    src={state.videoMetadata.thumbnail}
                    alt='Video thumbnail'
                    className='w-16 h-16 md:w-20 md:h-20 rounded-lg object-cover flex-shrink-0'
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                )}
                <div className='flex-1 min-w-0'>
                  <h3 className='text-white font-medium text-sm md:text-base line-clamp-2'>
                    {state.videoMetadata.title}
                  </h3>
                  <p className='text-white/70 text-xs md:text-sm mt-1'>
                    by {state.videoMetadata.author}
                  </p>
                  {state.videoMetadata.duration > 0 && (
                    <p className='text-white/50 text-xs mt-1'>
                      {Math.floor(state.videoMetadata.duration / 60)}:
                      {(state.videoMetadata.duration % 60)
                        .toString()
                        .padStart(2, '0')}
                    </p>
                  )}
                  {state.originalUrl &&
                    (() => {
                      const platform = state.videoMetadata?.platform
                      const platformConfig = {
                        tiktok: {
                          label: 'View on TikTok',
                          Icon: TikTokIcon,
                          color: 'text-pink-400 hover:text-pink-300',
                        },
                        twitter: {
                          label: 'View on Twitter/X',
                          Icon: TwitterXIcon,
                          color: 'text-sky-400 hover:text-sky-300',
                        },
                        unknown: {
                          label: 'View Original',
                          Icon: TikTokIcon,
                          color: 'text-pink-400 hover:text-pink-300',
                        },
                      }
                      const cfg =
                        platformConfig[platform ?? 'tiktok'] ??
                        platformConfig.tiktok
                      return (
                        <a
                          href={state.originalUrl}
                          target='_blank'
                          rel='noopener noreferrer'
                          className={`inline-flex items-center gap-1 mt-2 text-xs transition-colors underline underline-offset-2 break-all ${cfg.color}`}
                        >
                          <cfg.Icon className='w-3 h-3 flex-shrink-0' />
                          {cfg.label}
                        </a>
                      )
                    })()}
                </div>
              </div>

              {/* Preview Toggle (video only) */}
              {state.downloadUrl && (
                <motion.button
                  onClick={togglePreview}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.985 }}
                  transition={{ type: 'spring', stiffness: 280, damping: 24, mass: 0.6 }}
                  className='group relative w-full cursor-pointer py-2.5 px-4 bg-gradient-to-r from-sky-500 via-blue-500 to-indigo-500 bg-[length:200%_100%] bg-[position:0%_0%] hover:bg-[position:100%_0%] text-white font-semibold rounded-xl transition-[background-position,box-shadow] duration-500 ease-out flex items-center justify-center text-sm md:text-base shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-indigo-500/40 overflow-hidden'
                >
                  <span
                    className='pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-1000 ease-out'
                    aria-hidden
                  />
                  <span className='relative'>
                    {state.showPreview ? '👁️ Hide Preview' : '👀 Show Preview'}
                  </span>
                </motion.button>
              )}

              {/* Video Preview */}
              {state.showPreview && state.downloadUrl && (
                <div className='space-y-3'>
                  <div className='bg-black rounded-xl overflow-hidden ring-1 ring-white/10 shadow-lg'>
                    <video
                      src={state.downloadUrl}
                      poster={state.videoMetadata?.thumbnail || undefined}
                      controls
                      playsInline
                      className='w-full h-auto max-h-[60vh] object-contain bg-black'
                      preload='metadata'
                      onError={(e) => {
                        console.error('Video preview error:', e)
                        dispatch({
                          type: 'SET_MESSAGE',
                          payload:
                            'Preview unavailable, but download should work',
                        })
                      }}
                    >
                      Your browser does not support the video tag.
                    </video>
                  </div>
                  <p className='text-white/50 text-xs text-center'>
                    ⚡ Preview loaded — ready to download!
                  </p>
                </div>
              )}

              {/* Photo Carousel Audio Preview */}
              {state.videoMetadata?.isPhotoCarousel && state.audioUrl && (
                <div className='space-y-3 bg-gradient-to-br from-green-500/10 to-blue-500/10 rounded-xl p-4 border border-white/10'>
                  <div className='flex items-center gap-2 text-white'>
                    <MusicIcon className='w-5 h-5 text-green-300' />
                    <div className='flex-1 min-w-0'>
                      <p className='text-sm font-semibold truncate'>
                        {state.videoMetadata.musicTitle ||
                          'Slideshow soundtrack'}
                      </p>
                      {state.videoMetadata.musicAuthor && (
                        <p className='text-xs text-white/60 truncate'>
                          by {state.videoMetadata.musicAuthor}
                        </p>
                      )}
                    </div>
                  </div>
                  <audio
                    src={state.audioUrl}
                    controls
                    preload='metadata'
                    className='w-full'
                  >
                    Your browser does not support the audio element.
                  </audio>
                </div>
              )}

              {/* Image Gallery */}
              {state.videoMetadata?.images &&
                state.videoMetadata.images.length > 0 && (
                  <div className='space-y-3'>
                    <motion.button
                      onClick={toggleImageGallery}
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.985 }}
                      transition={{ type: 'spring', stiffness: 280, damping: 24, mass: 0.6 }}
                      className='group relative w-full cursor-pointer py-2.5 px-4 bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 bg-[length:200%_100%] bg-[position:0%_0%] hover:bg-[position:100%_0%] text-white font-semibold rounded-xl transition-[background-position,box-shadow] duration-500 ease-out flex items-center justify-center text-sm md:text-base shadow-lg shadow-purple-500/25 hover:shadow-xl hover:shadow-fuchsia-500/40 overflow-hidden'
                    >
                      <span
                        className='pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-1000 ease-out'
                        aria-hidden
                      />
                      <span className='relative'>
                        {state.showImageGallery
                          ? '🖼️ Hide Images'
                          : `🖼️ Show Images (${state.videoMetadata.images.length})`}
                      </span>
                    </motion.button>

                    {state.showImageGallery && (
                      <div className='space-y-3'>
                        <div className='flex items-center justify-between bg-white/5 rounded-lg p-3'>
                          <span className='text-white text-sm'>
                            Select images to download:
                          </span>
                          <div className='flex space-x-2'>
                            <button
                              onClick={() => selectAllImages(true)}
                              className='cursor-pointer px-3 py-1 bg-emerald-500/90 hover:bg-emerald-500 text-white text-xs font-medium rounded-md transition-colors'
                            >
                              All
                            </button>
                            <button
                              onClick={() => selectAllImages(false)}
                              className='cursor-pointer px-3 py-1 bg-rose-500/90 hover:bg-rose-500 text-white text-xs font-medium rounded-md transition-colors'
                            >
                              None
                            </button>
                          </div>
                        </div>

                        <div className='grid grid-cols-2 md:grid-cols-3 gap-3'>
                          {state.videoMetadata.images.map((image, index) => (
                            <div
                              key={image.id}
                              className={`group relative rounded-lg overflow-hidden transition-all duration-200 ${
                                image.selected
                                  ? 'ring-2 ring-pink-500'
                                  : 'hover:ring-2 hover:ring-white/30'
                              }`}
                            >
                              <button
                                type='button'
                                onClick={() => setLightboxIndex(index)}
                                className='block w-full cursor-zoom-in'
                                aria-label={`Open image ${index + 1} full size`}
                              >
                                <img
                                  src={image.thumbnail}
                                  alt={`Slideshow image ${index + 1}`}
                                  className='w-full h-24 md:h-32 object-cover transition-transform duration-200 group-hover:scale-105'
                                  loading='lazy'
                                  onError={(e) => {
                                    e.currentTarget.src =
                                      getImagePlaceholderBase64()
                                  }}
                                />
                              </button>

                              <button
                                type='button'
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleImageSelection(image.id)
                                }}
                                aria-pressed={image.selected}
                                aria-label={
                                  image.selected
                                    ? `Deselect image ${index + 1}`
                                    : `Select image ${index + 1}`
                                }
                                className={`absolute top-1 right-1 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all duration-200 backdrop-blur-sm ${
                                  image.selected
                                    ? 'bg-pink-500 border-pink-500'
                                    : 'bg-black/40 border-white/50 hover:border-white hover:bg-black/60'
                                }`}
                              >
                                {image.selected && (
                                  <CheckIcon className='w-4 h-4 text-white' />
                                )}
                              </button>

                              <div className='absolute top-1 left-1 bg-black/60 text-white text-xs font-medium px-2 py-0.5 rounded'>
                                {index + 1}
                              </div>

                              <div className='pointer-events-none absolute bottom-1 left-1 right-1 text-[10px] text-white/80 bg-black/40 rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-center'>
                                Click to preview
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className='bg-white/5 rounded-lg p-3 space-y-3'>
                          <div className='flex items-center space-x-3'>
                            <input
                              type='checkbox'
                              id='downloadAsZip'
                              checked={state.downloadImagesAsZip}
                              onChange={(e) =>
                                dispatch({
                                  type: 'SET_DOWNLOAD_IMAGES_AS_ZIP',
                                  payload: e.target.checked,
                                })
                              }
                              className='w-4 h-4 text-pink-500 bg-white/10 border-white/30 rounded focus:ring-pink-500 focus:ring-2'
                            />
                            <label
                              htmlFor='downloadAsZip'
                              className='text-white text-sm cursor-pointer'
                            >
                              Download as ZIP file
                            </label>
                          </div>
                          <p className='text-white/60 text-xs'>
                            {state.downloadImagesAsZip
                              ? '🗜️ Images will be packaged into a single ZIP file'
                              : '📸 Images will be downloaded individually'}
                          </p>
                        </div>

                        <button
                          onClick={handleImageDownload}
                          disabled={
                            state.downloadingImages ||
                            !state.videoMetadata?.images?.some(
                              (img) => img.selected,
                            )
                          }
                          className='w-full cursor-pointer py-3 px-4 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all duration-200 flex items-center justify-center text-sm md:text-base gap-2'
                        >
                          {state.downloadingImages ? (
                            <>
                              <SpinnerIcon className='flex-shrink-0 h-4 w-4 text-white' />
                              <span>Downloading...</span>
                            </>
                          ) : (
                            <>
                              <DownloadIcon className='flex-shrink-0 h-5 w-5 text-white' />
                              <span>
                                Download Selected (
                                {state.videoMetadata?.images?.filter(
                                  (img) => img.selected,
                                ).length || 0}
                                )
                              </span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}

              {/* Download Buttons */}
              {(() => {
                const hasImagesForSlideshow =
                  state.videoMetadata?.isPhotoCarousel &&
                  (state.videoMetadata?.images?.length ?? 0) > 0
                const showVideoButton =
                  !!state.downloadUrl || hasImagesForSlideshow
                const showAudioButton = !!state.audioUrl
                if (!showVideoButton && !showAudioButton) return null
                return (
                  <div
                    className={`grid gap-3 ${
                      showVideoButton && showAudioButton
                        ? 'grid-cols-1 md:grid-cols-2'
                        : 'grid-cols-1'
                    }`}
                  >
                    {showVideoButton && (
                      <motion.button
                        onClick={
                          state.downloadUrl
                            ? handleVideoDownload
                            : handleSlideshowRender
                        }
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.985 }}
                        transition={{ type: 'spring', stiffness: 280, damping: 24, mass: 0.6 }}
                        disabled={
                          state.downloading || state.downloadingImages
                        }
                        className='group relative py-3 cursor-pointer px-4 bg-gradient-to-r from-pink-500 via-fuchsia-500 to-violet-500 bg-[length:200%_100%] bg-[position:0%_0%] hover:bg-[position:100%_0%] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-[background-position,box-shadow] duration-500 ease-out flex items-center justify-center text-sm md:text-base gap-2 shadow-lg shadow-pink-500/25 hover:shadow-xl hover:shadow-violet-500/40 overflow-hidden'
                      >
                        <span
                          className='pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-1000 ease-out'
                          aria-hidden
                        />
                        {state.downloading ? (
                          <span className='relative flex items-center gap-2'>
                            <SpinnerIcon className='flex-shrink-0 h-4 w-4 text-white' />
                            <span>
                              {state.videoMetadata?.isPhotoCarousel &&
                              !state.downloadUrl
                                ? 'Rendering...'
                                : 'Downloading...'}
                            </span>
                          </span>
                        ) : (
                          <span className='relative flex items-center gap-2'>
                            <DownloadIcon className='flex-shrink-0 h-5 w-5 text-white' />
                            <span>
                              {state.videoMetadata?.isPhotoCarousel
                                ? 'Video (slideshow)'
                                : 'Video'}
                            </span>
                          </span>
                        )}
                      </motion.button>
                    )}

                    {showAudioButton && (
                      <motion.button
                        onClick={handleAudioDownload}
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.985 }}
                        transition={{ type: 'spring', stiffness: 280, damping: 24, mass: 0.6 }}
                        disabled={
                          state.downloadingAudio || state.downloadingImages
                        }
                        className='group relative py-3 cursor-pointer px-4 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 bg-[length:200%_100%] bg-[position:0%_0%] hover:bg-[position:100%_0%] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-[background-position,box-shadow] duration-500 ease-out flex items-center justify-center text-sm md:text-base gap-2 shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-cyan-500/40 overflow-hidden'
                      >
                        <span
                          className='pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-1000 ease-out'
                          aria-hidden
                        />
                        {state.downloadingAudio ? (
                          <span className='relative flex items-center gap-2'>
                            <SpinnerIcon className='flex-shrink-0 h-4 w-4 text-white' />
                            <span>Downloading...</span>
                          </span>
                        ) : (
                          <span className='relative flex items-center gap-2'>
                            <MusicIcon className='flex-shrink-0 h-5 w-5 text-white' />
                            <span>
                              {state.videoMetadata?.isPhotoCarousel
                                ? 'Download Audio'
                                : 'Extract Audio'}
                            </span>
                          </span>
                        )}
                      </motion.button>
                    )}
                  </div>
                )
              })()}

              {(state.downloadUrl || state.audioUrl) && (
                <p className='text-white/50 text-xs text-center'>
                  {state.downloading ||
                  state.downloadingAudio ||
                  state.downloadingImages
                    ? 'Please wait while we prepare your download...'
                    : 'Click to download your content'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {lightboxIndex !== null && state.videoMetadata?.images && (
        <ImageLightbox
          images={state.videoMetadata.images}
          activeIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onPrev={() =>
            setLightboxIndex((i) => {
              const total = state.videoMetadata?.images?.length ?? 0
              if (i === null || total === 0) return i
              return (i - 1 + total) % total
            })
          }
          onNext={() =>
            setLightboxIndex((i) => {
              const total = state.videoMetadata?.images?.length ?? 0
              if (i === null || total === 0) return i
              return (i + 1) % total
            })
          }
        />
      )}
    </div>
  )
}
