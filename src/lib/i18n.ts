/**
 * Minimal, dependency-free i18n for the downloader's core flow.
 *
 * Deliberately not next-intl/react-i18next: the site is a static export whose
 * pages are English (that is where search traffic lands, and hreflang says so),
 * and what needs translating is the interactive app after hydration — a few
 * dozen strings. A dictionary plus an external-store locale (the same shape as
 * proSignals/history, which is what makes it hydration-safe: server and first
 * client render agree on 'en', and useSyncExternalStore re-renders with the
 * stored choice after mount) covers exactly that with zero dependencies.
 *
 * Arabic ships RTL: `setLocale` mirrors `document.documentElement`'s `dir`,
 * which Tailwind's logical properties pick up across the app shell.
 *
 * Coverage note, stated honestly rather than hidden: deep copy — platform
 * landing pages, FAQs, legal text, secondary hints — remains English. The
 * keys here are the paste → resolve → download loop a visitor physically
 * operates; everything else staying English is a known, accepted edge until
 * each surface is added deliberately.
 */

export const LOCALES = ['en', 'es', 'pt', 'id', 'ar'] as const
export type Locale = (typeof LOCALES)[number]

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  pt: 'Português',
  id: 'Bahasa Indonesia',
  ar: 'العربية',
}

export const RTL_LOCALES: readonly Locale[] = ['ar']

export function isLocale(value: unknown): value is Locale {
  return (LOCALES as readonly string[]).includes(value as string)
}

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale)
}

/** Stable ids — never the English text itself, so renaming copy cannot rot keys. */
export type TKey =
  | 'pastePlaceholder'
  | 'paste'
  | 'pasteAria'
  | 'downloadBtn'
  | 'processing'
  | 'downloadingBtn'
  | 'preparingDownload'
  | 'progressLine'
  | 'clickToDownload'
  | 'videoBtn'
  | 'videoSlideshowBtn'
  | 'extractAudio'
  | 'downloadAudioBtn'
  | 'msgProcessed'
  | 'msgVideoDone'
  | 'msgDownloadStarted'
  | 'msgSlideshowDone'
  | 'msgAudioDone'
  | 'msgImagesDone'
  | 'recent'
  | 'clear'
  | 'export'
  | 'importLabel'
  | 'showLess'
  | 'viewAll'
  | 'savedLink'
  | 'thumbnailBtn'
  | 'thumbnailSaving'
  | 'thumbnailUnavailable'
  | 'langLabel'
  | 'tryAgain'
  | 'sendToApp'
  | 'sendFailed'
  | 'filterRecent'
  | 'importBadFile'
  | 'importUnreadable'
  | 'importedLinks'
  | 'importNothingNew'
  | 'dropHint'

const en: Record<TKey, string> = {
  pastePlaceholder: 'Paste a video link.',
  paste: 'Paste',
  pasteAria: 'Paste link from clipboard',
  downloadBtn: 'Download',
  processing: 'Processing...',
  downloadingBtn: 'Downloading...',
  preparingDownload: 'Preparing your download…',
  progressLine: 'Downloading… {pct}%',
  clickToDownload: 'Click to download your content',
  videoBtn: 'Video',
  videoSlideshowBtn: 'Video (slideshow)',
  extractAudio: 'Extract Audio',
  downloadAudioBtn: 'Download Audio',
  msgProcessed: 'Content processed successfully!',
  msgVideoDone: 'Video downloaded successfully! 🎉',
  msgDownloadStarted: 'Download started. Check your downloads. 🎉',
  msgSlideshowDone: 'Slideshow video rendered and downloaded! 🎬',
  msgAudioDone: 'Audio downloaded successfully! 🎵',
  msgImagesDone: '{n} image(s) downloaded individually! 🖼️',
  recent: 'Recent',
  clear: 'Clear',
  export: 'Export',
  importLabel: 'Import',
  showLess: 'Show less',
  viewAll: 'View all ({n})',
  savedLink: 'Saved link',
  thumbnailBtn: 'Save thumbnail',
  thumbnailSaving: 'Saving…',
  thumbnailUnavailable: 'Thumbnail unavailable',
  langLabel: 'Language',
  tryAgain: 'Try again',
  sendToApp: 'Send to an app',
  sendFailed: 'Could not send it',
  filterRecent: 'Filter recent…',
  importBadFile: 'That file is not a history export.',
  importUnreadable: 'Could not read that file.',
  importedLinks: 'Imported {n} link(s).',
  importNothingNew: 'Nothing new to import.',
  dropHint: 'Drop the link to start',
}

