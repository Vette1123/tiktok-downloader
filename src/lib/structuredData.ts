import { siteConfig } from '@/config/site'

const ogImage = `${siteConfig.url}/opengraph-image`

export const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${siteConfig.url}/#website`,
      url: siteConfig.url,
      name: siteConfig.name,
      description: siteConfig.description,
      inLanguage: 'en',
      publisher: { '@id': `${siteConfig.url}/#person` },
    },
    {
      '@type': 'Person',
      '@id': `${siteConfig.url}/#person`,
      name: siteConfig.author.name,
      url: siteConfig.author.url,
      sameAs: [siteConfig.links.twitter, siteConfig.links.github],
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
      isAccessibleForFree: true,
      inLanguage: 'en',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
      },
      featureList: [
        'Download TikTok videos without watermark',
        'Download Twitter/X videos in HD',
        'Extract MP3 audio from TikTok videos',
        'Download TikTok slideshows (photo carousels) with original music',
        'Preview video and images before downloading',
        'Save images individually or as a ZIP archive',
      ],
      screenshot: ogImage,
      image: ogImage,
      author: { '@id': `${siteConfig.url}/#person` },
      creator: { '@id': `${siteConfig.url}/#person` },
      potentialAction: {
        '@type': 'UseAction',
        target: `${siteConfig.url}/?url={url}`,
        'query-input': 'required name=url',
      },
    },
    {
      '@type': 'HowTo',
      '@id': `${siteConfig.url}/#howto`,
      name: 'How to download a TikTok or Twitter/X video without a watermark',
      description:
        'Save any TikTok or Twitter/X video, MP3 audio, or slideshow image in three steps — no login, no install, no watermark.',
      totalTime: 'PT30S',
      image: ogImage,
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
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Is this TikTok downloader free?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. The tool is free, requires no sign-up, and has no daily download limit.',
          },
        },
        {
          '@type': 'Question',
          name: 'Do downloaded TikTok videos have a watermark?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. Videos are saved in HD quality without the TikTok watermark.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can I download a TikTok photo carousel (slideshow)?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Paste the slideshow URL and the app shows every image plus the original background music — download them individually, as a ZIP, or save the audio as an MP3.',
          },
        },
        {
          '@type': 'Question',
          name: 'Does it support Twitter/X videos?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Paste any twitter.com or x.com status URL and the tool will extract the video for preview and download.',
          },
        },
      ],
    },
  ],
}
