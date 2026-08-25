import { siteConfig } from '@/config/site'

export type PlatformSlug =
  | 'video-downloader'
  | 'tiktok-downloader'
  | 'twitter-video-downloader'
  | 'instagram-downloader'
  | 'youtube-downloader'
  | 'facebook-downloader'
  | 'pinterest-downloader'
  | 'reddit-video-downloader'
  | 'threads-video-downloader'
  | 'snapchat-downloader'
  | 'twitch-clip-downloader'
  | 'vimeo-downloader'

export interface PlatformSeoCard {
  title: string
  body: string
}

export interface PlatformFaq {
  q: string
  a: string
}

export interface Platform {
  slug: PlatformSlug
  name: string
  brandLabel: string
  metaTitle: string
  metaDescription: string
  h1: string
  tagline: string
  intro: string
  accent: {
    chip: string
    grad: string
    ring: string
    glow: string
  }
  urlExamples: string[]
  cards: PlatformSeoCard[]
  faqs: PlatformFaq[]
  featureList: string[]
}

export const platforms: Platform[] = [
  {
    slug: 'video-downloader',
    name: 'Any Site',
    brandLabel: 'Any video downloader',
    metaTitle: 'Any Video Downloader — Paste Any Link, Save HD MP4 & MP3',
    metaDescription:
      'Paste a link from any website and download the video in HD, extract MP3 audio, or save embedded media — free, no login, no app install. TikTok, X, Instagram, YouTube and everything else.',
    h1: 'Any Video Downloader — Paste Any Link',
    tagline:
      'One paste box for every site: resolve the video, the audio, or the images from any public link.',
    intro:
      'Paste any public video link — from the eleven dedicated platforms or anywhere else. The extractor reads what the page itself publishes (og:video, JSON-LD, player configs, direct files) and verifies it serves real media before offering it, so what you get is a file that plays rather than an error page renamed .mp4. If a page serves its video to the public, this usually resolves it. No login, nothing installed.',
    accent: {
      chip: 'bg-cyan-600 text-white',
      grad: 'from-cyan-400 via-sky-500 to-blue-600',
      ring: 'ring-cyan-400/30',
      glow: 'shadow-cyan-500/30',
    },
    urlExamples: [
      'example.com/videos/any-clip',
      'site.org/watch/…',
      'blog.example.com/post-with-video',
      'any direct .mp4 / .webm link',
    ],
    cards: [
      {
        title: '🌐 Beyond the big eleven',
        body: 'Small video hosts, blogs, news sites, forums — if the page publishes its media, the generic extractor finds the best rendition and hands you the file.',
      },
      {
        title: '🛡️ Verified before offered',
        body: 'Every scraped URL is probed first: it must serve actual media bytes, not an HTML error page. What lands in your downloads folder plays.',
      },
      {
        title: '🎵 MP3 from any resolved link',
        body: 'Wherever the video resolves, the soundtrack comes with it — extract audio as MP3 even on platforms without a dedicated downloader.',
      },
    ],
    faqs: [
      {
        q: 'Does this work with any website?',
        a: 'It works wherever a page serves its media publicly. Dedicated support covers TikTok, X, Instagram, Facebook, YouTube, Pinterest, Reddit, Threads, Snapchat, Twitch and Vimeo; beyond those, the extractor reads whatever the page publishes, which resolves most smaller video hosts, blogs and news pages.',
      },
      {
        q: 'What if a site blocks automated access?',
        a: 'Some hosts serve a block page instead of the real markup to datacenter IPs. Those links are retried at an address the site does answer — an embed or player page usually stays open when the watch page does not — and when neither works, the error says the host blocked us rather than guessing at some other cause.',
      },
      {
        q: 'Can I download from sites that require a login?',
        a: 'No. Only what a logged-out visitor can already see is reachable — private accounts, paywalls and DRM streams are out of reach by design.',
      },
      {
        q: 'How do I get the best quality from a random site?',
        a: 'Leave quality on HD. When a page offers several renditions, the extractor ranks them by resolution and picks the highest verified one rather than trusting whichever URL appears first.',
      },
      {
        q: 'Why did my link fail?',
        a: 'The three common reasons: the media is login-gated, the page never exposes a direct file (it streams through an obfuscated player), or the host blocks automated fetches entirely. The error message tells you which one it was.',
      },
    ],
    featureList: [
      'Download videos from any public web page, not just major platforms',
      'Reads og:video, JSON-LD contentUrl, <video> sources and player configs',
      'Ranks multiple renditions by resolution and picks the best verified one',
      'MP3 extraction on every link that resolves as video',
      'Host-specific recipes that read an embed page when the watch page is walled',
    ],
  },
  {
    slug: 'tiktok-downloader',
    name: 'TikTok',
    brandLabel: 'TikTok video downloader',
    metaTitle: 'TikTok Video Downloader — HD MP4, MP3 & Slideshow',
    metaDescription:
      'Download public TikTok videos in HD, extract the soundtrack as MP3, or save every image from a photo carousel — free, no login, no app install.',
    h1: 'TikTok Video Downloader — HD, MP3 & Slideshow',
    tagline:
      'Save TikTok videos in 1080p, extract MP3 audio, and download photo carousels with their original music.',
    intro:
      'Paste any public tiktok.com or vm.tiktok.com link to download the video in its original quality, pull the soundtrack as an MP3, or save every image from a TikTok photo carousel — individually or as a single ZIP. Everything happens in your browser, no app to install and no sign-up.',
    accent: {
      chip: 'bg-[#010101] text-white',
      grad: 'from-pink-500 via-fuchsia-500 to-rose-500',
      ring: 'ring-pink-500/30',
      glow: 'shadow-pink-500/30',
    },
    urlExamples: [
      'tiktok.com/@user/video/…',
      'vm.tiktok.com/…',
      'tiktok.com/t/…',
      'm.tiktok.com/v/…',
    ],
    cards: [
      {
        title: '🎬 HD video, original quality',
        body: 'Get public TikTok clips at their source 1080p quality — the real MP4, not a screen recording, so it stays sharp when you archive or re-watch it.',
      },
      {
        title: '🎵 MP3 from any TikTok',
        body: 'Pull the soundtrack from any video or slideshow as an MP3. Trending sound? Grab it in seconds without screen-recording.',
      },
      {
        title: '🖼️ Photo carousels',
        body: 'TikTok slideshows return as a full gallery. Preview each image, pick favorites, then save individually or as a ZIP — original music included.',
      },
    ],
    faqs: [
      {
        q: 'Is this TikTok downloader free?',
        a: 'Yes — completely free, with no sign-up and no daily download limit.',
      },
      {
        q: 'What quality are downloaded TikTok videos?',
        a: 'The source file TikTok serves for a public post — up to 1080p HD, not a re-encode or a screen recording.',
      },
      {
        q: 'Can I download a TikTok photo carousel (slideshow)?',
        a: 'Yes. Paste the slideshow URL and the app lists every image, the background track, and — when TikTok provides one — the rendered slideshow video, so you can grab the photos, the MP3, or the MP4 in one flow.',
      },
      {
        q: 'How do I extract MP3 audio from a TikTok video?',
        a: 'Paste the TikTok URL, click Process URL, then use the Extract Audio button. The MP3 is delivered straight to your device — no screen-recording needed.',
      },
      {
        q: 'Why does my TikTok link fail to process?',
        a: 'Make sure the post is public and the URL is the share link (tiktok.com/@user/video/… or vm.tiktok.com/…). Private, deleted, region-locked, or age-restricted posts cannot be fetched.',
      },
    ],
    featureList: [
      'Download public TikTok videos at their original HD quality',
      'Extract MP3 audio from any TikTok video or slideshow',
      'Save TikTok photo carousels — individually or as a ZIP',
      'Preview the video and audio before downloading',
      'No login, no app install, no daily download limit',
    ],
  },
  {
    slug: 'twitter-video-downloader',
    name: 'Twitter / X',
    brandLabel: 'Twitter/X video downloader',
    metaTitle: 'Twitter / X Video Downloader — Save HD Videos & GIFs',
    metaDescription:
      'Save any Twitter or X video in HD, including GIF videos and longer posts. Paste a twitter.com or x.com status URL and download the MP4 instantly — no login.',
    h1: 'Twitter / X Video Downloader — HD MP4 & GIF',
    tagline:
      'Save Twitter videos, X clips, and GIF tweets as MP4 in their original quality.',
    intro:
      'Paste any twitter.com or x.com status URL and the tool resolves the underlying media — HD video, GIF, or multi-attachment thread — so you can preview and download the MP4 directly to your device. No login, no extensions, nothing installed.',
    accent: {
      chip: 'bg-black text-white',
      grad: 'from-sky-500 via-blue-500 to-indigo-500',
      ring: 'ring-sky-500/30',
      glow: 'shadow-sky-500/30',
    },
    urlExamples: [
      'x.com/user/status/…',
      'twitter.com/user/status/…',
      'mobile.twitter.com/…',
      't.co/…',
    ],
    cards: [
      {
        title: '🎬 HD MP4 downloads',
        body: 'Get the highest available bitrate of any tweet video — including longer-form posts and clips on X Premium accounts.',
      },
      {
        title: '🌀 GIF tweets → MP4',
        body: 'Twitter "GIFs" are really H.264 MP4s. The tool extracts them as a clean MP4 you can replay, edit, or convert.',
      },
      {
        title: '🔁 twitter.com & x.com',
        body: 'Both legacy twitter.com URLs and the new x.com URLs are supported. Paste either — the underlying status ID is what matters.',
      },
    ],
    faqs: [
      {
        q: 'Does this work for both twitter.com and x.com?',
        a: 'Yes. The tool extracts the status ID from either domain, so legacy twitter.com links and new x.com links both work.',
      },
      {
        q: 'Can I download a Twitter GIF as a video?',
        a: 'Yes. Twitter GIFs are stored as H.264 MP4s — the tool downloads them as clean MP4 files in their original quality.',
      },
      {
        q: 'What quality are downloaded Twitter videos?',
        a: 'You get the highest bitrate the original post offers — typically 720p or 1080p for HD clips, and up to the source quality for longer X Premium posts.',
      },
      {
        q: 'Do I need to log in or follow the account?',
        a: 'No. The tool fetches only what the post exposes publicly. If a post is from a protected account, it can\'t be downloaded.',
      },
      {
        q: 'Why does my Twitter link fail to process?',
        a: 'Make sure the tweet is public and the URL is a status link (twitter.com/user/status/… or x.com/user/status/…). Deleted, protected, or geo-restricted posts can\'t be fetched.',
      },
    ],
    featureList: [
      'Download Twitter and X videos in HD',
      'Save GIF tweets as clean MP4 files',
      'Works with both twitter.com and x.com URLs',
      'No login, no Twitter API key, no install',
      'Preview the video before downloading',
    ],
  },
  {
    slug: 'instagram-downloader',
    name: 'Instagram',
    brandLabel: 'Instagram reels & photo downloader',
    metaTitle: 'Instagram Reels & Photo Downloader — Free, No Login',
    metaDescription:
      'Download Instagram reels in HD, save single photos, or pull every image from a carousel post — no Instagram login, no app install. Free, no daily limit.',
    h1: 'Instagram Reels & Photo Downloader — Free, No Login',
    tagline:
      'Save Instagram reels, photos, and carousel posts in their original resolution.',
    intro:
      'Paste a public Instagram URL — a reel, a single photo, or a carousel — and the tool extracts the media in its original resolution. Carousels return every image individually so you can pick the ones you want or save them all as a ZIP. No Instagram login required.',
    accent: {
      chip:
        'bg-gradient-to-br from-[#FEDA75] via-[#D62976] to-[#4F5BD5] text-white',
      grad: 'from-fuchsia-500 via-pink-500 to-orange-500',
      ring: 'ring-fuchsia-500/30',
      glow: 'shadow-fuchsia-500/30',
    },
    urlExamples: [
      'instagram.com/p/…',
      'instagram.com/reel/…',
      'instagram.com/reels/…',
      'instagram.com/tv/…',
    ],
    cards: [
      {
        title: '🎬 Reels in HD',
        body: 'Save public Instagram reels in their full source resolution — vertical, square, or landscape — as the original MP4, not a re-encode.',
      },
      {
        title: '🖼️ Single photos',
        body: 'Public Instagram photo posts return at full size — no thumbnail compression, no UI screenshot needed.',
      },
      {
        title: '🗂️ Photo carousels',
        body: 'Carousel posts come through as a gallery. Pick the images you want and save them one by one, or download the whole set as a ZIP.',
      },
    ],
    faqs: [
      {
        q: 'Can I download Instagram reels in HD?',
        a: 'Yes — reels are saved at their source resolution and the original aspect ratio is preserved.',
      },
      {
        q: 'Does it work on Instagram photo carousels?',
        a: 'Yes. Paste a /p/ URL containing multiple photos and every image is listed individually — download them all as a ZIP or just the ones you want.',
      },
      {
        q: 'Do I need to log into Instagram?',
        a: 'No. The tool only accesses publicly visible posts. Private accounts, stories, and DMs are out of scope.',
      },
      {
        q: 'Can I download Instagram stories?',
        a: 'No. Stories are not in scope — only public feed posts, reels, IGTV, and carousels are supported.',
      },
      {
        q: 'Does Instagram see who downloaded a post?',
        a: 'No. There is no "downloaded by" signal exposed to creators. That said, please respect the original creator and Instagram\'s terms when re-using content.',
      },
    ],
    featureList: [
      'Download Instagram reels in HD',
      'Save single Instagram photos at full resolution',
      'Pull every image from a carousel — individually or as ZIP',
      'No Instagram login required',
      'Public posts only — private accounts and stories not supported',
    ],
  },
  {
    slug: 'youtube-downloader',
    name: 'YouTube',
    brandLabel: 'YouTube & Shorts downloader',
    metaTitle: 'YouTube & Shorts Downloader — MP4 HD & MP3 Audio',
    metaDescription:
      'Download YouTube videos and Shorts in HD as MP4, or extract the audio as MP3. Paste youtube.com/watch, youtu.be, or /shorts/ links — no install.',
    h1: 'YouTube & Shorts Downloader — MP4 HD & MP3',
    tagline:
      'Save YouTube videos and Shorts as HD MP4 or extract clean MP3 audio.',
    intro:
      'Paste any youtube.com/watch?v=…, youtu.be/…, or /shorts/… link. The tool resolves the stream so you can preview it, save the MP4 in HD, or pull the soundtrack as an MP3 — useful for podcasts, lectures, or trending audio. Age-restricted, private, and members-only videos aren\'t supported.',
    accent: {
      chip: 'bg-[#FF0000] text-white',
      grad: 'from-red-500 via-rose-500 to-pink-500',
      ring: 'ring-red-500/30',
      glow: 'shadow-red-500/30',
    },
    urlExamples: [
      'youtube.com/watch?v=…',
      'youtu.be/…',
      'youtube.com/shorts/…',
      'm.youtube.com/watch?v=…',
    ],
    cards: [
      {
        title: '🎬 HD MP4 video',
        body: 'Get the highest available MP4 quality — up to 1080p where the source supports it — without a browser extension or installed app.',
      },
      {
        title: '🎵 MP3 audio extract',
        body: 'Pull just the soundtrack as a clean MP3. Perfect for music, lectures, podcasts, and language-learning clips.',
      },
      {
        title: '⚡ Shorts ready',
        body: 'Vertical YouTube Shorts (/shorts/…) are first-class citizens — saved in their native 9:16 aspect ratio at source resolution.',
      },
      {
        title: '📚 Whole playlists, one paste',
        body: 'Supporters can paste a playlist?list=… link and it expands into individual videos automatically — de-duplicated and queued in order.',
      },
    ],
    faqs: [
      {
        q: 'Can I download YouTube Shorts?',
        a: 'Yes — paste any youtube.com/shorts/… link and the tool resolves the stream so you can preview it, download the MP4, or extract the MP3.',
      },
      {
        q: 'Can I extract just the MP3 audio?',
        a: 'Yes. Click Extract Audio after processing to download a clean MP3 instead of (or alongside) the video.',
      },
      {
        q: 'What\'s the maximum quality?',
        a: 'Up to 1080p MP4 when the source supports it. Some videos top out at 720p depending on the original upload.',
      },
      {
        q: 'Does it work on age-restricted or members-only videos?',
        a: 'No. Age-restricted, private, members-only, and region-blocked videos can\'t be fetched.',
      },
      {
        q: 'Why does my video only load as a preview?',
        a: 'Some YouTube videos restrict free extraction. In that case the tool falls back to an embedded preview so you can still watch it inline.',
      },
      {
        q: 'Can I import a whole YouTube playlist?',
        a: 'Yes. Supporters paste the playlist link once; every video becomes its own row in the download queue with real titles, capped per run. The queue is one of the supporter extras — downloading videos one link at a time is free and unlimited for everyone.',
      },
    ],
    featureList: [
      'Download YouTube videos as HD MP4',
      'Save YouTube Shorts in native vertical format',
      'Extract MP3 audio from any video',
      'Preview before downloading',
      'No browser extension, no install',
    ],
  },
  {
    slug: 'facebook-downloader',
    name: 'Facebook',
    brandLabel: 'Facebook video & reels downloader',
    metaTitle: 'Facebook Video & Reels Downloader — HD, No Login',
    metaDescription:
      'Save any public Facebook video, watch clip, or reel in HD. Paste a facebook.com/.../videos/, fb.watch, or /reel/ URL — no login or extension required.',
    h1: 'Facebook Video & Reels Downloader — HD, No Login',
    tagline:
      'Download Facebook videos, watch clips, and reels in HD straight to your device.',
    intro:
      'Paste any public Facebook video, watch clip, or reel URL — facebook.com/…/videos/…, fb.watch/…, or facebook.com/reel/… — and the tool extracts the HD stream for preview and download. No Facebook login, no extension, no app required. Private posts and videos from private groups can\'t be fetched.',
    accent: {
      chip: 'bg-[#1877F2] text-white',
      grad: 'from-blue-500 via-sky-500 to-cyan-500',
      ring: 'ring-blue-500/30',
      glow: 'shadow-blue-500/30',
    },
    urlExamples: [
      'facebook.com/.../videos/…',
      'fb.watch/…',
      'facebook.com/reel/…',
      'facebook.com/watch/?v=…',
    ],
    cards: [
      {
        title: '🎬 HD video & watch clips',
        body: 'Public Facebook videos and Watch clips come through at the source resolution they were uploaded with — typically 720p or 1080p.',
      },
      {
        title: '🎞️ Reels — native vertical',
        body: 'Facebook Reels are saved in their native 9:16 vertical format, ready for re-sharing or archiving.',
      },
      {
        title: '🔗 fb.watch short links',
        body: 'Short fb.watch URLs work the same as full facebook.com URLs — the tool resolves the short link to the underlying video automatically.',
      },
    ],
    faqs: [
      {
        q: 'Does this work on Facebook Reels?',
        a: 'Yes — paste a facebook.com/reel/… URL and the tool extracts the video in its native vertical format.',
      },
      {
        q: 'Can I download videos from Facebook Watch?',
        a: 'Yes. Watch clips (facebook.com/watch/?v=…) and embedded videos in posts are both supported.',
      },
      {
        q: 'Do private Facebook videos work?',
        a: 'No. Only public posts, public reels, and public Watch clips can be downloaded. Private posts and videos from private groups aren\'t in scope.',
      },
      {
        q: 'What URL formats are supported?',
        a: 'facebook.com/.../videos/…, fb.watch/…, facebook.com/reel/…, and facebook.com/watch/?v=… all work — paste any of them.',
      },
      {
        q: 'Will the original poster know I downloaded their video?',
        a: 'No — there\'s no "downloaded by" notification. Please respect the creator and Facebook\'s terms when re-using their content.',
      },
    ],
    featureList: [
      'Download Facebook videos in HD',
      'Save Facebook Reels in native vertical format',
      'Works with fb.watch short links',
      'Public posts only — no login, no extension',
      'Preview the video before downloading',
    ],
  },
  {
    slug: 'pinterest-downloader',
    name: 'Pinterest',
    brandLabel: 'Pinterest video & image downloader',
    metaTitle: 'Pinterest Video & Image Downloader — Save Pins, No Login',
    metaDescription:
      'Download Pinterest videos and pin images in full quality. Paste a pinterest.com/pin/ or pin.it link and save the media instantly — free, no login, no app.',
    h1: 'Pinterest Video & Image Downloader — Free, No Login',
    tagline:
      'Save Pinterest video pins and full-resolution images straight to your device.',
    intro:
      'Paste any pinterest.com/pin/… or pin.it/… link and the tool resolves the underlying media — an idea-pin video or a full-size image — so you can preview and download it directly. No Pinterest login, no browser extension, nothing installed. Private boards and secret pins can’t be fetched.',
    accent: {
      chip: 'bg-[#E60023] text-white',
      grad: 'from-red-500 via-rose-500 to-red-600',
      ring: 'ring-red-500/30',
      glow: 'shadow-red-500/30',
    },
    urlExamples: [
      'pinterest.com/pin/…',
      'pin.it/…',
      'pinterest.co.uk/pin/…',
      'pinterest.de/pin/…',
    ],
    cards: [
      {
        title: '🎬 Video pins in HD',
        body: 'Pinterest idea-pin videos are saved at their source quality as a clean MP4 — no screen-recording, no re-encode.',
      },
      {
        title: '🖼️ Full-resolution images',
        body: 'Image pins download at full size, not the compressed thumbnail the app shows — ideal for mood boards and references.',
      },
      {
        title: '🔗 pin.it short links',
        body: 'Short pin.it URLs work the same as full pinterest.com links — the tool resolves the short link to the underlying pin automatically.',
      },
      {
        title: '📚 Download a whole board',
        body: 'A board link expands into its pins through the board’s public feed — every pin becomes a row you can resolve in one run.',
      },
    ],
    faqs: [
      {
        q: 'Can I download Pinterest videos?',
        a: 'Yes — paste a video pin URL and the tool resolves the MP4 so you can preview it and save it directly to your device.',
      },
      {
        q: 'Does it save full-size Pinterest images?',
        a: 'Yes. Image pins are downloaded at their source resolution rather than the compressed preview shown in the feed.',
      },
      {
        q: 'Do pin.it short links work?',
        a: 'Yes. The tool follows the pin.it redirect to the underlying pinterest.com pin, so either format works.',
      },
      {
        q: 'Do I need a Pinterest account?',
        a: 'No. Only publicly visible pins are accessed — no login, no extension. Private boards and secret pins are out of scope.',
      },
      {
        q: 'Why does my Pinterest link fail to process?',
        a: 'Make sure the pin is public and the URL is a pin link (pinterest.com/pin/… or pin.it/…). Some pins only link out to an external site and carry no downloadable media.',
      },
      {
        q: 'Can I back up an entire Pinterest board?',
        a: 'Yes. Supporters paste the board link and each pin becomes its own queue row via the board’s public RSS feed, so images and videos resolve together without copying links one at a time.',
      },
    ],
    featureList: [
      'Download Pinterest video pins in HD',
      'Save Pinterest images at full resolution',
      'Works with pin.it short links',
      'No Pinterest login, no extension, no install',
      'Preview the media before downloading',
    ],
  },
  {
    slug: 'reddit-video-downloader',
    name: 'Reddit',
    brandLabel: 'Reddit video downloader',
    metaTitle: 'Reddit Video Downloader — Save v.redd.it Videos with Audio',
    metaDescription:
      'Download Reddit videos in HD with sound. Reddit stores video and audio separately — this tool merges them. Paste a reddit.com or v.redd.it link, no login.',
    h1: 'Reddit Video Downloader — HD, With Sound',
    tagline:
      'Save Reddit videos with the audio track merged back in — the way they should download.',
    intro:
      'Reddit hosts a post’s video and its audio as two separate streams, which is why a naive “save video” grabs a silent clip. Paste any reddit.com/r/…/comments/… or v.redd.it/… link and the tool resolves both streams and merges them so you get the video with sound. No login, no extension, nothing installed.',
    accent: {
      chip: 'bg-[#FF4500] text-white',
      grad: 'from-orange-500 via-orange-600 to-red-500',
      ring: 'ring-orange-500/30',
      glow: 'shadow-orange-500/30',
    },
    urlExamples: [
      'reddit.com/r/sub/comments/…',
      'v.redd.it/…',
      'reddit.com/r/sub/s/…',
      'redd.it/…',
    ],
    cards: [
      {
        title: '🔊 Video with sound',
        body: 'Reddit splits video and audio into separate files. The tool fetches both and merges them, so your download isn’t a silent clip.',
      },
      {
        title: '🎬 HD quality',
        body: 'Clips are saved at the highest resolution the original post offers — up to 1080p on hosted v.redd.it videos.',
      },
      {
        title: '🔗 Every Reddit link',
        body: 'Full comment permalinks, /s/ share links, and bare v.redd.it / redd.it short URLs are all supported — paste any of them.',
      },
      {
        title: '📚 Import whole subreddits',
        body: 'Paste a subreddit or user page and the media posts become queue rows — videos and images only, pinned mod posts skipped.',
      },
    ],
    faqs: [
      {
        q: 'Why do Reddit videos download without sound elsewhere?',
        a: 'Reddit stores the video and audio as two separate streams. A plain “save” grabs only the video. This tool fetches both and merges them so the download has sound.',
      },
      {
        q: 'What Reddit URL formats work?',
        a: 'Full comment permalinks (reddit.com/r/…/comments/…), new-style /s/ share links, and short v.redd.it / redd.it URLs all work.',
      },
      {
        q: 'Can I download videos from any subreddit?',
        a: 'Any public post works. Videos in private or quarantined communities, or NSFW posts behind an age gate, may not be accessible.',
      },
      {
        q: 'Does it work with GIFs and crossposts?',
        a: 'Yes — Reddit-hosted GIFs come through as MP4, and crossposts resolve to the original hosted video.',
      },
      {
        q: 'Do I need to log in to Reddit?',
        a: 'No. Only publicly visible posts are accessed — no login, no app, no extension.',
      },
      {
        q: 'Can I save every post from a subreddit or user?',
        a: 'Yes — supporters paste the subreddit or profile link and it expands into individual post links (media posts only), then resolves them as a queue. Text-only posts are filtered out rather than failing one by one.',
      },
    ],
    featureList: [
      'Download Reddit videos with the audio merged in',
      'Save v.redd.it clips in HD',
      'Works with permalinks, /s/ share links and redd.it',
      'Reddit-hosted GIFs saved as MP4',
      'No login, no app, no extension',
    ],
  },
  {
    slug: 'threads-video-downloader',
    name: 'Threads',
    brandLabel: 'Threads video & photo downloader',
    metaTitle: 'Threads Video & Photo Downloader — Save Posts, No Login',
    metaDescription:
      'Download videos and photos from Threads (threads.net) in full quality. Paste a threads.net/@user/post link and save the media instantly — free, no login.',
    h1: 'Threads Video & Photo Downloader — Free, No Login',
    tagline:
      'Save videos and photos from Threads posts in their original quality.',
    intro:
      'Paste any threads.net (or threads.com) post URL — threads.net/@username/post/… — and the tool resolves the attached media so you can preview and download the video or photo directly. No Threads or Instagram login, no extension, nothing installed. Private profiles can’t be fetched.',
    accent: {
      chip: 'bg-black text-white',
      grad: 'from-zinc-400 via-zinc-200 to-white',
      ring: 'ring-white/30',
      glow: 'shadow-white/20',
    },
    urlExamples: [
      'threads.net/@user/post/…',
      'threads.com/@user/post/…',
      'threads.net/t/…',
      'www.threads.net/@user/post/…',
    ],
    cards: [
      {
        title: '🎬 Videos in HD',
        body: 'Threads video posts are saved at their source resolution as a clean MP4 — no re-encode, no quality loss.',
      },
      {
        title: '🖼️ Photos at full size',
        body: 'Single photos and image posts download at full resolution, not the compressed inline preview.',
      },
      {
        title: '🧵 threads.net & threads.com',
        body: 'Both the threads.net and newer threads.com domains work, along with short /t/ links — paste whichever you copied.',
      },
    ],
    faqs: [
      {
        q: 'Can I download videos from Threads?',
        a: 'Yes — paste a public Threads post URL and the tool resolves the video so you can preview and download the MP4.',
      },
      {
        q: 'Does it work with photo posts?',
        a: 'Yes. Single photos and image posts are saved at full resolution.',
      },
      {
        q: 'Do I need a Threads or Instagram login?',
        a: 'No. Only publicly visible posts are accessed. Posts from private profiles can’t be downloaded.',
      },
      {
        q: 'What Threads URL formats are supported?',
        a: 'threads.net/@user/post/…, threads.com/@user/post/…, and short threads.net/t/… links all work.',
      },
      {
        q: 'Why does my Threads link fail to process?',
        a: 'Make sure the post is public and the URL points at a single post. Private profiles, deleted posts, and text-only posts (no media) can’t be fetched.',
      },
    ],
    featureList: [
      'Download Threads videos in HD',
      'Save Threads photos at full resolution',
      'Works with threads.net and threads.com URLs',
      'No Threads or Instagram login required',
      'Preview the media before downloading',
    ],
  },
  {
    slug: 'snapchat-downloader',
    name: 'Snapchat',
    brandLabel: 'Snapchat Spotlight downloader',
    metaTitle: 'Snapchat Spotlight Downloader — Save Videos, No Login',
    metaDescription:
      'Download public Snapchat Spotlight videos in HD. Paste a snapchat.com/spotlight or story.snapchat.com link and save the MP4 instantly — free, no login, no app.',
    h1: 'Snapchat Spotlight Downloader — HD, No Login',
    tagline:
      'Save public Snapchat Spotlight clips and public stories straight to your device.',
    intro:
      'Paste a public Snapchat link — snapchat.com/spotlight/… or story.snapchat.com/… — and the tool resolves the clip so you can preview and download the MP4. No Snapchat login, no app, no extension. Private snaps and disappearing messages are not accessible — only content Snapchat publishes publicly.',
    accent: {
      chip: 'bg-[#FFFC00] text-black',
      grad: 'from-yellow-300 via-yellow-400 to-amber-400',
      ring: 'ring-yellow-400/40',
      glow: 'shadow-yellow-400/30',
    },
    urlExamples: [
      'snapchat.com/spotlight/…',
      'story.snapchat.com/…',
      'snapchat.com/t/…',
      'snapchat.com/add/…',
    ],
    cards: [
      {
        title: '🎬 Spotlight in HD',
        body: 'Public Snapchat Spotlight clips are saved at their source resolution as a clean, vertical MP4 — ready to re-share or archive.',
      },
      {
        title: '📖 Public stories',
        body: 'Public profile stories on story.snapchat.com resolve the same way — preview the clip, then download it.',
      },
      {
        title: '🔒 Public content only',
        body: 'Only content Snapchat publishes publicly can be fetched. Private snaps, chats, and disappearing messages are never accessible.',
      },
    ],
    faqs: [
      {
        q: 'Can I download Snapchat Spotlight videos?',
        a: 'Yes — paste a snapchat.com/spotlight/… link and the tool resolves the MP4 so you can preview it and save it.',
      },
      {
        q: 'Can I download someone’s private snaps or chats?',
        a: 'No. Only publicly published content (Spotlight and public profile stories) can be accessed. Private snaps and messages are never in scope.',
      },
      {
        q: 'Will the other person know I saved their Spotlight clip?',
        a: 'There’s no “downloaded by” notification for public Spotlight content. Please respect the creator and Snapchat’s terms when re-using it.',
      },
      {
        q: 'What Snapchat URL formats are supported?',
        a: 'snapchat.com/spotlight/…, story.snapchat.com/…, and short snapchat.com/t/… links work best.',
      },
      {
        q: 'Why does my Snapchat link fail to process?',
        a: 'Make sure it’s a public Spotlight or public story link. Private snaps, expired stories, and profile links with no public media can’t be fetched.',
      },
    ],
    featureList: [
      'Download public Snapchat Spotlight clips in HD',
      'Save public profile stories as MP4',
      'Native vertical format preserved',
      'No Snapchat login, no app, no extension',
      'Public content only — private snaps never accessed',
    ],
  },
  {
    slug: 'twitch-clip-downloader',
    name: 'Twitch',
    brandLabel: 'Twitch clip & VOD downloader',
    metaTitle: 'Twitch Clip Downloader — Save Clips & VODs in HD, No Login',
    metaDescription:
      'Download Twitch clips and VODs in HD as MP4. Paste a clips.twitch.tv, twitch.tv/…/clip/, or twitch.tv/videos/ link and save instantly — free, no login.',
    h1: 'Twitch Clip & VOD Downloader — HD MP4',
    tagline:
      'Save Twitch clips and past broadcasts (VODs) as MP4 in their original quality.',
    intro:
      'Paste a Twitch clip or VOD link — clips.twitch.tv/…, twitch.tv/<channel>/clip/…, or twitch.tv/videos/… — and the tool resolves the stream so you can preview and download the MP4. No Twitch login, no extension, nothing installed. Sub-only VODs and content behind a paywall can’t be fetched.',
    accent: {
      chip: 'bg-[#9146FF] text-white',
      grad: 'from-violet-500 via-purple-500 to-fuchsia-500',
      ring: 'ring-violet-500/30',
      glow: 'shadow-violet-500/30',
    },
    urlExamples: [
      'clips.twitch.tv/…',
      'twitch.tv/channel/clip/…',
      'twitch.tv/videos/…',
      'm.twitch.tv/clip/…',
    ],
    cards: [
      {
        title: '🎬 Clips in HD',
        body: 'Twitch clips are saved at their source resolution as a clean MP4 — perfect for compilations, reactions, or re-sharing off-platform.',
      },
      {
        title: '📼 VOD downloads',
        body: 'Past broadcasts (twitch.tv/videos/…) resolve the same way, so you can archive a stream before it expires from the channel.',
      },
      {
        title: '🔗 Clip & channel links',
        body: 'Both clips.twitch.tv short links and full twitch.tv/<channel>/clip/… URLs are supported — paste whichever you copied.',
      },
    ],
    faqs: [
      {
        q: 'Can I download Twitch clips?',
        a: 'Yes — paste a clips.twitch.tv or twitch.tv/<channel>/clip/… link and the tool resolves the MP4 so you can preview and save it.',
      },
      {
        q: 'Can I download a full Twitch VOD?',
        a: 'Yes, public past broadcasts (twitch.tv/videos/…) can be downloaded. Very long VODs take longer to process.',
      },
      {
        q: 'Do sub-only VODs work?',
        a: 'No. Subscriber-only VODs and any content behind a paywall or login can’t be fetched — only publicly viewable clips and VODs.',
      },
      {
        q: 'What quality are downloaded clips?',
        a: 'You get the highest resolution the source offers — typically up to 1080p60 for clips captured from HD streams.',
      },
      {
        q: 'Why does my Twitch link fail to process?',
        a: 'Make sure it’s a public clip or VOD link. Sub-only, deleted, or region-restricted content can’t be downloaded.',
      },
    ],
    featureList: [
      'Download Twitch clips in HD MP4',
      'Save public VODs (past broadcasts)',
      'Works with clips.twitch.tv and channel clip links',
      'No Twitch login, no extension, no install',
      'Preview the clip before downloading',
    ],
  },
  {
    slug: 'vimeo-downloader',
    name: 'Vimeo',
    brandLabel: 'Vimeo video downloader',
    metaTitle: 'Vimeo Video Downloader — Save HD Videos as MP4, No Login',
    metaDescription:
      'Download public Vimeo videos in HD as MP4. Paste a vimeo.com link and save the progressive video file instantly — free, no login, no app install.',
    h1: 'Vimeo Video Downloader — HD MP4, No Login',
    tagline:
      'Save public Vimeo videos as MP4 in the highest quality the source offers.',
    intro:
      'Paste any public vimeo.com/… link and the tool resolves the video through Vimeo’s own player configuration, returning a direct progressive MP4 you can preview and download. No Vimeo login, no extension, nothing installed. Password-protected, private, and domain-restricted videos can’t be fetched.',
    accent: {
      chip: 'bg-[#1AB7EA] text-white',
      grad: 'from-sky-400 via-cyan-500 to-blue-500',
      ring: 'ring-sky-500/30',
      glow: 'shadow-sky-500/30',
    },
    urlExamples: [
      'vimeo.com/123456789',
      'player.vimeo.com/video/…',
      'vimeo.com/channels/…/…',
      'www.vimeo.com/…',
    ],
    cards: [
      {
        title: '🎬 HD MP4 downloads',
        body: 'Public Vimeo videos are saved at the highest progressive rendition available — commonly up to 1080p — as a clean MP4.',
      },
      {
        title: '⚡ Direct from Vimeo',
        body: 'The video is resolved through Vimeo’s own player config, so you get a real progressive file — not a screen-recording or re-encode.',
      },
      {
        title: '🎚️ Quality aware',
        body: 'Choose HD for the best rendition or Data saver for a lighter file — the tool picks the matching progressive source.',
      },
      {
        title: '📚 Channels & users in one run',
        body: 'A Vimeo channel or user link expands into their public videos through the feed — queue them all instead of pasting one by one.',
      },
    ],
    faqs: [
      {
        q: 'Can I download any Vimeo video?',
        a: 'Public videos that expose a progressive (non-DASH) MP4 can be downloaded. Password-protected, private, and domain-locked videos can’t be fetched.',
      },
      {
        q: 'What quality do I get?',
        a: 'The highest progressive rendition the video offers — often up to 1080p. Use the Data saver option for a smaller file.',
      },
      {
        q: 'Do I need a Vimeo account?',
        a: 'No. Only publicly viewable videos are accessed — no login, no extension, no install.',
      },
      {
        q: 'Why does a Vimeo video only stream and not download?',
        a: 'A few Vimeo videos are delivered only as adaptive DASH with no progressive MP4. Those can’t be saved as a single file.',
      },
      {
        q: 'Why does my Vimeo link fail to process?',
        a: 'Make sure the video is public and the URL is a vimeo.com/<id> link. Private, password-protected, or unlisted-with-restrictions videos can’t be fetched.',
      },
      {
        q: 'Can I grab everything from a Vimeo channel?',
        a: 'Yes — supporters paste the channel or user link, the public video feed expands into rows, and the batch queue resolves each one at the quality you prefer.',
      },
    ],
    featureList: [
      'Download public Vimeo videos as HD MP4',
      'Direct progressive file via Vimeo’s player config',
      'HD or Data-saver quality selection',
      'No Vimeo login, no extension, no install',
      'Preview the video before downloading',
    ],
  },
]

export const platformsBySlug: Record<PlatformSlug, Platform> = platforms.reduce(
  (acc, p) => {
    acc[p.slug] = p
    return acc
  },
  {} as Record<PlatformSlug, Platform>,
)

export function platformUrl(slug: PlatformSlug): string {
  return `${siteConfig.url}/${slug}`
}
