# Launch kit

Copy, assets and a submission list for putting this site in front of people who
are not already searching for it.

Everything here is written to one constraint that is not negotiable, because it
has already cost us a payment processor: **describe what the tool does, never
what a platform loses.** A downloader that advertises removing a mark reads as a
circumvention tool to a compliance reviewer, an app-store reviewer and a
directory moderator alike, and none of them read the code. See
`lessons/2026-08-10-creem-payout-rejection.md`. The site copy was scrubbed of it
in August; anywhere this project describes itself must match.

Do not paste anything below that contains the words "watermark", "bypass",
"unlock", "private", "premium" or the brand name of a competing downloader.

## Copy, at the lengths listings actually ask for

**Name.** Social Media Downloader
**Short name.** Social Downloader
**URL.** https://www.socialdownloader.space
**Repo.** https://github.com/Vette1123/social-media-downloader (MIT)

**Tagline, 40 chars.**
Save any public video in HD

**Tagline, 60 chars.**
Paste a link, save the video in its original quality

**One-liner, 100 chars.**
A free downloader for public posts on 11 platforms — HD video, MP3 audio and photo carousels.

**Short description, 160 chars.** (also the meta description)
Free downloader for public TikTok, X, Instagram, Facebook & YouTube posts — save
HD videos, Reels & Shorts, extract MP3 audio, or grab photo carousels.

**Medium description, ~300 chars.**
Paste a link from TikTok, X, Instagram, Facebook, YouTube, Pinterest, Reddit,
Threads, Snapchat, Twitch, Vimeo — or any other site — and get the file the
platform serves for that public post: HD video, MP3 audio, or the images from a
carousel. No account, no install, no ads, no limits. Open source, MIT.

**Long description.**
Social Media Downloader is a free, open-source web app for saving media from
public social posts. Paste a URL and it detects the platform, resolves what the
page itself publishes, verifies the stream actually plays before offering it,
and hands you the file — an HD MP4, an MP3 extracted from it, individual images
from a carousel, or the whole carousel as a ZIP.

It reaches only what a logged-out visitor can already see: no private accounts,
no subscriber-only posts, no DRM. It runs entirely in the browser with no
sign-up, shows no ads, sets no tracking cookies, and installs as a PWA so you
can share a link straight from the TikTok, Instagram or YouTube app.

Built on Next.js 16 and React 19, deployed as a static export plus a small
Cloudflare Worker. The source is MIT-licensed and the extraction chain falls
back across several providers, so a download keeps working when any one of them
goes down.

**First comment** (Product Hunt, StartupBase — the maker comment under the launch).
I built this because every downloader I tried wanted an install, an account, or
three ad redirects before it would give me a file I was allowed to keep anyway.

This one is a web page. Paste a link from TikTok, X, Instagram, Facebook,
YouTube, Pinterest, Reddit, Threads, Snapchat, Twitch or Vimeo — or any other
site — and it detects the platform, resolves what that public post publishes,
checks the stream actually plays before offering it, and hands you the file: an
HD MP4, an MP3 extracted from it, single images from a carousel, or the whole
carousel as a ZIP.

It only reaches what a logged-out visitor can already see. No sign-up, no ads,
no tracking cookies, no limits. It installs as a PWA, so you can share straight
from the TikTok, Instagram or YouTube app.

Stack: Next.js 16, React 19, static export plus a small Cloudflare Worker.
MIT-licensed, and the extraction chain falls back across several providers so a
download keeps working when any one of them goes down:
https://github.com/Vette1123/social-media-downloader

Happy to answer anything about the architecture or the fallback chain.

**Categories / tags.** utilities · multimedia · productivity · open source ·
privacy · PWA · developer tools

**Assets.**
- 1200x630 social card: `https://www.socialdownloader.space/opengraph-image`
- Per-platform cards: `https://www.socialdownloader.space/<slug>/opengraph-image`
- Phone screenshot 720x1280: `https://www.socialdownloader.space/screenshots/narrow`
- Icons: `/icons/192`, `/icons/512`, `/icons/maskable`, `/icons/apple`
  — these are generated routes, and a plain `curl` gets a Cloudflare challenge back (403,
  `Cf-Mitigated: challenge`, `Content-Type: text/html`), which reads like a broken route but
  is not. To get a file to upload, run a build and take `out/icons/512` — the built PNGs are
  extensionless, so copy one to `icon-512.png` before a directory will accept it.
