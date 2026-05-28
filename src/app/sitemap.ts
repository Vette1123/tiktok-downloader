import type { MetadataRoute } from 'next'
import { siteConfig } from '@/config/site'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    {
      url: siteConfig.url,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
      alternates: {
        languages: {
          en: siteConfig.url,
          'x-default': siteConfig.url,
        },
      },
      images: [`${siteConfig.url}/opengraph-image`],
    },
  ]
}
