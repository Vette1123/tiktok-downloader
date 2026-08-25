import Link from 'next/link'
import { DownloaderApp } from '@/components/DownloaderApp'
import { Surface } from '@/components/Surface'
import { InteractiveBackground } from '@/components/InteractiveBackground'
import { LazyFAQ } from '@/components/LazyFAQ'
import {
  FacebookIcon,
  FilmIcon,
  InstagramIcon,
  PinterestIcon,
  RedditIcon,
  SnapchatIcon,
  ThreadsIcon,
  TikTokIcon,
  TwitchIcon,
  TwitterXIcon,
  VimeoIcon,
  YouTubeIcon,
} from '@/components/icons'
import { SupportPanel } from '@/components/SupportPanel'
import { PromoSlot } from '@/components/PromoSlot'
import { DevAppLinks } from '@/components/DevAppLinks'
import { SiteFooter } from '@/components/SiteFooter'
import type { Platform, PlatformSlug } from '@/lib/platforms'
import { platforms } from '@/lib/platforms'
import type { SupportedPlatform } from '@/lib/validator'

/**
 * `Platform.slug` is the URL slug ('tiktok-downloader'), but offers.ts and
 * selectOffer() key platform targeting on detectPlatform()'s output
 * ('tiktok') — see src/lib/validator.ts. This is the one place that maps
 * between the two so PromoSlot never has to know about landing-page routing.
 * Typed against `SupportedPlatform` (not `string`) so a typo'd value fails
 * the build instead of relying on review.
 */
const OFFER_PLATFORM_BY_SLUG: Record<PlatformSlug, SupportedPlatform> = {
  'video-downloader': 'generic',
  'tiktok-downloader': 'tiktok',
  'twitter-video-downloader': 'twitter',
  'instagram-downloader': 'instagram',
  'youtube-downloader': 'youtube',
  'facebook-downloader': 'facebook',
  'pinterest-downloader': 'pinterest',
  'reddit-video-downloader': 'reddit',
  'threads-video-downloader': 'threads',
  'snapchat-downloader': 'snapchat',
  'twitch-clip-downloader': 'twitch',
  'vimeo-downloader': 'vimeo',
}

const heroChips = [
  'Free forever',
  'No login required',
  'No download limits',
  'HD quality',
] as const

const platformIcons: Record<PlatformSlug, { Icon: React.ComponentType<{ className?: string }>; tile: string }> = {
  'video-downloader': {
    Icon: FilmIcon,
    tile: 'bg-cyan-600',
  },
  'tiktok-downloader': {
    Icon: TikTokIcon,
    tile: 'bg-[#010101]',
  },
  'twitter-video-downloader': {
    Icon: TwitterXIcon,
    tile: 'bg-black',
  },
  'instagram-downloader': {
    Icon: InstagramIcon,
    tile: 'bg-transparent overflow-hidden',
  },
  'facebook-downloader': {
    Icon: FacebookIcon,
    tile: 'bg-transparent overflow-hidden',
  },
  'youtube-downloader': {
    Icon: YouTubeIcon,
    tile: 'bg-transparent overflow-hidden',
  },
  'pinterest-downloader': {
    Icon: PinterestIcon,
    tile: 'bg-[#E60023]',
  },
  'reddit-video-downloader': {
    Icon: RedditIcon,
    tile: 'bg-[#FF4500]',
  },
  'threads-video-downloader': {
    Icon: ThreadsIcon,
    tile: 'bg-black',
  },
  'snapchat-downloader': {
    Icon: SnapchatIcon,
    tile: 'bg-[#FFFC00]',
  },
  'twitch-clip-downloader': {
    Icon: TwitchIcon,
    tile: 'bg-[#9146FF]',
  },
  'vimeo-downloader': {
    Icon: VimeoIcon,
    tile: 'bg-[#1AB7EA]',
  },
}

// Centered section header (title + one-line sub) for the full-width bands.
function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className='mx-auto mb-9 max-w-2xl text-center'>
      <h2 className='text-2xl font-bold tracking-tight text-white text-balance sm:text-3xl'>
        {title}
      </h2>
      {sub && <p className='mt-3 text-sm text-white/60 md:text-base'>{sub}</p>}
    </div>
  )
}

