import { DownloaderApp } from '@/components/DownloaderApp'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  GitHubIcon,
  PortfolioIcon,
  TikTokIcon,
  TwitterXIcon,
} from '@/components/icons'

const devLinks = [
  {
    href: 'https://www.mohamedgado.com/',
    label: 'Portfolio',
    Icon: PortfolioIcon,
    grad: 'from-pink-500/80 to-violet-500/80',
  },
  {
    href: 'https://github.com/Vette1123/tiktok-downloader',
    label: 'GitHub',
    Icon: GitHubIcon,
    grad: 'from-violet-500/80 to-cyan-400/80',
  },
] as const

const howItWorksSteps = [
  {
    n: 1,
    title: 'Copy a video URL',
    sub: 'From TikTok or Twitter/X',
    grad: 'from-pink-500 to-pink-400',
  },
  {
    n: 2,
    title: 'Paste & process',
    sub: 'We resolve the media in seconds',
    grad: 'from-fuchsia-500 to-violet-500',
  },
  {
    n: 3,
    title: 'Download',
    sub: 'Video, MP3, or full image gallery',
    grad: 'from-violet-500 to-cyan-400',
  },
] as const

const whatYouCanDo = [
  {
    emoji: '🎬',
    label: 'HD Video',
    sub: 'No watermark',
    grad: 'from-pink-500/20 to-rose-500/10',
    ring: 'ring-pink-500/30',
  },
  {
    emoji: '🎵',
    label: 'MP3 audio',
    sub: 'Extract soundtrack',
    grad: 'from-emerald-500/20 to-teal-500/10',
    ring: 'ring-emerald-500/30',
  },
  {
    emoji: '🖼️',
    label: 'Slideshow',
    sub: 'Image carousels',
    grad: 'from-violet-500/20 to-fuchsia-500/10',
    ring: 'ring-violet-500/30',
  },
  {
    emoji: '🗜️',
    label: 'Batch ZIP',
    sub: 'All images at once',
    grad: 'from-sky-500/20 to-cyan-500/10',
    ring: 'ring-cyan-500/30',
  },
] as const

const trustStrip = [
  { k: 'Free', v: 'forever', accent: 'text-emerald-300' },
  { k: 'No login', v: 'required', accent: 'text-sky-300' },
  { k: 'No limit', v: 'on downloads', accent: 'text-pink-300' },
] as const

const mobileFeatures = [
  { color: 'bg-green-400', label: 'Watermark-free downloads' },
  { color: 'bg-blue-400', label: 'HD quality preservation' },
  { color: 'bg-purple-400', label: 'MP3 audio extraction' },
  { color: 'bg-pink-400', label: 'Video preview' },
  { color: 'bg-yellow-400', label: 'Image gallery downloads' },
  { color: 'bg-indigo-400', label: 'Multiple URL formats' },
  { color: 'bg-teal-400', label: 'Batch image selection' },
  { color: 'bg-orange-400', label: 'Fast processing' },
] as const

const seoCards = [
  {
    title: '🎬 Videos in HD',
    body: 'Watermark-free TikTok downloads and native Twitter/X video rips, served with proper range requests so preview and seeking work flawlessly.',
  },
  {
    title: '🎵 MP3 audio extraction',
    body: 'Pull the soundtrack from any TikTok video or slideshow. Photo carousels keep the original background music — perfect for trending sounds.',
  },
  {
    title: '🖼️ Photo carousels',
    body: 'TikTok slideshows come through as a full-resolution gallery. Preview, pick favorites, then save individually or as a single ZIP.',
  },
] as const

