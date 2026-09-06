'use client'

/**
 * The account page's content: plan, preferences, and account actions.
 *
 * Four fixed states drive the top of this file:
 *  - `signedIn === undefined` (no refresh has settled yet) renders a
 *    fixed-height skeleton, never the signed-out prompt — the latter would
 *    flash for every signed-in visitor on a cold load.
 *  - `signedIn === undefined` *and* `failed` renders a message and a retry.
 *    Without it, a 503 (the state of any deployment whose `DB` binding or
 *    `PRO_TOKEN_SECRET` is not set yet) pulses that skeleton forever.
 *  - `signedIn === false` renders the sign-in prompt.
 *  - `signedIn === true` renders the three sections below.
 */

import { type ReactNode, useEffect, useState } from 'react'
import Link from 'next/link'
import { Surface } from '@/components/Surface'
import { Avatar, type AvatarIdentity } from '@/components/Avatar'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { CheckIcon, ChevronDownIcon, CoffeeIcon } from '@/components/icons'
import {
  type PlanState,
  cachedProfile,
  cancelPlan,
  hasAccountHint,
  markSignedOut,
  refreshAccount,
  signInHref,
  signOut,
  useAccount,
} from '@/lib/account'
import {
  type Format,
  type Quality,
  persistPrefs,
  setFilenameTemplate,
  setFormat,
  setQuality,
  usePrefs,
} from '@/lib/prefs'
import {
  DEFAULT_FILENAME_TEMPLATE,
  FILENAME_TEMPLATE_PRESETS,
  FILENAME_TOKENS,
  buildDownloadFilename,
  isFilenameTemplate,
  unknownFilenameTokens,
} from '@/lib/filename'
import { useTier } from '@/lib/entitlements'
import { PRO_BENEFITS } from '@/config/pro'
import { PAST_DUE_GRACE_MS, paidThrough } from '@/lib/billing/entitlement'
import { formatDate, nowMs, useHydrated, useOnPageVisible } from '@/lib/clientEnv'
import { siteConfig } from '@/config/site'

const ACTION_BUTTON_CLASS =
  'btn-grad inline-flex rounded-xl px-5 py-2.5 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5 active:scale-95'
const SECONDARY_BUTTON_CLASS =
  'inline-flex rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:border-white/30 hover:text-white'
const TOGGLE_GROUP_CLASS = 'inline-flex rounded-full border border-white/10 bg-white/[0.03] p-0.5'
/**
 * The lowest-emphasis button on the page, for actions that must be findable
 * without being invited: cancelling, and nothing else so far.
 *
 * Deliberately not `.btn-danger`. Red is for the irreversible — closing an
 * account — and cancelling is neither irreversible nor immediate: Pro runs to
 * the end of the period and resubscribing is one click. Painting it as a hazard
 * would misdescribe it and put a red button on the card of every paying
 * customer.
 */
const QUIET_BUTTON_CLASS =
  'inline-flex rounded-xl px-3 py-2 text-sm font-medium text-white/50 outline-none transition-colors hover:text-white/80 focus-visible:ring-2 focus-visible:ring-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-60'

function toggleButtonClass(active: boolean): string {
  return `rounded-full px-3 py-1 text-xs font-medium transition-colors ${
    active ? 'bg-cyan-400/90 text-[#04171b]' : 'text-white/55 hover:text-white'
  }`
}

type PlanBucket =
  | 'free'
  /** The extras are on, granted by hand. No subscription, nothing billing. */
  | 'granted'
  | 'active-monthly'
  | 'active-annual'
  | 'cancelled'
  | 'past-due'
  | 'ended'

/**
 * One bucket per row of the brief's plan table. A `switch` on `plan.status`,
 * not chained ternaries — an unrecognised status falls back to `free` rather
 * than matching some broader condition by accident, the same fail-closed
 * shape as `isProAt`.
 *
 * `now` is taken as an argument rather than read inside, so that the same clock
 * decides "is this still Pro" here and in `isProAt` on the server. The two
 * cancelled statuses both land in `cancelled` while the paid period is running
 * and `ended` once it is not — `paidThrough` is imported rather than rewritten
 * so this screen cannot start disagreeing with entitlement about the same date.
 *
 * `entitled` is the server's own answer (`isEntitled`), and it is only ever
 * consulted where there is no subscription status to read: a hand grant is not
 * a plan, so it must not be able to relabel one. With payments withdrawn this
 * is the only path that reaches `granted`, and every subscription arm below is
 * dormant — kept because they are what must keep working if a processor is ever
 * found, not because any row currently uses them.
 */
export function classifyPlan(
  plan: PlanState | null,
  now: number,
  entitled = false,
): PlanBucket {
  switch (plan?.status ?? null) {
    case null:
      return entitled ? 'granted' : 'free'
    case 'active':
    case 'trialing':
      return plan?.variant === 'annual' ? 'active-annual' : 'active-monthly'
    // `scheduled_cancel` is Creem's API saying "stops at period end";
    // `canceled` is its portal saying "stopped", which for a subscriber with
    // months left on an annual plan is not what we sold them.
    case 'scheduled_cancel':
    case 'canceled':
      return paidThrough(plan?.endsAt ?? null, now) ? 'cancelled' : 'ended'
    case 'past_due':
      return 'past-due'
    case 'paused':
    case 'unpaid':
    case 'expired':
      return 'ended'
    default:
      return 'free'
  }
}

