import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter } from '@/components/SiteFooter'
import { siteConfig } from '@/config/site'

export const metadata: Metadata = {
  title: 'Terms of Service — Social Media Downloader',
  description: `The terms for using ${siteConfig.name}: as-is service, your responsibility for content rights, and what supporting the project does and does not buy.`,
  alternates: { canonical: '/terms' },
}

const UPDATED = '10 August 2026'

export default function Terms() {
  return (
    <div className='app-bg relative min-h-[100dvh] overflow-clip'>
      <div className='relative z-10 mx-auto max-w-3xl px-4 py-10 sm:py-16'>
        <h1 className='text-3xl font-bold tracking-tight text-white sm:text-4xl'>
          Terms of Service
        </h1>
        <p className='mt-2 text-sm text-white/50'>Last updated {UPDATED}</p>

        <div className='mt-8 space-y-6 text-sm leading-relaxed text-white/70 md:text-base'>
          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>Provided as-is</h2>
            <p>
              {siteConfig.name} is provided &ldquo;as is&rdquo; with no warranty of
              any kind, express or implied. We do not guarantee uninterrupted
              access, that every link will resolve, or that any particular
              platform will keep working.
            </p>
          </section>

          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>Your responsibility</h2>
            <p>
              You are responsible for having the right to download any content
              you process through this site &mdash; your own uploads, content
              you have permission to save, or material that is otherwise legally
              yours to download. We do not host or vet the media you link to.
            </p>
          </section>

          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>No commercial redistribution</h2>
            <p>
              Downloaded media is for personal use. You may not resell,
              re-upload for profit, or otherwise commercially redistribute
              content you did not create or license.
            </p>
          </section>

          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>What this site will not do</h2>
            <p>
              {siteConfig.name} reaches only what is already publicly
              accessible. It does not bypass DRM, defeat a paywall, sign in on
              your behalf, or reach private accounts, subscriber-only posts, or
              anything else a platform serves only to a logged-in viewer.
              Supporting the project does not change this: what supporters get
              affects how work is queued and how results are packaged, never
              what a link can reach.
            </p>
            <p className='mt-2'>
              Using this site to infringe copyright, or to access material you
              have no right to, is a breach of these terms. We may refuse
              service or close an account for it.
            </p>
          </section>

          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>Trademarks and affiliation</h2>
            <p>
              {siteConfig.name} is an independent tool and is{' '}
              <strong className='text-white/90'>
                not affiliated with, endorsed by, or sponsored by
              </strong>{' '}
              TikTok, X, Instagram, Facebook, YouTube, Pinterest, Reddit,
              Threads, Snapchat, Twitch, Vimeo, or any other platform named on
              this site. Those names and logos belong to their respective
              owners and are used only to describe which links this tool
              accepts.
            </p>
          </section>

          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>Rights holders</h2>
            <p>
              We do not host, store, or index media. Files are fetched from the
              source platform at the moment you ask for them and are never kept
              on our servers, so there is nothing here to take down. If you
              believe this service is being used to infringe your rights, email{' '}
              <a
                className='text-cyan-300 hover:text-cyan-200'
                href={`mailto:${siteConfig.supportEmail}`}
              >
                {siteConfig.supportEmail}
              </a>{' '}
              and we will respond.
            </p>
          </section>

          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>
              Supporting this project
            </h2>
            <p>
              Nothing on {siteConfig.name} is for sale. There is no
              subscription, no plan, and no charge of any kind &mdash; if you
              are ever billed by something claiming to be this site, it is not
              us, and we would like to hear about it.
            </p>
            <p className='mt-2'>
              You can support the project voluntarily through Buy Me a Coffee.
              That is a donation, handled entirely by them under their own
              terms: it is one-off, it does not renew, and there is nothing here
              to cancel. As a thank-you we switch some conveniences on for your
              account &mdash; a batch queue, ZIP bundling for a run, priority
              resolve, custom file names, and no sponsor card &mdash; by hand,
              after you email us.
            </p>
            <p className='mt-2'>
              Those conveniences are a gift and not a purchased entitlement. We
              may change or withdraw them at any time, and because no sale takes
              place there is nothing to refund. None of them change what a link
              can reach; see above.
            </p>
            <p className='mt-2'>
              If you want a donation reversed, that is between you and Buy Me a
              Coffee, though emailing{' '}
              <a
                className='text-cyan-300 hover:text-cyan-200'
                href={`mailto:${siteConfig.supportEmail}`}
              >
                {siteConfig.supportEmail}
              </a>{' '}
              first is usually faster.
            </p>
          </section>

          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>Changes to the service</h2>
            <p>
              The service may change, be limited, or be discontinued at any time
              without notice.
            </p>
          </section>

          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>Contact</h2>
            <p>
              Support requests and takedown notices both go to{' '}
              <a
                className='text-cyan-300 hover:text-cyan-200'
                href={`mailto:${siteConfig.supportEmail}`}
              >
                {siteConfig.supportEmail}
              </a>
              , read by{' '}
              <a
                className='text-cyan-300 hover:text-cyan-200'
                href={siteConfig.author.url}
              >
                {siteConfig.author.name}
              </a>
              .
            </p>
          </section>
        </div>

        <Link href='/' className='mt-10 inline-block text-sm text-cyan-300 hover:text-cyan-200'>
          ← Back to the downloader
        </Link>

        <SiteFooter />
      </div>
    </div>
  )
}