const es: Partial<Record<TKey, string>> = {
  pastePlaceholder: 'Pega un enlace de video.',
  paste: 'Pegar',
  pasteAria: 'Pegar enlace del portapapeles',
  downloadBtn: 'Descargar',
  processing: 'Procesando...',
  downloadingBtn: 'Descargando...',
  preparingDownload: 'Preparando tu descarga…',
  progressLine: 'Descargando… {pct}%',
  clickToDownload: 'Haz clic para descargar tu contenido',
  videoBtn: 'Video',
  videoSlideshowBtn: 'Video (carrusel)',
  extractAudio: 'Extraer audio',
  downloadAudioBtn: 'Descargar audio',
  msgProcessed: '¡Contenido procesado con éxito!',
  msgVideoDone: '¡Video descargado correctamente! 🎉',
  msgDownloadStarted: 'Descarga iniciada. Revisa tus descargas. 🎉',
  msgSlideshowDone: '¡Video de carrusel generado y descargado! 🎬',
  msgAudioDone: '¡Audio descargado correctamente! 🎵',
  msgImagesDone: '¡{n} imagen(es) descargadas individualmente! 🖼️',
  recent: 'Recientes',
  clear: 'Borrar',
  export: 'Exportar',
  importLabel: 'Importar',
  showLess: 'Mostrar menos',
  viewAll: 'Ver todo ({n})',
  savedLink: 'Enlace guardado',
  thumbnailBtn: 'Guardar miniatura',
  thumbnailSaving: 'Guardando…',
  thumbnailUnavailable: 'Miniatura no disponible',
  langLabel: 'Idioma',
  tryAgain: 'Reintentar',
  sendToApp: 'Enviar a una app',
  sendFailed: 'No se pudo enviar',
  filterRecent: 'Filtrar recientes…',
  importBadFile: 'Ese archivo no es una exportación del historial.',
  importUnreadable: 'No se pudo leer ese archivo.',
  importedLinks: 'Se importaron {n} enlace(s).',
  importNothingNew: 'No hay nada nuevo que importar.',
  dropHint: 'Suelta el enlace para empezar',
}

const pt: Partial<Record<TKey, string>> = {
  pastePlaceholder: 'Cole um link de vídeo.',
  paste: 'Colar',
  pasteAria: 'Colar link da área de transferência',
  downloadBtn: 'Baixar',
  processing: 'Processando...',
  downloadingBtn: 'Baixando...',
  preparingDownload: 'Preparando o seu download…',
  progressLine: 'Baixando… {pct}%',
  clickToDownload: 'Clique para baixar seu conteúdo',
  videoBtn: 'Vídeo',
  videoSlideshowBtn: 'Vídeo (carrossel)',
  extractAudio: 'Extrair áudio',
  downloadAudioBtn: 'Baixar áudio',
  msgProcessed: 'Conteúdo processado com sucesso!',
  msgVideoDone: 'Vídeo baixado com sucesso! 🎉',
  msgDownloadStarted: 'Download iniciado. Confira seus downloads. 🎉',
  msgSlideshowDone: 'Vídeo do carrossel gerado e baixado! 🎬',
  msgAudioDone: 'Áudio baixado com sucesso! 🎵',
  msgImagesDone: '{n} imagem(ns) baixada(s) individualmente! 🖼️',
  recent: 'Recentes',
  clear: 'Limpar',
  export: 'Exportar',
  importLabel: 'Importar',
  showLess: 'Mostrar menos',
  viewAll: 'Ver tudo ({n})',
  savedLink: 'Link salvo',
  thumbnailBtn: 'Salvar miniatura',
  thumbnailSaving: 'Salvando…',
  thumbnailUnavailable: 'Miniatura indisponível',
  langLabel: 'Idioma',
  tryAgain: 'Tentar novamente',
  sendToApp: 'Enviar para um app',
  sendFailed: 'Não foi possível enviar',
  filterRecent: 'Filtrar recentes…',
  importBadFile: 'Esse arquivo não é uma exportação do histórico.',
  importUnreadable: 'Não foi possível ler esse arquivo.',
  importedLinks: '{n} link(s) importado(s).',
  importNothingNew: 'Nada de novo para importar.',
  dropHint: 'Solte o link para começar',
}

