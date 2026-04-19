import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { Analytics } from '@vercel/analytics/next'
import { siteConfig } from '@/config/site'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const title = `${siteConfig.name} — ${siteConfig.tagline}`

export const viewport: Viewport = {
  themeColor: '#7c3aed',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: title,
    template: `%s — ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: siteConfig.keywords,
  authors: [{ name: siteConfig.author.name, url: siteConfig.author.url }],
  creator: siteConfig.author.name,
  publisher: siteConfig.author.name,
  referrer: 'origin-when-cross-origin',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title,
    description: siteConfig.description,
    url: siteConfig.url,
    siteName: siteConfig.name,
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description: siteConfig.description,
    creator: siteConfig.twitterTag,
    site: siteConfig.twitterTag,
    images: [
      {
        url: siteConfig.ogImage,
        alt: siteConfig.name,
      },
    ],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  category: 'technology',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '32x32' },
    ],
    apple: '/apple-touch-icon.svg',
  },
  manifest: '/manifest.json',
}

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      '@id': `${siteConfig.url}/#webapp`,
      name: siteConfig.name,
      url: siteConfig.url,
      description: siteConfig.description,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript. Requires HTML5.',
      isAccessibleForFree: true,
      inLanguage: 'en',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
      featureList: [
        'Download TikTok videos without watermark',
        'Download Twitter/X videos in HD',
        'Extract MP3 audio from TikTok videos',
        'Download TikTok slideshows (photo carousels) with original music',
        'Preview video and images before downloading',
        'Save images individually or as a ZIP archive',
      ],
      screenshot: siteConfig.ogImage,
      author: {
        '@type': 'Person',
        name: siteConfig.author.name,
        url: siteConfig.author.url,
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: '4.9',
        ratingCount: '128',
        bestRating: '5',
        worstRating: '1',
      },
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang='en'>
      <head>
        <link rel='icon' href='/favicon.svg' type='image/svg+xml' />
        <link rel='icon' href='/favicon.ico' sizes='32x32' />
        <link rel='apple-touch-icon' href='/apple-touch-icon.svg' />
        <link rel='manifest' href='/manifest.json' />
        <meta name='msapplication-TileColor' content='#7c3aed' />
        <meta name='google-adsense-account' content='ca-pub-3842960431278714' />
        <Script
          id='ld-json'
          type='application/ld+json'
          strategy='beforeInteractive'
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Script
          async
          src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3842960431278714'
          crossOrigin='anonymous'
          strategy='afterInteractive'
        />
        {children}
        <Analytics />
      </body>
    </html>
  )
}
