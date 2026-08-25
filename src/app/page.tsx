import Link from 'next/link'
import { DownloaderApp } from '@/components/DownloaderApp'
import { Surface } from '@/components/Surface'
import { InteractiveBackground } from '@/components/InteractiveBackground'
import { LazyFAQ } from '@/components/LazyFAQ'
import { ProHeroLine } from '@/components/ProNudge'
import { SupportPanel } from '@/components/SupportPanel'
import { PromoSlot } from '@/components/PromoSlot'
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
import { DevAppLinks } from '@/components/DevAppLinks'
import { SiteFooter } from '@/components/SiteFooter'
import { homepageFaqs } from '@/lib/homepageFaqs'
import { platforms } from '@/lib/platforms'
import { WHATS_NEW } from '@/config/whatsNew'
import { homepageStructuredData } from '@/lib/structuredData'

const heroChips = [
  'Free forever',
  'No login to download',
  'No download limits',
  'HD quality',
  'Any public link',
] as const

const howItWorksSteps = [
  {
    n: 1,
    title: 'Copy a video URL',
    sub: 'TikTok, X, Instagram, YouTube — or any public video link.',
  },
  {
    n: 2,
    title: 'Paste & download',
    sub: 'We resolve the media in seconds — right in your browser.',
  },
  {
    n: 3,
    title: 'Save it',
    sub: 'Video, MP3, or the full image gallery. Done.',
  },
] as const

// Line icons for the "what you can do" grid — replaces the old emoji glyphs.
function IconVideo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={1.6} strokeLinecap='round' strokeLinejoin='round'>
      <path d='m10 8 6 4-6 4V8z' />
      <rect x='3' y='4' width='18' height='16' rx='3' />
    </svg>
  )
}
function IconAudio({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={1.6} strokeLinecap='round' strokeLinejoin='round'>
      <path d='M9 18V6l10-2v12' />
      <circle cx='6' cy='18' r='3' />
      <circle cx='16' cy='16' r='3' />
    </svg>
  )
}
function IconGallery({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={1.6} strokeLinecap='round' strokeLinejoin='round'>
      <rect x='3' y='3' width='18' height='18' rx='3' />
      <circle cx='9' cy='9' r='2' />
      <path d='m21 15-5-5L5 21' />
    </svg>
  )
}
function IconZip({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={1.6} strokeLinecap='round' strokeLinejoin='round'>
      <path d='M21 8v13H3V8' />
      <rect x='1' y='3' width='22' height='5' rx='1' />
      <path d='M10 12h4' />
    </svg>
  )
}

const whatYouCanDo = [
  {
    Icon: IconVideo,
    label: 'HD video',
    sub: 'The full-quality source MP4, not a screen recording — seeking works.',
  },
  {
    Icon: IconAudio,
    label: 'MP3 audio',
    sub: 'Pull the soundtrack — perfect for trending sounds.',
  },
  {
    Icon: IconGallery,
    label: 'Photo galleries',
    sub: 'Carousels come through at full resolution to pick from.',
  },
  {
    Icon: IconZip,
    label: 'Batch ZIP',
    sub: 'Grab every image in a slideshow as one download.',
  },
] as const

const platformLinkTiles: Record<
  string,
  { tile: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  'video-downloader': { tile: 'bg-cyan-600', Icon: FilmIcon },
  'tiktok-downloader': { tile: 'bg-[#010101]', Icon: TikTokIcon },
  'twitter-video-downloader': { tile: 'bg-black', Icon: TwitterXIcon },
  'instagram-downloader': { tile: 'bg-transparent', Icon: InstagramIcon },
  'facebook-downloader': { tile: 'bg-transparent', Icon: FacebookIcon },
  'youtube-downloader': { tile: 'bg-transparent', Icon: YouTubeIcon },
  'pinterest-downloader': { tile: 'bg-[#E60023]', Icon: PinterestIcon },
  'reddit-video-downloader': { tile: 'bg-[#FF4500]', Icon: RedditIcon },
  'threads-video-downloader': { tile: 'bg-black', Icon: ThreadsIcon },
  'snapchat-downloader': { tile: 'bg-[#FFFC00]', Icon: SnapchatIcon },
  'twitch-clip-downloader': { tile: 'bg-[#9146FF]', Icon: TwitchIcon },
  'vimeo-downloader': { tile: 'bg-[#1AB7EA]', Icon: VimeoIcon },
}

