import type { MetadataRoute } from 'next'
import { siteConfig } from '@/config/site'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/'],
      },
      {
        userAgent: [
          // Search-aware AI crawlers (allow — drives discovery)
          'GPTBot',
          'OAI-SearchBot',
          'ChatGPT-User',
          'PerplexityBot',
          'Perplexity-User',
          'Google-Extended',
          'ClaudeBot',
          'Claude-Web',
          'anthropic-ai',
          'Applebot',
          'Applebot-Extended',
          'Bingbot',
          'DuckDuckBot',
          'YandexBot',
        ],
        allow: '/',
        disallow: ['/api/'],
      },
      {
        // Aggressive scrapers — block
        userAgent: ['CCBot', 'Bytespider', 'Amazonbot', 'Diffbot', 'Omgili'],
        disallow: '/',
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  }
}
