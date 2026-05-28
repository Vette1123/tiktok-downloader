import { siteConfig } from '@/config/site'

const ogImage = siteConfig.ogImage
const datePublished = `${siteConfig.foundingYear}-01-01`
const dateModified = new Date().toISOString().slice(0, 10)

export const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${siteConfig.url}/#website`,
      url: siteConfig.url,
      name: siteConfig.name,
      alternateName: siteConfig.shortName,
      description: siteConfig.description,
      inLanguage: 'en',
      publisher: { '@id': `${siteConfig.url}/#person` },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${siteConfig.url}/?url={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'Person',
      '@id': `${siteConfig.url}/#person`,
      name: siteConfig.author.name,
      url: siteConfig.author.url,
      email: `mailto:${siteConfig.author.email}`,
      jobTitle: siteConfig.author.jobTitle,
      sameAs: [
        siteConfig.links.twitter,
        siteConfig.links.github,
        siteConfig.links.portfolio,
      ],
    },
    {
      '@type': ['WebApplication', 'SoftwareApplication'],
      '@id': `${siteConfig.url}/#webapp`,
      name: siteConfig.name,
      alternateName: siteConfig.shortName,
      url: siteConfig.url,
      description: siteConfig.description,
      applicationCategory: 'MultimediaApplication',
      applicationSubCategory: 'VideoDownloader',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript. Requires HTML5.',
      softwareVersion: '1.0',
      datePublished,
      dateModified,
      isAccessibleForFree: true,
      inLanguage: 'en',
      keywords: siteConfig.keywords.join(', '),
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
      },
      featureList: [
        'Download TikTok videos in HD without watermark',
        'Download Twitter/X videos in HD (including GIF videos)',
        'Extract MP3 audio from TikTok videos',
        'Download TikTok slideshows (photo carousels) with original music',
        'Preview video, audio and images before downloading',
        'Save images individually or as a ZIP archive',
        'Works on desktop, iPhone, iPad and Android — no app install',
        'No login, no daily limit, no watermark, no signup',
      ],
      screenshot: ogImage,
      image: ogImage,
      author: { '@id': `${siteConfig.url}/#person` },
      creator: { '@id': `${siteConfig.url}/#person` },
      publisher: { '@id': `${siteConfig.url}/#person` },
      mainEntityOfPage: { '@id': `${siteConfig.url}/#website` },
      potentialAction: {
        '@type': 'UseAction',
        target: `${siteConfig.url}/?url={url}`,
        'query-input': 'required name=url',
      },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${siteConfig.url}/#breadcrumbs`,
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: siteConfig.url,
        },
      ],
    },
    {
      '@type': 'HowTo',
      '@id': `${siteConfig.url}/#howto`,
      name: 'How to download a TikTok or Twitter/X video without a watermark',
      description:
        'Save any TikTok or Twitter/X video, MP3 audio, or slideshow image in three steps — no login, no install, no watermark.',
      totalTime: 'PT30S',
      image: ogImage,
      inLanguage: 'en',
      estimatedCost: {
        '@type': 'MonetaryAmount',
        currency: 'USD',
        value: '0',
      },
      supply: [
        { '@type': 'HowToSupply', name: 'TikTok or Twitter/X post URL' },
      ],
      tool: [
        { '@type': 'HowToTool', name: 'Any modern web browser' },
        { '@type': 'HowToTool', name: 'A TikTok or Twitter/X URL' },
      ],
      step: [
        {
          '@type': 'HowToStep',
          position: 1,
          name: 'Copy the link',
          text: 'Open the TikTok or Twitter/X post and copy the share URL.',
          url: `${siteConfig.url}/#step-1`,
        },
        {
          '@type': 'HowToStep',
          position: 2,
          name: 'Paste and process',
          text: 'Paste the URL into the input on this page and click Process URL to fetch the media.',
          url: `${siteConfig.url}/#step-2`,
        },
        {
          '@type': 'HowToStep',
          position: 3,
          name: 'Download',
          text: 'Preview, then download the watermark-free video, MP3 audio, or carousel images individually or as a ZIP.',
          url: `${siteConfig.url}/#step-3`,
        },
      ],
    },
    {
      '@type': 'FAQPage',
      '@id': `${siteConfig.url}/#faq`,
      inLanguage: 'en',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Is this TikTok downloader free?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. The tool is completely free, requires no sign-up or account, and has no daily download limit.',
          },
        },
        {
          '@type': 'Question',
          name: 'Do downloaded TikTok videos have a watermark?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. Videos are saved in original HD quality (up to 1080p) without the TikTok watermark.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can I download a TikTok photo carousel (slideshow)?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Paste the slideshow URL and the app shows every image plus the original background music — download them individually, as a ZIP archive, or save the audio as an MP3.',
          },
        },
        {
          '@type': 'Question',
          name: 'Does it support Twitter/X videos?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Paste any twitter.com or x.com status URL and the tool will extract the video for preview and download — including GIF videos in HD.',
          },
        },
        {
          '@type': 'Question',
          name: 'Does it work on iPhone, iPad and Android?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. It runs entirely in the browser on any modern device — iPhone, iPad, Android phone, tablet, Mac, Windows or Linux. No app install required.',
          },
        },
        {
          '@type': 'Question',
          name: 'What formats and quality are downloads available in?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Videos are downloaded as MP4 in HD (typically 1080p when the source supports it). Audio is delivered as MP3. Carousel images are saved as JPG or PNG, individually or in a ZIP archive.',
          },
        },
        {
          '@type': 'Question',
          name: 'Do you store the videos I download?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. The tool fetches media on demand and streams it directly to your device. Nothing is stored on our servers and no account is needed.',
          },
        },
        {
          '@type': 'Question',
          name: 'Is downloading TikTok or Twitter/X videos legal?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Downloading public videos for personal, non-commercial use is generally allowed, but you should respect the original creator’s rights and the platform’s terms of service. Do not redistribute or monetize content you do not own.',
          },
        },
        {
          '@type': 'Question',
          name: 'Why does my TikTok link fail to process?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Make sure the post is public and the URL is the share link (tiktok.com/@user/video/... or vm.tiktok.com/...). Private, deleted, region-locked or age-restricted posts cannot be fetched.',
          },
        },
      ],
    },
  ],
}