// Uppercase eyebrow with a fading cyan hairline — for in-column labels.
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <h3 className='mb-4 flex items-center gap-3 text-xs font-semibold tracking-[0.13em] uppercase text-white/60'>
      {children}
      <span className='h-px flex-1 bg-gradient-to-r from-cyan-400/30 to-transparent' />
    </h3>
  )
}

function CheckMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round'>
      <path d='m5 12 5 5 9-11' />
    </svg>
  )
}

function PlatformIconRow({ activeSlug }: { activeSlug: PlatformSlug }) {
  return (
    <div className='mb-4 flex justify-center'>
      <div className='flex max-w-md flex-wrap items-center justify-center gap-2 md:max-w-xl md:gap-2.5'>
        {platforms.map((p) => {
          const { Icon, tile } = platformIcons[p.slug]
          const isActive = p.slug === activeSlug
          // The hover accent belongs to `.icon-lift`; this only sets the
          // resting ring, and the current page keeps a permanent bright one.
          const ring = isActive
            ? 'ring-2 ring-cyan-400/80'
            : 'ring-1 ring-white/15'
          const opacity = isActive ? '' : 'opacity-80 hover:opacity-100'
          return (
            <Link
              key={p.slug}
              href={`/${p.slug}`}
              aria-label={`${p.brandLabel}${isActive ? ' (current page)' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              className='block'
            >
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-xl md:h-12 md:w-12 ${tile} ${ring} ${opacity} icon-lift shadow-lg shadow-black/30`}
              >
                {tile.startsWith('bg-transparent') ? (
                  <Icon className='h-full w-full' />
                ) : (
                  <Icon className='h-5 w-5 text-white md:h-6 md:w-6' />
                )}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function CrossLinkNav({ activeSlug }: { activeSlug: PlatformSlug }) {
  const others = platforms.filter((p) => p.slug !== activeSlug)
  return (
    <nav
      aria-label='Other downloaders'
      className='flex flex-wrap justify-center gap-2.5'
    >
      <Surface
        as={Link}
        href='/'
        interaction='lift'
        radius='xl'
        className='inline-flex items-center gap-1.5 px-4 py-2.5 text-sm text-white/80 hover:text-white'
      >
        ← All platforms
      </Surface>
      {others.map((p) => {
        const { Icon, tile } = platformIcons[p.slug]
        const useBrandTile = !tile.startsWith('bg-transparent')
        return (
          <Surface
            key={p.slug}
            as={Link}
            href={`/${p.slug}`}
            interaction='lift'
            radius='xl'
            className='inline-flex items-center gap-2.5 px-4 py-2.5 text-sm text-white/80 hover:text-white'
          >
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${useBrandTile ? tile : ''}`}
            >
              {useBrandTile ? (
                <Icon className='h-3.5 w-3.5 text-white' />
              ) : (
                <Icon className='h-full w-full' />
              )}
            </span>
            {p.brandLabel}
          </Surface>
        )
      })}
    </nav>
  )
}

function Breadcrumb({ platform }: { platform: Platform }) {
  return (
    <nav
      aria-label='Breadcrumb'
      className='mb-3 flex justify-center text-[11px] text-white/55 md:text-xs'
    >
      <ol className='flex items-center gap-1.5'>
        <li>
          <Link href='/' className='transition-colors hover:text-white/85'>
            Home
          </Link>
        </li>
        <li aria-hidden className='text-white/30'>
          /
        </li>
        <li aria-current='page' className='text-white/85'>
          {platform.brandLabel}
        </li>
      </ol>
    </nav>
  )
}

export function PlatformLanding({ platform }: { platform: Platform }) {
  return (
    <div className='app-bg relative min-h-[100dvh] overflow-clip'>
      {/* Fixed so the interactive grid + spotlight track the viewport across
          the full scroll length of the page. */}
      <div className='pointer-events-none fixed inset-0 z-0'>
        <InteractiveBackground />
      </div>

      <div className='relative z-10 mx-auto max-w-6xl px-4 py-10 sm:py-16'>
        <main>
        {/* HERO — brand row, breadcrumb, headline, and the paste-bar. */}
        <Surface
          glow
          radius='3xl'
          className='animate-card-enter mx-auto w-full max-w-3xl p-5 shadow-2xl sm:p-8 md:p-10'
        >
          <div className='animate-fade-in-up text-center'>
            <PlatformIconRow activeSlug={platform.slug} />
            <Breadcrumb platform={platform} />
            <h1 className='mb-3 text-2xl font-extrabold tracking-tight text-white text-balance sm:text-3xl md:text-4xl'>
              {platform.h1}
            </h1>
            <p className='mx-auto mb-7 max-w-xl text-sm text-white/70 md:text-base'>
              {platform.tagline}
            </p>
          </div>

          {/* Interactive island — paste bar + results */}
          <DownloaderApp />

          {/* Reassurance chips */}
          <div className='mt-7 flex flex-wrap justify-center gap-2'>
            {heroChips.map((chip) => (
              <span
                key={chip}
                className='inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-1.5 text-xs text-white/70 md:text-sm'
              >
                <span className='h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]' />
                {chip}
              </span>
            ))}
          </div>

          {/* Dev / companion-app links */}
          <DevAppLinks />
        </Surface>

        {/* WHAT YOU CAN DO — platform feature list */}
        <section className='mt-16 sm:mt-24'>
          <SectionHead title={`With this ${platform.name} downloader you can`} />
          <ul className='mx-auto grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2'>
            {platform.featureList.map((f) => (
              <Surface
                key={f}
                as='li'
                className='flex items-start gap-3 p-4 text-sm text-white/80'
              >
                <CheckMark className='mt-0.5 h-4 w-4 shrink-0 text-cyan-300' />
                <span>{f}</span>
              </Surface>
            ))}
          </ul>
        </section>

        {/* HIGHLIGHT CARDS */}
        <section className='mt-16 sm:mt-24'>
          <div className='grid gap-4 md:grid-cols-3'>
            {platform.cards.map((card) => (
              <Surface
                key={card.title}
                as='article'
                interaction='lift'
                className='p-5'
              >
                <h3 className='mb-2 font-semibold text-white'>{card.title}</h3>
                <p className='text-sm text-white/75'>{card.body}</p>
              </Surface>
            ))}
          </div>
        </section>

        {/* CROSS-LINKS */}
        <section className='mt-16 sm:mt-24'>
          <SectionHead
            title='Also try our other downloaders'
            sub='One tool per platform — pick whichever you need.'
          />
          <CrossLinkNav activeSlug={platform.slug} />
        </section>

        {/* Compact, because these pages arrive from search with one link in
            mind. The full split belongs on the home page, where someone is
            already browsing; here it is a single line that names the one thing
            worth paying for and gets out of the way. */}
        <section className='mt-16 sm:mt-24'>
          <SupportPanel variant='compact' />
        </section>

        <section className='mt-16 sm:mt-24'>
          <PromoSlot
            placement='in-content'
            platform={OFFER_PLATFORM_BY_SLUG[platform.slug]}
          />
        </section>

        {/* SEO PROSE + FAQ */}
        <section
          aria-labelledby='seo-heading'
          className='mt-16 grid gap-10 sm:mt-24 lg:grid-cols-2 lg:gap-14'
        >
          <div>
            <Eyebrow>Why it works</Eyebrow>
            <h2
              id='seo-heading'
              className='mb-4 text-2xl font-bold tracking-tight text-white text-balance md:text-3xl'
            >
              Free {platform.brandLabel} — {platform.tagline}
            </h2>
            <p className='mb-8 max-w-[60ch] text-sm leading-relaxed text-white/80 md:text-base'>
              {platform.intro}
            </p>

            <Eyebrow>Supported {platform.name} URL formats</Eyebrow>
            <ul className='grid grid-cols-1 gap-x-6 gap-y-1.5 font-mono text-[11px] text-white/55 sm:grid-cols-2 md:text-xs'>
              {platform.urlExamples.map((u) => (
                <li key={u} className='truncate'>
                  {u}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className='mb-5 text-2xl font-bold tracking-tight text-white md:text-3xl'>
              {platform.name} downloader — Frequently asked questions
            </h2>
            <LazyFAQ items={platform.faqs} />
          </div>
        </section>
        </main>

        <SiteFooter />
      </div>
    </div>
  )
}