// The 5 brand tiles that sit above the headline — each links to its dedicated
// downloader page.
const heroPlatforms = [
  {
    href: '/tiktok-downloader',
    label: 'TikTok video downloader',
    tile: 'bg-[#010101]',
    Icon: TikTokIcon,
    brand: false,
  },
  {
    href: '/twitter-video-downloader',
    label: 'Twitter/X video downloader',
    tile: 'bg-black',
    Icon: TwitterXIcon,
    brand: false,
  },
  {
    href: '/instagram-downloader',
    label: 'Instagram reels & photo downloader',
    tile: '',
    Icon: InstagramIcon,
    brand: true,
  },
  {
    href: '/facebook-downloader',
    label: 'Facebook video & reels downloader',
    tile: '',
    Icon: FacebookIcon,
    brand: true,
  },
  {
    href: '/youtube-downloader',
    label: 'YouTube & Shorts downloader',
    tile: '',
    Icon: YouTubeIcon,
    brand: true,
  },
] as const

// Centered section header (title + one-line sub). Used by the full-width bands.
function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className='mx-auto mb-9 max-w-2xl text-center'>
      <h2 className='text-2xl font-bold tracking-tight text-white text-balance sm:text-3xl'>
        {title}
      </h2>
      <p className='mt-3 text-sm text-white/60 md:text-base'>{sub}</p>
    </div>
  )
}

// Small uppercase eyebrow with a fading cyan hairline — for in-column labels.
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <h3 className='mb-4 flex items-center gap-3 text-xs font-semibold tracking-[0.13em] uppercase text-white/60'>
      {children}
      <span className='h-px flex-1 bg-gradient-to-r from-cyan-400/30 to-transparent' />
    </h3>
  )
}

