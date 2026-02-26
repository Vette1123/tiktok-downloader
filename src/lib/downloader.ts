import axios from 'axios'
import * as cheerio from 'cheerio'
import { VideoData, ImageData } from './types'
import { parseVideoId } from './validator'

export class Downloader {
  private readonly userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

  async downloadVideo(url: string): Promise<VideoData> {
    const videoId = parseVideoId(url)
    if (!videoId) {
      throw new Error('Could not extract video ID from URL')
    }

    // Try multiple working methods
    const methods = [
      () => this.trySnaptikMethod(url),
      () => this.trySSSMethod(url),
      () => this.tryTikwmMethod(url),
      () => this.tryDirectTikTokScraping(url),
    ]

    for (const method of methods) {
      try {
        const result = await method()
        if (result) {
          console.log('Successfully downloaded video using method')
          return result
        }
      } catch (error) {
        console.warn('Method failed, trying next...', error)
        continue
      }
    }

    throw new Error(
      'All download methods failed. TikTok might be blocking requests or the video is private.',
    )
  }

  private async trySnaptikMethod(url: string): Promise<VideoData | null> {
    try {
      // Step 1: Get the main page to extract necessary tokens
      await axios.get('https://snaptik.app/', {
        headers: { 'User-Agent': this.userAgent },
      })

      // Step 2: Submit the URL
      const formData = new URLSearchParams()
      formData.append('url', url)

      const response = await axios.post(
        'https://snaptik.app/abc2.php',
        formData,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': this.userAgent,
            Referer: 'https://snaptik.app/',
            Origin: 'https://snaptik.app',
          },
          timeout: 30000,
        },
      )

      if (response.data && typeof response.data === 'string') {
        const $ = cheerio.load(response.data)

        // Look for download links
        const downloadLinks: string[] = []
        $('a[href*=".mp4"], a[download*=".mp4"]').each((_, element) => {
          const href = $(element).attr('href')
          if (href && href.includes('.mp4')) {
            downloadLinks.push(href)
          }
        })

        if (downloadLinks.length > 0) {
          const videoId = parseVideoId(url) || 'unknown'
          return {
            id: videoId,
            title: 'TikTok Video (Snaptik)',
            url: url,
            thumbnail: '',
            duration: 0,
            author: 'Unknown',
            description: 'Downloaded via Snaptik',
            downloadUrl: downloadLinks[0], // Use the first (usually highest quality) link
          }
        }
      }
    } catch {
      throw new Error('Snaptik method failed')
    }
    return null
  }

  private async trySSSMethod(url: string): Promise<VideoData | null> {
    try {
      const response = await axios.post(
        'https://ssstik.io/abc',
        {
          id: url,
          locale: 'en',
          tt: 'RFBiZ3Bi',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': this.userAgent,
            Accept: 'application/json, text/plain, */*',
            Origin: 'https://ssstik.io',
            Referer: 'https://ssstik.io/en',
          },
          timeout: 30000,
        },
      )

      if (response.data && response.data.url) {
        const videoId = parseVideoId(url) || 'unknown'
        return {
          id: videoId,
          title: response.data.title || 'TikTok Video (SSSt)',
          url: url,
          thumbnail: response.data.cover || '',
          duration: response.data.duration || 0,
          author: response.data.author || 'Unknown',
          description: response.data.title || 'Downloaded via SSSTik',
          downloadUrl: response.data.url,
        }
      }
    } catch {
      throw new Error('SSSTik method failed')
    }
    return null
  }

  private async tryTikwmMethod(url: string): Promise<VideoData | null> {
    try {
      const response = await axios.post(
        'https://www.tikwm.com/api/',
        {
          url: url,
          count: 12,
          cursor: 0,
          web: 1,
          hd: 1,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': this.userAgent,
            Accept: 'application/json, text/plain, */*',
            Origin: 'https://www.tikwm.com',
            Referer: 'https://www.tikwm.com/',
          },
          timeout: 30000,
        },
      )

      if (response.data && response.data.code === 0 && response.data.data) {
        const data = response.data.data
        const videoId = parseVideoId(url) || 'unknown'

        // Check if this is a photo carousel (slideshow)
        const isPhotoCarousel =
          data.images && Array.isArray(data.images) && data.images.length > 0

        let images: ImageData[] = []
        if (isPhotoCarousel) {
          images = data.images.map((img: string, index: number) => ({
            id: `${videoId}_img_${index}`,
            url: img,
            thumbnail: img,
          }))
        }

        // Get the video URL and make it absolute if it's relative
        // Prefer hdplay (HD no watermark), fall back to play (SD no watermark), then wmplay
        let downloadUrl = data.hdplay || data.play || data.wmplay

        // If the URL is relative, make it absolute
        if (downloadUrl && downloadUrl.startsWith('/')) {
          downloadUrl = 'https://www.tikwm.com' + downloadUrl
        }

        // Extract dedicated music/audio URL so the audio proxy never uses the video stream
        let musicUrl: string | undefined =
          data.music || data.music_info?.play || undefined

        if (musicUrl && musicUrl.startsWith('/')) {
          musicUrl = 'https://www.tikwm.com' + musicUrl
        }

        return {
          id: videoId,
          title: data.title || 'TikTok Video (Tikwm)',
          url: url,
          thumbnail: data.cover || '',
          duration: data.duration || 0,
          author: data.author?.nickname || 'Unknown',
          description: data.title || 'Downloaded via Tikwm',
          downloadUrl: downloadUrl,
          musicUrl: musicUrl,
          images: images,
          isPhotoCarousel: isPhotoCarousel,
        }
      }
    } catch {
      throw new Error('Tikwm method failed')
    }
    return null
  }

  private async tryDirectTikTokScraping(
    url: string,
  ): Promise<VideoData | null> {
    try {
      // First resolve any shortened URLs
      const resolvedUrl = await this.resolveUrl(url)

      const response = await axios.get(resolvedUrl, {
        headers: {
          'User-Agent': this.userAgent,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          Connection: 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 30000,
      })

      // Parse TikTok's page for video data
      const $ = cheerio.load(response.data)

      // Look for JSON data in script tags
      const scripts = $('script').toArray()
      for (const script of scripts) {
        const content = $(script).html()
        if (content && content.includes('webapp.video-detail')) {
          try {
            // Extract video URLs from the script content
            const videoUrlMatch = content.match(/"playAddr":"([^"]+)"/)
            const downloadUrlMatch = content.match(/"downloadAddr":"([^"]+)"/)

            if (videoUrlMatch || downloadUrlMatch) {
              const videoId = parseVideoId(url) || 'unknown'
              const downloadUrl = (
                downloadUrlMatch?.[1] ||
                videoUrlMatch?.[1] ||
                ''
              ).replace(/\\u002F/g, '/')

              return {
                id: videoId,
                title: 'TikTok Video (Direct)',
                url: url,
                thumbnail: '',
                duration: 0,
                author: 'Unknown',
                description: 'Downloaded via direct scraping',
                downloadUrl: downloadUrl,
              }
            }
          } catch {
            continue
          }
        }
      }
    } catch {
      throw new Error('Direct scraping method failed')
    }
    return null
  }

  private async resolveUrl(url: string): Promise<string> {
    try {
      if (url.includes('vm.tiktok.com') || url.includes('/t/')) {
        const response = await axios.head(url, {
          maxRedirects: 5,
          validateStatus: () => true,
          headers: { 'User-Agent': this.userAgent },
          timeout: 10000,
        })
        return response.request.res.responseUrl || url
      }
    } catch {
      // If resolve fails, return original URL
    }
    return url
  }
}
