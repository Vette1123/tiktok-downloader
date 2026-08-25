import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter } from '@/components/SiteFooter'
import { Surface } from '@/components/Surface'
import { CheckIcon, CoffeeIcon } from '@/components/icons'
import { PRO_BENEFITS } from '@/config/pro'
import { siteConfig } from '@/config/site'
import { SUPPORT_LIFETIME, SUPPORT_MEMBERSHIP, SUPPORT_PRICES } from '@/config/support'

export const metadata: Metadata = {
  title: 'Support this project',
  description:
    'This downloader is free and stays free. Support it for $5 a month or $99 once — supporters get the batch queue, playlist import, subtitle downloads, ZIP bundling, priority resolve and an ad-free site, switched on automatically.',
  alternates: { canonical: '/pro' },
}

/**
 * The page that used to sell a subscription.
 *
 * It is a donation page now. Two merchants of record refused to process
 * payments for a third-party downloader, the second after every fixable item on
 * their review checklist had been fixed, so there is nothing to buy here and
 * nothing that renews.
 *
 * The extras are still real, and they are still the same four: properties of
 * this site, none of which widen what a link can reach. They switch on from a
 * Buy Me a Coffee membership now rather than by hand — see
 * `docs/buymeacoffee-setup.md` — which changes who runs the payment, not what
 * the money is. The provider owns the checkout, the renewal and the cancel
 * button; there is still no merchant of record here, no entitlement to enforce
 * and no refund policy, because a donation with a thank-you attached is not a
 * sale. A plain one-off coffee still grants nothing until someone asks.
 *
 * What this page must never do is imply the tip buys reach. That claim is what
 * every acceptable-use policy in this space prohibits, and it is what closed
 * the store.
 */
