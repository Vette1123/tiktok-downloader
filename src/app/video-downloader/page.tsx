import type { Metadata } from 'next'
import { PlatformLanding } from '@/components/PlatformLanding'
import { siteConfig } from '@/config/site'
import { platformsBySlug } from '@/lib/platforms'
import { platformStructuredData } from '@/lib/structuredData'

const platform = platformsBySlug['video-downloader']
const path = `/${platform.slug}`
const url = `${siteConfig.url}${path}`

export const metadata: Metadata = {
  title: platform.metaTitle,
  description: platform.metaDescription,
  alternates: {
    canonical: path,
    languages: {
      en: path,
      'x-default': path,
    },
  },
  openGraph: {
    title: platform.metaTitle,
    description: platform.metaDescription,
    url,
    siteName: siteConfig.name,
    locale: siteConfig.locale,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: platform.metaTitle,
    description: platform.metaDescription,
    creator: siteConfig.twitterTag,
    site: siteConfig.twitterTag,
  },
}

export default function Page() {
  return (
    <>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(platformStructuredData(platform.slug)),
        }}
      />
      <PlatformLanding platform={platform} />
    </>
  )
}