- Repo social preview: `docs/social-preview.png`

## Where to submit, in the order worth doing it

Ranked by what each one actually returns. The list is deliberately short: mass
directory submission buys near-worthless links, and a hundred of them are worth
less than one relevant listing that sends people.

### Tier 1 — worth the effort

| Where | Why | Needs |
| --- | --- | --- |
| **Google Search Console** | 5 Googlebot hits in 24h against ~800 page views is the whole SEO story. Submit the sitemap, watch Coverage. | Account (already verified via meta tag) |
| **Bing Webmaster Tools** | Feeds Bing, DuckDuckGo and Copilot. IndexNow already pings on every deploy; this is the console for it. | Account |
| **AlternativeTo** | Ranks for "alternative to <downloader>", which is the query this category is actually searched with. Sends real traffic, not just a link. | Account |
| **GitHub topics + repo description** | The repo is the strongest asset we own and already has stars. Topics are how it is found on GitHub itself. See the note below. | Repo access |
| **Show HN / r/opensource, r/selfhosted, r/webdev** | The open-source, no-ads, no-tracking angle is the story these audiences reward. One shot each — do not cross-post the same text. | Accounts, and read each sub's rules first |

### Tier 2 — cheap, low risk, small return

Product Hunt (one-shot launch, schedule it), Peerlist Launchpad, Uneed, Fazier,
Microlaunch, SaaSHub, Indie Hackers, StackShare.

### Tier 3 — on-topic because this is a PWA

Appscope, findpwa.com, progressiveapp.store. Tiny audiences, but the listing is
relevant rather than a link farm, and they are the only directories in this list
that care that the thing installs.

### Not worth it

Paid "submit to 100 directories" services, and any directory whose own pages are
not indexed. Both buy links Google discounts, and one of them can look like a
link scheme.

## Repo description and topics — done 2026-08-29

The GitHub repo is marketing too, and it was the one surface still carrying the
framing the site removed in August: the description said "no watermark" and the
topics included `watermark-remover` and `no-watermark`. A `vercel` topic was
also stale — this deploys to Cloudflare Workers.

The description now matches the site. Topics are capped at 20 by GitHub, so the
three that went also bought room for five that match how people actually
search: `cloudflare-workers`, `pinterest-downloader`, `reddit-video-downloader`,
`snapchat-downloader`, `vimeo-downloader` (the last two replacing bare
`pinterest` and `vimeo`, which matched nothing anyone types).

If a new surface is ever added — a store listing, a directory entry, a README
rewrite — check it against the rule at the top of this file first.

## Submission status — 2026-08-29

