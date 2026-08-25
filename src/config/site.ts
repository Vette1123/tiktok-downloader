export type SiteConfig = typeof siteConfig

// Canonical site URL. Driven by NEXT_PUBLIC_SITE_URL in deploys; falls back to
// the production domain. Any trailing slash is stripped so `${siteUrl}/path`
// never produces a double slash.
const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.socialdownloader.space'
).replace(/\/+$/, '')

export const siteConfig = {
  name: '社交媒体解析下载器',
  shortName: '媒体下载器',
  /**
   * How the site describes itself everywhere — title, meta, OG, JSON-LD.
   *
   * Deliberately framed around *original quality* rather than the removal of
   * anything. A downloader that advertises stripping a platform's mark reads
   * as a circumvention tool to a payment reviewer, and the merchant of record
   * reads these strings during account review. The behaviour is unchanged:
   * we save the source file a platform serves for a public post. Say that.
   */
  tagline: '安全解析并保存公开社交媒体内容',
  description:
    '需要私人登录的社交媒体解析下载器，支持解析公开的视频、音频和图片内容，并为快捷指令提供受 API Key 保护的接口。',
  url: siteUrl,
  ogImage: `${siteUrl}/opengraph-image`,
  ogImageAlt: '社交媒体解析下载器中文界面',
  locale: 'zh_CN',
  foundingYear: 2024,
  /**
   * The one public contact address, for support, billing receipts and takedown
   * notices alike.
   *
   * A domain address rather than a personal inbox, for three reasons that all
   * point the same way: the merchant of record prints it on every receipt and
   * will not accept a free-provider address; a rights holder reading /terms
   * should be answered by the product, not by someone's Yahoo account; and it
   * used to be emitted as machine-readable JSON-LD, which is how a personal
   * address ends up on scraper lists. Routed by Cloudflare Email Routing.
   */
  supportEmail: 'support@socialdownloader.space',
  author: {
    name: 'Mohamed Gado',
    url: 'https://www.mohamedgado.com',
    twitter: '@Sadge1996',
    jobTitle: 'Software Engineer',
  },
  links: {
    twitter: 'https://twitter.com/Sadge1996',
    github: 'https://github.com/Vette1123/social-media-downloader',
    portfolio: 'https://www.mohamedgado.com',
    /** Our other site: the streaming/discovery app. Sister link, both ways. */
    reely: 'https://www.reely.space',
    /**
     * The one way to put money into this project, and deliberately a donation
     * rather than a product.
     *
     * A tip is not a sale: nothing is promised in return, so there is no
     * merchant of record, no entitlement to enforce, no refund policy and no
     * subscription to cancel. That matters here — every merchant of record
     * approached refused this product category, and the honest response is to
     * stop selling rather than to keep rewording the same offer.
     */
    sponsor: 'https://buymeacoffee.com/vetteotp',
    /**
     * The two membership levels, rather than the tip jar.
     *
     * A separate link because the two asks are different: `sponsor` is a
     * one-off of any amount and grants nothing automatically, while this page
     * carries the levels the webhook actually recognises — pay here and the
     * extras switch themselves on. Anywhere the copy mentions supporter status
     * must point at this one, or someone follows the ask, pays, and gets
     * nothing. See docs/buymeacoffee-setup.md.
     */
    membership: 'https://buymeacoffee.com/vetteotp/membership',
  },
  twitterTag: '@Sadge1996',
  /**
   * Meta keywords. Google has ignored this tag since 2009, so it carries no
   * ranking weight — but it is machine-readable text on the page a payment
   * reviewer reads. Nothing here may describe removing a platform's mark, and
   * nothing here may trade on another downloader's brand name.
   */
  keywords: [
    // Primary intent
    'TikTok downloader',
    'TikTok video downloader',
    'TikTok HD video downloader',
    'download public TikTok videos',
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
    // Instagram
    'Instagram video downloader',
    'Instagram reels downloader',
    'Instagram reel downloader',
    'download Instagram reels',
    'Instagram photo downloader',
    'Instagram carousel downloader',
    'save Instagram videos',
    'Instagram downloader no login',
    // YouTube
    'YouTube video downloader',
    'YouTube downloader',
    'YouTube Shorts downloader',
    'download YouTube videos',
    'YouTube to MP3',
    'YouTube MP3 downloader',
    'YouTube HD downloader',
    'save YouTube videos',
    'YouTube 1080p downloader',
    // Facebook
    'Facebook video downloader',
    'Facebook reels downloader',
    'download Facebook videos',
    'fb video downloader',
    'fb.watch downloader',
    'Facebook HD video downloader',
    'save Facebook videos',
    'Facebook downloader no login',
    // Generic
    'social media downloader',
    'free video downloader',
    'HD video downloader',
    'online video downloader',
    'social video saver',
    'MP4 downloader online',
    'MP3 audio extractor',
    'photo carousel downloader',
    'tiktok downloader online',
    'tiktok downloader free no login',
    // Device / platform
    'TikTok downloader mobile',
    'TikTok downloader iPhone',
    'TikTok downloader Android',
    'TikTok downloader PC',
  ],
}