/**
 * The state badge, and the only piece of colour the card spends on itself.
 *
 * `warn` is reserved for the one state with money at stake and a deadline —
 * a failed payment. A scheduled cancellation is `ending`, not a warning:
 * nothing is wrong, nothing is lost, and painting it red would tell a customer
 * who made a deliberate choice that they had made a mistake.
 */
interface PlanChip {
  label: string
  tone: 'live' | 'ending' | 'warn' | 'idle'
}

/**
 * One labelled fact. Deliberately not free prose: these are the answers to
 * "how much", "until when", "what happens next" — the three questions that
 * bring anyone to this page — and a table answers them at a glance where a
 * paragraph has to be read.
 */
interface PlanFact {
  label: string
  value: string
}

interface PlanCopy {
  /**
   * The state in one plain sentence, for the states that need explaining —
   * what "cancelled" means for access, what happens after a failed payment,
   * what a free account is.
   *
   * A live subscription has no such sentence and must not be given one: the
   * heading, the price and the two fact rows already say "Pro, annual, $24 a
   * year, charged again on this date", and a lede repeating it word for word
   * is the same fact printed four times on one card.
   */
  lede?: string
  note?: ReactNode
  chip: PlanChip
  /** What they are on, as a heading. */
  title: string
  /** The price, when money is involved at all. */
  price?: string
  facts: PlanFact[]
}

/** A date, or the honest vaguer answer when the row has no timestamp. */
function dateOr(at: number | null | undefined, fallback: string): string {
  return at ? formatDate(at) : fallback
}

/** When Pro actually switches off for an unpaid subscription. */
function graceEndsAt(plan: PlanState | null): number | null {
  if (plan?.pastDueSince === null || plan?.pastDueSince === undefined) return null
  return plan.pastDueSince + PAST_DUE_GRACE_MS
}

export function planCopy(bucket: PlanBucket, plan: PlanState | null): PlanCopy {
  switch (bucket) {
    case 'free':
      return {
        lede: "You're on the free plan.",
        chip: { label: 'Free', tone: 'idle' },
        title: 'Free',
        facts: [],
      }
    case 'granted':
      return {
        lede: 'The extras are switched on for this account. Thank you.',
        // Said plainly because the honest description is also the reassuring
        // one: this is a gift, not a plan, so there is no date to watch, no
        // renewal to catch, and nothing that can fail to charge.
        note: 'Nothing is billing and there is nothing to cancel.',
        chip: { label: 'Supporter', tone: 'live' },
        title: 'Supporter',
        facts: [],
      }
    // Both dormant: no row has a subscription and none can be created. The
    // price is read off the plan rather than a constant now — the constants
    // went with the store, and hardcoding "$3" here would be this screen
    // asserting a number nothing else in the codebase agrees with.
    case 'active-monthly':
      return {
        chip: { label: 'Active', tone: 'live' },
        title: 'Pro, monthly',
        facts: [
          { label: 'Next charge', value: dateOr(plan?.renewsAt, 'Soon') },
          { label: 'Renews', value: 'Every month, until cancelled' },
        ],
      }
    case 'active-annual':
      return {
        chip: { label: 'Active', tone: 'live' },
        title: 'Pro, annual',
        facts: [
          { label: 'Next charge', value: dateOr(plan?.renewsAt, 'Soon') },
          { label: 'Renews', value: 'Every year, until cancelled' },
        ],
      }
    case 'cancelled':
      return {
        lede: `Pro until ${dateOr(plan?.endsAt, 'the end of the period')}. Won't renew after that.`,
        // Said because it is the question someone has straight after
        // cancelling, and because the honest answer is reassuring: they are
        // cancelled, they keep what they paid for, and no further money moves.
        note: 'You keep Pro until then, and nothing further will be charged.',
        chip: { label: 'Ending', tone: 'ending' },
        title: 'Pro, cancelled',
        facts: [
          { label: 'Pro until', value: dateOr(plan?.endsAt, 'End of the period') },
          { label: 'Next charge', value: 'None' },
        ],
      }
    case 'past-due':
      return {
        lede: `We couldn't take payment. Pro stays on until ${dateOr(
          graceEndsAt(plan),
          'the grace period ends',
        )}.`,
        chip: { label: 'Payment failed', tone: 'warn' },
        title: 'Pro, payment failed',
        // One row only: the button underneath already says what to do about it,
        // and a "To fix it — update your card" row was the same instruction
        // printed twice, six millimetres apart.
        facts: [{ label: 'Pro until', value: dateOr(graceEndsAt(plan), 'The grace period ends') }],
      }
    case 'ended':
      return {
        lede: "Your subscription has ended, so you're back on the free plan.",
        note: 'Nothing further will be charged.',
        chip: { label: 'Ended', tone: 'idle' },
        title: 'Free',
        facts: [{ label: 'Ended', value: dateOr(plan?.endsAt, 'Already') }],
      }
  }
}