| Where | State |
| --- | --- |
| **Google Search Console** | Done 2026-08-29 by the owner. `https://www.socialdownloader.space/sitemap.xml` submitted and read the same day: Success, 16 discovered pages, 0 videos. Watch Coverage from here — the point of the submission is that Googlebot was hitting the site 5 times a day against ~800 page views. |
| **AlternativeTo** | Submitted. Listing plus six alternatives (Cobalt Tools, yt-dlp, NewPipe, youtube-dl, Seal, 4k Video Downloader) are in the review queue — the site says that can take months unless the $5 priority review is paid. Nothing to do until it is approved; the listing is not public and should not be shared yet. |
| **GitHub topics + description** | Done. See the section above. |
| **Uneed** | Blocked, not refused. The account is signed in and already has one product queued (Masareef, unscheduled), and the free plan allows one queued launch at a time. Either schedule or remove that one, or take Uneed Pro, before this can be submitted. |
| **Product Hunt** | Draft created, not scheduled: https://www.producthunt.com/products/social-media-downloader — name, tagline, the ~300-char description, site + repo links, open-source flag, X account, three launch tags (Open Source, Social Media, Video), four gallery images, thumbnail, Free pricing, bootstrapped, and the first comment are all filled. Scheduling the launch date is yours: a launch is one shot, and the day it goes live decides how much of the day the post gets. Shoutouts and the solo-maker checkbox were left for you as well — both are claims made in your name. |
| **StartupBase** | Filled, not submitted: https://startupbase.io/submissions/social-media-downloader — checklist reads 100% complete. Name, the 60-char tagline, site + repo links, X handle, the long description (1081/1250), tags (Social Media, Open Source, Content Creation), logo, two screenshots, maker and Free pricing are all saved. Demo video, promo code and location left empty on purpose. Submitting is yours: **Schedule Your Launch** is the only button on the last step, and it is what publishes into the queue. The free launch is already queued behind ~1,458 others (roughly four to five weeks) and requires their badge on our site; the ways past that are $39 / $99 / $299, all refused. |
| **StartupBase first comment** | Not saved on the page — the Launch Checklist textarea is React state only, and a reload empties it. Paste the copy below into it at the moment you schedule, or the launch goes out without it. |
| **Peerlist** | Not attempted — the domain is outside what this browser session may reach. |
| **Hacker News** | Live: https://news.ycombinator.com/item?id=49489963 — "Show HN: A downloader for public social posts, no sign-up and no ads", plus the maker comment (what it does, the architecture, and the 360p YouTube ceiling stated up front). Posted on a Saturday, which is the weakest slot of the week; if it gets no traction, HN allows one repost of a story nobody saw, so keep the option. |
| **Reddit** | Posted and removed. r/SideProject (https://redd.it/1w1ngah) and r/coolgithubprojects (https://redd.it/1w1nkwg) both came back `removed_by_category: "reddit"` — Reddit's own sitewide spam filter, not the subreddit mods. u/vetteop is seven years old but has 5 link karma and 0 comment karma, and that is under the filter's bar for link posts. Nothing else was posted: more submissions from a filtered account make the signal worse, not better. To unblock, either build ordinary comment karma first, or message each subreddit's mods and ask them to approve the post — both are yours to do, since they are messages sent in your name. |
| **SaaSHub** | Submitted on the free tier (the $75 Priority+ review was refused) and now complete: https://www.saashub.com/manage/social-media-downloader — logo, one screenshot, the long description, release date 2025-06, Open Source = Yes with the repo URL, categories and six competitors. Status is "Pending approval", which they say takes up to 32 days. |
| **Indie Hackers** | Posting is blocked — the editor answers "your account cannot create posts yet", which is their new-account gate. The Products DB entry was created instead and is complete: https://www.indiehackers.com/product/social-media-downloader — logo, tagline, the "why I built it" text, site link, start date, Free / bootstrapped / side project / solo founder / no employees, and the Open Source, Social Media, Video and Utilities tags. Two of those (solo founder, side project) are claims in your name; change them on the edit page if they are wrong. |
| **OpenAlternative** | Rejected automatically: "This tool doesn't meet our submission requirements and can't be listed." No retry with reworded copy — rewording to beat a filter is the kind of thing that gets a domain flagged. |
| **DevHunt** | Skipped on their own rules: the directory is for developer-facing tools, and this is not one. |
| **Microlaunch** | Paid only now — the submit path redirects to /premium#pricing. |
| **awesome-nextjs** | PR open: https://github.com/unicodeveloper/awesome-nextjs/pull/575 (Apps section). |
| **awesome-cloudflare** | PR open: https://github.com/zhuima/awesome-cloudflare/pull/216 (Others / 其他, both the Chinese and English READMEs). |
| **awesome-selfhosted** | Ineligible, not rejected. They require a tagged release older than four months, and the repo has no tags at all; they also disqualify software that depends on a specific cloud provider, and the extraction Worker is Cloudflare-bound. |

The alternatives on AlternativeTo were picked to keep the association clean:
open-source and mainstream tools only. Entries the site itself flags for
malware or bundleware (JDownloader, ClipGrab) and ones whose own description
lists adult sites were deliberately skipped, as was Internet Download Manager.
"Support for 4K" was left unticked on the listing — YouTube resolves through
the in-Worker ANDROID_VR client at a 360p ceiling, and a feature checkbox is a
claim.