function HowItWorks() {
  return (
    <div className='bg-white/5 rounded-xl p-5 border border-white/10'>
      <h3 className='text-white font-semibold mb-4 text-sm md:text-base flex items-center'>
        🚀 How it works
        <div className='ml-2 w-8 h-0.5 bg-gradient-to-r from-pink-500 to-violet-500 rounded' />
      </h3>
      <ol className='space-y-3'>
        {howItWorksSteps.map((s) => (
          <li key={s.n} className='flex items-start gap-3 group'>
            <div
              className={`shrink-0 w-7 h-7 rounded-full bg-gradient-to-br ${s.grad} flex items-center justify-center text-white text-xs font-bold shadow-md ring-1 ring-white/20`}
            >
              {s.n}
            </div>
            <div className='min-w-0'>
              <p className='text-white text-sm font-medium leading-tight'>
                {s.title}
              </p>
              <p className='text-white/55 text-xs mt-0.5'>{s.sub}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function IdleRightContent() {
  return (
    <div className='space-y-4'>
      {/* What you can do — 2x2 bento grid */}
      <div className='bg-white/5 rounded-xl p-5 border border-white/10'>
        <h3 className='text-white font-semibold mb-4 text-sm md:text-base flex items-center'>
          ✨ What you can do
          <div className='ml-2 w-8 h-0.5 bg-gradient-to-r from-pink-500 to-violet-500 rounded' />
        </h3>
        <div className='grid grid-cols-2 gap-3'>
          {whatYouCanDo.map((t) => (
            <div
              key={t.label}
              className={`bg-gradient-to-br ${t.grad} rounded-lg p-3 ring-1 ${t.ring} border border-white/5 transition-transform duration-200 hover:-translate-y-0.5`}
            >
              <div className='text-2xl mb-1.5 leading-none'>{t.emoji}</div>
              <p className='text-white text-sm font-semibold leading-tight'>
                {t.label}
              </p>
              <p className='text-white/55 text-xs mt-0.5'>{t.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Supported link formats */}
      <div className='bg-white/5 rounded-xl p-5 border border-white/10'>
        <h3 className='text-white font-semibold mb-3 text-sm md:text-base flex items-center'>
          🔗 Supported link formats
          <div className='ml-2 w-8 h-0.5 bg-gradient-to-r from-cyan-400 to-sky-500 rounded' />
        </h3>
        <ul className='grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] md:text-xs text-white/65 font-mono'>
          <li className='truncate'>tiktok.com/@user/video/…</li>
          <li className='truncate'>vm.tiktok.com/…</li>
          <li className='truncate'>vt.tiktok.com/…</li>
          <li className='truncate'>twitter.com/user/status/…</li>
          <li className='truncate'>x.com/user/status/…</li>
        </ul>
      </div>

      {/* Trust strip */}
      <div className='grid grid-cols-3 gap-2'>
        {trustStrip.map((b) => (
          <div
            key={b.k}
            className='bg-white/5 rounded-lg p-3 border border-white/10 text-center'
          >
            <p className={`text-sm font-semibold ${b.accent}`}>{b.k}</p>
            <p className='text-white/50 text-[10px] md:text-xs mt-0.5'>{b.v}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <div className='relative min-h-screen overflow-clip bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex justify-center items-start py-6 px-4'>
      <div
        aria-hidden
        className='blob-1 pointer-events-none absolute -top-32 -left-32 h-[28rem] w-[28rem] rounded-full bg-pink-500/30 blur-3xl'
      />
      <div
        aria-hidden
        className='blob-2 pointer-events-none absolute -bottom-40 -right-32 h-[32rem] w-[32rem] rounded-full bg-cyan-400/25 blur-3xl'
      />
      <div
        aria-hidden
        className='blob-3 pointer-events-none absolute top-1/3 left-1/2 h-[24rem] w-[24rem] -translate-x-1/2 rounded-full bg-violet-500/20 blur-3xl'
      />

      <div className='relative z-10 my-auto w-full max-w-sm md:max-w-2xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl bg-white/10 backdrop-blur-lg rounded-2xl p-4 md:p-8 shadow-2xl border border-white/20'>
        {/* Header */}
        <div className='text-center mb-6 md:mb-8'>
          <div className='flex justify-center mb-4'>
            <div className='flex items-center space-x-3'>
              <div className='w-10 h-10 md:w-12 md:h-12 bg-[#010101] rounded-full flex items-center justify-center ring-2 ring-white/20'>
                <TikTokIcon className='w-5 h-5 md:w-6 md:h-6 text-white' />
              </div>
              <div className='w-10 h-10 md:w-12 md:h-12 bg-black rounded-full flex items-center justify-center ring-2 ring-white/20'>
                <TwitterXIcon className='w-5 h-5 md:w-6 md:h-6 text-white' />
              </div>
            </div>
          </div>
          <h1 className='text-2xl md:text-3xl lg:text-4xl font-bold text-white mb-2'>
            Social Media Downloader
          </h1>
          <p className='text-sm md:text-base text-white/70 mb-4'>
            Download videos without watermarks, extract MP3 audio, or save
            images from TikTok &amp; Twitter/X
          </p>
          <div className='flex justify-center items-center gap-3'>
            {devLinks.map(({ href, label, Icon, grad }) => (
              <a
                key={label}
                href={href}
                target='_blank'
                rel='noopener noreferrer'
                className='group relative flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/15 overflow-hidden backdrop-blur-sm transition-transform duration-200 hover:-translate-y-0.5 active:scale-95'
              >
                <span
                  className={`absolute inset-0 bg-gradient-to-r ${grad} opacity-0 group-hover:opacity-100 transition-opacity duration-300`}
                  aria-hidden
                />
                <span
                  className='pointer-events-none absolute inset-0 rounded-xl ring-1 ring-white/10 group-hover:ring-white/30 transition-all duration-300'
                  aria-hidden
                />
                <Icon className='relative w-4 h-4 text-white/80 group-hover:text-white transition-colors duration-300' />
                <span className='relative text-white/80 group-hover:text-white text-sm font-medium transition-colors duration-300'>
                  {label}
                </span>
              </a>
            ))}
          </div>
        </div>

        {/* Interactive island — form + results */}
        <DownloaderApp
          idleLeftSlot={<HowItWorks />}
          idleRightSlot={<IdleRightContent />}
        />

        {/* Features List - Mobile only */}
        <div className='lg:hidden bg-white/5 rounded-xl p-4 mt-6 border border-white/10'>
          <h3 className='text-white font-semibold mb-4 text-sm md:text-base flex items-center'>
            ✨ Features
            <div className='ml-2 w-8 h-0.5 bg-gradient-to-r from-pink-500 to-violet-500 rounded' />
          </h3>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-3 text-xs md:text-sm'>
            {mobileFeatures.map((f) => (
              <div
                key={f.label}
                className='flex items-center space-x-2 text-white/70'
              >
                <div className={`w-2 h-2 ${f.color} rounded-full`} />
                <span>{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* SEO Content */}
        <section
          aria-labelledby='seo-heading'
          className='mt-10 space-y-6 text-white/80'
        >
          <div>
            <h2
              id='seo-heading'
              className='text-xl md:text-2xl font-bold text-white mb-3'
            >
              Free TikTok &amp; Twitter/X Video Downloader
            </h2>
            <p className='text-sm md:text-base leading-relaxed'>
              Save any TikTok or Twitter/X post in a couple of clicks. Paste
              the link, preview the content, and download the full-quality
              video, the original MP3 soundtrack, or every image from a TikTok
              photo carousel. Everything happens in your browser — no app, no
              sign-up, no watermark.
            </p>
          </div>

          <div className='grid md:grid-cols-3 gap-4'>
            {seoCards.map((card) => (
              <article
                key={card.title}
                className='bg-white/5 rounded-xl p-4 border border-white/10 hover:border-white/30 transition-all duration-200 hover:-translate-y-1 hover:scale-[1.02]'
              >
                <h3 className='text-white font-semibold mb-2'>{card.title}</h3>
                <p className='text-sm'>{card.body}</p>
              </article>
            ))}
          </div>

          <div>
            <h2 className='text-xl md:text-2xl font-bold text-white mb-3'>
              Frequently asked questions
            </h2>
            <Accordion
              type='single'
              collapsible
              defaultValue='faq-1'
              className='space-y-3'
            >
              <AccordionItem value='faq-1'>
                <AccordionTrigger>
                  Is this TikTok downloader free?
                </AccordionTrigger>
                <AccordionContent>
                  Yes — completely free, with no sign-up and no daily download
                  limit.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value='faq-2'>
                <AccordionTrigger>
                  Do downloaded TikTok videos have a watermark?
                </AccordionTrigger>
                <AccordionContent>
                  No. Videos are saved in HD quality, free of the TikTok
                  watermark.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value='faq-3'>
                <AccordionTrigger>
                  Can I download a TikTok photo carousel (slideshow)?
                </AccordionTrigger>
                <AccordionContent>
                  Paste the slideshow URL. The app lists every image, the
                  background track, and — when TikTok provides one — the full
                  rendered slideshow video, so you can grab the photos, the
                  MP3, or the MP4 in a single flow.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value='faq-4'>
                <AccordionTrigger>Does it work on Twitter/X?</AccordionTrigger>
                <AccordionContent>
                  Yes — paste any twitter.com or x.com status URL and the tool
                  resolves the underlying media automatically.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </section>
      </div>
    </div>
  )
}