/**
 * The one thing this page can offer someone with no extras.
 *
 * There is no checkout to send them to any more — a plan picker, a Creem
 * redirect and a "payments opening shortly" button all lived here and are gone
 * with the store. What replaced them is a link to the support page and an
 * honest description of the fulfilment, which is a human reading an email.
 *
 * Saying "by hand" out loud is deliberate. Someone who donates and then watches
 * an account page not change is owed the reason before they email to ask.
 */
function SupportLink() {
  return (
    <div className='flex flex-col gap-2'>
      <a href='/pro' className={`${ACTION_BUTTON_CLASS} w-fit items-center gap-2`}>
        <CoffeeIcon className='h-4 w-4' />
        Support this project
      </a>
      <p className='text-xs text-white/50'>
        Nothing is for sale and nothing renews. Supporters get the extras
        switched on by hand — donate, then email{' '}
        <a
          className='underline underline-offset-2 hover:text-white/70'
          href={`mailto:${siteConfig.supportEmail}?subject=${encodeURIComponent('Supporter — switch on the extras')}`}
        >
          {siteConfig.supportEmail}
        </a>{' '}
        and give it a day.
      </p>
    </div>
  )
}

/**
 * Cancelling, with the confirmation step and the two states it can fail into.
 *
 * The confirmation is the same `ConfirmDialog` that guards closing an account,
 * because a second vocabulary for "are you sure" on one screen is how a UI
 * starts to feel assembled rather than designed. Its `neutral` tone is the
 * accurate one: nothing is destroyed here and nothing stops today.
 *
 * The dialog body states the date rather than a policy sentence. "Pro until 8
 * August 2027" is a fact someone can check against what they paid; "you retain
 * access for the remainder of your billing period" is a sentence people skip.
 */
