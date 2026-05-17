import { derived, type Readable } from 'svelte/store'
import type { Locale } from '../../atelier-api'
import { createBridgeStore } from './_factory'

export const lang: Readable<Locale> = createBridgeStore<Locale>(
  window.AtelierAPI.events.LANG_CHANGED,
  () => window.AtelierAPI.i18n.getLang(),
  typeof window !== 'undefined' ? window.AtelierAPI.i18n.getLang() : 'cs'
)

export const tt: Readable<
  (path: string, params?: Record<string, string | number>) => string
> = derived(lang, () => (
  path: string,
  params?: Record<string, string | number>
) => window.AtelierAPI.i18n.t(path, params))