export default function Home() {
  return (
    <>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(homepageStructuredData()),
        }}
      />
      <div className='app-bg relative min-h-[100dvh] overflow-clip'>
        {/* Fixed so the interactive grid + spotlight track the viewport across
            the full scroll length of the page. */}
        <div className='pointer-events-none fixed inset-0 z-0'>
          <InteractiveBackground />
        </div>

        <div className='relative z-10 mx-auto max-w-6xl px-4 py-10 sm:py-16'>
          <main>
          {/* ---------------------------------------------------------------
              HERO — brand tiles, headline, and the paste-bar (the product).
              Download results expand directly under the bar, inside the card.
          ---------------------------------------------------------------- */}
          <Surface
            glow
            radius='3xl'
            className='animate-card-enter mx-auto w-full max-w-3xl p-5 shadow-2xl sm:p-8 md:p-10'
          >
            <div className='animate-fade-in-up text-center'>
              <div className='mb-6 flex justify-center'>
                <div className='flex items-center gap-2 md:gap-2.5'>
                  {heroPlatforms.map((p) => (
                    <Link
                      key={p.href}
                      href={p.href}
                      aria-label={p.label}
                      className='block'
                    >
                      <span
                        className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl icon-lift ring-1 ring-white/15 shadow-lg shadow-black/30 md:h-12 md:w-12 ${
                          p.brand ? '' : p.tile
                        }`}
                      >
                        {p.brand ? (
                          <p.Icon className='h-full w-full' />
                        ) : (
                          <p.Icon className='h-5 w-5 text-white md:h-6 md:w-6' />
                        )}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>

              <h1 className='mb-3 text-3xl font-extrabold tracking-tight text-white text-balance sm:text-4xl md:text-5xl'>
                Download any public video,{' '}
                <span className='text-grad'>in original quality</span>
              </h1>
              <p className='mx-auto mb-3 max-w-xl text-sm text-white/70 md:text-base'>
                Save the video, extract MP3 audio, or grab full image galleries
                from public posts on TikTok, X, Instagram, Facebook, YouTube,
                Pinterest, Reddit, Threads, Snapchat, Twitch &amp; Vimeo.
              </p>
              {/* The first mention of Pro anywhere above the fold. Self-hides
                  for a subscriber. */}
              <ProHeroLine />
            </div>

            {/* Interactive island — paste bar + results */}
            <DownloaderApp />

            {/* Reassurance chips. "Any public link" is the one chip that is
                also a link: it names the universal downloader page, which is
                both where a curious visitor goes next and an internal link to
                it from every page that shows this hero. */}
            <div className='mt-7 flex flex-wrap justify-center gap-2'>
              {heroChips.map((chip) => {
                const inner = (
                  <>
                    <span className='h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]' />
                    {chip}
                  </>
                )
                const cls =
                  'inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-1.5 text-xs text-white/70 transition-colors hover:text-white md:text-sm'
                if (chip !== 'Any public link') {
                  return (
                    <span key={chip} className={cls}>
                      {inner}
                    </span>
                  )
                }
                return (
                  <Link key={chip} href='/video-downloader' className={cls}>
                    {inner}
                  </Link>
                )
              })}
            </div>

            {/* Dev / companion-app links */}
            <DevAppLinks />
          </Surface>

          {/* ---------------------------------------------------------------
              WHAT YOU CAN DO — 4-across feature band
          ---------------------------------------------------------------- */}
          <section className='mt-16 sm:mt-24'>
            <SectionHead
              title='Everything from one link'
              sub='One paste, four ways to save it. No app, no account, nothing installed.'
            />
            <div className='grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4'>
              {whatYouCanDo.map((t) => (
                // Surface, border, shadow and sub-copy all step up together on
                // hover. Lifting the card alone left the hovered tile looking as
                // dim as its neighbours, which defeats the point in a
                // four-across band you're meant to skim. `.card-lift` carries
                // the shared geometry (see globals.css); only the copy and icon
                // response, which are specific to this card, live here.
                <Surface
                  key={t.label}
                  interaction='lift'
                  className='group p-5'
                >
                  <t.Icon className='mb-4 h-6 w-6 text-cyan-300 drop-shadow-[0_2px_6px_rgba(34,211,238,0.35)] transition-transform duration-200 group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100' />
                  <p className='font-semibold text-white'>{t.label}</p>
                  <p className='mt-1 text-sm text-white/60 transition-colors duration-200 group-hover:text-white/85'>
                    {t.sub}
                  </p>
                </Surface>
              ))}
            </div>
          </section>

          {/* ---------------------------------------------------------------
              HOW IT WORKS — 3 steps
          ---------------------------------------------------------------- */}
          <section className='mt-16 sm:mt-24'>
            <SectionHead
              title='Three steps, a few seconds'
              sub='No tutorials. No settings. Paste and go.'
            />
            <ol className='grid gap-3 md:grid-cols-3 md:gap-4'>
              {howItWorksSteps.map((s) => (
                <Surface
                  key={s.n}
                  as='li'
                  id={`step-${s.n}`}
                  interaction='lift'
                  className='group scroll-mt-24 p-6'
                >
                  <div className='btn-grad mb-4 flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100'>
                    {s.n}
                  </div>
                  <p className='font-semibold text-white'>{s.title}</p>
                  <p className='mt-1 text-sm text-white/60'>{s.sub}</p>
                </Surface>
              ))}
            </ol>
          </section>

          {/* ---------------------------------------------------------------
              PLATFORM QUICK LINKS
          ---------------------------------------------------------------- */}
          <section className='mt-16 sm:mt-24'>
            <SectionHead
              title='Jump to a dedicated downloader'
              sub='Prefer a page built for one platform? Pick yours.'
            />
            <nav
              aria-label='Per-platform downloaders'
              className='mx-auto flex max-w-md flex-col gap-2.5 sm:max-w-none sm:flex-row sm:flex-wrap sm:justify-center'
            >
              {platforms.map((p) => {
                const cfg = platformLinkTiles[p.slug]
                if (!cfg) return null
                const { tile, Icon } = cfg
                const useBrandTile = !tile.startsWith('bg-transparent')
                return (
                  <Surface
                    key={p.slug}
                    as={Link}
                    href={`/${p.slug}`}
                    interaction='lift'
                    radius='xl'
                    className='inline-flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-white/80 hover:text-white sm:w-auto'
                  >
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${
                        useBrandTile ? tile : ''
                      }`}
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
          </section>

          {/* ---------------------------------------------------------------
              SUPPORT — the ask, and the only one on the page
          ---------------------------------------------------------------- */}
          <section className='mt-16 sm:mt-24'>
            <SupportPanel />
          </section>

          {/* The same below-the-fold slot the platform pages carry. No platform
              prop here: the home page serves every platform, so only offers
              marked `platforms: 'all'` are eligible. Sits after the grid and
              before the prose, mirroring PlatformLanding exactly. */}
          <section className='mt-16 sm:mt-24'>
            <PromoSlot placement='in-content' />
          </section>

          {/* ---------------------------------------------------------------
              SEO PROSE + FAQ — two columns on desktop
          ---------------------------------------------------------------- */}
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
                Free TikTok, X, Instagram, Facebook &amp; YouTube Video
                Downloader
              </h2>
              <p className='mb-4 max-w-[60ch] text-sm leading-relaxed text-white/80 md:text-base'>
                Save any public TikTok, Twitter/X, Instagram, Facebook, or
                YouTube post in a couple of clicks. Paste the link, preview the
                content, and download the full-quality video, the original MP3
                soundtrack, or every image from a photo carousel.
              </p>
              <p className='mb-8 max-w-[60ch] text-sm leading-relaxed text-white/80 md:text-base'>
                Everything happens in your browser — no app, no sign-up, and no
                limit on how much you save. Only publicly visible posts are
                reachable, and you are responsible for having the rights to
                whatever you download.
              </p>

              <Eyebrow>Supported link formats</Eyebrow>
              <ul className='grid grid-cols-1 gap-x-6 gap-y-1.5 font-mono text-[11px] text-white/55 sm:grid-cols-2 md:text-xs'>
                <li className='truncate'>tiktok.com/@user/video/…</li>
                <li className='truncate'>vm.tiktok.com/…</li>
                <li className='truncate'>x.com/user/status/…</li>
                <li className='truncate'>instagram.com/p/…</li>
                <li className='truncate'>instagram.com/reel/…</li>
                <li className='truncate'>youtube.com/watch?v=…</li>
                <li className='truncate'>youtu.be/… · /shorts/…</li>
                <li className='truncate'>facebook.com/…/videos/…</li>
                <li className='truncate'>fb.watch/… · /reel/…</li>
                <li className='truncate'>pinterest.com/pin/… · pin.it/…</li>
                <li className='truncate'>reddit.com/r/…/comments/…</li>
                <li className='truncate'>threads.net/@user/post/…</li>
                <li className='truncate'>snapchat.com/spotlight/…</li>
                <li className='truncate'>twitch.tv/…/clip/…</li>
                <li className='truncate'>vimeo.com/…</li>
              </ul>
            </div>

            <div>
              <h2 className='mb-5 text-2xl font-bold tracking-tight text-white md:text-3xl'>
                Frequently asked questions
              </h2>
              <LazyFAQ items={homepageFaqs} />
            </div>
          </section>

          {/* ---------------------------------------------------------------
              WHAT'S NEW — proof of life, four lines, newest first. Config-fed
              (src/config/whatsNew.ts) and pruned rather than accumulated, so
              it never becomes a wall nobody reads.
          ---------------------------------------------------------------- */}
          {WHATS_NEW.length > 0 && (
            <section className='mt-16 sm:mt-24'>
              <SectionHead
                title='Recently added'
                sub='The tool is under active development — here is what changed lately.'
              />
              <ol className='mx-auto grid max-w-3xl gap-2.5'>
                {WHATS_NEW.map((item) => (
                  // <li> rather than the Surface directly: an <ol> may only
                  // contain list items, and a dated changelog is exactly the
                  // ordered list a screen reader should announce as one.
                  <li key={item.title}>
                    <Surface className='flex items-start gap-3 p-4'>
                      <span className='shrink-0 rounded-md border border-cyan-400/25 bg-cyan-400/10 px-2 py-0.5 text-[11px] font-medium text-cyan-300'>
                        {item.date}
                      </span>
                      <span className='min-w-0 text-sm text-white/70'>
                        <strong className='font-semibold text-white'>{item.title}.</strong>{' '}
                        {item.detail}
                      </span>
                    </Surface>
                  </li>
                ))}
              </ol>
            </section>
          )}
          </main>

          <SiteFooter />
        </div>
      </div>
    </>
  )
}
