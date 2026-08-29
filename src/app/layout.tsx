import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { siteConfig } from '@/config/site'
import { versionedIcon } from '@/lib/appIcon'
import { globalStructuredData } from '@/lib/structuredData'
import { SPLASH_DEVICES, splashMedia, splashPath } from '@/lib/splashDevices'
import { AccountControl } from '@/components/AccountControl'
import { HomeControl } from '@/components/HomeControl'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap',
  preload: true,
})

// The <title> is its own string rather than name + tagline: together those
// ran to 106 characters, so a result showed neither of them whole. The
// tagline is unchanged in the description and the OG tags, where nothing
// is clipped at 60.
const title = `${siteConfig.name} — Save Any Public Video in HD`

// Runs synchronously in <head>, before paint. Flags low-power devices and writes
// a .low-power class to <html> so CSS can swap to the cheap variant with no
// flash. Avoids false positives on flagships — only genuine low-end hardware
// (≤4 CPU cores or ≤4GB RAM), Save-Data, or a slow effective network type opts
// down. Everything else keeps the full effect set.
const lowPowerScript = `(function(){try{
var n=navigator,h=hardwareData(n);
if(h.low){document.documentElement.classList.add('low-power');}
}catch(e){}})();function hardwareData(n){var low=false;
try{var cores=n.hardwareConcurrency||8,mem=n.deviceMemory||8;
var slowNet=n.connection&&/2g|slow-2g/.test(n.connection.effectiveType);
var saveData=n.connection&&n.connection.saveData;
low=(cores<=4)||(mem<=4)||!!slowNet||!!saveData;
}catch(e){}return{low:low};}`

// Attributes for the Buy Me a Coffee widget, and the loader that gives the
// vendor bundle the DOMContentLoaded it waits for. See the tag in <head> below
// for why it is written this way rather than as the provider's own snippet.
// 'right' is lower-case on purpose: the bundle compares the value against the
// literal 'left' and treats everything else as the right edge, so the
// capitalised value its generator writes works only by accident. The right
// corner is free at every breakpoint — both corner slots sit at the top.
const bmcWidgetScript = `(function(){try{
var n=navigator;if(n.connection&&n.connection.saveData){return;}
var a={name:'BMC-Widget',cfasync:'false',id:'vetteotp',
description:'Support me on Buy me a coffee!',
message:'',
color:'#5F7FFF',position:'right',x_margin:'18',y_margin:'18'};
function load(){var s=document.createElement('script');s.async=true;
s.src='https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js';
for(var k in a){s.setAttribute('data-'+k,a[k]);}
s.onload=function(){window.dispatchEvent(new Event('DOMContentLoaded'));};
document.head.appendChild(s);}
function idle(){(window.requestIdleCallback||function(f){setTimeout(f,1200);})(load);}
if(document.readyState==='complete'){idle();}
else{window.addEventListener('load',idle);}
}catch(e){}})();`