function CancelPlanButton({ plan }: { plan: PlanState | null }) {
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cancel(): Promise<void> {
    setConfirming(false)
    setSubmitting(true)
    setError(null)
    const ok = await cancelPlan()
    // On success the forced refresh has already landed and this whole branch of
    // the card is replaced by the cancelled state, so there is no success
    // message to show and nothing to reset. Only the failure path stays here.
    if (!ok) {
      setError('That did not go through. Please try again in a minute.')
      setSubmitting(false)
    }
  }

  const until = plan?.endsAt ? formatDate(plan.endsAt) : null

  return (
    <>
      <button
        type='button'
        onClick={() => setConfirming(true)}
        disabled={submitting}
        className={QUIET_BUTTON_CLASS}
      >
        {submitting ? 'Cancelling…' : 'Cancel plan'}
      </button>
      {error && (
        <p role='alert' className='mt-2 basis-full text-xs text-red-300'>
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        tone='neutral'
        title='Cancel your plan?'
        body={
          until
            ? `Your next charge is stopped. You keep Pro until ${until}, and nothing further will be charged. You can resubscribe at any time.`
            : 'Your next charge is stopped. You keep Pro to the end of the period you have already paid for, and nothing further will be charged.'
        }
        confirmLabel='Cancel my plan'
        dismissLabel='Keep my plan'
        onCancel={() => setConfirming(false)}
        onConfirm={() => void cancel()}
      />
    </>
  )
}

function PlanAction({ bucket, plan }: { bucket: PlanBucket; plan: PlanState | null }) {
  switch (bucket) {
    case 'free':
      return <SupportLink />
    // Nothing to do. No card to update, no date to watch, no button that could
    // charge anything — a supporter's card is deliberately the quietest on the
    // page, because the correct state of a gift is "already done".
    case 'granted':
      return null
    // "Manage billing" is the card and the invoices; cancelling is ours, because
    // Creem's portal cancels immediately and would cost an annual subscriber the
    // months they paid for — see src/lib/billing/cancel.ts.
    case 'active-monthly':
    case 'active-annual':
      return (
        <div className='flex flex-wrap items-center gap-2'>
          <a href='/api/billing/portal' className={SECONDARY_BUTTON_CLASS}>
            Manage billing
          </a>
          <CancelPlanButton plan={plan} />
        </div>
      )
    // The one state with a genuinely urgent action, so this is the one place the
    // accent is spent on the plan card: Pro is running out for a reason the
    // customer can fix in about a minute, and burying that in a bordered button
    // next to an equally-weighted Cancel would be the wrong emphasis.
    case 'past-due':
      return (
        <div className='flex flex-wrap items-center gap-2'>
          <a href='/api/billing/portal' className={ACTION_BUTTON_CLASS}>
            Update payment method
          </a>
          <CancelPlanButton plan={plan} />
        </div>
      )
    // No resubscribe button on either: there is nothing to buy. The portal
    // stays, because a cancelled subscriber is still a paying one until the
    // period ends and both they and an ended one may need a past invoice —
    // those outlive the subscription and this is the only screen that can
    // reach them.
    case 'cancelled':
    case 'ended':
      return (
        <div className='flex flex-wrap items-center gap-2'>
          <a href='/api/billing/portal' className={SECONDARY_BUTTON_CLASS}>
            Manage billing
          </a>
        </div>
      )
  }
}

/** The two buckets with a live, renewing subscription behind them. */
function isRenewing(bucket: PlanBucket): boolean {
  return bucket === 'active-monthly' || bucket === 'active-annual'
}

const CHIP_CLASS: Record<PlanChip['tone'], string> = {
  live: 'border-cyan-300/40 bg-cyan-400/10 text-cyan-200',
  ending: 'border-amber-300/40 bg-amber-400/10 text-amber-200',
  warn: 'border-red-400/40 bg-red-500/10 text-red-200',
  idle: 'border-white/15 bg-white/[0.06] text-white/60',
}

function StatusChip({ chip }: { chip: PlanChip }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide ${CHIP_CLASS[chip.tone]}`}
    >
      {/* Shape as well as colour, so the state survives being read by someone
          who cannot separate the amber from the cyan. */}
      <span aria-hidden className='h-1.5 w-1.5 rounded-full bg-current' />
      {chip.label}
    </span>
  )
}

/**
 * The facts, as rows.
 *
 * `dl` rather than a table: these are name/value pairs, not a grid of data, and
 * the semantics are what makes "Next charge — 8 August 2027" survive being read
 * out linearly. `tabular-nums` keeps the dates from shifting width between
 * states.
 */
function PlanFacts({ facts }: { facts: PlanFact[] }) {
  if (facts.length === 0) return null
  return (
    <dl className='mt-4 divide-y divide-white/[0.06] border-y border-white/[0.06] text-sm'>
      {facts.map((fact) => (
        <div key={fact.label} className='flex items-baseline justify-between gap-4 py-2.5'>
          <dt className='text-white/50'>{fact.label}</dt>
          <dd className='text-right font-medium text-white/85 tabular-nums'>{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The free card has to do a job the others don't: it is the one screen where
 * someone has arrived, is signed in, and has none of the extras. So it carries
 * the list itself — the same four lines shown everywhere else, from
 * `PRO_BENEFITS`, so a change to what they are cannot land here and nowhere
 * else.
 */
function FreePlanPitch() {
  return (
    <ul className='mt-4 grid gap-2 sm:grid-cols-2'>
      {PRO_BENEFITS.map((benefit) => (
        <li
          key={benefit.title}
          className='flex items-start gap-2 text-sm text-white/70'
          title={benefit.body}
        >
          <CheckIcon className='mt-0.5 h-4 w-4 shrink-0 text-cyan-300' aria-hidden />
          {benefit.title}
        </li>
      ))}
    </ul>
  )
}

function PlanSection({ plan, entitled }: { plan: PlanState | null; entitled: boolean }) {
  // Read at render rather than held in state: nothing on this card counts down,
  // and the only boundary it decides — has the paid period run out — is months
  // away for anyone looking at it. A ticking clock here would be a re-render per
  // second to move nothing. Server-side `plan` is null and `entitled` is false,
  // so this cannot produce a hydration mismatch: both passes classify as `free`.
  const bucket = classifyPlan(plan, nowMs(), entitled)
  const copy = planCopy(bucket, plan)

  return (
    <Surface glow radius='3xl' className='animate-card-enter p-5 shadow-2xl sm:p-6'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h2 className='text-xs font-medium tracking-wide text-white/45 uppercase'>Plan</h2>
          <p className='mt-1 text-xl font-bold text-white sm:text-2xl'>{copy.title}</p>
          {copy.price && <p className='mt-0.5 text-sm text-white/55'>{copy.price}</p>}
        </div>
        <StatusChip chip={copy.chip} />
      </div>

      {/* Only for the states that need explaining — see the note on `lede`. */}
      {copy.lede && <p className='mt-3 text-sm text-white/70'>{copy.lede}</p>}
      {copy.note && <p className='mt-2 text-xs text-white/50'>{copy.note}</p>}

      {/* The list is the pitch on `free` and the receipt on `granted` — the
          same four lines either way, which is the point: what a supporter got
          is exactly what a non-supporter was shown. */}
      {bucket === 'free' || bucket === 'granted' ? (
        <FreePlanPitch />
      ) : (
        <PlanFacts facts={copy.facts} />
      )}

      <div className='mt-5 empty:mt-0'>
        <PlanAction bucket={bucket} plan={plan} />
      </div>
      {/* Said here rather than only in the Terms, because this is the screen
          someone is on when they decide to cancel, and the two things they
          want to know at that moment are whether access stops immediately (it
          does not) and whether money comes back (within 14 days of the charge,
          it does). Keep this sentence in step with the Terms. */}
      {isRenewing(bucket) && (
        <p className='mt-3 text-xs text-white/50'>
          Cancelling stops the next charge and Pro runs to the end of the
          period you have paid for. Charged in the last 14 days?{' '}
          <a
            className='underline underline-offset-2 hover:text-white/70'
            href={`mailto:${siteConfig.supportEmail}?subject=${encodeURIComponent('Refund request')}`}
          >
            Email us
          </a>{' '}
          for a full refund.
        </p>
      )}
    </Surface>
  )
}

function PreferencesSection() {
  const { quality, format } = usePrefs()

  function chooseFormat(next: Format): void {
    setFormat(next)
    void persistPrefs({ quality, format: next })
  }

  function chooseQuality(next: Quality): void {
    setQuality(next)
    void persistPrefs({ quality: next, format })
  }

  return (
    <Surface radius='3xl' className='animate-card-enter p-5 sm:p-6'>
      <h2 className='text-lg font-semibold text-white'>Preferences</h2>
      <div className='mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs'>
        <div className='flex items-center gap-2'>
          <span className='text-white/50'>Format</span>
          <div role='group' aria-label='Download format' className={TOGGLE_GROUP_CLASS}>
            {(['video', 'audio'] as const).map((f) => (
              <button
                key={f}
                type='button'
                onClick={() => chooseFormat(f)}
                aria-pressed={format === f}
                className={toggleButtonClass(format === f)}
              >
                {f === 'video' ? 'Video' : 'Audio (MP3)'}
              </button>
            ))}
          </div>
        </div>

        {format === 'video' && (
          <div className='flex items-center gap-2'>
            <span className='text-white/50'>Quality</span>
            <div role='group' aria-label='Preferred video quality' className={TOGGLE_GROUP_CLASS}>
              {(['hd', 'sd'] as const).map((q) => (
                <button
                  key={q}
                  type='button'
                  onClick={() => chooseQuality(q)}
                  aria-pressed={quality === q}
                  className={toggleButtonClass(quality === q)}
                >
                  {q === 'hd' ? 'HD' : 'Data saver'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Surface>
  )
}

/**
 * The example every filename preview is built from.
 *
 * A real-looking post rather than "Title" and "Author": the whole question
 * someone is answering here is "what will this look like in my folder", and a
 * placeholder that is shorter and tidier than real data answers it wrongly.
 * Frozen date so the preview does not tick over while being read.
 */
const FILENAME_SAMPLE = {
  platform: 'instagram',
  author: 'nasagoddard',
  title: 'Ancient space rocks, and what they told us',
  date: new Date(2026, 5, 8, 14, 30, 52),
} as const

function previewFilename(template: string | undefined, ext = 'mp4'): string {
  return buildDownloadFilename({ ...FILENAME_SAMPLE, ext, template })
}

/**
 * Where a supporter decides how saved files are named.
 *
 * Free visitors see the shape they already get and what the extra buys, which
 * is the point of showing them the card at all — a benefit nobody can see is
 * not a benefit. Nothing here is disabled-and-teasing: the preview is real
 * either way, and only the controls that change it are behind the support.
 */
function FilenamesSection() {
  const tier = useTier()
  const prefs = usePrefs()
  const isPro = tier === 'pro'
  const active = prefs.filenameTemplate ?? DEFAULT_FILENAME_TEMPLATE

  const [draft, setDraft] = useState(active)
  const [touched, setTouched] = useState(false)

  // While untouched, follow the stored value — it can change under us when a
  // sign-in adopts the account's copy.
  const shown = touched ? draft : active
  const unknown = unknownFilenameTokens(shown)
  const valid = isFilenameTemplate(shown)

  function apply(next: string): void {
    setTouched(true)
    setDraft(next)
    if (!isFilenameTemplate(next)) return
    // The built-in shape is stored as "no template", so clearing back to the
    // default leaves nothing behind to migrate later.
    const value = next.trim() === DEFAULT_FILENAME_TEMPLATE ? undefined : next.trim()
    setFilenameTemplate(value)
    void persistPrefs({ ...prefs, filenameTemplate: value })
  }

  return (
    <Surface radius='3xl' className='animate-card-enter p-5 sm:p-6'>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <h2 className='text-lg font-semibold text-white'>File names</h2>
        {!isPro && (
          <span className='rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[11px] font-medium text-cyan-200'>
            Supporters
          </span>
        )}
      </div>
      <p className='mt-1 text-sm text-white/55'>
        {isPro
          ? 'Every download is named this way. The date leads by default so a folder sorted by name is in the order you saved things.'
          : 'Downloads are named with the date, the platform, the account and the title. Supporters can change that shape.'}
      </p>

      <p className='mt-4 overflow-x-auto rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2 font-mono text-xs whitespace-nowrap text-cyan-200/90'>
        {previewFilename(valid ? shown : undefined)}
      </p>

      {isPro && (
        <div className='mt-4 space-y-3'>
          <div className='flex flex-wrap gap-1.5'>
            {FILENAME_TEMPLATE_PRESETS.map((preset) => (
              <button
                key={preset.template}
                type='button'
                onClick={() => apply(preset.template)}
                aria-pressed={shown === preset.template}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  shown === preset.template
                    ? 'border-cyan-400/60 bg-cyan-400/15 text-cyan-100'
                    : 'border-white/10 text-white/55 hover:border-white/25 hover:text-white'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <label className='block'>
            <span className='sr-only'>Filename template</span>
            <input
              type='text'
              value={shown}
              spellCheck={false}
              autoComplete='off'
              onChange={(e) => apply(e.target.value)}
              aria-invalid={!valid}
              className={`w-full rounded-xl border bg-black/25 px-3 py-2 font-mono text-sm text-white outline-none transition-colors ${
                valid
                  ? 'border-white/10 focus:border-cyan-400/60'
                  : 'border-rose-400/50 focus:border-rose-400'
              }`}
            />
          </label>

          <p role='status' className='text-xs text-white/45'>
            {unknown.length > 0
              ? `There is no {${unknown[0]}} — use ${FILENAME_TOKENS.map((t) => `{${t}}`).join(', ')}.`
              : valid
                ? `Available: ${FILENAME_TOKENS.map((t) => `{${t}}`).join(', ')}. The extension is always added for you.`
                : 'A template needs at least one placeholder, or every file would be given the same name.'}
          </p>
        </div>
      )}

      {!isPro && (
        <Link
          href='/pro'
          className='mt-4 inline-flex text-sm font-medium text-cyan-300 underline-offset-4 transition-colors hover:text-cyan-200 hover:underline'
        >
          See what supporting gets you →
        </Link>
      )}
    </Surface>
  )
}

const DELETE_FAILED = 'Could not delete the account. Try again.'

/**
 * A full page load of the home page, deliberately not `useRouter().push()`.
 *
 * Both callers have just destroyed the session, and a client-side transition
 * would carry the old React tree — cached account state and all — into the
 * signed-out page. The Next lint rule that flags relative `location.href`
 * assumes a soft transition is always preferable; here the reload is the point.
 */
function hardNavigateHome(): void {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional, see above
  window.location.href = '/'
}

/**
 * The delete endpoint refuses (409) while a subscription is still entitling,
 * because deleting the row would leave Creem billing an account that no
 * longer exists. That refusal explains what to do, so it is shown as-is rather
 * than flattened into the generic failure.
 */
async function deleteFailureMessage(response: Response): Promise<string> {
  try {
    const body = await response.json()
    return typeof body?.error === 'string' ? body.error : DELETE_FAILED
  } catch {
    return DELETE_FAILED
  }
}

function AccountSection({
  identity,
  hasSubscription,
}: {
  identity: AvatarIdentity
  /** Whether Creem has a subscription for this account at all. The
   *  billing portal 404s without one, so linking it unconditionally sent
   *  free-plan visitors to an API error page. */
  hasSubscription: boolean
}) {
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  /** Which confirmation is on screen, if any. Only ever one at a time. */
  const [confirming, setConfirming] = useState<'signout-all' | 'delete' | null>(null)

  /**
   * Signing out on the account page leaves you looking at an account page you
   * no longer have an account for. Send people home instead — the same landing
   * deleting an account already used.
   */
  async function signOutAndGoHome(all = false): Promise<void> {
    await signOut(all)
    hardNavigateHome()
  }

  async function handleDelete(): Promise<void> {
    setConfirming(null)
    setDeleting(true)
    setDeleteError(null)
    try {
      const response = await fetch('/api/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delete: true }),
      })
      if (!response.ok) {
        setDeleteError(await deleteFailureMessage(response))
        setDeleting(false)
        return
      }
      await signOut()
      hardNavigateHome()
    } catch {
      setDeleteError(DELETE_FAILED)
      setDeleting(false)
    }
  }

  return (
    <Surface radius='3xl' className='animate-card-enter p-5 sm:p-6'>
      <h2 className='text-lg font-semibold text-white'>Account</h2>

      <div className='mt-3 flex items-center gap-3'>
        <Avatar identity={identity} size={44} />
        <div className='min-w-0'>
          {identity.name && (
            <p className='truncate text-sm font-semibold text-white'>{identity.name}</p>
          )}
          <p className='truncate text-sm text-white/60'>{identity.email ?? 'Signed in'}</p>
        </div>
      </div>

      <div className='mt-4 flex flex-wrap gap-3'>
        <button
          type='button'
          onClick={() => void signOutAndGoHome()}
          className={SECONDARY_BUTTON_CLASS}
        >
          Sign out
        </button>
        <button
          type='button'
          onClick={() => setConfirming('signout-all')}
          className={SECONDARY_BUTTON_CLASS}
        >
          Sign out everywhere
        </button>
      </div>

      {/* Deleting an account is irreversible and is the least likely reason
          anyone opened this page, so it does not get to sit next to "Sign out"
          as an equally-weighted button waiting to be mis-tapped. It is folded
          away behind a disclosure, and the button inside it still has to be
          confirmed — three deliberate acts, none of them reachable by accident.
          A native <details>, so the collapsed state costs no JavaScript. */}
      <details className='group mt-6 border-t border-white/10 pt-4'>
        <summary className='inline-flex list-none items-center gap-1.5 text-xs font-medium text-white/50 transition-colors hover:text-white/70'>
          <ChevronDownIcon
            className='h-3 w-3 transition-transform duration-200 group-open:rotate-180'
            aria-hidden
          />
          Close this account
        </summary>

        <div className='mt-3'>
          <p className='text-xs text-white/50'>
            {hasSubscription ? (
              // Points at the plan card rather than the billing portal: cancelling
              // is done there now, and sending someone to Creem's portal to do it
              // is exactly the path that would cost them their remaining months.
              <>
                Deleting your account does not cancel your subscription. Use{' '}
                <span className='text-white/70'>Cancel plan</span> above first, or it
                will keep renewing after the account is gone.
              </>
            ) : (
              'Deleting your account removes your email address, your preferences, and every signed-in session. It cannot be undone.'
            )}
          </p>
          <button
            type='button'
            onClick={() => setConfirming('delete')}
            disabled={deleting}
            className='btn-danger btn-press mt-3 rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50'
          >
            {deleting ? 'Deleting…' : 'Delete account'}
          </button>
          {deleteError && <p className='mt-2 text-xs text-red-300'>{deleteError}</p>}
        </div>
      </details>

      <ConfirmDialog
        open={confirming === 'signout-all'}
        tone='neutral'
        title='Sign out everywhere?'
        body='Every device currently signed in to this account will be signed out, including this one. Nothing else changes, and you can sign back in with Google at any time.'
        confirmLabel='Sign out everywhere'
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null)
          void signOutAndGoHome(true)
        }}
      />
      <ConfirmDialog
        open={confirming === 'delete'}
        title='Delete your account?'
        body={
          hasSubscription
            ? 'This does not cancel your subscription. It will keep renewing after the account is gone, so use "Cancel plan" on your plan card first. Your email address, preferences and sessions are removed, and this cannot be undone.'
            : 'Your email address, preferences and every signed-in session are removed. This cannot be undone.'
        }
        confirmLabel='Delete my account'
        onCancel={() => setConfirming(null)}
        onConfirm={() => void handleDelete()}
      />
    </Surface>
  )
}

function Skeleton() {
  return (
    <div className='animate-pulse space-y-6'>
      <Surface radius='3xl' className='h-40 p-5 sm:p-6' />
      <Surface radius='3xl' className='h-28 p-5 sm:p-6' />
      <Surface radius='3xl' className='h-40 p-5 sm:p-6' />
    </div>
  )
}

/**
 * Stands in for the plan card alone, at the size the card resolves to.
 *
 * Only reached by someone the profile cache remembers as paying: their plan is
 * the one thing on this page the browser cannot answer on its own, and
 * guessing "free" at somebody who is paying is worse than a moment of loading.
 * Everyone else gets the real card immediately.
 *
 * ponytail: sized to the free/cancelled card, so a Pro card that lands with a
 * renewal note is ~20px taller and settles by that much. Measure and pin the
 * taller height if it ever reads as a jump.
 */
function PlanPlaceholder() {
  return (
    <Surface
      glow
      radius='3xl'
      aria-hidden
      className='animate-pulse h-[152px] p-5 shadow-2xl sm:h-40 sm:p-6'
    />
  )
}

/**
 * Shown instead of the skeleton when the refresh could not be answered at all.
 * The retry is a button, not a timer: nothing on this page may poll.
 */
function LoadFailed() {
  const [retrying, setRetrying] = useState(false)

  async function retry(): Promise<void> {
    setRetrying(true)
    await refreshAccount()
    setRetrying(false)
  }

  return (
    <Surface radius='3xl' className='animate-card-enter p-6 text-center sm:p-8'>
      <p className='text-sm text-white/70'>
        We couldn&rsquo;t load your account. Accounts may not be switched on yet, or the connection
        dropped.
      </p>
      <button
        type='button'
        onClick={() => void retry()}
        disabled={retrying}
        className={`${SECONDARY_BUTTON_CLASS} mt-4 disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {retrying ? 'Trying…' : 'Try again'}
      </button>
    </Surface>
  )
}

function SignInPrompt() {
  return (
    <Surface glow radius='3xl' className='animate-card-enter p-6 text-center sm:p-8'>
      <p className='text-sm text-white/70'>Sign in to see your plan and manage your account.</p>
      {/* Home, not back to this page. Signing in is a means to using the
          downloader, so it ends where the downloader is. */}
      <a href={signInHref()} className={`${ACTION_BUTTON_CLASS} mt-4`}>
        Sign in with Google
      </a>
    </Surface>
  )
}


/**
 * Why the billing portal sent someone back here instead of to Creem.
 *
 * `/api/billing/portal` has to be a server round trip — Creem mints and
 * expires portal URLs, so one is generated per click — and
 * it used to answer its failures as raw JSON. A visitor who clicked it with no
 * subscription landed on `{"success":false,"error":"No subscription"}` with no
 * way back. It now redirects here with a reason instead.
 */
const NOTICES: Record<string, Record<string, string>> = {
  billing: {
    none: 'There is no subscription on this account, so there is nothing to manage yet.',
    unavailable: 'The billing portal could not be opened just now. Please try again in a minute.',
  },
  /**
   * A sign-in that came back from Google without a usable session. Sent here
   * rather than answered as JSON for the same reason as the billing portal:
   * these are reached by a browser following a redirect, so the reply is a
   * page, and a page has to offer a way forward. The prompt below this notice
   * is that way forward.
   */
  signin: {
    expired:
      'That sign-in took too long, or it started in a different browser. Please try again from here.',
    failed: 'Google could not complete the sign-in. Please try again.',
    email: 'Google did not return a verified email address, so no account could be created.',
  },
}

/**
 * Read during render rather than in an effect: the query string is fixed for
 * the life of the page, so there is nothing to synchronise and no reason to
 * pay a second render for it. `useHydrated` is what keeps `window` out of the
 * prerender.
 */
function useNotice(): string | null {
  const hydrated = useHydrated()
  if (!hydrated) return null
  const params = new URLSearchParams(window.location.search)
  for (const [key, messages] of Object.entries(NOTICES)) {
    const value = params.get(key)
    if (value && value in messages) return messages[value]
  }
  return null
}

function Notice({ children }: { children: string }) {
  return (
    <Surface tone='accent' radius='2xl' className='p-4 text-sm text-white/80'>
      {children}
    </Surface>
  )
}

export function AccountPanel() {
  // `userId` is no longer destructured here: it existed to bind a buyer to a
  // checkout, and there is no checkout.
  const { signedIn, failed, pro, email, name, picture, plan } = useAccount()
  const hydrated = useHydrated()
  const notice = useNotice()
  // Read once. Safe as a lazy initialiser despite touching localStorage: it
  // catches and returns null on the server, and nothing renders from it until
  // `hydrated`, so it can never reach the markup React compares.
  const [cached] = useState(cachedProfile)

  // No hint cookie means no session to load, so there is nothing to ask the
  // Worker and no request that could fail on the way.
  const syncAccount = (): void => {
    if (hasAccountHint()) void refreshAccount()
    else markSignedOut()
  }

  useEffect(syncAccount, [])
  // Again whenever this page comes back into view. The session can have been
  // created or destroyed somewhere this document never heard about: another
  // tab, or the installed app, which is where Android can land the OAuth
  // callback even when the sign-in started here. `refreshAccount` is a no-op
  // while the token in hand is still fresh, so a tab merely being switched
  // back to costs nothing.
  useOnPageVisible(syncAccount)

  if (signedIn === undefined && failed) return <LoadFailed />

  // Until hydration finishes, the markup has to be what was prerendered.
  // `useHydrated` settles in the re-render React does immediately after
  // hydrating, before the browser paints, so nothing below is ever seen
  // shifting into place.
  if (!hydrated && signedIn === undefined) return <Skeleton />

  /**
   * What the browser already knows, for free.
   *
   * The hint cookie is the client's own answer to "is there a session?", and
   * the profile cache is its answer to "whose?" — both written at sign-in,
   * both readable with no request. The page used to ignore all of it and show
   * three pulsing blocks until a round trip came back, then swap in three
   * cards of entirely different heights. That reflow was the single largest
   * layout shift on the site, and it fired on every visit to this page.
   *
   * Now only the genuinely unknown part waits. A signed-out visitor is
   * answered on the first frame; a signed-in one gets their preferences and
   * account card immediately, because both render from local state alone.
   */
  const settled = signedIn ?? hasAccountHint()

  // The notice has to survive this branch: a failed sign-in lands here signed
  // out, and the reason it failed is the only thing worth reading on the page.
  if (!settled) {
    return (
      <div className='space-y-6'>
        {notice && <Notice>{notice}</Notice>}
        <SignInPrompt />
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      {notice && <Notice>{notice}</Notice>}
      {/* The plan is the one card the browser cannot answer on its own. It
          waits only for someone the cache remembers as entitled; for everyone
          else `plan: null` IS their plan, so the real card renders at once.

          There is no post-checkout poll here any more. It existed because a
          Creem webhook could lag the redirect back by a few seconds; a grant
          set by hand lands whenever it lands, and the visitor was told to
          expect a day rather than thirty seconds. */}
      {signedIn === undefined && cached?.pro ? (
        <PlanPlaceholder />
      ) : (
        <PlanSection plan={plan} entitled={pro} />
      )}
      <PreferencesSection />
      <FilenamesSection />
      <AccountSection
        identity={{
          // The cache covers all three while the refresh is in flight, so the
          // avatar and name paint on the first frame rather than fading in.
          name: name ?? cached?.name ?? null,
          email: email ?? cached?.email ?? null,
          picture: picture ?? cached?.picture ?? null,
        }}
        hasSubscription={plan?.status !== null && plan?.status !== undefined}
      />
    </div>
  )
}
