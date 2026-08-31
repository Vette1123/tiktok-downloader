# Social Media Downloader

> Download public TikTok, Twitter/X, Instagram, Facebook, YouTube, Pinterest, Reddit, Threads, Snapchat, Twitch & Vimeo posts in their original quality — HD video, reels, Shorts, MP3 audio, photo carousels, and ffmpeg-rendered slideshow MP4s. Free, no login, no limits. Installs as an app.

![Social Media Downloader — download HD video, reels, Shorts, MP3 audio and photos from public posts on TikTok, X, Instagram, Facebook, YouTube and more](docs/social-preview.png)

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![Release](https://img.shields.io/github/v/release/Vette1123/social-media-downloader?label=release&color=F38020&logo=cloudflare&logoColor=white)](../../releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy_Me_A_Coffee-support-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/vetteotp)

### 🚀 [Try it live →](https://www.socialdownloader.space)

A free downloader for public posts on **TikTok, Twitter/X, Instagram, Facebook, YouTube, Pinterest, Reddit, Threads, Snapchat, Twitch, and Vimeo**. Paste a link and get an HD video, reel, or Short, MP3 audio, a photo carousel (individual images or a ZIP), or a fully rendered slideshow MP4 with the original soundtrack — no login, no install required, runs in your browser. It reaches only what a logged-out visitor can already see: no private accounts, no paywalled or subscriber-only posts, no DRM.

It's also an **installable app (PWA)**: add it to your home screen and share links straight from the TikTok, Instagram, or YouTube app — no browser, no copy-paste.

Open source, with **no popups, no redirects, no tracking, and a multi-source fallback chain** so downloads keep working when any single provider goes down.

⭐ **If this tool is useful to you, please [star the repo](https://github.com/Vette1123/social-media-downloader/stargazers)** — it helps others find it.

Built with Next.js 16, React 19, TypeScript, Tailwind CSS 4, and Motion by [Mohamed Gado](https://www.mohamedgado.com).

## Why use it

- **11 platforms, one paste box.** TikTok, X, Instagram, Facebook, YouTube, Pinterest, Reddit, Threads, Snapchat, Twitch, and Vimeo — auto-detected from the URL.
- **Any other link too.** Paste a URL from anywhere else and the extractor still goes to work: it reads whatever media the page publishes (og:video, JSON-LD, player configs, download links), with a self-hosted yt-dlp resolver behind it for everything stricter. If the page serves its media to the public, this usually resolves it.
- **Original quality, HD by default.** The source file rather than a re-encode, with a one-tap fallback to SD, plus MP3 audio extraction wherever a stream resolves — not just on the big-name platforms.
- **No login, no API key, no daily limit.** Nothing to sign up for and nothing installed unless you want the app.
- **Private by design.** No account needed to download and no log of what you download — a Google sign-in exists so preferences can sync and so supporters' extras can be attached to an account. Your Recent list lives in your own browser.
- **Resilient.** A per-platform fallback chain quietly retries other sources, so a single provider outage doesn't break your download.
- **Installable PWA.** Home-screen icon, app shortcuts, and native share-in from other apps.

## Features

### Platforms

**TikTok**

- HD video downloads at the source quality
- Extract the soundtrack as MP3 (re-served with `audio/mpeg`)
- Photo carousels (slideshows): preview every image, save individually or as a ZIP, keep the original background music
- Render a TikTok slideshow into a real MP4 video (ffmpeg) when the platform only ships images

**Twitter / X**

- Native video and GIF extraction from any `twitter.com` or `x.com` status URL
- Resolves `t.co` short links

**Instagram**

- Download reels and feed videos in their original quality
- Save single-photo posts and multi-image carousels — individually or as a ZIP
- Extract the audio track from a reel as MP3
- Works with `instagram.com/p/…`, `/reel/…`, `/tv/…` and share links — no login required
- Posts Instagram will not serve logged-out (private, age- or region-restricted) need `IG_SESSIONID` *and* the `ig` grant, and are the only Instagram links that fail

**YouTube**

- Download videos and Shorts in HD as MP4
- Extract the audio track as MP3
- Rich metadata (title, channel, thumbnail) pulled from YouTube's public oEmbed
- Works with `youtube.com/watch?v=…`, `youtu.be/…`, `/shorts/…`, and `/embed/…`

**Facebook**

- Download public videos, watch clips, and reels in HD
- Extract the audio track as MP3
- Resolves `fb.watch/…` short links and `/share/…` links automatically
- Works with `facebook.com/…/videos/…`, `facebook.com/watch/?v=…`, and `facebook.com/reel/…`

**Pinterest**

- Download Pin videos and images from `pinterest.com/pin/…` (and `pin.it` short links)

**Reddit**

- Download videos from `reddit.com/r/…/comments/…` posts and `/s/…` share links

**Threads**

- Download videos and images from `threads.net` / `threads.com` posts

**Snapchat**

- Download Spotlight clips and public story/profile media

**Twitch**

- Download clips and VODs from `twitch.tv/…/clip/…`, `clips.twitch.tv/…`, and `twitch.tv/videos/…`

**Vimeo**

- Download videos from `vimeo.com/…` and `player.vimeo.com/…` via a dedicated extractor

**Any other site**

- Paste any public link — the generic chain reads the page's own media (og:video, JSON-LD `contentUrl`, `<video>` sources, inline player configs, download anchors), verifies it serves a file rather than an error page, and offers it
- Sites that wall datacenter IPs are retried at an address they do answer (host-specific recipes read the embed/player page, which usually stays open when the watch page does not); a relay chain and an optional self-hosted yt-dlp resolver (`deploy/resolver/`) sit behind that, but note the free relays now refuse Worker-origin fetches, so on Cloudflare only a configured unlocker or resolver adds anything
- MP3 extraction works on this long tail too: when no audio-specific source answers, the resolved video stream is re-served through the audio route
- Where native binaries exist (self-hosting, local dev), a full yt-dlp extractor runs as the final fallback for pages whose players defeat tag-scraping — automatically absent on Cloudflare, where it short-circuits to null

### App experience

- **Installable PWA** — add to your home screen and launch it like a native app (standalone, own icon, splash).
- **Share Target (Android)** — installing registers the app as a share destination, so you can hit **Share → Social Downloader** from inside TikTok/Instagram/YouTube and land straight on a resolved download. No browser, no paste.
- **App shortcuts / jump list** — long-press the installed icon to jump straight to the TikTok, X, Instagram, YouTube, or Facebook downloader.
- **iOS add-to-home hint** — a quiet, on-brand nudge with the exact "Share → Add to Home Screen" steps, plus an iOS save hint on results.
- **One-tap paste** — reads the clipboard and resolves the link in a single tap.
- **Batch paste (supporter)** — drop a whole list of links (one per line or space-separated); every URL is pulled out, de-duplicated, and resolved in turn with live progress, across 1–3 parallel lanes.
- **Collection import (supporter)** — paste a YouTube `playlist?list=…`, a subreddit or Reddit profile, a Pinterest board, or a Vimeo channel once and it expands into batch rows, capped and de-duplicated, no re-pasting.
- **Subtitle download (supporter)** — every caption track on a resolved YouTube video saves as an SRT or WebVTT file, manual and auto-generated languages included; your language is remembered and syncs with your account.
- **Thumbnail save** — the cover image of any result saves as its own file.
- **Recent export/import** — the local history leaves the device as plain JSON and merges back in on another one (newest wins), staying local-first either way.
- **Result re-pick** — switch a resolved result between **HD / SD / MP3** without re-pasting; your choice is remembered for the next link.
- **Recent** — a local, privacy-friendly history of what you've grabbed (branded per-platform tiles, "View all"), stored only in your browser and re-resolvable in one tap. Never stores the short-lived CDN/stream URL.

### Quality of life

- Inline video and image previews before downloading
- Multi-source fallback chain per platform (resilient against any single provider going down)
- Warm-instance resolve cache and direct tunnel downloads for faster, lighter fetches
- CORS-proxied media routes so downloads (and Instagram's hotlink-protected CDN) work cross-origin, with HTTP range support for seek/preview
- Inline URL validation, smooth motion animations, fully responsive layout, low-power/touch-aware effects
- Eleven dedicated, SEO-tuned landing pages (one per platform)
- Production-grade SEO: dynamic OpenGraph and Twitter card images, per-platform OG images, JSON-LD (WebSite, Person, SoftwareApplication, HowTo, FAQPage), hreflang, sitemap, IndexNow ping on build, and a PWA-tuned manifest
- No registration, no API keys, no daily limit

## Supporting the project

The site is free and stays free. It is paid for by a single sponsor card shown
after a download — no popups, no redirects, no interstitials, and no tracking of
what you download.

Nothing here is for sale. A subscription existed briefly and was withdrawn: two
merchants of record refused to underwrite a third-party downloader, the second
after every fixable item on their published review checklist had been fixed, so
the rejection was about the product category and not the paperwork. Supporting
the project is a donation, and supporters get the extras switched on by hand —
see [the support page](https://www.socialdownloader.space/pro).

<a href="https://buymeacoffee.com/vetteotp">
  <img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=&slug=vetteotp&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" height="48" />
</a>

## Tech stack

| Layer            | Technology                          |
| ---------------- | ----------------------------------- |
| Framework        | Next.js 16 (App Router), React 19   |
| Language         | TypeScript 6                        |
| Styling          | Tailwind CSS 4                      |
| Animation        | Motion (formerly framer-motion) 12  |
| UI primitives    | Radix Accordion, `clsx`             |
| Icons            | Hand-rolled SVG (`src/components/icons.tsx`) |
| Hosting          | Cloudflare Workers — static export + a hand-written Worker for `/api/*` |
| Accounts         | Google OAuth (PKCE, no SDK) + Cloudflare D1 |
| Entitlements     | Hand-set grants in D1 + signed short-lived tokens |
| HTTP             | Native `fetch` (`src/lib/httpClient.ts`) |
| HTML scraping    | Regex extractors (`src/lib/htmlExtract.ts`) |
| ZIP bundling     | JSZip, lazily imported **in the browser** |
| Slideshow video  | fluent-ffmpeg + @ffmpeg-installer *(Node hosts only)* |
| YouTube fallback | youtube-dl-exec *(Node hosts only)* |
| Dynamic OG       | `next/og`, prerendered to PNG at build time |
| App shell        | PWA manifest + Share Target + shortcuts |

Four of these are *deliberate removals* rather than choices never made: **Axios**
(~half the CPU of `/api/download` — see `src/lib/httpClient.ts`), **Cheerio**
(too slow for the Worker CPU budget), **lucide-react** (three icons, hand-copied
paths), and **arctic** (41% of the Worker bundle to reach one OAuth provider).
Nothing in the deployed Worker comes from `node_modules` any more. Adding a
dependency that the Worker imports is a CPU decision — run `pnpm cf:startup`.

## Getting started

**Prerequisites:** Node.js 20+ (24 LTS recommended), pnpm.

```bash
git clone https://github.com/Vette1123/social-media-downloader.git
cd social-media-downloader
pnpm install
pnpm dev
```

Open <http://localhost:3000>.

Build for production:

```bash
pnpm build && pnpm start
```

### Environment variables

All optional — the app runs without any config. Signing in and Pro billing are
themselves optional: without the accounts/billing variables below, the site
still works as a fully anonymous, free downloader; sign-in simply is not
offered.

They all live in one gitignored `.env`, copied from `.env.sample`. Next reads it
for `next dev` and `next build`, wrangler reads it for `wrangler dev`, and
`pnpm cf:setup secrets` uploads the deploy-relevant half to the Worker — so a
value is set once rather than kept in step across three files. Do not add a
`.dev.vars`: wrangler prefers that file and then ignores `.env` entirely.

| Variable              | Purpose                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`| Canonical site URL used for metadata, sitemap, and OG images.                    |
| `COBALT_API_URL`      | Self-hosted [Cobalt](https://github.com/imputnet/cobalt) instance to harden the extraction fallback chain. |
| `IG_SESSIONID`        | Instagram session cookie from a burner account. Public posts resolve without it. Setting it is **not** sufficient on its own: a request also needs the `ig` grant on its user row, so an unlisted visitor never carries the cookie. Never sold, never bundled with the supporter grant — see below. |
| `NEXT_PUBLIC_CF_BEACON_TOKEN` | Enables Cloudflare Web Analytics by injecting the beacon script at build time. Build-time only, like `NEXT_PUBLIC_SITE_URL` — set it as build env, not a Worker var. If Web Analytics is already enabled at the zone level in the Cloudflare dashboard, Cloudflare injects the beacon at the edge automatically; setting this too would load it twice and double-count page views. Pick one mechanism. |
| `PRO_TOKEN_SECRET`    | HMAC key (WebCrypto HMAC-SHA256) for signing Pro access tokens and session-cookie values. Generate 32+ random bytes yourself. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client used for sign-in. Created in Google Cloud console; both the dev and production redirect URIs must be registered on it. Replacing the client with one from a *different* Google Cloud project changes every existing user's `sub`, since a `sub` identifies a person within a project rather than globally — `handleAuthCallback` re-keys the row by verified email so accounts survive the move, and the consent screen on the new project must be published (a project left in Testing admits only its listed test users). |
| `CREEM_API_KEY` | Dormant. Mints a customer-portal URL per click for any subscription that predates the withdrawal, and backs the lazy reconcile. Nothing creates subscriptions any more. |
| `CREEM_WEBHOOK_SECRET` | Dormant, and still never optional while the endpoint is registered: an unverified webhook endpoint would let anyone grant themselves the extras. |
| `BMC_WEBHOOK_SECRET` | Signing secret for the Buy Me a Coffee webhook, one per endpoint, from its dashboard. Without it `/api/billing/bmc` answers 503 and grants nothing. Setup and payload notes: `docs/buymeacoffee-setup.md`. |

### Accounts and grants

Nothing is sold. A $3/month subscription existed for two days in August 2026 and
was withdrawn — see *Supporting the project* above. The features it covered are
still here and are now granted by hand.

Signing in is with a Google account, entitlement is a signed short-lived access
token, and preferences (HD/SD, video/audio) sync across devices for anyone
signed in. Signing in never changes what is free.

**Grants.** The `users.grants` column holds a comma-separated set, set and
cleared with one command:

```bash
pnpm exec wrangler d1 execute social-media-downloader --remote \
  --command "UPDATE users SET grants = 'pro' WHERE email = 'someone@example.com'"
```

It takes effect within one access-token TTL (15 minutes), with no deploy. Note
that this command *assigns* the column rather than adding to it, so running it
on an account that also holds `ig` silently drops that. The Buy Me a Coffee
webhook (`/api/billing/bmc`) adds and removes single names instead and is the
normal path now — `docs/buymeacoffee-setup.md`. It records support against an
email address in `supporters` whether or not an account exists yet, and the
grant is applied when that address signs in. One Buy Me a Coffee account serves
several projects, so support is tied to a project by the name of the thing
bought: this site recognises the `Downloader — Supporter` membership and the
`Downloader — Lifetime` extra (`src/config/support.ts`) and ignores everything
else sold on the account. A plain one-off coffee carries no name to match and
grants nothing automatically; it is handled by hand as an expiring window rather
than as a `pro` grant, which has no expiry.

Two names are defined, and keeping them separate is the point:

| Grant | What it does |
| ----- | ------------ |
| `pro` | The batch queue, ZIP bundling, priority resolve, no sponsor card. What a supporter gets. |
| `ig`  | Attaches `IG_SESSIONID` to that account's Instagram resolves. Operator only. |

**What a grant is allowed to be.** `pro` is every entitlement that is a property
of *this site* — resolver ordering, queueing, how results are packaged. None of
them widens what a link can reach, and none makes this service present
credentials on a user's behalf. That line is load-bearing rather than stylistic:
a downloader that sells access to login-gated content is refused by every
merchant of record, explicitly so in some cases (Polar's acceptable-use policy
names third-party content downloaders outright; Paddle's catch-all covers
anything "enabling unauthorized access to data belonging to another party").

`ig` is on the other side of that line, which is exactly why it is a separate
grant rather than a flag inside `pro`. It is never offered, never bundled, and
`isEntitled` deliberately does not read it — a supporter is `pro` and is not
`ig`, and there is a test pinning both directions. Before this existed,
`IG_SESSIONID` alone was the whole gate, so setting it attached the cookie to
*every* visitor's Instagram resolve; a named grant is strictly less exposure
than that. Do not turn it into something anyone can obtain by paying — that is
not a policy you can reword your way around.

A credentialed resolve also bypasses both cache tiers in both directions. The
edge cache is shared and externally addressable, so a login-gated payload
written into it would be served to anonymous visitors; see the note in
`src/lib/apiRoutes.ts`.

Setting this up for a fork or self-hosted deployment, in order:

1. **Google Cloud console** — create an OAuth client and configure its consent
   screen. Register **both** redirect URIs (a mismatch between dev and
   production here is the most common thing to get wrong): the `wrangler dev`
   origin's `/api/auth/callback` and the production origin's `/api/auth/callback`.
2. **No payment provider.** There is nothing to configure here — a fork that
   wants the extras grants them with the `wrangler d1 execute` command above.
   The Creem webhook, portal and reconcile code is still in
   `src/lib/billing/` and still tested, so a fork that finds a processor
   willing to underwrite this category has a working half to build on. Read
   `lessons/2026-08-10-creem-payout-rejection.md` first: two refused, and the
   second refusal came after every fixable checklist item had been fixed.
3. **Cloudflare** — create the D1 database, apply the migrations
   (`wrangler d1 migrations apply <name> --remote` — use this rather than
   executing the SQL files directly, or the `d1_migrations` bookkeeping table
   will disagree with the schema and later migrations will fail), add the `DB`
   binding in `wrangler.jsonc`, then set the five secrets above with
   `pnpm cf:setup` (reads `.env`) or `wrangler secret put`.

   Order matters for one of them: do not put live checkout URLs in
   `src/config/pro.ts` until `CREEM_WEBHOOK_SECRET` is set. The webhook route
   fails closed with a 503 while that secret is missing, and Creem eventually
   stops retrying — so a purchase made in that window is billed with no
   subscription recorded.
4. **Edge policy** — `pnpm cf:waf` applies the zone's WAF rules, rate limit, bot
   settings and TLS settings; `pnpm cf:health` reads back who the edge stopped in
   the last 24 hours. Both are idempotent, and
   `.github/workflows/cloudflare-edge-policy.yml` runs them weekly, because zone
   state is not repo state and a dashboard edit outlives every push.

   The single thing to understand before touching it: **free-plan Bot Fight Mode
   runs outside the Ruleset Engine, so no `skip` rule can exempt anything from
   it.** Left on, it challenges crawlers, webhook senders and Google's own
   review fetches, and a challenged request appears in no log — not
   `wrangler tail`, not the deploy, nowhere but the zone's firewall events. It is
   off, and the defence it provided is re-expressed as WAF rules that can be
   scoped. `pnpm cf:health` is the only witness; run it after every change.

   Which crawlers are welcome lives in **`src/config/crawlers.json`**, read by
   both `src/app/robots.tsx` (the request) and `scripts/cf-setup.mjs` (the
   enforcement). Editing one list changes both, which is the point: a crawler
   invited in robots.txt and blocked at the edge is invisible until the traffic
   never arrives.

## How to use

**Download a video, reel, or Short**

1. Copy a link from any supported platform.
2. Paste it into the input on the homepage (or tap **Paste**, or share it into the installed app).
3. Click **Process URL** — the app fetches metadata and a clean download link.
4. Optionally preview, then click **Video** or **Extract Audio** — or re-pick **HD / SD / MP3**.

**Download several at once (batch)**

1. Paste a list of links — one per line or space-separated.
2. Each URL is detected and resolved in turn with live progress.

**Download a photo carousel**

1. Paste the photo post URL (a TikTok slideshow or an Instagram carousel).
2. All images appear as a selectable grid.
3. Toggle the selections, then download them individually or as a ZIP.
4. For TikTok slideshows, click **Video (slideshow)** to render an MP4 of the images timed to the original music.

**Install as an app**

- **Android/Chrome:** tap **Install** on the in-app prompt (or the browser's install button). Afterwards, share links straight from other apps via **Share → Social Downloader**.
- **iOS Safari:** tap **Share → Add to Home Screen**, then launch from the icon and use one-tap **Paste**.

**Supported URL formats**

| Platform  | Formats                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------ |
| TikTok    | `tiktok.com/@user/video/…`, `vm.tiktok.com/…`, `vt.tiktok.com/…`, `m.tiktok.com/v/…`, `tiktok.com/t/…` |
| Twitter/X | `twitter.com/user/status/…`, `x.com/user/status/…`, `t.co/…`                                           |
| Instagram | `instagram.com/p/…`, `instagram.com/reel/…`, `instagram.com/tv/…`, `instagram.com/share/…`             |
| YouTube   | `youtube.com/watch?v=…`, `youtu.be/…`, `youtube.com/shorts/…`, `youtube.com/embed/…`                   |
| Facebook  | `facebook.com/…/videos/…`, `facebook.com/watch/?v=…`, `facebook.com/reel/…`, `fb.watch/…`              |
| Pinterest | `pinterest.com/pin/…`, `pin.it/…`                                                                       |
| Reddit    | `reddit.com/r/…/comments/…`, `reddit.com/…/s/…`                                                         |
| Threads   | `threads.net/@user/post/…`, `threads.com/@user/post/…`, `threads.net/t/…`                              |
| Snapchat  | `snapchat.com/spotlight/…`, `snapchat.com/t/…`, `story.snapchat.com/…`                                 |
| Twitch    | `twitch.tv/…/clip/…`, `clips.twitch.tv/…`, `twitch.tv/videos/…`                                        |
| Vimeo     | `vimeo.com/…`, `player.vimeo.com/video/…`                                                               |

## Project structure

```
src/
├── app/
│   ├── page.tsx                 # Home page
│   ├── layout.tsx               # Root layout, metadata, JSON-LD injection
│   ├── <platform>-downloader/   # 11 per-platform landing pages (SEO)
│   ├── opengraph-image.tsx      # Dynamic 1200x630 OG image (edge runtime)
│   ├── twitter-image.tsx        # Twitter card image (delegates to OG)
│   ├── robots.ts                # robots.txt (incl. AI crawler policy)
│   ├── sitemap.ts               # sitemap.xml with hreflang + OG image
│   ├── globals.css
│   └── api/
│       ├── download/            # POST — resolves URL, returns video/image data
│       ├── video/               # GET  — proxies the video stream (video/mp4, range-aware)
│       ├── audio/               # GET  — proxies the same stream as audio/mpeg
│       ├── image/               # GET  — proxies a single image (CORS + CDN referer)
│       ├── images/              # POST — batch image fetcher with ZIP support
│       ├── slideshow/           # POST — renders an MP4 from images + audio (ffmpeg)
│       ├── thumb/               # GET  — proxied, cached thumbnails for Recent tiles
│       ├── tiktok/              # platform-specific resolve helper
│       └── youtube/             # platform-specific resolve helper
├── components/
│   ├── DownloaderApp.tsx        # Main client app (paste, batch, re-pick, Recent)
│   ├── InstallPrompt.tsx        # PWA install nudge (Android + iOS)
│   ├── PlatformLanding.tsx      # Shared landing-page template
│   ├── ImageLightbox.tsx, GlowCard.tsx, InteractiveBackground.tsx, …
│   └── icons.tsx
├── config/
│   └── site.ts                  # Single source of truth for site metadata
└── lib/
    ├── downloader.ts            # Core resolve logic + per-platform fallbacks
    ├── validator.ts             # URL validation and platform detection (11 platforms)
    ├── platforms.ts             # Per-platform copy, colors, landing config
    ├── proxyHeaders.ts          # Per-CDN Referer resolution shared by proxy routes
    ├── responseCache.ts         # Warm-instance resolve cache
    ├── history.ts               # Local, privacy-friendly Recent list
    ├── appReducer.ts            # Client state machine
    ├── audioExtractor.ts        # Audio extraction helpers
    ├── videoProcessor.ts        # Video processing utilities
    ├── ytdlp.ts                 # youtube-dl-exec fallback
    ├── structuredData.ts        # JSON-LD graph (Schema.org)
    ├── platformOgImage.tsx      # Per-platform OG image rendering
    ├── types.ts                 # Shared TypeScript types
    └── utils.ts
```

## API reference

### `POST /api/download`

Resolves a supported URL and returns download links and metadata.

```json
{ "url": "https://www.instagram.com/reel/ABC123/" }
```

Video response:

```json
{
  "success": true,
  "downloadUrl": "/api/video?url=...",
  "audioUrl": "/api/audio?url=...",
  "metadata": { "title": "…", "author": "…", "thumbnail": "…", "platform": "instagram" }
}
```

Photo carousel response:

```json
{
  "success": true,
  "metadata": {
    "title": "…",
    "author": "…",
    "platform": "instagram",
    "images": ["…", "…"]
  }
}
```

### `GET /api/video?url=<encoded>`

Proxies a video file with `Content-Type: video/mp4`, adding the correct `Referer` for each CDN (via `lib/proxyHeaders.ts`) and honoring HTTP range requests so preview/seek works.

### `GET /api/audio?url=<encoded>`

Same proxy as `/api/video` but with `Content-Type: audio/mpeg`, so browsers treat it as an audio download.

### `GET /api/image?url=<encoded>`

Proxies a single image with the correct CDN `Referer` and permissive CORS headers. Instagram's CDN refuses cross-origin browser requests, so Instagram image previews and individual downloads are routed through this endpoint.

### `POST /api/images`

Fetches a list of image URLs. Returns either a JSON list of (proxied) downloadable URLs or a ZIP archive depending on `asZip`.

```json
{ "imageUrls": ["https://…"], "title": "post-title", "asZip": true }
```

### `POST /api/slideshow`

Renders a real MP4 from a TikTok photo carousel using ffmpeg, timing each image and laying the original music on top.

```json
{
  "imageUrls": ["https://…", "https://…"],
  "audioUrl": "https://…",
  "perImageSeconds": 3
}
```

## Source fallback order

The downloader tries providers in order and falls back automatically on failure.

- **TikTok videos:** Tikwm → Snaptik → SSSTik → direct scraping
- **Twitter/X videos:** vxTwitter → public Cobalt instances
- **Instagram posts/reels:** embed page (`shortcode_media`) → private media API (`/api/v1/media/<id>/info/`, session only) → public Cobalt instances. The embed resolves public posts, reels and carousels with no login; Cobalt covers what it misses. Anything Instagram will not serve logged-out — private, age- or region-restricted posts, and all stories — needs `IG_SESSIONID` *and* the `ig` grant on the requesting account. The web GraphQL extractor was removed on 2026-08-15: Instagram retired the persisted query and refuses the `doc_id` itself, identically for a logged-out and a logged-in caller.
- **YouTube videos/Shorts:** public Cobalt instances → public Piped instances → `youtube-dl-exec` (metadata enriched via YouTube oEmbed)
- **Facebook videos/reels:** video plugin page (`/plugins/video.php`) → direct page scrape (`browser_native_*_url`) → public Cobalt instances
- **Vimeo:** player config (`/config`) progressive renditions → embed-only when Vimeo ships no progressive rendition for that video (playable, not downloadable — the DASH/HLS manifests it ships instead need ffmpeg)
- **Reddit:** the embed view's `packaged-media-json` (pre-muxed MP4s; the raw `v.redd.it` renditions are video and audio in separate files) → Cobalt
- **Threads:** the post's `/embed` view, requested as a link crawler (a browser user agent gets the empty app shell) → Cobalt
- **Twitch clips:** the public GraphQL clip query, signed with the access token from the same response → Cobalt. VODs are HLS and are not supported.
- **Pinterest:** the widget API (`/v3/pidgets/pins/info/`) — video renditions, or the image as a one-image gallery → Cobalt
- **Snapchat and anything else:** best-effort via public Cobalt instances, then the generic page scrape

Each platform above tries its own endpoint *before* Cobalt because the one open
public instance now answers `api.fetch.fail`/`api.fetch.critical` for most of
them — its address is blocked by the origins. Cobalt stays in the chain: when it
does answer, it tunnels the media, which streams from any IP.

> Cobalt does the heavy lifting on serverless hosts (where `yt-dlp` isn't available). Set `COBALT_API_URL` to point the fallback chain at your own [Cobalt](https://github.com/imputnet/cobalt) instance for more reliable, higher-throughput extraction.

## Deployment

Production runs on **Cloudflare Workers**. `pnpm cf:build` exports the whole site to `out/`, wrangler uploads that as Workers Static Assets, and `cloudflare/worker.js` answers only `/api/*` — a page view matches an asset before the Worker is invoked, so it costs no CPU and nothing against the free plan's request cap.

A push to `main` deploys ([`.github/workflows/deploy-cloudflare.yml`](.github/workflows/deploy-cloudflare.yml)). The same run checks the bundle against the upload limit and the isolate startup budget (`pnpm cf:startup`), pings IndexNow with the deployed sitemap, and publishes a dated [release](../../releases) listing what that deploy carried. The Cloudflare-side setup — D1, migrations, secrets, WAF — is in [Getting started](#getting-started).

It also runs on any Node.js host that supports Next.js 16 (Node 20+, ideally 24 LTS): the App Router files under `src/app/api/` wrap the same handlers the Worker calls, so nothing here is Cloudflare-only except the deploy itself. For the most reliable extraction in production, set `COBALT_API_URL` to a self-hosted Cobalt instance.

## Legal

This tool is intended for personal use with content you have the right to save. Respect the Terms of Service of each platform and do not download content without the creator's permission. Private accounts, stories, and age-restricted, members-only, or private videos are not supported.

## Author

Built and maintained by **[Mohamed Gado](https://www.mohamedgado.com)** — [mohamedgado.com](https://www.mohamedgado.com).

## License

MIT — see [LICENSE](LICENSE).

## Issues and contributions

Open a ticket on the [Issues](../../issues) page with a description, the URL format you tried, and any error message. Pull requests welcome. If the tool saved you time, a ⭐ goes a long way.

Before opening a pull request, run `pnpm verify` — typecheck, lint and tests in one command. CI does not run those separately: `next build` type-checks the whole project including test files, so a type error in a test fails the deploy rather than the test run.
