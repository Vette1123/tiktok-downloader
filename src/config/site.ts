export type SiteConfig = typeof siteConfig

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.mohamedgado.site'

export const siteConfig = {
  name: 'Social Media Downloader',
  shortName: 'SM Downloader',
  tagline: 'Download TikTok & Twitter/X videos without watermarks',
  description:
    'Free, fast, and watermark-free downloader for TikTok and Twitter/X. Save HD videos, extract MP3 audio, and download TikTok photo carousels (slideshows) with the original soundtrack — no login or install required.',
  url: siteUrl,
  author: {
    name: 'Mohamed Gado',
    url: 'https://www.mohamedgado.com',
    email: 'boogado@yahoo.com',
    twitter: '@Sadge1996',
  },
  links: {
    twitter: 'https://twitter.com/Sadge1996',
    github: 'https://github.com/Vette1123/tiktok-downloader',
    portfolio: 'https://www.mohamedgado.com',
  },
  ogImage: `${siteUrl}/og.jpg`,
  twitterTag: '@Sadge1996',
  keywords: [
    'TikTok downloader',
    'TikTok video downloader',
    'TikTok downloader no watermark',
    'download TikTok without watermark',
    'TikTok MP3 downloader',
    'TikTok audio extractor',
    'TikTok slideshow downloader',
    'TikTok photo carousel downloader',
    'Twitter video downloader',
    'Twitter/X video downloader',
    'X video downloader',
    'social media downloader',
    'save TikTok videos',
    'download Twitter videos',
    'free video downloader',
    'HD video downloader',
    'watermark remover',
    'TikTok to MP3',
    'TikTok image downloader',
  ],
}
