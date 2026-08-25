/**
 * "Recently added" — a short, dated list of what shipped lately.
 *
 * Its job is conversion-adjacent trust: a visitor deciding whether this tool
 * is alive reads four concrete lines and answers the question themselves. It
 * lives in config (not CMS, not fetch) because it changes a few times a month
 * and every entry must be true of the deployed site on the day it appears.
 *
 * Newest first. Four entries maximum — a changelog that scrolls stops being
 * read. When an entry is older than the next one's news, delete rather than
 * accumulate.
 */

export interface WhatsNewItem {
  /** Shown as-is; keep to a short month + day form ("Aug 24"). */
  date: string
  title: string
  detail: string
}

export const WHATS_NEW: WhatsNewItem[] = [
  {
    date: 'Aug 24',
    title: 'Paste any link',
    detail:
      'Beyond the eleven platforms: the downloader now resolves public videos from any site whose page serves them — smaller hosts, blogs, news pages.',
  },
  {
    date: 'Aug 24',
    title: 'One-paste collection import',
    detail:
      'A YouTube playlist, Reddit subreddit or profile, Pinterest board, or Vimeo channel expands into batch rows automatically.',
  },
  {
    date: 'Aug 24',
    title: 'Subtitles as SRT or VTT',
    detail:
      'Every caption track on a YouTube video, auto-generated included, with your preferred language remembered.',
  },
  {
    date: 'Aug 24',
    title: 'The app speaks your language',
    detail:
      'Spanish, Portuguese, Indonesian and Arabic (RTL) joined English across the download flow — pick from the footer.',
  },
]
