'use client'

import { AppsIcon } from '@/components/icons'
import { LinkCard } from '@/components/LinkCard'
import {
  openStoreListing,
  PLAY_APPS,
  PlayApp,
  storeHref,
  storesLabel,
} from '@/lib/apps'

// Attention-grabbing hero card promoting one of our apps. Same shell as the
// dev-link cards (LinkCard owns the geometry), and it opens the store the
// reader can actually install from.
//
// The sheen was Google-Play green. Two of the three apps are on the App Store
// too, so a green Play-coloured card is the same false claim the Play icon was;
// it is now the site's own cyan/sky, which is what every other accent here uses.
export function PlayAppPromoCard({ app }: { app: PlayApp }) {
  return (
    <LinkCard
      href={storeHref(app)}
      label={app.name}
      Icon={AppsIcon}
      iconHoverClass='group-hover:text-white'
      title={`${app.name} — an app made by us, on ${storesLabel(app)}`}
      onClick={(e: React.MouseEvent) => {
        e.preventDefault()
        openStoreListing(app)
      }}
      className='overflow-hidden'
    >
      <span
        className='absolute inset-0 bg-gradient-to-r from-cyan-500/80 to-sky-400/80 opacity-0 transition-opacity duration-300 group-hover:opacity-100'
        aria-hidden
      />
      <span
        className='pointer-events-none absolute inset-0 rounded-xl ring-1 ring-white/10 transition-all duration-300 group-hover:ring-white/30'
        aria-hidden
      />
    </LinkCard>
  )
}

// One card per app, in the hero's dev-link row.
export function PlayAppPromoCards() {
  return (
    <>
      {PLAY_APPS.map((app) => (
        <PlayAppPromoCard key={app.androidPackage} app={app} />
      ))}
    </>
  )
}
