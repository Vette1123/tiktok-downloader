// Our companion apps. Shared metadata + a store-open helper reused across
// footers, nav, and CTAs.
//
// This list was Play-only by construction: one `playStoreUrl` per app, derived
// from the Android package, and an `openOnPlayStore` that sent everyone there.
// Rafiq and Masareef shipped on the App Store on 2026-09-04, so from that day
// every iPhone visitor tapping either name landed on a listing they cannot
// install from. An app on both stores now carries `appStoreUrl` and
// `installUrl`, and it is `installUrl` — the chooser the apps themselves link
// to — that a desktop reader gets, because from a laptop there is no way to
// know which phone they will install on.
//
// Nafis is Android-only (no iOS submit config in its eas.json, no App Store id
// anywhere in its repo, and nafis-privacy/go 404s), so it has neither and
// `storesLabel` says so rather than inheriting a claim from its neighbours.
//
// The same module exists in the Reely repo. Two deployables with no shared
// package between them, so this is a port, not an import — fix both or neither.

export type PlayApp = {
  name: string
  /** One line under the name in the footer menu. Same copy the apps ship with. */
  tagline: string
  androidPackage: string
  playStoreUrl: string
  /** Set only for apps that shipped on the App Store. */
  appStoreUrl?: string
  /** The app's own "pick your store" page. Present iff `appStoreUrl` is. */
  installUrl?: string
}

const playApp = (
  name: string,
  tagline: string,
  androidPackage: string,
  /** App Store numeric id and privacy-repo slug, for apps on both stores. */
  apple?: { id: string; slug: string },
): PlayApp => {
  const app: PlayApp = {
    name,
    tagline,
    androidPackage,
    playStoreUrl: `https://play.google.com/store/apps/details?id=${androidPackage}`,
  }
  if (!apple) return app
  return {
    ...app,
    appStoreUrl: `https://apps.apple.com/app/id${apple.id}`,
    installUrl: `https://vette1123.github.io/${apple.slug}-privacy/go`,
  }
}

export const PLAY_APPS: readonly PlayApp[] = [
  playApp(
    'Rafiq',
    'A private Islamic companion: prayer, Qur’an, adhkar, qibla',
    'com.mohamedgado.rafiq',
    { id: '6806678979', slug: 'rafiq' },
  ),
  playApp(
    'Masareef',
    'An offline-first, multi-currency spending tracker',
    'com.mohamedgado.masareef',
    { id: '6806735875', slug: 'masareef' },
  ),
  playApp(
    'Nafis',
    'A local-price tracker for gold, currencies and more',
    'com.mohamedgado.nafis',
  ),
]

/** Where an app can actually be installed from, for a row's hint or title. */
export function storesLabel(app: PlayApp): string {
  return app.appStoreUrl ? 'App Store · Google Play' : 'Google Play'
}

/**
 * The href to render on a real anchor: the chooser when there is one, so a
 * right-click, a copied link or a no-JS load all still reach both stores.
 */
export function storeHref(app: PlayApp): string {
  return app.installUrl ?? app.playStoreUrl
}

/**
 * Open an app's listing on the store the reader can actually install from.
 *
 * - Android: navigate to `market://` to launch the Play Store app, mirroring
 *   the apps' own deep-link behaviour. If nothing handles it (app missing) the
 *   page stays visible, so a short timeout falls back to the web listing. A
 *   successful hand-off hides the page, which cancels the fallback.
 * - iPhone / iPad: the App Store listing, or the Play listing for an
 *   Android-only app — there is nothing better to offer, and a listing that
 *   says "Android" beats a silent no-op.
 * - Desktop: the chooser page, which puts the reader's own store one tap away
 *   on whichever phone they open it on.
 */
export function openStoreListing(app: PlayApp): void {
  if (typeof window === 'undefined') return

  const ua = window.navigator.userAgent
  if (/android/i.test(ua)) {
    const fallback = window.setTimeout(() => {
      window.location.href = app.playStoreUrl
    }, 1200)

    const cancel = () => {
      window.clearTimeout(fallback)
      document.removeEventListener('visibilitychange', cancel)
    }
    document.addEventListener('visibilitychange', cancel)

    window.location.href = `market://details?id=${app.androidPackage}`
    return
  }

  const isApplePhone = /iPad|iPhone|iPod/.test(ua)
  const target = isApplePhone
    ? (app.appStoreUrl ?? app.playStoreUrl)
    : storeHref(app)
  window.open(target, '_blank', 'noopener,noreferrer')
}
