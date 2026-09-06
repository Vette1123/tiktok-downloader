/**
 * What Pro is, now that it is not for sale.
 *
 * Two merchants of record refused this product category — Lemon Squeezy
 * silently, Creem twice, the second time after every fixable item on their
 * published review checklist had been fixed. The rejections were about the
 * category, not the copy, so the response is to stop selling rather than to
 * reword the same offer a third time.
 *
 * The features stayed. They are granted off a donation now: a row in `users`
 * carries `grants = 'pro'`, written by the Buy Me a Coffee webhook when someone
 * takes this project's membership or its one-time extra, and by hand for a
 * plain coffee (`docs/buymeacoffee-setup.md`). No checkout here, no merchant of
 * record, nothing for us to refund — the provider owns the payment, the
 * membership and the cancel button. A donation with a thank-you attached is not
 * a sale, and that is the whole point.
 *
 * The checkout links, the plan variants and the price constants that used to
 * live here are gone rather than commented out; git has them if a processor is
 * ever found. What survives is the description of the offer, because that is
 * still shown on the support page.
 */

/**
 * What supporters get, in the order it matters.
 *
 * Every line describes *less standing over it*, never more reach. Nothing here
 * unlocks content a visitor cannot already download, and a line that implied
 * otherwise would be the acceptable-use clause that ended the store — not
 * merely overstated copy. That constraint outlived the store: it is why the
 * `ig` grant is deliberately not on this list and is not something anyone can
 * obtain by supporting the project.
 */
export interface ProBenefit {
  title: string
  body: string
}

/**
 * Everything an entitled account gets, grouped the way someone shopping for a
 * reason to support thinks about it. Two rules survive from the store days:
 * every line describes less standing over it (never more reach), and nothing
 * here may be readable as "paywalled downloads".
 */
export const PRO_BENEFITS: ProBenefit[] = [
  {
    title: 'The batch queue',
    body: 'Paste up to 20 links and let them resolve in turn — videos save themselves as each finishes.',
  },
  {
    title: 'One-paste collection import',
    body: 'A YouTube playlist, Reddit subreddit or profile, Pinterest board, or Vimeo channel becomes queue rows instantly — de-duplicated, capped per run.',
  },
  {
    title: 'Adjustable batch speed',
    body: 'Run 1–3 parallel lanes. Fast when you are in a hurry; back down when a source starts refusing traffic.',
  },
  {
    title: 'Subtitles, remembered',
    body: 'Save any YouTube caption track as SRT or VTT — auto-generated included — and your preferred language leads the list next time, synced to your account.',
  },
  {
    title: 'Priority resolving',
    body: 'Your links are asked of our own resolvers first: not rate-limited, not shared with the public internet.',
  },
  {
    // Deliberately about the BATCH archive, not the carousel one.
    //
    // The carousel ZIP checkbox has always been free, and the platform pages,
    // the FAQ and llms.txt all promise it to everyone. This line used to read
    // "carousel images and batched audio", half of which was untrue — the
    // mirror image of the FAQ that promised a free batch queue in
    // lessons/2026-08-25-pre-push-review.md. What is genuinely behind the
    // support is the queue's own archive, because the queue is.
    title: 'One-tap ZIP bundles',
    body: 'A whole batch run collects into a single archive — twenty links in, one file out — instead of twenty separate saves.',
  },
  {
    // Nothing here that a free visitor cannot already download; what is dropped
    // is the second tap, not a restriction. See the note above this list.
    title: 'Saves without asking',
    body: 'Switch it on and a pasted link starts downloading the moment it resolves. Carousels still wait for you to pick.',
  },
  {
    title: 'Watches your clipboard',
    body: 'Copy a link anywhere, switch back to the tab, and it is already resolving. With the setting above, the file is already saving.',
  },
  {
    title: 'File names your way',
    body: 'Set the shape once — {date}, {platform}, {author}, {title}, {index} — and every download lands named for the library you keep, on every device you sign in to.',
  },
  {
    title: 'No sponsor card',
    body: 'Site-wide, immediately, on every page.',
  },
]