export default function Support() {
  return (
    <div className='app-bg relative min-h-[100dvh] overflow-clip'>
      <div className='relative z-10 mx-auto max-w-3xl px-4 py-10 sm:py-16'>
        <div className='text-center'>
          <span className='btn-grad inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase'>
            <CoffeeIcon className='h-3.5 w-3.5' />
            Support
          </span>
          <h1 className='mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl'>
            Free forever. <span className='text-grad'>Not free to run.</span>
          </h1>
          <p className='mx-auto mt-3 max-w-xl text-sm text-white/70 md:text-base'>
            Every download on this site is free, with no account and no limits,
            and that is not changing. A membership covers a slice of what it
            costs to keep the resolvers up — and switches on a few things that
            save you standing over them.
          </p>
        </div>

        <Surface
          glow
          radius='3xl'
          className='animate-card-enter mt-8 p-5 shadow-2xl sm:p-8'
        >
          <div className='grid gap-3 sm:grid-cols-2'>
            <a
              href={siteConfig.links.membership}
              target='_blank'
              rel='noopener noreferrer'
              className='btn-grad btn-press flex flex-col items-center gap-0.5 rounded-xl px-6 py-3.5'
            >
              <span className='text-sm font-semibold sm:text-base'>
                Become a supporter
              </span>
              <span className='text-xs font-medium opacity-80'>
                ${SUPPORT_PRICES.monthly}/month · ${SUPPORT_PRICES.yearly}/year
              </span>
            </a>
            <a
              href={siteConfig.links.membership}
              target='_blank'
              rel='noopener noreferrer'
              className='btn-press flex flex-col items-center gap-0.5 rounded-xl border border-white/15 bg-white/5 px-6 py-3.5 transition-colors hover:bg-white/10'
            >
              <span className='text-sm font-semibold text-white sm:text-base'>
                Lifetime
              </span>
              <span className='text-xs font-medium text-white/60'>
                ${SUPPORT_PRICES.lifetime} once · never renews
              </span>
            </a>
          </div>

          <p className='mt-4 text-center text-sm text-white/60'>
            Either one switches the extras on by itself, for the address you pay
            with — no account here needed to pay, and nothing to send me.
          </p>

          <div className='mt-8 border-t border-white/10 pt-6'>
            <h2 className='text-lg font-semibold text-white'>
              Supporters get the extras
            </h2>
            <p className='mt-1 text-sm text-white/60'>
              The two levels are{' '}
              <strong className='font-semibold text-white/80'>
                {SUPPORT_MEMBERSHIP}
              </strong>{' '}
              and{' '}
              <strong className='font-semibold text-white/80'>
                {SUPPORT_LIFETIME}
              </strong>
              . Sign in here with the same address you paid with and the extras
              are already on, usually within minutes. The monthly covers this
              downloader; the lifetime covers every project I build, including
              the ones that do not exist yet.
            </p>
            <p className='mt-3 text-sm text-white/60'>
              Prefer{' '}
              <a
                className='text-cyan-300 hover:text-cyan-200'
                href={siteConfig.links.sponsor}
                target='_blank'
                rel='noopener noreferrer'
              >
                a one-off coffee
              </a>{' '}
              of any amount? That one is a plain thank-you and switches nothing
              on by itself. Same if you signed in with a different address —
              email{' '}
              <a
                className='text-cyan-300 hover:text-cyan-200'
                href={`mailto:${siteConfig.supportEmail}?subject=${encodeURIComponent('Supporter — switch on the extras')}`}
              >
                {siteConfig.supportEmail}
              </a>{' '}
              from the address on your receipt and I&rsquo;ll sort it by hand,
              usually the same day.
            </p>

            <ul className='mt-5 grid gap-3 sm:grid-cols-2'>
              {PRO_BENEFITS.map((benefit) => (
                <li
                  key={benefit.title}
                  className='rounded-xl border border-white/[0.08] bg-white/[0.03] p-4'
                >
                  <div className='flex items-start gap-2.5'>
                    <CheckIcon className='mt-0.5 h-4 w-4 shrink-0 text-cyan-300' aria-hidden />
                    <div>
                      <p className='text-sm font-semibold text-white'>{benefit.title}</p>
                      <p className='mt-1 text-sm leading-relaxed text-white/60'>{benefit.body}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* Not in PRO_BENEFITS on purpose: that list is what the *site*
                switches on for an entitled account, and this is a promise from
                a person. Keeping it out of the array is what stops it from
                turning up in the nudges, where an anonymous visitor would read
                it as a feature they are being denied. */}
            <p className='mt-5 rounded-xl border border-cyan-300/25 bg-cyan-400/5 p-4 text-sm text-white/75'>
              <strong className='font-semibold text-white'>
                And a direct line to me.
              </strong>{' '}
              Supporters get my number — message me any time, about anything.
              Ask for a feature and I&rsquo;ll build it if it can be built.
              It&rsquo;s a short list, so that is a real promise rather than a
              nice sentence.
            </p>
          </div>

          <p className='mt-6 text-sm text-white/60'>
            Every one above is about doing the same work without standing over
            it — a queue instead of one link at a time, one ZIP instead of
            twelve files, a playlist instead of twenty pastes. None of them
            reach anything a visitor without them cannot already download, and
            none of them involve this site signing in anywhere on your behalf.
            Everything free today stays free whether anyone supports this or
            not.
          </p>
        </Surface>

        <p className='mt-6 text-center text-xs text-white/50'>
          Supporting this is a tip, not a purchase: no invoice from us and no
          refund policy, because nothing is being sold. Payments, memberships
          and cancelling one are handled entirely by Buy Me a Coffee under their
          own terms.
          Questions:{' '}
          <a
            className='text-cyan-300 hover:text-cyan-200'
            href={`mailto:${siteConfig.supportEmail}`}
          >
            {siteConfig.supportEmail}
          </a>
          , answered by{' '}
          <a className='text-cyan-300 hover:text-cyan-200' href={siteConfig.author.url}>
            {siteConfig.author.name}
          </a>
          .
        </p>

        <Link href='/' className='mt-10 inline-block text-sm text-cyan-300 hover:text-cyan-200'>
          Back to the downloader
        </Link>

        <SiteFooter />
      </div>
    </div>
  )
}
