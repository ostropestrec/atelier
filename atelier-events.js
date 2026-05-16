// ============================================================
// atelier-events.js — shared event names + emit/on helpers
// Importují atelier-data.js, atelier_auth.js (později), atelier-api.js
// a Svelte bridge vrstva. Bez DOM závislostí kromě window.CustomEvent.
// ============================================================

export const EVENTS = Object.freeze({
  LANG_CHANGED:     'atelier:lang-changed',
  COURSES_UPDATED:  'atelier:courses-updated',
  LESSONS_UPDATED:  'atelier:lessons-updated',
  BOOKINGS_UPDATED: 'atelier:bookings-updated',
  AUTH_CHANGED:     'atelier:auth-changed',
  UI_UPDATED:       'atelier:ui-updated'
})

export function emit(name, detail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

export function on(name, handler) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(name, handler)
  return () => window.removeEventListener(name, handler)
}
