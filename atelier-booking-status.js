// ============================================================
// atelier-booking-status.js — Stav potvrzené účasti
// ============================================================
// `booked` je historický DB název. V UI ho chápeme jako "potvrzená účast".

export const PARTICIPATION_STATUS = Object.freeze({
  PENDING_PAYMENT: 'pending_payment',
  CONFIRMED: 'booked',
  CANCELLED: 'cancelled',
  PAYMENT_EXPIRED: 'payment_expired',

  // Legacy hodnoty ze staršího schématu. Aplikace je dál aktivně nepoužívá,
  // ale umí je bezpečně zobrazit, pokud už v datech existují.
  ATTENDED: 'attended',
  MISSED: 'missed',
})

export const BLOCKING_PARTICIPATION_STATUSES = Object.freeze([
  PARTICIPATION_STATUS.PENDING_PAYMENT,
  PARTICIPATION_STATUS.CONFIRMED,
])

export const VISIBLE_USER_PARTICIPATION_STATUSES = Object.freeze([
  PARTICIPATION_STATUS.PENDING_PAYMENT,
  PARTICIPATION_STATUS.CONFIRMED,
])

export function isBlockingParticipationStatus(status) {
  return BLOCKING_PARTICIPATION_STATUSES.includes(String(status))
}

