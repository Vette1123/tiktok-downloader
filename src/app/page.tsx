'use client'

import { useReducer, useRef } from 'react'
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

export default function Home() {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleProcess = async () => {
    if (!state.url.trim()) {
      dispatch({ type: 'SET_MESSAGE', payload: 'Please enter a URL' })
      return
    }

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
    <div className='min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4'>
      <div
        ref={containerRef}
        className='w-full max-w-sm md:max-w-2xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl bg-white/10 backdrop-blur-lg rounded-2xl p-4 md:p-8 shadow-2xl border border-white/20'
      >
        {' '}
        {/* Header */}
        <div className='text-center mb-6 md:mb-8'>
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
          <div className='flex justify-center items-center space-x-4'>
            {' '}
            <a
              href='https://www.mohamedgado.com/'
              target='_blank'
              rel='noopener noreferrer'
              className='group flex items-center space-x-2 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-all duration-200 border border-white/20 hover:border-white/40'
            >
              <PortfolioIcon className='w-4 h-4 text-white/70 group-hover:text-white transition-colors' />
              <span className='text-white/70 group-hover:text-white text-sm font-medium transition-colors'>
                Portfolio
              </span>
            </a>{' '}
            <a
              href='https://github.com/Vette1123/tiktok-downloader'
              target='_blank'
              rel='noopener noreferrer'
              className='group flex items-center space-x-2 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-all duration-200 border border-white/20 hover:border-white/40'
            >
              <GitHubIcon className='w-4 h-4 text-white/70 group-hover:text-white transition-colors' />
              <span className='text-white/70 group-hover:text-white text-sm font-medium transition-colors'>
                GitHub
              </span>
            </a>
          </div>
        </div>{' '}
        <div
          className={`grid gap-6 lg:gap-8 transition-all duration-300 ${
            state.videoMetadata && !state.showPreview && !state.showImageGallery
              ? 'grid-cols-1 xl:grid-cols-3'
              : 'grid-cols-1 lg:grid-cols-2'
          }`}
        >
          {' '}
          {/* Input Section */}
          <div className='space-y-4 xl:col-span-1'>
            <div>
              <input
                type='text'
                placeholder='Paste a TikTok or Twitter/X URL...'
                value={state.url}
                onChange={(e) =>
                  dispatch({ type: 'SET_URL', payload: e.target.value })
                }
                className='w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm md:text-base'
              />
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
            <button
              onClick={handleProcess}
              disabled={
                state.loading ||
                state.downloading ||
                state.downloadingAudio ||
                state.downloadingImages
              }
              className='w-full cursor-pointer py-3 px-4 bg-gradient-to-r from-pink-500 to-violet-500 text-white font-semibold rounded-xl hover:from-pink-600 hover:to-violet-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center text-sm md:text-base'
            >
              {' '}
              {state.loading ? (
                <>
                  <SpinnerIcon className='-ml-1 mr-3 h-4 w-4 md:h-5 md:w-5 text-white' />
                  Processing...
                </>
              ) : (
                <>Process URL</>
              )}
            </button>{' '}
            {/* Features List - Hidden on mobile, shown on desktop */}
            <div className='hidden lg:block bg-white/5 rounded-xl p-4 mt-6 border border-white/10'>
              <h3 className='text-white font-semibold mb-4 text-sm md:text-base flex items-center'>
                ✨ Features
                <div className='ml-2 w-8 h-0.5 bg-gradient-to-r from-pink-500 to-violet-500 rounded'></div>
              </h3>
              <div className='grid grid-cols-1 xl:grid-cols-2 gap-3 text-xs md:text-sm'>
                <div className='flex items-center space-x-2 text-white/70 hover:text-white/90 transition-colors'>
                  <div className='w-2 h-2 bg-green-400 rounded-full'></div>
                  <span>Watermark-free downloads</span>
                </div>
                <div className='flex items-center space-x-2 text-white/70 hover:text-white/90 transition-colors'>
                  <div className='w-2 h-2 bg-blue-400 rounded-full'></div>
                  <span>HD quality preservation</span>
                </div>
                <div className='flex items-center space-x-2 text-white/70 hover:text-white/90 transition-colors'>
                  <div className='w-2 h-2 bg-purple-400 rounded-full'></div>
                  <span>MP3 audio extraction</span>
                </div>
                <div className='flex items-center space-x-2 text-white/70 hover:text-white/90 transition-colors'>
                  <div className='w-2 h-2 bg-pink-400 rounded-full'></div>
                  <span>Video preview</span>
                </div>
                <div className='flex items-center space-x-2 text-white/70 hover:text-white/90 transition-colors'>
                  <div className='w-2 h-2 bg-yellow-400 rounded-full'></div>
                  <span>Image gallery downloads</span>
                </div>
                <div className='flex items-center space-x-2 text-white/70 hover:text-white/90 transition-colors'>
                  <div className='w-2 h-2 bg-indigo-400 rounded-full'></div>
                  <span>Multiple URL formats</span>
                </div>
                <div className='flex items-center space-x-2 text-white/70 hover:text-white/90 transition-colors'>
                  <div className='w-2 h-2 bg-teal-400 rounded-full'></div>
                  <span>Batch image selection</span>
                </div>
                <div className='flex items-center space-x-2 text-white/70 hover:text-white/90 transition-colors'>
                  <div className='w-2 h-2 bg-orange-400 rounded-full'></div>
                  <span>Fast processing</span>
                </div>
              </div>
            </div>
          </div>{' '}
          {/* Results Section */}
          <div
            className={`results-section space-y-4 ${
              state.videoMetadata &&
              !state.showPreview &&
              !state.showImageGallery
                ? 'xl:col-span-2'
                : ''
            }`}
          >
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
              <div className='space-y-4'>
                {/* Getting Started Card */}
                <div className='bg-gradient-to-br from-white/5 to-white/10 rounded-xl p-6 border border-white/20'>
                  <div className='text-center'>
                    <div className='w-16 h-16 bg-gradient-to-r from-pink-500/20 to-violet-500/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-pink-500/30'>
                      <TikTokIcon className='w-8 h-8 text-pink-400' />
                    </div>
                    <h3 className='text-white font-semibold text-lg mb-2'>
                      Ready to Download?
                    </h3>
                    <p className='text-white/70 text-sm mb-4'>
                      Paste a TikTok or Twitter/X URL above to get started!
                    </p>
                  </div>
                </div>

                {/* How it Works */}
                <div className='bg-white/5 rounded-xl p-6 border border-white/10'>
                  <h3 className='text-white font-semibold mb-4 flex items-center'>
                    🚀 How it Works
                    <div className='ml-2 w-8 h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded'></div>
                  </h3>
                  <div className='space-y-3'>
                    <div className='flex items-start space-x-3'>
                      <div className='w-6 h-6 bg-pink-500 rounded-full flex items-center justify-center text-white text-xs font-bold mt-0.5'>
                        1
                      </div>
                      <div>
                        <p className='text-white text-sm font-medium'>
                          Copy a Video URL
                        </p>
                        <p className='text-white/60 text-xs'>
                          From TikTok or Twitter/X
                        </p>
                      </div>
                    </div>
                    <div className='flex items-start space-x-3'>
                      <div className='w-6 h-6 bg-violet-500 rounded-full flex items-center justify-center text-white text-xs font-bold mt-0.5'>
                        2
                      </div>
                      <div>
                        <p className='text-white text-sm font-medium'>
                          Paste & Process
                        </p>
                        <p className='text-white/60 text-xs'>
                          Our servers analyze the content
                        </p>
                      </div>
                    </div>
                    <div className='flex items-start space-x-3'>
                      <div className='w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold mt-0.5'>
                        3
                      </div>
                      <div>
                        <p className='text-white text-sm font-medium'>
                          Download Content
                        </p>
                        <p className='text-white/60 text-xs'>
                          Video, audio, or images - your choice!
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Supported Formats */}
                <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                  <div className='bg-white/5 rounded-xl p-4 border border-white/10'>
                    <h4 className='text-white font-medium mb-3 flex items-center'>
                      📱 Supported Links
                    </h4>
                    <div className='space-y-2 text-xs text-white/70'>
                      <p>• https://www.tiktok.com/@user/video/...</p>
                      <p>• https://vm.tiktok.com/...</p>
                      <p>• https://vt.tiktok.com/...</p>
                      <p>• https://twitter.com/user/status/...</p>
                      <p>• https://x.com/user/status/...</p>
                    </div>
                  </div>
                  <div className='bg-white/5 rounded-xl p-4 border border-white/10'>
                    <h4 className='text-white font-medium mb-3 flex items-center'>
                      📊 Download Options
                    </h4>
                    <div className='space-y-2 text-xs text-white/70'>
                      <p>• HD Video (no watermark)</p>
                      <p>• MP3 Audio extraction</p>
                      <p>• Image galleries (ZIP/Individual)</p>
                      <p>• Preview before download</p>
                    </div>
                  </div>
                </div>
              </div>
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
                {/* Preview Toggle */}
                {state.downloadUrl && (
                  <button
                    onClick={togglePreview}
                    className='w-full py-2 px-4 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors duration-200 flex items-center justify-center text-sm md:text-base'
                  >
                    {state.showPreview ? '👁️ Hide Preview' : '👀 Show Preview'}
                  </button>
                )}{' '}
                {/* Video Preview */}
                {state.showPreview && state.downloadUrl && (
                  <div className='space-y-3'>
                    <div className='bg-black/50 rounded-lg overflow-hidden'>
                      <video
                        src={state.downloadUrl}
                        controls
                        className='w-full h-auto max-h-48 md:max-h-64 object-contain'
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
                      ⚡ Preview loaded - ready to download!
                    </p>
                  </div>
                )}
                {/* Image Gallery */}
                {state.videoMetadata?.images &&
                  state.videoMetadata.images.length > 0 && (
                    <div className='space-y-3'>
                      <button
                        onClick={toggleImageGallery}
                        className='w-full py-2 px-4 bg-purple-500 hover:bg-purple-600 text-white font-semibold rounded-lg transition-colors duration-200 flex items-center justify-center text-sm md:text-base'
                      >
                        {state.showImageGallery
                          ? '🖼️ Hide Images'
                          : `🖼️ Show Images (${state.videoMetadata.images.length})`}
                      </button>

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
                                className='px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-xs rounded'
                              >
                                All
                              </button>
                              <button
                                onClick={() => selectAllImages(false)}
                                className='px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded'
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
                                className={`relative rounded-lg overflow-hidden cursor-pointer transition-all duration-200 ${
                                  image.selected
                                    ? 'ring-2 ring-pink-500'
                                    : 'hover:ring-2 hover:ring-white/30'
                                }`}
                                onClick={() => toggleImageSelection(image.id)}
                              >
                                <img
                                  src={image.thumbnail}
                                  alt={`TikTok image ${index + 1}`}
                                  className='w-full h-24 md:h-32 object-cover'
                                  onError={(e) => {
                                    e.currentTarget.src =
                                      getImagePlaceholderBase64()
                                  }}
                                />

                                {/* Selection Overlay */}
                                <div
                                  className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
                                    image.selected
                                      ? 'bg-pink-500/20'
                                      : 'bg-black/0 hover:bg-black/20'
                                  }`}
                                >
                                  <div
                                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                                      image.selected
                                        ? 'bg-pink-500 border-pink-500'
                                        : 'border-white/50 hover:border-white'
                                    }`}
                                  >
                                    {' '}
                                    {image.selected && (
                                      <CheckIcon className='w-4 h-4 text-white' />
                                    )}
                                  </div>
                                </div>

                                {/* Image Number */}
                                <div className='absolute top-1 left-1 bg-black/50 text-white text-xs px-2 py-1 rounded'>
                                  {index + 1}
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
                {(state.downloadUrl || state.audioUrl) && (
                  <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
                    {state.downloadUrl && (
                      <button
                        onClick={handleVideoDownload}
                        disabled={state.downloading || state.downloadingImages}
                        className='py-3 cursor-pointer px-4 bg-gradient-to-r from-pink-500 to-violet-500 hover:from-pink-600 hover:to-violet-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all duration-200 flex items-center justify-center text-sm md:text-base gap-2'
                      >
                        {' '}
                        {state.downloading ? (
                          <>
                            <SpinnerIcon className='flex-shrink-0 h-4 w-4 text-white' />
                            <span>Downloading...</span>
                          </>
                        ) : (
                          <>
                            <DownloadIcon className='flex-shrink-0 h-5 w-5 text-white' />
                            <span>Video</span>
                          </>
                        )}
                      </button>
                    )}

                    {state.audioUrl && (
                      <button
                        onClick={handleAudioDownload}
                        disabled={
                          state.downloadingAudio || state.downloadingImages
                        }
                        className='py-3 cursor-pointer px-4 bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all duration-200 flex items-center justify-center text-sm md:text-base gap-2'
                      >
                        {' '}
                        {state.downloadingAudio ? (
                          <>
                            <SpinnerIcon className='flex-shrink-0 h-4 w-4 text-white' />
                            <span>Extracting...</span>
                          </>
                        ) : (
                          <>
                            <MusicIcon className='flex-shrink-0 h-5 w-5 text-white' />
                            <span>Extract Audio</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}
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
      </div>
    </div>
  )
}