export const viewport: Viewport = {
  themeColor: '#08080a',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: title,
    // No brand suffix. Every page title below was written to fit the ~60
    // characters a result actually shows, and a `%s — Social Media
    // Downloader` template put all thirteen of them between 78 and 88
    // characters — so the part that had been measured to fit was the part
    // that got cut. The site name is not lost by dropping it: Google takes
    // it from the WebSite/Organization JSON-LD in structuredData.ts and
    // prints it above the title in its own right.
    template: `%s`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  authors: [{ name: siteConfig.author.name, url: siteConfig.author.url }],
  creator: siteConfig.author.name,
  publisher: siteConfig.author.name,
  referrer: 'origin-when-cross-origin',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    canonical: '/',
    languages: {
      en: '/',
      'x-default': '/',
    },
  },
  openGraph: {
    title,
    description: siteConfig.description,
    url: siteConfig.url,
    siteName: siteConfig.name,
    locale: siteConfig.locale,
    type: 'website',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: siteConfig.ogImageAlt,
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description: siteConfig.description,
    creator: siteConfig.twitterTag,
    site: siteConfig.twitterTag,
    images: [
      {
        url: '/twitter-image',
        alt: siteConfig.ogImageAlt,
        width: 1200,
        height: 630,
      },
    ],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  category: 'technology',
  // Single source of truth for <head>. These used to be declared here AND
  // hand-written as <link> tags below, so every page shipped the manifest and
  // both favicons twice and apple-touch-icon three times. Duplicate icon links
  // are not merely noise: which one a client picks is unspecified, so an iOS
  // home-screen icon could resolve to the SVG, which iOS cannot render.
  // `?v=` (see ICON_VERSION) is what actually delivers new art to someone who
  // has been here before. A favicon is one of the stickiest things a browser
  // caches, and it is keyed by URL, so changing the bytes behind an unchanged
  // path can leave the old mark in the tab indefinitely.
  icons: {
    icon: [
      { url: versionedIcon('/favicon.svg'), type: 'image/svg+xml' },
      // Not only a legacy fallback: Google's search-result crawler fetches
      // /favicon.ico directly and ignores the SVG above, so this is the mark
      // most people see first. Generated from the same favicon.svg by
      // `pnpm icons` (scripts/make-favicon.mjs) and committed — it used to be
      // hand-made, which is how it ended up two redesigns behind.
      // Versioned for browsers, which cache a favicon by URL and would
      // otherwise keep showing the old bytes; Google fetches the bare path and
      // gets the new file either way.
      { url: versionedIcon('/favicon.ico'), sizes: '16x16 32x32 48x48' },
    ],
    // PNG only. `apple-touch-icon` has never supported SVG on iOS — listing
    // /apple-touch-icon.svg gave iOS a candidate it silently drops, leaving a
    // screenshot-of-the-page icon on the home screen instead of the logo.
    apple: [
      {
        url: versionedIcon('/icons/apple'),
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  },
  manifest: '/manifest.json',
  /**
   * The iOS half of "installed app". Android reads all of this from
   * manifest.json; iOS reads none of it and needs these meta tags instead.
   *
   * `black-translucent` puts the page behind the status bar, which is what the
   * `viewportFit: 'cover'` above and the safe-area padding in globals.css are
   * already built for. `startupImage` is what replaces the blank white screen
   * between tapping the home-screen icon and the first paint.
   */
  appleWebApp: {
    capable: true,
    title: siteConfig.shortName,
    statusBarStyle: 'black-translucent',
    startupImage: SPLASH_DEVICES.map((device) => ({
      url: versionedIcon(splashPath(device)),
      media: splashMedia(device),
    })),
  },
  verification: {
    google: 'aha64Aa3HDSFKw-xDlfpIGcBkGRU4lRV9xU-qR2SPwc',
  },
  other: {
    'msapplication-TileColor': '#08080a',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang='en' dir='ltr'>
      <head>
        {/* Icons, manifest, tile colour and Google verification are all declared
            in `metadata` above — Next renders them into <head> itself. Nothing
            static belongs here; only the two inline scripts, which have no
            Metadata equivalent, and the Impact tag below. */}
        {/* Impact publisher verification. Deliberately NOT in `metadata.other`:
            that renders `content=`, and Impact reads the non-standard `value=`
            attribute this tag is specified with. Inert — no script, no request. */}
        {/* Spread, because React's JSX types reject `value` on <meta> — but the
            DOM keeps unknown attributes, so the tag ships exactly as Impact
            specified it. */}
        <meta
          name='impact-site-verification'
          {...{ value: '6048f587-d18b-4e66-a399-27aa77470438' }}
        />

        {/* Capability-based rendering: set before first paint so low-power devices
            get the cheap variant with no FOUC. No false positives — flagships and
            tablets keep the full effect set; only genuinely weak hardware (≤4
            cores / ≤4GB RAM), Save-Data, or a slow connection opt down. */}
        <script dangerouslySetInnerHTML={{ __html: lowPowerScript }} />
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(globalStructuredData),
          }}
        />

        {/* Buy Me a Coffee's floating tip jar, loaded off the critical path.

            The provider's own snippet — a plain <script defer src> with the
            settings as data attributes — does render here, and is what the
            sister project ships. This is that tag, built later and by hand,
            for one reason: a deferred script still downloads as part of the
            page load and still delays DOMContentLoaded, and 8KB of vendor
            script plus a webfont and an iframe have no business competing with
            the first paint for something nobody came here to use.

            `async` is not the way out of that. The vendor bundle does all of
            its work inside a `DOMContentLoaded` listener with no readyState
            guard, so any tag that starts executing after that event has fired
            downloads and then does nothing — the reason every next/script
            strategy fails on this widget too, measured in the sister project.

            So: inject after `load`, in idle time, and hand the bundle the event
            it is waiting for. By then the real DOMContentLoaded is long gone,
            which is what makes the synthetic one safe to dispatch — it fires
            exactly once, and only after every other listener for it has already
            run. Anything added later that listens for DOMContentLoaded on
            `window` will hear this second one, so listen on `document`.

            The same loader runs in the streaming project
            (movies-streaming-platform/lib/bmc-widget.ts), kept in step by hand:
            the two share no package, and only the settings object differs. Both
            files name the other, because the first version of this drifted the
            moment one side was improved.

            Skipped entirely under Save-Data, on the same reasoning as the
            low-power branch above: a reader who asked for less should not spend
            their bytes on our donation button.

            What it sells is coffees, not the levels in config/support.ts, so
            nothing bought through this panel grants anything — including its
            "make this monthly" toggle, which fires a recurring event carrying
            no level name we recognise, and lib/billing/bmc.ts matches on that
            name alone. The path that turns somebody into a supporter is /pro.
            If a payer ever reports tipping here and getting nothing switched
            on, this comment is the why — and it is why `message` is empty: the
            bubble is the only place the widget could have promised something,
            so it says nothing at all. */}
        <script dangerouslySetInnerHTML={{ __html: bmcWidgetScript }} />
      </head>
      <body
        className={`${geistSans.variable} antialiased`}
        style={{ backgroundColor: '#08080a' }}
      >
        <HomeControl />
        <AccountControl />
        {children}
        {process.env.NEXT_PUBLIC_CF_BEACON_TOKEN ? (
          <script
            defer
            src='https://static.cloudflareinsights.com/beacon.min.js'
            data-cf-beacon={`{"token": "${process.env.NEXT_PUBLIC_CF_BEACON_TOKEN}"}`}
          />
        ) : null}
      </body>
    </html>
  )
}
