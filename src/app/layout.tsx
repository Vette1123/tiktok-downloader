import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
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

export const metadata: Metadata = {
  title: 'Social Media Downloader - Download Videos Without Watermarks',
  description:
    'Free social media video downloader. Download TikTok videos without watermarks and Twitter/X videos. Extract MP3 audio or save image galleries in high quality.',
  keywords: [
    'social media downloader',
    'video downloader',
    'TikTok downloader',
    'Twitter downloader',
    'Twitter/X video downloader',
    'download TikTok without watermark',
    'MP3 audio extractor',
    'no watermark downloader',
    'free video downloader',
    'image gallery downloader',
  ],
  authors: [
    {
      name: siteConfig.name,
      url: siteConfig.links.github,
    },
  ],
  creator: siteConfig.links.github,
  publisher: siteConfig.links.github,
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL('https://www.mohamedgado.site'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Social Media Downloader - Download Videos Without Watermarks',
    description:
      'Free social media video downloader. Download TikTok and Twitter/X videos without watermarks. Fast, secure, and easy to use.',
    url: siteConfig.links.github,
    siteName: 'Social Media Downloader',
    images: [
      {
        url: siteConfig.ogImage,
        alt: siteConfig.name,
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
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
  verification: {
    google: 'your-google-verification-code', // Add your Google Search Console verification code
    // yandex: 'your-yandex-verification-code', // Add if needed
    // yahoo: 'your-yahoo-verification-code', // Add if needed
  },
  category: 'technology',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '32x32' },
    ],
    apple: '/apple-touch-icon.svg',
  },
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
        <meta name='theme-color' content='#7c3aed' />
        <meta name='msapplication-TileColor' content='#7c3aed' />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Analytics />
      </body>
    </html>
  )
}
