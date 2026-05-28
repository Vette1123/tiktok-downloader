import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { Analytics } from '@vercel/analytics/next'
import { siteConfig } from '@/config/site'
import { structuredData } from '@/lib/structuredData'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap',
  preload: true,
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
  preload: false,
})

const title = `${siteConfig.name} — ${siteConfig.tagline}`

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#1e1b4b' },
    { media: '(prefers-color-scheme: light)', color: '#7c3aed' },
  ],
  colorScheme: 'dark light',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
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
    languages: {
      en: '/',
      'x-default': '/',
    },
  },
  openGraph: {
    title,
    description: siteConfig.description,
    url: siteConfig.url,
    siteName: siteConfig.name,
    locale: siteConfig.locale,
    type: 'website',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: siteConfig.ogImageAlt,
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description: siteConfig.description,
    creator: siteConfig.twitterTag,
    site: siteConfig.twitterTag,
    images: [
      {
        url: '/twitter-image',
        alt: siteConfig.ogImageAlt,
        width: 1200,
        height: 630,
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang='en' dir='ltr'>
      <head>
        <link rel='icon' href='/favicon.svg' type='image/svg+xml' />
        <link rel='icon' href='/favicon.ico' sizes='32x32' />
        <link rel='apple-touch-icon' href='/apple-touch-icon.svg' />
        <link rel='manifest' href='/manifest.json' />
        <link
          rel='preconnect'
          href='https://pagead2.googlesyndication.com'
          crossOrigin='anonymous'
        />
        <link rel='dns-prefetch' href='https://pagead2.googlesyndication.com' />
        <meta name='msapplication-TileColor' content='#7c3aed' />
        <meta name='google-adsense-account' content='ca-pub-3842960431278714' />
        <meta
          name='google-site-verification'
          content='aha64Aa3HDSFKw-xDlfpIGcBkGRU4lRV9xU-qR2SPwc'
        />
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        style={{
          backgroundColor: '#1e1b4b',
          backgroundImage:
            'linear-gradient(to bottom right, #4c1d95, #1e3a8a, #312e81)',
        }}
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