const id: Partial<Record<TKey, string>> = {
  pastePlaceholder: 'Tempel tautan video.',
  paste: 'Tempel',
  pasteAria: 'Tempel tautan dari papan klip',
  downloadBtn: 'Unduh',
  processing: 'Memproses...',
  downloadingBtn: 'Mengunduh...',
  preparingDownload: 'Menyiapkan unduhan Anda…',
  progressLine: 'Mengunduh… {pct}%',
  clickToDownload: 'Klik untuk mengunduh konten Anda',
  videoBtn: 'Video',
  videoSlideshowBtn: 'Video (slide)',
  extractAudio: 'Ekstrak audio',
  downloadAudioBtn: 'Unduh audio',
  msgProcessed: 'Konten berhasil diproses!',
  msgVideoDone: 'Video berhasil diunduh! 🎉',
  msgDownloadStarted: 'Unduhan dimulai. Cek unduhan Anda. 🎉',
  msgSlideshowDone: 'Video slide selesai dibuat dan diunduh! 🎬',
  msgAudioDone: 'Audio berhasil diunduh! 🎵',
  msgImagesDone: '{n} gambar berhasil diunduh satu per satu! 🖼️',
  recent: 'Terbaru',
  clear: 'Hapus',
  export: 'Ekspor',
  importLabel: 'Impor',
  showLess: 'Tampilkan lebih sedikit',
  viewAll: 'Lihat semua ({n})',
  savedLink: 'Tautan tersimpan',
  thumbnailBtn: 'Simpan thumbnail',
  thumbnailSaving: 'Menyimpan…',
  thumbnailUnavailable: 'Thumbnail tidak tersedia',
  langLabel: 'Bahasa',
  tryAgain: 'Coba lagi',
  sendToApp: 'Kirim ke aplikasi',
  sendFailed: 'Tidak bisa mengirim',
  filterRecent: 'Saring riwayat…',
  importBadFile: 'Berkas itu bukan hasil ekspor riwayat.',
  importUnreadable: 'Tidak dapat membaca berkas itu.',
  importedLinks: '{n} tautan diimpor.',
  importNothingNew: 'Tidak ada yang baru untuk diimpor.',
  dropHint: 'Lepaskan tautan untuk mulai',
}

const ar: Partial<Record<TKey, string>> = {
  pastePlaceholder: 'الصق رابط الفيديو.',
  paste: 'لصق',
  pasteAria: 'لصق الرابط من الحافظة',
  downloadBtn: 'تنزيل',
  processing: 'جارٍ المعالجة...',
  downloadingBtn: 'جارٍ التنزيل...',
  preparingDownload: 'جارٍ تجهيز تنزيلك…',
  progressLine: 'جارٍ التنزيل… {pct}%',
  clickToDownload: 'انقر لتنزيل المحتوى',
  videoBtn: 'فيديو',
  videoSlideshowBtn: 'فيديو (عرض شرائح)',
  extractAudio: 'استخراج الصوت',
  downloadAudioBtn: 'تنزيل الصوت',
  msgProcessed: 'تمت معالجة المحتوى بنجاح!',
  msgVideoDone: 'تم تنزيل الفيديو بنجاح! 🎉',
  msgDownloadStarted: 'بدأ التنزيل. تحقق من تنزيلاتك. 🎉',
  msgSlideshowDone: 'تم إنشاء فيديو العرض الشرائح وتنزيله! 🎬',
  msgAudioDone: 'تم تنزيل الصوت بنجاح! 🎵',
  msgImagesDone: 'تم تنزيل {n} صورة بشكل فردي! 🖼️',
  recent: 'الأحدث',
  clear: 'مسح',
  export: 'تصدير',
  importLabel: 'استيراد',
  showLess: 'إظهار أقل',
  viewAll: 'عرض الكل ({n})',
  savedLink: 'رابط محفوظ',
  thumbnailBtn: 'حفظ الصورة المصغرة',
  thumbnailSaving: 'جارٍ الحفظ…',
  thumbnailUnavailable: 'الصورة المصغرة غير متوفرة',
  langLabel: 'اللغة',
  tryAgain: 'حاول مجددًا',
  sendToApp: 'إرسال إلى تطبيق',
  sendFailed: 'تعذّر الإرسال',
  filterRecent: 'تصفية السجل…',
  importBadFile: 'هذا الملف ليس نسخة مُصدَّرة من السجل.',
  importUnreadable: 'تعذّرت قراءة هذا الملف.',
  importedLinks: 'تم استيراد {n} رابط.',
  importNothingNew: 'لا جديد للاستيراد.',
  dropHint: 'أفلت الرابط للبدء',
}

const DICTS: Record<Locale, Partial<Record<TKey, string>>> = {
  en,
  es,
  pt,
  id,
  ar,
}

/** Replace `{name}` placeholders; missing vars leave the token visible. */
function fill(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  )
}

/**
 * Look up `key` for `locale`, falling back per-key to English. A missing var
 * or an untranslated key degrades to readable copy, never to a crash.
 */
export function translate(
  locale: Locale,
  key: TKey,
  vars?: Record<string, string | number>,
): string {
  const dict = DICTS[locale] ?? {}
  const template = dict[key] ?? en[key]
  return fill(template, vars)
}
