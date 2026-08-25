'use client'

import {
  getLocaleSnapshot,
  setLocale,
  useT,
} from '@/lib/i18nStore'
import { LOCALES, LOCALE_LABELS, type Locale } from '@/lib/i18n'

/**
 * The one language control, in the footer of every page: visible enough to
 * find, quiet enough to ignore. Changing it re-renders every translated
 * surface through the store and mirrors dir/lang onto <html> for Arabic.
 */
export function LanguagePicker() {
  const t = useT()
  // useT subscribes this component to the store, so the imperative snapshot
  // read here is re-taken on every locale change — no second subscription.
  const value = getLocaleSnapshot()
  return (
    <label className='inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap'>
      <span className='sr-only'>{t('langLabel')}</span>
      <span aria-hidden className='text-white/40'>
        🌐
      </span>
      <select
        value={value}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className='cursor-pointer rounded-md border border-white/10 bg-transparent px-1.5 py-0.5 text-xs text-white/60 outline-none transition-colors hover:text-white [&>option]:bg-[#0b1220] [&>option]:text-white'
      >
        {LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {LOCALE_LABELS[locale]}
          </option>
        ))}
      </select>
    </label>
  )
}
