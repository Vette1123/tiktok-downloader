'use client'

import { useReducer, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { appReducer, initialState } from '@/lib/appReducer'
import {
  TikTokIcon,
  TwitterXIcon,
  PortfolioIcon,
  GitHubIcon,
  SpinnerIcon,
  DownloadIcon,
  MusicIcon,
  CheckIcon,
  getImagePlaceholderBase64,
} from '@/components/icons'
import { ImageLightbox } from '@/components/ImageLightbox'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'

export default function Home() {
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

        // Clear the input after successful processing
        dispatch({ type: 'SET_URL', payload: '' })

        // Scroll to results section after successful processing
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
      // Clear the input after successful download
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
      // Clear the input after successful download
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

      // Only create ZIP if user explicitly chose it
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
        // Clear the input after successful download
        dispatch({ type: 'SET_URL', payload: '' })
      } else {
        // Always download images individually (regardless of count)
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

        // Download each image individually
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

            // Small delay between downloads
            await new Promise((resolve) => setTimeout(resolve, 500))
          } catch (error) {
            console.error('Failed to download individual image:', error)
          }
        }
        dispatch({
          type: 'SET_MESSAGE',
          payload: `${selectedImages.length} image(s) downloaded individually! 🖼️`,
        })
        // Clear the input after successful download
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
    <div className='relative min-h-screen overflow-clip bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex justify-center items-start py-6 px-4'>
      <motion.div
        aria-hidden
        className='pointer-events-none absolute -top-32 -left-32 h-[28rem] w-[28rem] rounded-full bg-pink-500/30 blur-3xl'
        animate={{ x: [0, 60, -20, 0], y: [0, 40, -30, 0], scale: [1, 1.1, 0.95, 1] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        aria-hidden
        className='pointer-events-none absolute -bottom-40 -right-32 h-[32rem] w-[32rem] rounded-full bg-cyan-400/25 blur-3xl'
        animate={{ x: [0, -50, 30, 0], y: [0, -40, 20, 0], scale: [1, 1.08, 0.97, 1] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        aria-hidden
        className='pointer-events-none absolute top-1/3 left-1/2 h-[24rem] w-[24rem] -translate-x-1/2 rounded-full bg-violet-500/20 blur-3xl'
        animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className='relative z-10 my-auto w-full max-w-sm md:max-w-2xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl bg-white/10 backdrop-blur-lg rounded-2xl p-4 md:p-8 shadow-2xl border border-white/20'
      >
        {' '}
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: 'easeOut' }}
          className='text-center mb-6 md:mb-8'
        >
          {' '}
          <div className='flex justify-center mb-4'>
            <div className='flex items-center space-x-3'>
              <div className='w-10 h-10 md:w-12 md:h-12 bg-[#010101] rounded-full flex items-center justify-center ring-2 ring-white/20'>
                <TikTokIcon className='w-5 h-5 md:w-6 md:h-6 text-white' />
              </div>
              <div className='w-10 h-10 md:w-12 md:h-12 bg-black rounded-full flex items-center justify-center ring-2 ring-white/20'>
                <TwitterXIcon className='w-5 h-5 md:w-6 md:h-6 text-white' />
              </div>
            </div>
          </div>
          <h1 className='text-2xl md:text-3xl lg:text-4xl font-bold text-white mb-2'>
            Social Media Downloader
          </h1>{' '}
          <p className='text-sm md:text-base text-white/70 mb-4'>
            Download videos without watermarks, extract MP3 audio, or save
            images from TikTok &amp; Twitter/X
          </p>
          {/* Developer Links */}
          <motion.div
            className='flex justify-center items-center gap-3'
            initial='hidden'
            animate='show'
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.1, delayChildren: 0.3 } },
            }}
          >
            {[
              {
                href: 'https://www.mohamedgado.com/',
                label: 'Portfolio',
                Icon: PortfolioIcon,
                grad: 'from-pink-500/80 to-violet-500/80',
              },
              {
                href: 'https://github.com/Vette1123/tiktok-downloader',
                label: 'GitHub',
                Icon: GitHubIcon,
                grad: 'from-violet-500/80 to-cyan-400/80',
              },
            ].map(({ href, label, Icon, grad }) => (
              <motion.a
                key={label}
                href={href}
                target='_blank'
                rel='noopener noreferrer'
                variants={{
                  hidden: { opacity: 0, y: 10 },
                  show: { opacity: 1, y: 0 },
                }}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                className='group relative flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/15 overflow-hidden backdrop-blur-sm'
              >
                <span
                  className={`absolute inset-0 bg-gradient-to-r ${grad} opacity-0 group-hover:opacity-100 transition-opacity duration-300`}
                  aria-hidden
                />
                <span className='pointer-events-none absolute inset-0 rounded-xl ring-1 ring-white/10 group-hover:ring-white/30 transition-all duration-300' aria-hidden />
                <Icon className='relative w-4 h-4 text-white/80 group-hover:text-white transition-colors duration-300' />
                <span className='relative text-white/80 group-hover:text-white text-sm font-medium transition-colors duration-300'>
                  {label}
                </span>
              </motion.a>
            ))}
          </motion.div>
        </motion.div>{' '}
        <div className='grid gap-6 lg:gap-8 grid-cols-1 lg:grid-cols-2'>
          {' '}
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
            {/* Download Type Selection */}
            {/* <div className='flex space-x-2'>
              <button
                onClick={() =>
                  dispatch({ type: 'SET_DOWNLOAD_TYPE', payload: 'video' })
                }
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all duration-200 text-sm md:text-base ${
                  state.downloadType === 'video'
                    ? 'bg-gradient-to-r from-pink-500 to-violet-500 text-white'
                    : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                📹 Video
              </button>
              <button
                onClick={() =>
                  dispatch({ type: 'SET_DOWNLOAD_TYPE', payload: 'audio' })
                }
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all duration-200 text-sm md:text-base ${
                  state.downloadType === 'audio'
                    ? 'bg-gradient-to-r from-green-500 to-blue-500 text-white'
                    : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                🎵 MP3
              </button>
            </div>{' '} */}
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
            </motion.button>{' '}
            {/* How it Works - lives on the left, replaces the old Features list */}
            {!state.videoMetadata && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15, ease: 'easeOut' }}
                className='bg-white/5 rounded-xl p-5 border border-white/10'
              >
                <h3 className='text-white font-semibold mb-4 text-sm md:text-base flex items-center'>
                  🚀 How it works
                  <div className='ml-2 w-8 h-0.5 bg-gradient-to-r from-pink-500 to-violet-500 rounded' />
                </h3>
                <ol className='space-y-3'>
                  {[
                    {
                      n: 1,
                      title: 'Copy a video URL',
                      sub: 'From TikTok or Twitter/X',
                      grad: 'from-pink-500 to-pink-400',
                    },
                    {
                      n: 2,
                      title: 'Paste & process',
                      sub: 'We resolve the media in seconds',
                      grad: 'from-fuchsia-500 to-violet-500',
                    },
                    {
                      n: 3,
                      title: 'Download',
                      sub: 'Video, MP3, or full image gallery',
                      grad: 'from-violet-500 to-cyan-400',
                    },
                  ].map((s) => (
                    <li
                      key={s.n}
                      className='flex items-start gap-3 group'
                    >
                      <div
                        className={`shrink-0 w-7 h-7 rounded-full bg-gradient-to-br ${s.grad} flex items-center justify-center text-white text-xs font-bold shadow-md ring-1 ring-white/20`}
                      >
                        {s.n}
                      </div>
                      <div className='min-w-0'>
                        <p className='text-white text-sm font-medium leading-tight'>
                          {s.title}
                        </p>
                        <p className='text-white/55 text-xs mt-0.5'>{s.sub}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </motion.div>
            )}
          </div>{' '}
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
            {!state.videoMetadata && !state.message && (
              <motion.div
                className='space-y-4'
                initial='hidden'
                animate='show'
                variants={{
                  hidden: {},
                  show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
                }}
              >
                {/* What you can do — 2x2 bento grid */}
                <motion.div
                  variants={{
                    hidden: { opacity: 0, y: 16 },
                    show: { opacity: 1, y: 0 },
                  }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className='bg-white/5 rounded-xl p-5 border border-white/10'
                >
                  <h3 className='text-white font-semibold mb-4 text-sm md:text-base flex items-center'>
                    ✨ What you can do
                    <div className='ml-2 w-8 h-0.5 bg-gradient-to-r from-pink-500 to-violet-500 rounded' />
                  </h3>
                  <div className='grid grid-cols-2 gap-3'>
                    {[
                      {
                        emoji: '🎬',
                        label: 'HD Video',
                        sub: 'No watermark',
                        grad: 'from-pink-500/20 to-rose-500/10',
                        ring: 'ring-pink-500/30',
                      },
                      {
                        emoji: '🎵',
                        label: 'MP3 audio',
                        sub: 'Extract soundtrack',
                        grad: 'from-emerald-500/20 to-teal-500/10',
                        ring: 'ring-emerald-500/30',
                      },
                      {
                        emoji: '🖼️',
                        label: 'Slideshow',
                        sub: 'Image carousels',
                        grad: 'from-violet-500/20 to-fuchsia-500/10',
                        ring: 'ring-violet-500/30',
                      },
                      {
                        emoji: '🗜️',
                        label: 'Batch ZIP',
                        sub: 'All images at once',
                        grad: 'from-sky-500/20 to-cyan-500/10',
                        ring: 'ring-cyan-500/30',
                      },
                    ].map((t) => (
                      <motion.div
                        key={t.label}
                        whileHover={{ y: -2 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                        className={`bg-gradient-to-br ${t.grad} rounded-lg p-3 ring-1 ${t.ring} border border-white/5`}
                      >
                        <div className='text-2xl mb-1.5 leading-none'>{t.emoji}</div>
                        <p className='text-white text-sm font-semibold leading-tight'>
                          {t.label}
                        </p>
                        <p className='text-white/55 text-xs mt-0.5'>{t.sub}</p>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>

                {/* Supported link formats */}
                <motion.div
                  variants={{
                    hidden: { opacity: 0, y: 16 },
                    show: { opacity: 1, y: 0 },
                  }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className='bg-white/5 rounded-xl p-5 border border-white/10'
                >
                  <h3 className='text-white font-semibold mb-3 text-sm md:text-base flex items-center'>
                    🔗 Supported link formats
                    <div className='ml-2 w-8 h-0.5 bg-gradient-to-r from-cyan-400 to-sky-500 rounded' />
                  </h3>
                  <ul className='grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] md:text-xs text-white/65 font-mono'>
                    <li className='truncate'>tiktok.com/@user/video/…</li>
                    <li className='truncate'>vm.tiktok.com/…</li>
                    <li className='truncate'>vt.tiktok.com/…</li>
                    <li className='truncate'>twitter.com/user/status/…</li>
                    <li className='truncate'>x.com/user/status/…</li>
                  </ul>
                </motion.div>

                {/* Trust strip */}
                <motion.div
                  variants={{
                    hidden: { opacity: 0, y: 16 },
                    show: { opacity: 1, y: 0 },
                  }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className='grid grid-cols-3 gap-2'
                >
                  {[
                    { k: 'Free', v: 'forever', accent: 'text-emerald-300' },
                    { k: 'No login', v: 'required', accent: 'text-sky-300' },
                    { k: 'No limit', v: 'on downloads', accent: 'text-pink-300' },
                  ].map((b) => (
                    <div
                      key={b.k}
                      className='bg-white/5 rounded-lg p-3 border border-white/10 text-center'
                    >
                      <p className={`text-sm font-semibold ${b.accent}`}>
                        {b.k}
                      </p>
                      <p className='text-white/50 text-[10px] md:text-xs mt-0.5'>
                        {b.v}
                      </p>
                    </div>
                  ))}
                </motion.div>
              </motion.div>
            )}
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
                )}{' '}
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
                          {/* Select All Controls */}
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

                          {/* Image Grid */}
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

                                {/* Selection Toggle (separate from preview) */}
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

                                {/* Image Number */}
                                <div className='absolute top-1 left-1 bg-black/60 text-white text-xs font-medium px-2 py-0.5 rounded'>
                                  {index + 1}
                                </div>

                                {/* Hover hint */}
                                <div className='pointer-events-none absolute bottom-1 left-1 right-1 text-[10px] text-white/80 bg-black/40 rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-center'>
                                  Click to preview
                                </div>
                              </div>
                            ))}{' '}
                          </div>

                          {/* Download Options */}
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

                          {/* Download Selected Images Button */}
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
                            {' '}
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
                  )}{' '}
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
                          />{' '}
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
                          />{' '}
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
            )}{' '}
          </div>
        </div>{' '}
        {/* Features List - Mobile only, shown at bottom */}
        <div className='lg:hidden bg-white/5 rounded-xl p-4 mt-6 border border-white/10'>
          <h3 className='text-white font-semibold mb-4 text-sm md:text-base flex items-center'>
            ✨ Features
            <div className='ml-2 w-8 h-0.5 bg-gradient-to-r from-pink-500 to-violet-500 rounded'></div>
          </h3>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-3 text-xs md:text-sm'>
            <div className='flex items-center space-x-2 text-white/70'>
              <div className='w-2 h-2 bg-green-400 rounded-full'></div>
              <span>Watermark-free downloads</span>
            </div>
            <div className='flex items-center space-x-2 text-white/70'>
              <div className='w-2 h-2 bg-blue-400 rounded-full'></div>
              <span>HD quality preservation</span>
            </div>
            <div className='flex items-center space-x-2 text-white/70'>
              <div className='w-2 h-2 bg-purple-400 rounded-full'></div>
              <span>MP3 audio extraction</span>
            </div>
            <div className='flex items-center space-x-2 text-white/70'>
              <div className='w-2 h-2 bg-pink-400 rounded-full'></div>
              <span>Video preview</span>
            </div>
            <div className='flex items-center space-x-2 text-white/70'>
              <div className='w-2 h-2 bg-yellow-400 rounded-full'></div>
              <span>Image gallery downloads</span>
            </div>
            <div className='flex items-center space-x-2 text-white/70'>
              <div className='w-2 h-2 bg-indigo-400 rounded-full'></div>
              <span>Multiple URL formats</span>
            </div>
            <div className='flex items-center space-x-2 text-white/70'>
              <div className='w-2 h-2 bg-teal-400 rounded-full'></div>
              <span>Batch image selection</span>
            </div>
            <div className='flex items-center space-x-2 text-white/70'>
              <div className='w-2 h-2 bg-orange-400 rounded-full'></div>
              <span>Fast processing</span>
            </div>
          </div>
        </div>
        {/* SEO Content: how-to + FAQ (mirrors JSON-LD FAQ schema) */}
        <motion.section
          aria-labelledby='seo-heading'
          className='mt-10 space-y-6 text-white/80'
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        >
          <div>
            <h2
              id='seo-heading'
              className='text-xl md:text-2xl font-bold text-white mb-3'
            >
              Free TikTok &amp; Twitter/X Video Downloader
            </h2>
            <p className='text-sm md:text-base leading-relaxed'>
              Save any TikTok or Twitter/X post in a couple of clicks. Paste the
              link, preview the content, and download the full-quality video,
              the original MP3 soundtrack, or every image from a TikTok photo
              carousel. Everything happens in your browser — no app, no sign-up,
              no watermark.
            </p>
          </div>

          <motion.div
            className='grid md:grid-cols-3 gap-4'
            initial='hidden'
            whileInView='show'
            viewport={{ once: true, margin: '-60px' }}
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.12 } },
            }}
          >
            {[
              {
                title: '🎬 Videos in HD',
                body: 'Watermark-free TikTok downloads and native Twitter/X video rips, served with proper range requests so preview and seeking work flawlessly.',
              },
              {
                title: '🎵 MP3 audio extraction',
                body: 'Pull the soundtrack from any TikTok video or slideshow. Photo carousels keep the original background music — perfect for trending sounds.',
              },
              {
                title: '🖼️ Photo carousels',
                body: 'TikTok slideshows come through as a full-resolution gallery. Preview, pick favorites, then save individually or as a single ZIP.',
              },
            ].map((card) => (
              <motion.article
                key={card.title}
                variants={{
                  hidden: { opacity: 0, y: 24 },
                  show: { opacity: 1, y: 0 },
                }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                whileHover={{ y: -4, scale: 1.02 }}
                className='bg-white/5 rounded-xl p-4 border border-white/10 hover:border-white/30 transition-colors'
              >
                <h3 className='text-white font-semibold mb-2'>{card.title}</h3>
                <p className='text-sm'>{card.body}</p>
              </motion.article>
            ))}
          </motion.div>

          <div>
            <h2 className='text-xl md:text-2xl font-bold text-white mb-3'>
              Frequently asked questions
            </h2>
            <Accordion
              type='single'
              collapsible
              defaultValue='faq-1'
              className='space-y-3'
            >
              <AccordionItem value='faq-1'>
                <AccordionTrigger>
                  Is this TikTok downloader free?
                </AccordionTrigger>
                <AccordionContent>
                  Yes — completely free, with no sign-up and no daily download
                  limit.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value='faq-2'>
                <AccordionTrigger>
                  Do downloaded TikTok videos have a watermark?
                </AccordionTrigger>
                <AccordionContent>
                  No. Videos are saved in HD quality, free of the TikTok
                  watermark.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value='faq-3'>
                <AccordionTrigger>
                  Can I download a TikTok photo carousel (slideshow)?
                </AccordionTrigger>
                <AccordionContent>
                  Paste the slideshow URL. The app lists every image, the
                  background track, and — when TikTok provides one — the full
                  rendered slideshow video, so you can grab the photos, the MP3,
                  or the MP4 in a single flow.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value='faq-4'>
                <AccordionTrigger>Does it work on Twitter/X?</AccordionTrigger>
                <AccordionContent>
                  Yes — paste any twitter.com or x.com status URL and the tool
                  resolves the underlying media automatically.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </motion.section>
      </motion.div>

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
