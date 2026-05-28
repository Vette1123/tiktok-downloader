export type SiteConfig = typeof siteConfig

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.mohamedgado.com'

export const siteConfig = {
  name: 'Social Media Downloader',
  shortName: 'Social Downloader',
  tagline: 'Download TikTok & Twitter/X videos without watermarks',
  description:
    'Free, fast, and watermark-free downloader for TikTok and Twitter/X. Save HD videos, extract MP3 audio, and download TikTok photo carousels (slideshows) with the original soundtrack — no login or install required.',
  url: siteUrl,
  ogImage: `${siteUrl}/opengraph-image`,
  ogImageAlt:
    'Social Media Downloader — paste a TikTok or Twitter/X link to save HD video, MP3 audio, or slideshow images without a watermark.',
  locale: 'en_US',
  foundingYear: 2024,
  author: {
    name: 'Mohamed Gado',
    url: 'https://www.mohamedgado.com',
    email: 'boogado@yahoo.com',
    twitter: '@Sadge1996',
    jobTitle: 'Software Engineer',
  },
  links: {
    twitter: 'https://twitter.com/Sadge1996',
    github: 'https://github.com/Vette1123/tiktok-downloader',
    portfolio: 'https://www.mohamedgado.com',
  },
  twitterTag: '@Sadge1996',
  keywords: [
    // Primary intent
    'TikTok downloader',
    'TikTok video downloader',
    'TikTok downloader no watermark',
    'download TikTok without watermark',
    'TikTok video saver',
    'save TikTok videos',
    'TikTok HD downloader',
    'TikTok 1080p downloader',
    'TikTok 4K downloader',
    // Audio
    'TikTok MP3 downloader',
    'TikTok to MP3',
    'TikTok audio extractor',
    'TikTok sound downloader',
    'extract sound from TikTok',
    // Slideshow / images
    'TikTok slideshow downloader',
    'TikTok photo carousel downloader',
    'TikTok image downloader',
    'TikTok slideshow to ZIP',
    'download TikTok slideshow with music',
    // Twitter / X
    'Twitter video downloader',
    'Twitter/X video downloader',
    'X video downloader',
    'x.com video downloader',
    'download Twitter videos',
    'save Twitter videos',
    'Twitter GIF downloader',
    'Twitter HD video downloader',
    // Generic / brand-alternative
    'social media downloader',
    'free video downloader',
    'HD video downloader',
    'online video downloader',
    'no watermark video downloader',
    'watermark remover',
    'snaptik alternative',
    'ssstik alternative',
    'tikmate alternative',
    'ttdownloader alternative',
    'tiktok downloader online',
    'tiktok downloader free no login',
    // Device / platform
    'TikTok downloader mobile',
    'TikTok downloader iPhone',
    'TikTok downloader Android',
    'TikTok downloader PC',
  ],
}
