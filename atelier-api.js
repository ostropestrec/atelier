// @ts-check
// ============================================================
// atelier-api.js — tenká fasáda nad vanilla window.* aliasy.
// Žádná byznys logika. Jen:
//   - lazy() proxy nad existujícími globály,
//   - read-only čtení AppState,
//   - re-export t() z translations.js,
//   - centralizované event názvy.
// ============================================================

import { t as translate } from './translations.js'
import { EVENTS, on, emit } from './atelier-events.js'

/** @typedef {import('./atelier-api.d.ts').AtelierAPI} AtelierAPI */
/** @typedef {import('./atelier-api.d.ts').Locale} Locale */
/** @typedef {import('./atelier-api.d.ts').Course} Course */
/** @typedef {import('./atelier-api.d.ts').Lesson} Lesson */

const w = /** @type {any} */ (typeof window !== 'undefined' ? window : {})

function lazy(name) {
  return (...args) => {
    const fn = w[name]
    if (typeof fn !== 'function') {
      console.warn(`[AtelierAPI] action not registered yet: ${name}`)
      return undefined
    }
    return fn.apply(null, args)
  }
}

function readLang() {
  return w.__uiLang === 'en' ? 'en' : 'cs'
}

const actions = Object.freeze({
  openBookingPopup: lazy('openBookingPopup')
})

const state = Object.freeze({
  getCourses:         () => /** @type {readonly Course[]} */ (w.AppState?.courses ?? []),
  getUpcomingLessons: () => /** @type {readonly Lesson[]} */ (w.AppState?.upcomingLessons ?? []),
  getLang:            () => /** @type {Locale} */ (readLang())
})

const events = Object.freeze({
  ...EVENTS,
  on,
  emit
})

const i18n = Object.freeze({
  t:       (path, params) => translate(readLang(), path, params),
  getLang: readLang
})

/** @type {AtelierAPI} */
const AtelierAPI = Object.freeze({
  version: '1.0.0',
  actions,
  state,
  events,
  i18n
})

if (typeof window !== 'undefined') {
  if (w.AtelierAPI) {
    console.warn('[AtelierAPI] already defined — refusing to overwrite')
  } else {
    w.AtelierAPI = AtelierAPI
  }
}

export default AtelierAPI
