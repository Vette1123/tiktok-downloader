import { describe, expect, it } from 'vitest'
import { PLAY_APPS, storeHref, storesLabel } from './apps'

describe('the companion app list', () => {
  /**
   * The invariant the whole shape rests on. `installUrl` is the chooser page
   * that offers both stores, so an app that has an App Store listing and no
   * chooser would hand a desktop reader a Play-only link, and an app with a
   * chooser but no `appStoreUrl` would send an iPhone to Play — the exact
   * dead end this module was rewritten to remove.
   */
  it('carries the App Store link and the chooser together or not at all', () => {
    for (const app of PLAY_APPS) {
      expect(!!app.appStoreUrl, `${app.name}`).toBe(!!app.installUrl)
    }
  })

  it('builds every URL from the ids rather than by hand', () => {
    for (const app of PLAY_APPS) {
      expect(app.playStoreUrl).toBe(
        `https://play.google.com/store/apps/details?id=${app.androidPackage}`,
      )
      if (app.appStoreUrl) {
        expect(app.appStoreUrl).toMatch(/^https:\/\/apps\.apple\.com\/app\/id\d+$/)
        expect(app.installUrl).toMatch(
          /^https:\/\/vette1123\.github\.io\/[a-z-]+-privacy\/go$/,
        )
      }
    }
  })

  /**
   * A label that outlives the truth is worse than no label: it is the line an
   * iPhone reader believes before tapping.
   */
  it('says only what an app can actually be installed from', () => {
    for (const app of PLAY_APPS) {
      const label = storesLabel(app)
      expect(label.includes('App Store')).toBe(!!app.appStoreUrl)
      expect(label).toContain('Google Play')
    }
  })

  /**
   * The anchor's href has to survive a right-click, a copied link and a no-JS
   * load, so it is the chooser wherever there is one.
   */
  it('prefers the chooser for the rendered href', () => {
    for (const app of PLAY_APPS) {
      expect(storeHref(app)).toBe(app.installUrl ?? app.playStoreUrl)
    }
  })

  /**
   * Nafis shipped on the App Store on 2026-09-06, a day after the two before
   * it. Pinned by name because the failure it fixes is silent: nothing breaks
   * when this entry goes stale, an iPhone visitor just lands somewhere they
   * cannot install from.
   */
  it('has all three apps on both stores', () => {
    expect(PLAY_APPS.map((app) => app.name)).toEqual([
      'Rafiq',
      'Masareef',
      'Nafis',
    ])
    for (const app of PLAY_APPS) expect(app.appStoreUrl).toBeTruthy()
  })
})
