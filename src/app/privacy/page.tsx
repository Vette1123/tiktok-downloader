import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter } from '@/components/SiteFooter'
import { siteConfig } from '@/config/site'

export const metadata: Metadata = {
  title: 'Privacy Policy — Social Media Downloader',
  description: `How ${siteConfig.name} handles your data: anonymous by default, a Google sign-in and nothing else for Pro, no download logs, no cross-site tracking.`,
  alternates: { canonical: '/privacy' },
}

const UPDATED = '10 August 2026'

export default function Privacy() {
  return (
    <div className='app-bg relative min-h-[100dvh] overflow-clip'>
      <div className='relative z-10 mx-auto max-w-3xl px-4 py-10 sm:py-16'>
        <h1 className='text-3xl font-bold tracking-tight text-white sm:text-4xl'>
          Privacy Policy
        </h1>
        <p className='mt-2 text-sm text-white/50'>Last updated {UPDATED}</p>

        <div className='mt-8 space-y-6 text-sm leading-relaxed text-white/70 md:text-base'>
          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>If you never sign in</h2>
            <p>
              No account, no sign-up, nothing stored — you are fully anonymous.
              We do not log the links you paste or the files you download. Your
              Recent list is written to your own browser&rsquo;s local storage
              and never leaves the device. This is unchanged from before Pro
              existed, and it stays true whether or not anyone ever subscribes.
            </p>
          </section>

          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>If you sign in for Pro</h2>
            <p>
              Signing in with Google creates an account. We store your email
              address, your Google account ID, your display name and the link
              to your Google profile photo, and a list of the sessions
              (devices/browsers) currently signed in — that list is what lets
              you sign out of one device from another, and what enforces the
              5-device cap. The name and photo are only used to show you who
              you are signed in as. We do not store a password; Google handles
              authentication and we never see one.
            </p>
            <p className='mt-2'>
              Your name, email and photo link are also kept in your own
              browser&rsquo;s storage, so the account button can render without
              calling our server on every page. Signing out erases that copy.
            </p>
            <p className='mt-2'>
              No download activity is recorded for anyone, signed in or not.
              We do not store IP addresses. Deleting your account, from{' '}
              <Link href='/account' className='text-cyan-300 hover:text-cyan-200'>/account</Link>,
              removes your record and every session immediately.
            </p>
          </section>

          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>Analytics</h2>
            <p>
              When enabled, we use Cloudflare Web Analytics for page-view
              counts. It sets no cookies, builds no cross-site profile, and
              does not fingerprint your device. It is the only analytics this
              site ever runs.
            </p>
          </section>

          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>Sponsor links</h2>
            <p>
              After a successful download we may show one sponsor card. If you
              click it you are taken to that company&rsquo;s own site and we may
              earn a commission on a purchase, at no extra cost to you. We only
              see that a click happened, reported in aggregate by the advertiser.
              We never sell your data, and we run no popups, popunders, or
              redirects.
            </p>
          </section>

          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>Payments</h2>
            <p>
              Nothing is sold on this site, so we take no payments and hold no
              billing data. If you support the project, that happens entirely on
              Buy Me a Coffee under their privacy policy &mdash; we never see
              your card details, and the only thing that reaches us is whatever
              you put in the email asking for the extras to be switched on.
            </p>
          </section>

          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>Media handling</h2>
            <p>
              Links are resolved on demand and nothing you download is stored on
              our servers. Where a file is proxied, it is streamed through and
              discarded.
            </p>
          </section>

          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>Your clipboard</h2>
            <p>
              The Paste button reads your clipboard once, when you press it.
              Supporters can also switch on a setting that reads it when you
              return to the tab, so a link copied elsewhere resolves by itself.
              It is off unless you turn it on, your browser asks permission
              before the first read, and the reading happens in your browser: if
              the clipboard holds a link, that link is sent to our resolver
              exactly as though you had pasted it, and if it holds anything else
              the text is discarded on the spot and never sent anywhere. Nothing
              is read while the tab is in the background &mdash; browsers do not
              permit it, and neither would we.
            </p>
          </section>

          <section>
            <h2 className='mb-2 text-lg font-semibold text-white'>Contact</h2>
            <p>
              Privacy questions, or a request to delete data we hold, go to{' '}
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
              . You can also delete your account and every session yourself, at
              any time, from{' '}
              <Link href='/account' className='text-cyan-300 hover:text-cyan-200'>
                /account
              </Link>
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
