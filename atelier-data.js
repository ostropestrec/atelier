// ============================================================
// atelier-data.js — Supabase data layer (finální)
// Načítání kurzů, lekcí, realtime, render kalendáře + kurzů.
// Použití: <script type="module" src="atelier-data.js"></script>
// ============================================================

import { sb, logSupabaseClientDebug } from './atelier-supabase.js'
import { sanitizeCourseRichText } from './atelier-sanitize.js'
import {
  isEnrolled,
  registerRerenderers,
  currentUser,
  userPasses,
  loadUserPasses,
  myBookings,
  canUserCancelBooking,
  getUserBookingCancellationMessage,
  renderNavigation,
  saveBookingReturn,
  resumeBookingAfterAuth,
} from './atelier_auth.js'
import { t, UI_LANG_STORAGE_KEY } from './translations.js'
import { EVENTS, emit } from './atelier-events.js'
import {
  BLOCKING_PARTICIPATION_STATUSES,
  PARTICIPATION_STATUS,
} from './atelier-booking-status.js'

// Dočasný pilotní režim: placené akce se připíšou bez Stripe a bez reálné tržby.
const PILOT_FREE_CHECKOUT = true

// ── Jazyk ─────────────────────────────────────────────────────
export let lang = 'cs'
try {
  const _ls = localStorage.getItem(UI_LANG_STORAGE_KEY)
  if (_ls === 'en' || _ls === 'cs') lang = _ls
} catch (_) { /* */ }

function _syncDocumentLang() {
  try {
    document.documentElement.lang = lang === 'en' ? 'en-GB' : 'cs'
  } catch (_) { /* SSR */ }
}

if (typeof window !== 'undefined') {
  window.__uiLang = lang
}
_syncDocumentLang()

/** Aktuální locale pro t() ('cs' | 'en'). */
function _locale() {
  return lang === 'en' ? 'en' : 'cs'
}

function _tp(path, params) {
  return t(_locale(), path, params)
}

function _currentRole() {
  return window.__userRole ?? window.AppState?.role ?? currentUser?.role ?? 'uzivatel'
}

function _isStaffUser() {
  const role = _currentRole()
  return role === 'admin' || role === 'lektor'
}

function _staffBookingDisabledMessage() {
  return _locale() === 'en'
    ? 'Admins and instructors manage lessons; they cannot book them.'
    : 'Admin a lektor lekce pouze spravují, nemohou se na ně přihlašovat.'
}

function refreshStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const path = el.getAttribute('data-i18n')
    if (!path) return
    let params = {}
    const raw = el.getAttribute('data-i18n-params')
    if (raw) {
      try { params = JSON.parse(raw) } catch (_) {}
    }
    el.textContent = _tp(path, params)
  })
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const path = el.getAttribute('data-i18n-title')
    if (!path) return
    let params = {}
    const raw = el.getAttribute('data-i18n-params')
    if (raw) {
      try { params = JSON.parse(raw) } catch (_) {}
    }
    el.title = _tp(path, params)
  })
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const path = el.getAttribute('data-i18n-placeholder')
    if (!path) return
    el.placeholder = _tp(path)
  })
  const rem = document.getElementById('set-reminder')
  if (rem && rem.options?.length >= 4) {
    rem.options[0].textContent = _tp('pages.reminder6h')
    rem.options[1].textContent = _tp('pages.reminder24h')
    rem.options[2].textContent = _tp('pages.reminder48h')
    rem.options[3].textContent = _tp('pages.reminderOff')
  }
}

window.refreshStaticI18n = refreshStaticI18n

function _multiSessionsWord(cap) {
  const n = Number(cap) || 0
  if (lang !== 'cs') {
    return n === 1 ? _tp('booking.multiHintSessionsOne') : _tp('booking.multiHintSessionsMany')
  }
  if (n === 1) return _tp('booking.multiHintSessionsOne')
  if (n >= 2 && n <= 4) return _tp('booking.multiHintSessionsFew')
  return _tp('booking.multiHintSessionsMany')
}

function _entriesWordPick(cap) {
  return Number(cap) === 1 ? _tp('booking.payment.perEntry') : _tp('booking.payment.entriesLabel')
}

/** Platnost permanentky po zakoupení (uživ. katalog). */
function _passShopValidityLine(weeks) {
  const w = Number(weeks) || 0
  if (lang === 'cs') {
    if (w === 1) return _tp('shop.validityOneWeek')
    if (w >= 2 && w <= 4) return _tp('shop.validityWeeksFew', { weeks: w })
    return _tp('shop.validityWeeksMany', { weeks: w })
  }
  return w === 1 ? _tp('shop.validityOneWeek') : _tp('shop.validityWeeksMany', { weeks: w })
}

export const setLang = l => {
  lang = l === 'en' ? 'en' : 'cs'
  if (typeof window !== 'undefined') window.__uiLang = lang
  try {
    localStorage.setItem(UI_LANG_STORAGE_KEY, lang)
    _syncDocumentLang()
  } catch (_) { /* */ }
  emit(EVENTS.LANG_CHANGED, { lang })
  renderAll()
  window.syncLangUI?.(lang)
  window.refreshStaticI18n?.()
  try {
    renderNavigation(currentUser)
  } catch (_) { /* */ }

  const activeScreen = document.querySelector('.screen.active')
  const sid = activeScreen?.id ?? ''
  if (sid === 'screen-nastenka') {
    window.renderProfile?.()
  } else if (sid === 'screen-moje-lekce') {
    void window.renderMojeLekce?.()
  } else if (sid === 'screen-sprava' || sid.startsWith('screen-admin-')) {
    const route = sid.replace(/^screen-/, '')
    void window.__refreshAdminScreen?.(route)
  }
}

const loc = obj => typeof obj === 'object' && obj ? (obj[lang] ?? obj.cs ?? '') : (obj ?? '')

window.__setLang = setLang
window.__toggleLang = () => setLang(lang === 'cs' ? 'en' : 'cs')
const LESSONS_SELECT =
  'lesson_id, course_id, start_time, end_time, capacity, booked_count, available_spots'
const BOOKINGS_LIVE_REFRESH_COOLDOWN_MS = 4000

const DEFAULT_PASS_THEME = '#C4806E'
const DEFAULT_COURSE_THEME = '#2854B9'
function passThemeHex(hex) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(hex || '').trim()) ? String(hex).trim() : DEFAULT_PASS_THEME
}
/** Bezpečná barva kurzu pro rámečky / akcenty (stejně jako nástěnka). */
function courseThemeHex(hex) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(hex || '').trim()) ? String(hex).trim() : DEFAULT_COURSE_THEME
}
function passCardSurfaceCss(hex) {
  const h = passThemeHex(hex)
  return `background:${h}18;border:1px solid ${h}44;`
}

/** Kurzy permanentky jako pill štítky (uživ. katalog) */
function passShopCourseTagsBlock(ids, courseTitle, pc) {
  const hdr = `<div class="pass-shop-scope-heading">${_escHtml(_tp('nav.courses'))}</div>`
  const pill = txt =>
    `<span class="pass-shop-tag" style="background:${pc}22;color:${pc};">${_escHtml(txt)}</span>`
  if (!ids.length) {
    return `${hdr}<div class="pass-shop-course-tags">${pill(_tp('catalog.validAllCourses'))}</div>`
  }
  const labels = ids.map(courseTitle).filter(Boolean)
  if (!labels.length) {
    return `${hdr}<div class="pass-shop-course-tags">${pill(_tp('catalog.selectedCoursesDetail'))}</div>`
  }
  return `${hdr}<div class="pass-shop-course-tags">${labels.map(l => pill(l)).join('')}</div>`
}

function _toastPassEntriesLimitReached() {
  window.showToast?.(_tp('booking.toast.passEntriesLimitReached'), 'error')
}

/** Zbývající vstupy na konkrétní user_passes řádek (aktuálně načtené v aplikaci). */
function _remainingEntriesOnUserPass(passId) {
  if (!passId) return 0
  const row = userPasses.find(p => String(p.id) === String(passId))
  const n = Number(row?.entries_remaining ?? 0)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** Po změně zaškrtnutí přepočítat disabled na dalších termínech (max jako zbývá na pasu). */
function _enforceBkLessonCheckboxCapsFromPayOpts() {
  const payEl = document.getElementById('bk-payment-opts')
  const sel = payEl?.dataset.selected ?? ''
  if (!sel.startsWith('up-')) return
  const passId = sel.replace(/^up-/, '')
  const cap = _remainingEntriesOnUserPass(passId)
  const box = document.getElementById('bk-lesson-checkboxes')
  if (!box) return
  const n = [...box.querySelectorAll('input[name="bk-lesson-cb"]:checked')].length
  box.querySelectorAll('input[name="bk-lesson-cb"]').forEach(inp => {
    inp.disabled = cap <= 0 || (!inp.checked && n >= cap)
  })
}

function _refreshPopupPassSlotsCounter() {
  const slotEl = document.getElementById('bk-pass-slot-counter')
  const payEl = document.getElementById('bk-payment-opts')
  const sel = payEl?.dataset?.selected ?? ''
  if (!slotEl || !sel.startsWith('up-')) {
    if (slotEl) slotEl.style.display = 'none'
    return
  }
  const passId = sel.replace(/^up-/, '')
  const cap = _remainingEntriesOnUserPass(passId)
  const n = document.querySelectorAll('#bk-lesson-checkboxes input[name="bk-lesson-cb"]:checked').length
  slotEl.style.display = 'block'
  slotEl.textContent = _tp('booking.passPickerCountSelected', {
    n,
    cap,
    entriesWord: _entriesWordPick(cap),
  })
}

function _refreshCardPassSlotsRow(courseId) {
  const el = document.getElementById(`card-pass-count-${courseId}`)
  const st = window._cardState?.[courseId]
  if (!el) return
  if (!st || st.paymentType !== 'pass' || !st.passId) {
    el.style.display = 'none'
    return
  }
  const cap = _remainingEntriesOnUserPass(st.passId)
  const n = Array.isArray(st.lessonIds) ? st.lessonIds.length : 0
  el.style.display = 'block'
  el.textContent = _tp('booking.passPickerCountSelected', {
    n,
    cap,
    entriesWord: _entriesWordPick(cap),
  })
}

function _syncCardPrimaryButton(courseId) {
  const btn = document.getElementById(`res-btn-${courseId}`)
  const st = window._cardState?.[courseId] ?? {}
  if (!btn) return
  if (st.paymentType === 'buy-pass') {
    btn.textContent = _tp('booking.btn.buyPass')
    return
  }
  btn.textContent = _tp('booking.btn.continueToBooking')
}

function _bkSelectedLessonForPopupSingleSelect() {
  const lid = document.getElementById('bk-lesson-select')?.value?.trim?.()
  if (!lid) return null
  return _findFutureBookableLessonById(lid)
}

/** Po změně termínu v dropdownu přepíše text hlavního tlačítka rezervace (buy-pass vs jednoráz). */
function _bindBkLessonSelectPrimaryLabelSync() {
  const sel = document.getElementById('bk-lesson-select')
  if (!sel || sel.dataset.bkPrimaryLabelSync === '1') return
  sel.dataset.bkPrimaryLabelSync = '1'
  sel.addEventListener('change', () => { _syncPopupPrimaryButton() })
}

function _syncPopupPrimaryButton() {
  const btn = document.getElementById('bk-confirm-btn')
  const payEl = document.getElementById('bk-payment-opts')
  if (!btn || !payEl) return

  const paymentSel = payEl.dataset.selected ?? 'single'
  const courseId = payEl.dataset.courseid
  const course = window.AppState.courses.find(c => String(c.id) === String(courseId))

  if (paymentSel.startsWith('up-')) {
    btn.textContent = _tp('booking.btn.confirmBooking')
    return
  }

  if (paymentSel.startsWith('tpl-')) {
    const buyPassMetaEl = payEl.querySelector('.bk-opt-sel[data-buy-pass-template-id]')
    const passPriceNum = Number(buyPassMetaEl?.dataset.buyPassPrice ?? 0)
    const passPriceTxt = fmtPrice(passPriceNum)
    const les = _bkSelectedLessonForPopupSingleSelect()
    const slot = les
      ? _fmtBkLessonLine(les)
      : _tp('booking.slot.selectPrompt')
    btn.textContent = _tp('booking.btn.buyPassAndBook', { slot, price: passPriceTxt })
    return
  }

  const priceTxt = fmtPrice(Number(course?.price_single) || 0)
  btn.textContent = _tp('booking.btn.confirmAndPay', { price: priceTxt })
}

// ── Stav v AppState (single source of truth) ──────────────────
// Pořadí skriptů: tento modul může naběhnout před atelier_auth.js — merge, ne přepis objektu.
window.AppState ??= {}
Object.assign(window.AppState, {
  courses:           window.AppState.courses ?? [],
  lessons:           window.AppState.lessons ?? [],
  upcomingLessons:   window.AppState.upcomingLessons ?? [],
  weekStart:         window.AppState.weekStart ?? getMondayOf(new Date()),
  initialized:       window.AppState.initialized ?? false,
})

// Per-karta stav: { lessonId, lessonIds, paymentType, passId, buyPassTemplateId, buyPassEntriesTotal, buyPassPrice }
window._cardState = {}

/** Zapněte až po ověření stability. Nyní: data jen z prvního načtení, žádný další sync při návratu na tab. */
const ENABLE_TAB_RESUME_SYNC = false

// DIAGNOSTIKA: dříve INIT_SESSION_HEALTH_MS + withTimeout — dočasně vypnuto, ať vidíš reálnou chybu ze sítě
// const INIT_SESSION_HEALTH_MS = 15000

// ── Inicializace ──────────────────────────────────────────────
async function init() {
  if (window.__atelierBootFinished) {
    console.warn('[App] init() znovu vynechán — start už proběhl úspěšně (navigace init nevolá)')
    return
  }
  if (window.__atelierInitStarted) {
    console.warn('[App] init() již běží nebo bylo spuštěno — duplicitní volání ignorováno (ochrana proti smyčce)')
    return
  }
  window.__atelierInitStarted = true

  console.log('[App] Inicializace start — public data v paralele s auth (žádné serializované waterfally)')
  showAppLoader()
  try {
    logSupabaseClientDebug()

    // 1) Nejdřív auth — až potom kurzy/lekce, aby RLS vidělo přihlášeného uživatele
    //    (jinak zůstanou jen veřejné kurzy až do reloadu stránky).
    if (window.__authReady) await window.__authReady
    console.log('[App] Auth ready (tab resume sync je ' + (ENABLE_TAB_RESUME_SYNC ? 'ZAP' : 'VY') + 'PNUTÝ)')

    const dataFetches = (async () => {
      await fetchCourses().catch(e => {
        console.warn('[Debug] Init: fetchCourses chyba — pokračuji s prázdnými kurzy:', e?.message ?? e)
        console.dir(e, { depth: null })
      })
      await fetchCourseBookingAccess().catch(() => {})
      await Promise.all([
        fetchLessons().catch(e => {
          console.warn('[Debug] Init: fetchLessons:', e?.message ?? e)
          console.dir(e, { depth: null })
        }),
        fetchUpcomingLessons().catch(e => {
          console.warn('[Debug] Init: fetchUpcomingLessons:', e?.message ?? e)
          console.dir(e, { depth: null })
        }),
      ])
    })()

    // 2) Admin modul (~135 KB) jen pro staff (admin nebo lektor) — lazy import paralelně s daty.
    //    Lektor používá z admin modulu: správu kurzů/workshopů, permanentek a akce v „Moje lekce"
    //    (otevření účastníků, storno lekce, storno rezervace zákazníka). RLS scopuje vše na vlastní.
    const _role = window.AppState.role
    const _isStaff = _role === 'admin' || _role === 'lektor'
    const adminLoad = _isStaff
      ? import('./atelier-admin.js').catch(e => {
          console.error('[App] Lazy import atelier-admin.js selhal:', e)
          return null
        })
      : null

    // 4) Počkat na public data (auth už doběhl, takže `currentUser` je k dispozici pro render).
    await dataFetches
    console.log('[App] První kolo dat dokončeno')

    // 5) Pokud uživatel přistává na admin sekci, musí být admin modul načten dříve, než nav() pošle hook.
    if (adminLoad) await adminLoad

    window.AppState.initialized = true
    renderAll()
    window.syncLangUI?.(lang)
    window.refreshStaticI18n?.()

    // Defaultní obrazovka podle role: admin → přehled, lektor → vlastní lekce, přihlášený uživatel → přehled, host → kalendář.
    const defaultPage = _role === 'admin'
      ? 'admin-dashboard'
      : (_role === 'lektor' ? 'moje-lekce' : (currentUser ? 'nastenka' : 'kalendar'))
    const resumedBooking = await resumeBookingAfterAuth()
    if (!resumedBooking) {
      window.nav?.(defaultPage)
    }

    subscribeToLessons()
    if (ENABLE_TAB_RESUME_SYNC) {
      setupTabResumeRefresh()
    } else {
      console.log('[App] Tab resume sync VYPNUT — žádné další getSession/fetch při focusu (stabilita)')
    }
    registerRerenderers(renderKalendar, updateEnrolledOnNastenska)
    window.__atelierBootFinished = true
    console.log('[App] Inicializace OK — další volání init() by bylo chybou (nepoužívá navigace)')
  } catch (err) {
    console.error('[App] Kritická chyba při inicializaci:', err)
    showRetryScreen()
  } finally {
    // Skryje spinner vždy — showRetryScreen() zobrazí app-error zvlášť
    const spinner = document.getElementById('app-loader')
    if (spinner) spinner.style.display = 'none'
  }
}

function showAppLoader() {
  const el = document.getElementById('app-loader')
  if (el) el.style.display = 'flex'
}


function showRetryScreen() {
  const loader = document.getElementById('app-loader')
  if (loader) loader.style.display = 'none'
  const errEl = document.getElementById('app-error')
  if (errEl) errEl.style.display = 'flex'
}

/** DIAGNOSTIKA: původní rozpočty + withTimeout — dočasně vypnuto */
// const BACKGROUND_FETCH_BUDGET_MS = 3000
// const TAB_RESUME_FETCH_BUDGET_MS = 10000
// const INIT_NETWORK_BUDGET_MS = 12000
//
// function withTimeout(promise, ms, label) {
//   return Promise.race([
//     Promise.resolve(promise),
//     new Promise((_, rej) => setTimeout(() => {
//       const e = new Error(`TIMEOUT:${label}`)
//       e.code = 'TIMEOUT'
//       e.label = label
//       rej(e)
//     }, ms))
//   ])
// }

let _bgResumeGeneration = 0

/** Neblokující aktualizace AppState při návratu na tab — kroky jdou za sebou (méně zahlcení Supabase než 4 paralelní). */
async function runBackgroundDataSync(reason) {
  const myGen = ++_bgResumeGeneration
  console.log(
    `[Debug] Pozadí sync (${reason}): sekvenčně, bez vlastního časového limitu (dříve TAB_RESUME_FETCH_BUDGET_MS / withTimeout vypnuto)`,
  )

  const step = async (label, fn) => {
    if (myGen !== _bgResumeGeneration) return
    try {
      await fn()
      console.log(`[Debug]   ✓ dokončeno: ${label}`)
    } catch (e) {
      console.warn(`[Debug]   ✗ ${label}:`, e?.message ?? e)
      console.dir(e, { depth: null })
    }
    if (myGen !== _bgResumeGeneration) return
    await new Promise(r => setTimeout(r, 40))
  }

  await step('auth.getSession', () => sb.auth.getSession())
  if (myGen !== _bgResumeGeneration) return
  await step('fetchCourses', () => fetchCourses())
  if (myGen !== _bgResumeGeneration) return
  await step('fetchLessons', () => fetchLessons())
  if (myGen !== _bgResumeGeneration) return
  await step('fetchUpcomingLessons', () => fetchUpcomingLessons())

  if (myGen !== _bgResumeGeneration) {
    console.log('[Debug] Pozadí sync zahozen — mezitím začal novější běh')
    return
  }

  console.log('[Debug] Pozadí sync hotovo — tiše přepočítávám Kurzy + Kalendář (stejná logika jako po Načíst, bez plánovaného druhého „prázdného“ renderu)')
  try {
    requestAnimationFrame(() => {
      if (myGen !== _bgResumeGeneration) return
      try {
        renderAll()
        updateEnrolledOnNastenska()
      } catch (e) {
        console.warn('[Debug] rAF překreslení po pozadí:', e)
      }
    })
  } catch (e) {
    console.warn('[Debug] překreslení po pozadí selhalo:', e)
  }
}

/** Jednotný seznam URL z `courses.images` (jediný zdroj fotek kurzu). */
export function courseImageUrls(course) {
  const raw = course?.images
  if (!Array.isArray(raw)) return []
  const out = []
  for (const u of raw) {
    if (typeof u !== 'string') continue
    const t = u.trim()
    if (t) out.push(t)
  }
  return out.slice(0, 4)
}

export function normalizeCourseRecord(c) {
  if (!c || typeof c !== 'object') return c
  return { ...c, images: courseImageUrls(c) }
}

// ── Fetch: kurzy ─────────────────────────────────────────────
const _COURSE_COLS = `
  id, title, description_short, description_long,
  color_code, price_single, capacity_default,
  min_participants,
  cancellation_hours, images, is_workshop, is_restricted, owner_id,
  schedule_days, schedule_time_start, schedule_time_end
`

/** Kurzy, na které má přihlášený uživatel právo rezervace (whitelist). */
window._allowedCourseIds = window._allowedCourseIds ?? new Set()

async function fetchCourseBookingAccess() {
  if (!currentUser?.id) {
    window._allowedCourseIds = new Set()
    return
  }
  const { data, error } = await sb
    .from('course_allowed_users')
    .select('course_id')
    .eq('user_id', currentUser.id)
  if (error) {
    console.warn('[App] fetchCourseBookingAccess:', error)
    return
  }
  window._allowedCourseIds = new Set((data ?? []).map(r => r.course_id))
}

/** Uzavřený kurz: viditelný všem, rezervace jen pro vybrané (+ vlastní lektor). */
function canBookCourse(course) {
  if (!course?.is_restricted) return true
  if (_isStaffUser()) return false
  if (!currentUser?.id) return false
  if (_currentRole() === 'lektor' && String(course.owner_id) === String(currentUser.id)) return true
  return window._allowedCourseIds?.has(course.id) ?? false
}

function _restrictedBadgeHtml() {
  return `<span class="badge" style="background:#E8EEF8;color:#2854B9;font-size:10px;font-weight:600;">${_escHtml(_tp('courses.badgeRestricted'))}</span>`
}

function _workshopBadgeHtml() {
  return `<span class="badge" style="background:#FFF4E0;color:#8B5C00;font-size:10px;font-weight:600;">${_escHtml(_tp('courses.badgeWorkshop'))}</span>`
}

function _isPastLesson(lesson) {
  const endTs = lesson?.end_time ? new Date(lesson.end_time).getTime() : NaN
  return Number.isFinite(endTs) && endTs <= Date.now()
}

function _preferredPayFromCardState(st) {
  if (!st) return null
  if (st.paymentType === 'pass' && st.passId) return `up-${st.passId}`
  if (st.paymentType === 'buy-pass' && st.buyPassTemplateId) return `tpl-${st.buyPassTemplateId}`
  if (st.paymentType === 'single') return 'single'
  return null
}

async function fetchCourses() {
  // Pokus 1: rovnou s embedem owner. Pokud RLS na users zablokuje JOIN
  // (typicky „permission denied for table users"), spadneme do fallbacku
  // a kurzy načteme bez embedu, jména lektorů dotáhneme zvlášť.
  const primary = await sb
    .from('courses')
    .select(`${_COURSE_COLS}, owner:users!owner_id ( id, name )`)
    .eq('is_active', true)
    .order('title->cs')

  if (!primary.error) {
    window.AppState.courses = (primary.data ?? []).map(normalizeCourseRecord)
    window.AppState._coursesFetchSettled = true
    await _refreshWorkshopSessionMeta()
    emit(EVENTS.COURSES_UPDATED, { count: window.AppState.courses.length, source: 'primary' })
    return
  }

  console.warn('[App] fetchCourses: embed owner selhal, zkouším fallback', primary.error)

  const fallback = await sb
    .from('courses')
    .select(_COURSE_COLS)
    .eq('is_active', true)
    .order('title->cs')

  if (fallback.error) {
    console.error('[App] fetchCourses fallback selhal:', fallback.error)
    throw new Error('Nepodařilo se načíst kurzy: ' + fallback.error.message)
  }

  const courses = fallback.data ?? []
  // Doplň jména lektorů samostatným dotazem (RLS to může povolit i bez embedu).
  const ownerIds = [...new Set(courses.map(c => c.owner_id).filter(Boolean))]
  let ownerMap = {}
  if (ownerIds.length) {
    const { data: owners, error: oErr } = await sb
      .from('users')
      .select('id, name')
      .in('id', ownerIds)
    if (oErr) {
      console.warn('[App] fetchCourses: nepodařilo se dotáhnout jména lektorů:', oErr)
    } else {
      ownerMap = Object.fromEntries((owners ?? []).map(u => [u.id, u]))
    }
  }
  window.AppState.courses = courses.map(c => normalizeCourseRecord({
    ...c,
    owner: ownerMap[c.owner_id] ?? null,
  }))
  window.AppState._coursesFetchSettled = true
  await _refreshWorkshopSessionMeta()
  emit(EVENTS.COURSES_UPDATED, { count: window.AppState.courses.length, source: 'fallback' })
}

function _calcDurMin(startStr, endStr) {
  if (!startStr || !endStr) return null
  const [sh, sm] = startStr.split(':').map(Number)
  const [eh, em] = endStr.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

/** Lekce jen u kurzů v AppState (lesson_availability může vrátit i skryté kurzy). */
function _visibleCourseIdSet() {
  return new Set((window.AppState.courses ?? []).map(c => c.id))
}

function _filterLessonsByVisibleCourses(lessons) {
  // Kurzy ještě nenačtené — neřež (jinak prázdný kalendář při závodu fetchCourses vs. fetchLessons).
  if (!window.AppState._coursesFetchSettled) return lessons ?? []
  const ids = _visibleCourseIdSet()
  return (lessons ?? []).filter(l => ids.has(l.course_id))
}

// ── Fetch: lekce pro aktuální týden ──────────────────────────
async function fetchLessons(from = window.AppState.weekStart) {
  const to = new Date(from)
  to.setDate(to.getDate() + 7)
  const weekQuery = sb
    .from('lesson_availability')
    .select(LESSONS_SELECT)
    .eq('status', 'active')
    .gte('start_time', from.toISOString())
    .lt('start_time',  to.toISOString())
    .order('start_time')
  const [{ data, error }] = await Promise.all([weekQuery, _refreshWorkshopSessionMeta()])
  if (error) { console.error('fetchLessons:', error); return }
  window.AppState.lessons = _filterLessonsByVisibleCourses(data ?? [])
  emit(EVENTS.LESSONS_UPDATED, { scope: 'week', from: from.toISOString() })
}

// ── Fetch: všechny budoucí lekce (pro kurzy + booking) ───────
async function fetchUpcomingLessons() {
  const { data, error } = await sb
    .from('lesson_availability')
    .select(LESSONS_SELECT)
    .eq('status', 'active')
    .gte('start_time', new Date().toISOString())
    .order('start_time')
    .limit(300)
  if (error) { console.error('fetchUpcomingLessons:', error); return }
  window.AppState.upcomingLessons = _filterLessonsByVisibleCourses(data ?? [])
  emit(EVENTS.LESSONS_UPDATED, { scope: 'upcoming' })
}

// ── Realtime: živá obsazenost (debounce — tab / burst events nesmí zahltit UI) ──
let _bookingsLiveTimer = null
let _lastBookingsLiveRefreshAt = 0
let _bookingsLiveSubscribed = false
function _flushBookingsRealtime() {
  _bookingsLiveTimer = null
  if (document.visibilityState !== 'visible') return
  const now = Date.now()
  const sinceLastRefresh = now - _lastBookingsLiveRefreshAt
  if (sinceLastRefresh < BOOKINGS_LIVE_REFRESH_COOLDOWN_MS) {
    _bookingsLiveTimer = setTimeout(
      _flushBookingsRealtime,
      BOOKINGS_LIVE_REFRESH_COOLDOWN_MS - sinceLastRefresh,
    )
    return
  }
  _lastBookingsLiveRefreshAt = now
  ;(async () => {
    console.log('[Debug] Realtime (bookings): refresh lekcí na pozadí (bez withTimeout)')
    try {
      await Promise.allSettled([
        fetchLessons().catch(() => {}),
        fetchUpcomingLessons().catch(() => {}),
      ])
      renderKalendar()
      renderKurzy()
    } catch (e) {
      console.warn('[App] realtime refresh:', e)
    }
  })()
}

function subscribeToLessons() {
  if (_bookingsLiveSubscribed) return
  _bookingsLiveSubscribed = true
  sb.channel('bookings-live')
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'bookings'
    }, () => {
      if (_bookingsLiveTimer) clearTimeout(_bookingsLiveTimer)
      _bookingsLiveTimer = setTimeout(_flushBookingsRealtime, 350)
    })
    .subscribe()
}

let _resumeTimer = null
function setupTabResumeRefresh() {
  const run = () => {
    if (document.visibilityState !== 'visible') {
      console.log('[Debug] Tab není aktivní (visibility/focus událost → nic)')
      return
    }
    if (!window.AppState.initialized) {
      console.log('[Debug] Čekám na dokončení první init — návrat na tab bez sync')
      return
    }
    if (_resumeTimer) clearTimeout(_resumeTimer)
    console.log('[Debug] Návrat na tab → nejdřív okamžitě překreslím Kurzy+Kalendář ze stávajícího AppState, pak síťový sync (bez vlastního timeoutu)')
    _resumeTimer = setTimeout(() => {
      _resumeTimer = null
      try {
        console.log('[Debug] Okamžitý renderAll() se starými daty (UI zůstane použitelné při pomalé síti)')
        renderAll()
        updateEnrolledOnNastenska()
      } catch (e) {
        console.warn('[Debug] okamžité překreslení před sync:', e)
      }
      void runBackgroundDataSync('tab-visible / window-focus').catch(e =>
        console.warn('[Debug] runBackgroundDataSync:', e))
    }, 280)
  }
  document.addEventListener('visibilitychange', run, { passive: true })
  window.addEventListener('focus', run, { passive: true })
}

function renderAll() {
  renderKalendar()
  renderKurzy()
  if (document.getElementById('screen-permanentky')?.classList.contains('active')) void renderPermanentkyShop()
  if (document.getElementById('pop-booking')?.style.display === 'flex') _syncPopupPrimaryButton()
}

async function refreshPublicData() {
  await fetchCourses().catch(() => {})
  await fetchCourseBookingAccess().catch(() => {})
  await Promise.allSettled([
    fetchLessons().catch(() => {}),
    fetchUpcomingLessons().catch(() => {}),
    currentUser?.id && typeof window.refreshUserBookings === 'function'
      ? window.refreshUserBookings().catch(() => {})
      : Promise.resolve(),
  ])

  renderAll()

  const detailScreen = document.getElementById('screen-detail-kurzu')
  if (detailScreen?.classList.contains('active') && window._detailCourseId) {
    await renderCourseDetail(window._detailCourseId)
  }

  if (document.getElementById('screen-nastenka')?.classList.contains('active')
      || document.getElementById('screen-admin-dashboard')?.classList.contains('active')) {
    window.renderProfile?.()
  }
}

window.refreshPublicData = refreshPublicData

/** Veřejný detail: HTML jen po projítí DOMPurify; prostý text zachovat s řádky (legacy data před editorem). */
function _formatCourseDetailLong(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if (/<[a-z][\s\S]*>/i.test(s))
    return `<div class="course-rich-text">${sanitizeCourseRichText(s)}</div>`
  return `<div class="course-rich-text course-rich-text--plain">${_escHtml(s)}</div>`
}

function _escHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// ============================================================
// KALENDÁŘ
// ============================================================
/** Všechna aktivní setkání workshopů (ne jen aktuální týden) — pro správné číslo (2), (3)… */
async function _refreshWorkshopSessionMeta() {
  const map = new Map()
  if (!window.AppState._coursesFetchSettled) {
    window.AppState.workshopSessionMeta = map
    return
  }
  const workshopIds = (window.AppState.courses ?? [])
    .filter(c => c.is_workshop)
    .map(c => c.id)
  if (!workshopIds.length) {
    window.AppState.workshopSessionMeta = map
    return
  }
  const { data, error } = await sb
    .from('lesson_availability')
    .select('lesson_id, course_id, start_time')
    .in('course_id', workshopIds)
    .eq('status', 'active')
    .order('start_time')
  if (error) {
    console.warn('[App] _refreshWorkshopSessionMeta:', error)
    return
  }
  const byCourse = new Map()
  for (const l of _filterLessonsByVisibleCourses(data ?? [])) {
    const cid = l.course_id
    if (!byCourse.has(cid)) byCourse.set(cid, [])
    byCourse.get(cid).push(l)
  }
  for (const lessons of byCourse.values()) {
    lessons.sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    lessons.forEach((l, i) => {
      map.set(String(l.lesson_id ?? l.id), { index: i + 1, total: lessons.length })
    })
  }
  window.AppState.workshopSessionMeta = map
}

/** @returns {Map<string, { index: number, total: number }>} */
function _workshopSessionMetaByLessonId() {
  return window.AppState.workshopSessionMeta ?? new Map()
}

function _workshopEventTitle(courseTitle, sessionMeta) {
  if (!sessionMeta || sessionMeta.total <= 1 || sessionMeta.index <= 1) return courseTitle
  return `${courseTitle} (${sessionMeta.index})`
}

export function renderKalendar() {
  const colIds = ['col-po','col-ut','col-st','col-ct','col-pa','col-so','col-ne']

  // Vyčistíme eventy, ne strukturu sloupců
  colIds.forEach(id => {
    const col = document.getElementById(id)
    if (col) col.querySelectorAll('.ev').forEach(e => e.remove())
  })

  renderWeekHeader()

  // Rozsah hodin — dynamický dle lekcí
  const { min, max } = calMinMax()
  const PH = (() => {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cal-hour'))
    return Number.isFinite(v) && v > 0 ? v : 56
  })()

  // Regenerate time column and column heights to match actual lesson range
  const tc = document.getElementById('cal-times')
  if (tc) {
    tc.innerHTML = ''
    for (let h = min; h <= max; h++) {
      const div = document.createElement('div')
      div.className = 'time-slot'
      div.textContent = `${h}:00`
      tc.appendChild(div)
    }
  }
  const colHeight = (max - min + 1) * PH
  colIds.forEach(id => {
    const col = document.getElementById(id)
    if (col) col.style.minHeight = `${colHeight}px`
  })

  const wsMeta = _workshopSessionMetaByLessonId()

  window.AppState.lessons.forEach(l => {
    const course  = window.AppState.courses.find(c => c.id === l.course_id)
    if (!course) return
    const color   = courseThemeHex(course.color_code)
    const start   = new Date(l.start_time)
    const end     = new Date(l.end_time)
    const dayIdx  = (start.getDay() + 6) % 7  // 0=Po … 6=Ne
    const startH  = start.getHours() + start.getMinutes() / 60
    const endH    = end.getHours()   + end.getMinutes()   / 60
    const topPx   = (startH - min) * PH
    const heightPx = (endH - startH) * PH - 3

    if (topPx < 0) return

    const col = document.getElementById(colIds[dayIdx])
    if (!col) return

    const lid = String(l.lesson_id ?? l.id)
    const sessionMeta = wsMeta.get(lid)
    const isFollowUpSession = sessionMeta && sessionMeta.index > 1
    const enrolled = isEnrolled(lid)
    const full     = l.available_spots <= 0 && !enrolled
    const isPast   = _isPastLesson(l)
    const baseName = course ? loc(course.title) : '—'
    const name     = _workshopEventTitle(baseName, sessionMeta)
    const timeStr  = `${fmtTime(start)}–${fmtTime(end)}`
    const evColor  = isPast ? '#9b9b9b' : color
    const bgAlpha = isPast ? '18' : (enrolled ? '33' : (isFollowUpSession ? '0c' : '18'))

    const el = document.createElement('div')
    el.className = 'ev' + (isPast ? ' ev-past' : '')
    el.style.cssText = [
      `top:${topPx}px`,
      `height:${heightPx}px`,
      `background:${evColor + bgAlpha}`,
      `border-left:3px solid ${evColor}`,
      isPast ? 'cursor:default;pointer-events:none;' : '',
      !isPast && isFollowUpSession ? 'opacity:.72' : '',
      !isPast && full ? 'opacity:.45' : '',
    ].filter(Boolean).join(';')

    const wsBadge = !isPast && course?.is_workshop
      ? `<div class="evb" style="color:${evColor};opacity:.7;">WORKSHOP${sessionMeta && sessionMeta.index > 1 ? ` (${sessionMeta.index})` : ''}</div>`
      : ''
    const restrictedBadge = !isPast && course?.is_restricted
      ? `<div class="evb" style="color:#2854B9;opacity:.85;">${_escHtml(_tp('courses.badgeRestricted').toUpperCase())}</div>`
      : ''

    el.innerHTML = `
      <div class="evn" style="color:${evColor};">${_escHtml(name)}</div>
      <div class="evt" style="color:${evColor};">${timeStr}</div>
      ${wsBadge}
      ${restrictedBadge}
      ${enrolled ? `<div class="evb" style="color:${evColor};">✓ ${_escHtml(_tp('common.enrolled'))}</div>` : ''}
      ${full && !enrolled && !isPast ? `<div class="evb" style="color:${evColor};">${_escHtml(_tp('common.full').toUpperCase())}</div>` : ''}
    `

    if (!isPast) {
      el.addEventListener('click', () => openKalendarPopup(l, course, enrolled, sessionMeta))
    }
    col.appendChild(el)
  })
}

function renderWeekHeader() {
  const dayNames = {
    cs: ['Po','Út','St','Čt','Pá','So','Ne'],
    en: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
  }
  const today = new Date()
  document.querySelectorAll('.dh').forEach((dh, i) => {
    const d = new Date(window.AppState.weekStart)
    d.setDate(d.getDate() + i)
    const numEl  = dh.querySelector('.dd')
    const nameEl = dh.querySelector('.dn')
    if (numEl)  { numEl.textContent = d.getDate(); numEl.classList.toggle('td', isSameDay(d, today)) }
    if (nameEl)   nameEl.textContent = dayNames[lang][i]
  })
  const calTitle = document.querySelector('.cal-title, .cal-ctrl .pt')
  if (calTitle) calTitle.textContent = fmtWeekRange(window.AppState.weekStart)
}

function calMinMax() {
  let mn = 9, mx = 18
  _filterLessonsByVisibleCourses(window.AppState.lessons).forEach(l => {
    const s = new Date(l.start_time), e = new Date(l.end_time)
    mn = Math.min(mn, s.getHours())
    mx = Math.max(mx, e.getHours() + (e.getMinutes() > 0 ? 1 : 0))
  })
  return { min: Math.floor(mn), max: Math.ceil(mx) }
}

// Navigace týdnů
export async function calPrev() {
  const ws = new Date(window.AppState.weekStart)
  ws.setDate(ws.getDate() - 7)
  window.AppState.weekStart = ws
  await fetchLessons(); renderKalendar()
}
export async function calNext() {
  const ws = new Date(window.AppState.weekStart)
  ws.setDate(ws.getDate() + 7)
  window.AppState.weekStart = ws
  await fetchLessons(); renderKalendar()
}
window.calPrev = calPrev
window.calNext = calNext

// Popup při kliknutí na lekci v kalendáři
function openKalendarPopup(lesson, course, enrolled, sessionMeta = null) {
  if (_isPastLesson(lesson)) return
  const color   = courseThemeHex(course?.color_code)
  const baseName = course ? loc(course.title) : '—'
  const name    = _workshopEventTitle(baseName, sessionMeta)
  const start   = new Date(lesson.start_time)
  const end     = new Date(lesson.end_time)
  const durMin  = Math.round((end - start) / 60000)
  const ownerName = Array.isArray(course?.owner) ? course.owner[0]?.name : course?.owner?.name

  const bar = document.getElementById('kal-bar')
  if (bar) bar.style.background = color

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val }
  setEl('kal-lbl-inst', _tp('courses.instructor'))
  setEl('kal-lbl-dur', _tp('kal.duration'))
  setEl('kal-lbl-spots', _tp('kal.spots'))
  setEl('kal-name',   name)
  setEl('kal-meta',   `${fmtDayFull(start)} · ${fmtTime(start)}–${fmtTime(end)}`)
  setEl('kal-lektor', ownerName ?? '—')
  setEl('kal-delka',  `${durMin} min`)
  setEl('kal-mista',  `${lesson.available_spots} / ${lesson.capacity}`)

  const lid = lesson.lesson_id ?? lesson.id
  window._kalOpenLessonId = lid != null ? String(lid) : ''
  const enrolledBooking = myBookings.find(b => String(b?.lesson?.id ?? '') === String(lid))
  const canCancelEnrolledBooking = canUserCancelBooking(enrolledBooking)
  const staffUser = _isStaffUser()
  const role = _currentRole()
  const courseOwnerId = Array.isArray(course?.owner) ? course.owner[0]?.id : course?.owner?.id
  const canManageLesson = role === 'admin'
    || (role === 'lektor' && String(course?.owner_id ?? courseOwnerId ?? '') === String(currentUser?.id ?? ''))
  const canBookLesson = start.getTime() > Date.now() && canBookCourse(course)

  const enrBadge = document.getElementById('kal-enrolled')
  const bEnr     = document.getElementById('kal-btns-enr')
  const bFree    = document.getElementById('kal-btns-free')
  const bStaff   = document.getElementById('kal-btns-staff')
  const rezBtn   = document.getElementById('kal-rez-btn')
  const publicDetailBtn = document.getElementById('kal-course-detail-btn')

  if (enrBadge) {
    enrBadge.textContent = `✓ ${_tp('common.enrolled')}`
    enrBadge.style.display = enrolled ? 'inline-block' : 'none'
  }
  const cKalCancel = document.getElementById('kal-cancel-booking-btn')
  if (cKalCancel) cKalCancel.textContent = _tp('kal.cancelBooking')
  if (publicDetailBtn) {
    publicDetailBtn.style.display = staffUser ? 'none' : ''
    publicDetailBtn.textContent = _tp('admin.btn.courseDetail')
    publicDetailBtn.onclick = () => {
      const pop = document.getElementById('pop-kal')
      if (pop) pop.style.display = 'none'
      window.openDetail?.(lesson.course_id)
    }
  }
  if (bEnr)     bEnr.style.display     = enrolled && canCancelEnrolledBooking ? 'block' : 'none'
  if (bFree)    bFree.style.display    = enrolled || staffUser || !canBookLesson ? 'none'  : 'grid'
  if (bStaff)   bStaff.style.display   = staffUser ? 'grid' : 'none'
  if (staffUser) {
    const detailBtn = document.getElementById('kal-detail-btn')
    const attendeesBtn = document.getElementById('kal-attendees-btn')
    const deactivateBtn = document.getElementById('kal-deactivate-btn')
    if (detailBtn) {
      detailBtn.textContent = _tp('admin.btn.courseDetail')
      detailBtn.onclick = () => {
        const pop = document.getElementById('pop-kal')
        if (pop) pop.style.display = 'none'
        window.openDetail?.(lesson.course_id)
      }
    }
    if (attendeesBtn) {
      attendeesBtn.textContent = _tp('admin.btn.attendees')
      attendeesBtn.style.display = canManageLesson ? '' : 'none'
      attendeesBtn.onclick = () => window.adminOpenLessonDetail?.(lid)
    }
    if (deactivateBtn) {
      deactivateBtn.textContent = _tp('admin.btn.deactivate')
      deactivateBtn.style.display = canManageLesson ? '' : 'none'
      deactivateBtn.onclick = () => window.adminDeactivateLesson?.(lid)
    }
  }
  if (rezBtn) {
    rezBtn.style.display = canBookLesson ? '' : 'none'
    rezBtn.style.background = color
    rezBtn.textContent = _tp('booking.btn.book')
    rezBtn.onclick = () => {
      if (_isStaffUser()) {
        window.showToast?.(_staffBookingDisabledMessage(), 'error')
        return
      }
      window.closeAll?.()
      window.openBookingPopup?.(lesson.course_id, null, lesson.lesson_id ?? lesson.id)
    }
  }

  const pop = document.getElementById('pop-kal') ?? document.getElementById('ov-lesson')
  if (pop) pop.style.display = 'flex'
}

/** Storno rezervace z kalendářového popupu (tlačítko v index.html). */
window.cancelBookingFromPopup = async () => {
  const lid = window._kalOpenLessonId
  if (!currentUser?.id || !lid) {
    window.showToast?.(_tp('booking.toast.cancelNoLesson'), 'error')
    return
  }
  try {
    const { data, error } = await sb
      .from('bookings')
      .select(`
        id, payment_type, user_pass_id,
        user_pass:user_passes ( id, entries_total, cancellation_count ),
        lesson:lessons (
          id, start_time,
          course:courses ( cancellation_hours )
        )
      `)
      .eq('user_id', currentUser.id)
      .eq('lesson_id', lid)
      .eq('status', PARTICIPATION_STATUS.CONFIRMED)
      .maybeSingle()
    if (error) throw error
    if (!data?.id) {
      window.showToast?.(_tp('booking.toast.noActiveBooking'), 'error')
      return
    }
    if (data.payment_type === 'single') {
      window.showToast?.(_tp('booking.toast.singleCannotCancel'), 'error')
      return
    }
    if (!canUserCancelBooking(data)) {
      window.showToast?.(getUserBookingCancellationMessage(data), 'error')
      return
    }
    const { data: rpcData, error: rpcErr } = await sb.rpc('cancel_my_pass_booking', {
      p_booking_id: data.id,
    })
    if (rpcErr) throw rpcErr
    if (rpcData?.ok === false) {
      const msg = rpcData.error === 'cancel_not_allowed'
        ? getUserBookingCancellationMessage(data)
        : (rpcData.error || 'Storno se nepodařilo.')
      throw new Error(msg)
    }

    window.showToast?.(_tp('booking.toast.cancelled'), 'ok')
    const pop = document.getElementById('pop-kal')
    if (pop) pop.style.display = 'none'
    await Promise.all([fetchUpcomingLessons(), fetchLessons()])
    renderKurzy()
    renderKalendar()
    window.refreshUserBookings?.()
  } catch (err) {
    console.error('[cancelBookingFromPopup]', err)
    window.showToast?.(_tp('booking.toast.errorPrefix') + (err.message ?? err), 'error')
  }
}

// ============================================================
// SEKCE: KURZY
// ============================================================
export function renderKurzy() {
  const container = document.getElementById('screen-kurzy') ?? document.getElementById('s-kurzy')
  if (!container) return

  // Vymažeme karty i skeleton
  container.querySelectorAll('.cc, .cc-sk').forEach(el => el.remove())

  if (!window.AppState.courses.length) {
    container.insertAdjacentHTML('beforeend', `
      <div style="padding:40px;text-align:center;font-size:12px;color:#9b9b9b;">
        ${_tp('courses.noActiveCourses')}
      </div>`)
    return
  }

  window.AppState.courses.forEach(c => {
    const color    = courseThemeHex(c.color_code)
    const title    = loc(c.title)
    const desc     = loc(c.description_short)
    const ownerName = Array.isArray(c.owner) ? c.owner[0]?.name : c.owner?.name
    const soldOut  = !window.AppState.upcomingLessons.some(l => l.course_id === c.id && l.available_spots > 0)
    const upcoming = window.AppState.upcomingLessons.filter(l => l.course_id === c.id)
    const pricePerEntry = c.price_single
    const restricted = !!c.is_restricted
    const bookable = canBookCourse(c)

    _ensureCardStateForCourse(c.id, upcoming)

    const card = document.createElement('div')
    card.className = 'cc'

    const thumbUrls = courseImageUrls(c)
    const thumb0 = thumbUrls[0] ?? null
    card.innerHTML = `
      <div class="cm" onclick="toggleC('${c.id}')">
        <div class="cab" style="background:${color};"></div>
        ${thumb0
          ? `<div class="cc-thumb-wrap"><img class="cc-thumb" src="${thumb0}" alt="" /></div>`
          : `<div class="cc-thumb-wrap cc-thumb-ph" aria-hidden="true"></div>`}
        <div class="cb">
          <div class="cname">${title}${c.is_workshop ? ` ${_workshopBadgeHtml()}` : ''}${restricted ? ` ${_restrictedBadgeHtml()}` : ''}</div>
          <div class="cmeta">
            <span class="cmi">${ownerName ?? '—'}</span>
            <span class="cmi">${c.capacity_default} ${_tp('courses.capacitySpots')}</span>
            ${restricted && !bookable
              ? ''
              : soldOut
                ? `<span class="badge" style="background:#fdeaea;color:#791F1F;">${_tp('courses.badgeFull')}</span>`
                : `<span class="badge" style="background:#eaf5ea;color:#085041;">${_tp('courses.badgeSpots')}</span>`
            }
          </div>
        </div>
        <div class="cr">
          <span class="cpr">${fmtPrice(pricePerEntry)}</span>
          <span style="font-size:11px;color:#6b6b6b;" id="cv-${c.id}">›</span>
        </div>
      </div>

      <div class="cex" id="cx-${c.id}">
        <div class="cxi">
          <div class="cxi-left">
            ${buildCourseImage(c)}
            <div style="font-size:11px;color:#6b6b6b;line-height:1.6;margin-bottom:10px;">${desc}</div>
            <button type="button" class="btn-detail" onclick="event.stopPropagation();openDetail('${c.id}')">
              ${_tp('courses.detailLink')}
            </button>
          </div>
          <div class="cxi-right">
            ${_buildKurzyAccordionBooking(c, color, upcoming, bookable)}
          </div>
        </div>
      </div>`

    card.style.border = `1px solid ${color}`
    container.appendChild(card)
  })
}

function buildCourseImage(c) {
  const url = courseImageUrls(c)[0] ?? null
  return url
    ? `<img src="${url}" style="width:100%;height:78px;object-fit:cover;border-radius:8px;margin-bottom:10px;" alt="" />`
    : `<div style="background:#F8F8F8;border-radius:8px;height:78px;display:flex;align-items:center;justify-content:center;margin-bottom:10px;font-size:10px;color:#9b9b9b;">
         ${_tp('courses.photoAlt')}
       </div>`
}

function buildTermPills(upcoming, color, courseId, interactive = true, large = false) {
  if (!upcoming.length) {
    return `<span style="font-size:10px;color:#9b9b9b;">${_tp('courses.noDates')}</span>`
  }
  const firstAvailIdx = upcoming.findIndex(l => l.available_spots > 0)
  const st = window._cardState?.[courseId]
  const selectedPassIds = st?.paymentType === 'pass' && Array.isArray(st.lessonIds) ? st.lessonIds.map(String) : []
  return upcoming.map((l, i) => {
    const label = fmtLessonPill(l.start_time)
    const full  = l.available_spots <= 0
    const lid   = String(l.lesson_id ?? l.id)
    const selByPass = interactive && selectedPassIds.length > 0 && selectedPassIds.includes(lid)
    const selSingle = interactive && st?.paymentType === 'single' && st.lessonId != null && String(st.lessonId) === lid
    const selBuyPass = interactive && st?.paymentType === 'buy-pass' && st.lessonId != null && String(st.lessonId) === lid
    const selDefault = interactive
      && (!st || st.paymentType === 'single')
      && st?.lessonId == null
      && !selectedPassIds.length
      && i === firstAvailIdx
    const sel   = selByPass || selSingle || selBuyPass || selDefault
    const borderColor = interactive
      ? (sel ? color : 'rgba(0,0,0,.08)')
      : color
    const textColor = interactive
      ? (sel ? color : '#6b6b6b')
      : color
    const bgColor = interactive
      ? 'transparent'
      : `${color}14`
    const padding = (large || !interactive) ? '6px 12px' : '3px 9px'
    const fontSize = (large || !interactive) ? '11px' : '10px'
    return `<span
      class="term-pill"
      data-lesson-id="${lid}"
      data-course-id="${courseId}"
      data-full="${full ? '1' : ''}"
      style="font-size:${fontSize};padding:${padding};border-radius:var(--btn-radius);
             background:${bgColor};
             border:${interactive && sel ? `1.5px solid ${color}` : `0.5px solid ${borderColor}`};
             color:${textColor};
             cursor:${interactive && !full ? 'pointer' : 'default'};
             ${full ? 'opacity:.5;' : ''}"
      ${interactive && !full ? `onclick="window.pickTerm(this,'${color}','${courseId}')"` : ''}
    >${label}${full ? ` (${_tp('courses.optionFullSuffix')})` : ''}</span>`
  }).join('')
}

function _ensureCardStateForCourse(courseId, upcoming) {
  const validLessonIds = new Set(upcoming.map(l => String(l.lesson_id ?? l.id)))
  const prevCard = window._cardState?.[courseId]
  if (!prevCard) {
    const owned = userPasses.filter(up => {
      if (up.entries_remaining <= 0) return false
      const ids = up.pass?.allowed_course_ids
      return !ids?.length || ids.includes(courseId)
    })
    if (owned.length) {
      window._cardState[courseId] = {
        lessonId: null,
        lessonIds: [],
        paymentType: 'pass',
        passId: owned[0].id,
      }
    } else {
      const firstAvail = upcoming.find(l => l.available_spots > 0)
      window._cardState[courseId] = {
        lessonId: firstAvail ? (firstAvail.lesson_id ?? firstAvail.id) : null,
        lessonIds: [],
        paymentType: 'single',
        passId: null,
      }
    }
  } else {
    if (prevCard.lessonId != null && !validLessonIds.has(String(prevCard.lessonId))) {
      const firstAvail = upcoming.find(l => l.available_spots > 0)
      prevCard.lessonId = firstAvail ? (firstAvail.lesson_id ?? firstAvail.id) : null
    }
    if (Array.isArray(prevCard.lessonIds) && prevCard.lessonIds.length) {
      prevCard.lessonIds = prevCard.lessonIds.filter(id => validLessonIds.has(String(id)))
    }
    window._cardState[courseId] = prevCard
  }
}

/** Sdílený blok výběru termínů, platby a CTA (detail kurzu i akordeon Kurzy). */
function _buildCourseBookingInline(course, courseId, color, upcoming, bookable, opts = {}) {
  const sectionLabel = opts.sectionLabel ?? _tp('courses.bookingSectionTitle')
  const wrapSection = !!opts.wrapSection
  const btnFullWidth = !!opts.btnFullWidth

  if (_isStaffUser() || !bookable || !upcoming.length) return ''

  const isWorkshopBundle = !!course.is_workshop && upcoming.length > 1
  const hasSpots = upcoming.some(l => l.available_spots > 0)
  if (!hasSpots) {
    return `<div style="margin-top:8px;text-align:center;font-size:12px;color:#791F1F;background:#fdeaea;padding:10px;border-radius:10px;">
      ${_escHtml(_tp('courses.allSessionsFull'))}
    </div>`
  }

  const termsInteractive = !isWorkshopBundle
  const pillsHtml = buildTermPills(upcoming, color, courseId, termsInteractive, true)

  let paymentHtml = ''
  if (!currentUser) {
    paymentHtml = `<p style="font-size:12px;color:var(--muted);margin:10px 0 0;line-height:1.55;">${_escHtml(_tp('courses.detailLoginToBook'))}</p>`
  } else if (!isWorkshopBundle) {
    paymentHtml = `
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px;">
        ${buildBuyPanel(course, color, false)}
      </div>`
  }

  const btnOnclick = isWorkshopBundle
    ? `window.openBookingPopup?.('${courseId}')`
    : `window.reserveFromCard('${courseId}')`
  const btnLabel = isWorkshopBundle
    ? _tp('booking.btn.continueToBooking')
    : _tp('booking.btn.book')
  const btnStyle = btnFullWidth
    ? `background:${color};width:100%;padding:14px;border:none;font-size:15px;font-weight:600;cursor:pointer;margin-top:14px;`
    : `background:${color};margin-top:8px;`

  const inner = `
    <div class="blbl" style="margin-bottom:8px;">${_escHtml(sectionLabel)}</div>
    ${isWorkshopBundle ? `<p style="font-size:12px;color:var(--muted);margin:0 0 10px;line-height:1.5;">${_escHtml(_tp('courses.workshopSessionsNote', { n: upcoming.length }))}</p>` : ''}
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px;">${pillsHtml}</div>
    ${paymentHtml}
    <button type="button" class="btn-res" id="res-btn-${courseId}" style="${btnStyle}"
      onclick="${btnOnclick}">
      ${_escHtml(btnLabel)}
    </button>`

  if (wrapSection) {
    return `
      <div class="detail-booking-section" style="margin-top:18px;padding:16px;border:1px solid rgba(0,0,0,.08);border-radius:12px;background:var(--surface,#fff);">
        ${inner}
      </div>`
  }
  return inner
}

function _buildKurzyAccordionBooking(course, color, upcoming, bookable) {
  if (_isStaffUser()) return ''
  const sectionLabel = _tp('courses.lessonListTitle')
  if (!bookable) {
    return `
      <div class="blbl" style="margin-bottom:8px;">${_escHtml(sectionLabel)}</div>
      <div style="font-size:12px;color:#6b6b6b;line-height:1.5;margin-top:4px;padding:10px 12px;background:#f5f5f5;border-radius:10px;">${_escHtml(_tp('courses.restrictedBookingHint'))}</div>`
  }
  if (!upcoming.length) {
    return `
      <div class="blbl" style="margin-bottom:8px;">${_escHtml(sectionLabel)}</div>
      <span style="font-size:10px;color:#9b9b9b;">${_tp('courses.noDates')}</span>`
  }
  return _buildCourseBookingInline(course, course.id, color, upcoming, bookable, { sectionLabel })
}

function buildBuyPanel(c, color, includeReserveButton = true) {
  if (_isStaffUser()) return ''
  return `
    <div class="bo bo-pay"
      id="buy-single-${c.id}"
      style="border-color:${color};border-width:1.5px;"
      data-pay-type="single" data-color="${color}" data-course-id="${c.id}"
      onclick="window.selectPayment(this,'${c.id}','single',null)">
      <div class="brow">
        <span class="bnm">${_tp('booking.payment.singleSession')}</span>
        <span style="font-size:11px;font-weight:500;color:${color};">${fmtPrice(c.price_single)}</span>
      </div>
      <div class="bsb">${_tp('booking.payment.singleSessionValidity')}</div>
    </div>
    <div id="pass-panel-${c.id}"></div>
    <div id="card-pass-count-${c.id}" style="display:none;font-size:11px;color:#6b6b6b;margin:8px 0 2px;line-height:1.45;text-align:center;"></div>
    <div id="card-msg-${c.id}" style="display:none;border-radius:8px;padding:8px 12px;font-size:11px;text-align:center;margin-top:4px;"></div>
    ${includeReserveButton ? `
    <button class="btn-res" id="res-btn-${c.id}" style="background:${color};"
      onclick="window.reserveFromCard('${c.id}')">
      ${_tp('booking.btn.continueToBooking')}
    </button>` : ''}`
}

async function fetchPassTemplatesForCourse(courseId) {
  const { data, error } = await sb
    .from('passes')
    .select('id, name, entries_total, price, validity_weeks, color_code')
    .eq('is_active', true)
    .contains('allowed_course_ids', [courseId])

  if (error) throw error
  return data ?? []
}

function buildPassPurchaseCards(passRows, courseId, color, compact = false, selectedTemplateId = null) {
  return (passRows ?? []).map(p => {
    const name = loc(p.name)
    const perEntry = fmtPrice(p.price / p.entries_total)
    const pc = passThemeHex(p.color_code)
    const selected = String(selectedTemplateId ?? '') === String(p.id)
    const compactPad = compact ? 'padding:10px 12px;' : ''
    const wrapStyle = `${compactPad}border-radius:12px;${passCardSurfaceCss(pc)}${
      selected ? `border-width:1.5px;border-color:${pc};` : ''
    }`
    return `
      <div class="bo bo-pay"
        style="${wrapStyle}"
        data-pay-type="buy-pass"
        data-color="${color}"
        data-course-id="${courseId}"
        data-buy-pass-template-id="${p.id}"
        data-buy-pass-entries="${p.entries_total}"
        data-buy-pass-price="${p.price}"
        onclick="window.selectPayment(this,'${courseId}','buy-pass','${p.id}','${p.entries_total}','${p.price}')">
        <div class="brow">
          <span class="bnm">${name}</span>
          <span style="font-size:11px;font-weight:500;color:${pc};">${fmtPrice(p.price)}</span>
        </div>
        <div class="bsb" style="margin-top:4px;">
          ${p.entries_total} ${_tp('booking.payment.entriesLabel')} · ${perEntry}/${_tp('booking.payment.perEntry')}
          <span style="display:block;margin-top:3px;color:${pc};font-weight:500;">
            ${_tp('booking.payment.passAvailableToBuy')}
          </span>
        </div>
      </div>`
  }).join('')
}

// Lazy load platebních možností při rozbalení kurzu
async function loadPassesForCourse(courseId) {
  const panel     = document.getElementById(`pass-panel-${courseId}`)
  const singleDiv = document.getElementById(`buy-single-${courseId}`)
  if (!panel) return

  const c     = window.AppState.courses.find(x => x.id === courseId)
  const color = courseThemeHex(c?.color_code)
  const prevState = window._cardState[courseId] ?? {}

  // ── 1. Aktivní permanentky uživatele platné pro tento kurz ──
  const ownedPasses = userPasses.filter(up => {
    if (up.entries_remaining <= 0) return false
    const ids = up.pass?.allowed_course_ids
    return !ids?.length || ids.includes(courseId)
  })

  if (ownedPasses.length > 0) {
    // Uživatel má permanentku → skryjeme jednorázový vstup, ukážeme pouze permanentky
    if (singleDiv) singleDiv.style.display = 'none'

    const selectedOwnedPass = ownedPasses.find(up => String(up.id) === String(prevState.passId)) ?? ownedPasses[0]
    const maxSel = _remainingEntriesOnUserPass(selectedOwnedPass?.id)
    const keptLessonIds = prevState.paymentType === 'pass' && String(prevState.passId) === String(selectedOwnedPass?.id)
      ? [...(prevState.lessonIds ?? [])].slice(0, maxSel)
      : []

    window._cardState[courseId] = {
      ...(window._cardState[courseId] ?? {}),
      paymentType: 'pass',
      passId:      selectedOwnedPass.id,
      lessonId:    null,
      lessonIds:   keptLessonIds,
      buyPassTemplateId: null,
      buyPassEntriesTotal: null,
      buyPassPrice: null,
    }

    panel.innerHTML = ownedPasses.map((up, i) => {
      const sel  = String(up.id) === String(selectedOwnedPass.id)
      const name = loc(up.pass?.name ?? {})
      const exp  = up.expires_at
        ? new Date(up.expires_at).toLocaleDateString(lang === 'cs' ? 'cs-CZ' : 'en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' })
        : null
      const pc = passThemeHex(up.pass?.color_code)
      return `
        <div class="bo bo-pay"
          style="${passCardSurfaceCss(pc)}${sel ? `border-width:1.5px;border-color:${pc};` : ''}"
          data-pay-type="pass" data-color="${color}" data-course-id="${courseId}"
          onclick="window.selectPayment(this,'${courseId}','pass','${up.id}')">
          <div class="brow">
            <span class="bnm">${name}</span>
            <span style="font-size:11px;font-weight:600;color:${pc};">${up.entries_remaining} ${_tp('booking.payment.entriesLabel')}</span>
          </div>
          <div class="bsb">${exp ? _tp('payment.validUntil', { date: exp }) : ''}</div>
        </div>`
    }).join('')
    const ids = window._cardState[courseId].lessonIds ?? []
    document.querySelectorAll(`.term-pill[data-course-id="${courseId}"]`).forEach(p => {
      if (p.dataset.full === '1') return
      const sel = ids.includes(p.dataset.lessonId)
      p.style.borderColor = sel ? color : 'rgba(0,0,0,.08)'
      p.style.borderWidth = sel ? '1.5px' : '0.5px'
      p.style.color = sel ? color : '#6b6b6b'
    })
    _refreshCardPassSlotsRow(courseId)
    _syncCardPrimaryButton(courseId)
    return
  }

  // ── 2. Uživatel nemá permanentku → ukážeme jednorázový vstup + nabídka koupě ──
  if (singleDiv) singleDiv.style.display = ''

  let data = []
  try {
    data = await fetchPassTemplatesForCourse(courseId)
  } catch (error) {
    console.warn('[loadPassesForCourse]', error)
    panel.innerHTML = ''
    return
  }

  if (!data?.length) {
    panel.innerHTML = ''
    _syncCardPrimaryButton(courseId)
    return
  }
  const selectedTemplate = prevState.paymentType === 'buy-pass' ? prevState.buyPassTemplateId : null
  if (selectedTemplate) {
    const tpl = data.find(p => String(p.id) === String(selectedTemplate))
    if (tpl) {
      window._cardState[courseId] = {
        ...prevState,
        paymentType: 'buy-pass',
        passId: null,
        lessonIds: [],
        buyPassTemplateId: tpl.id,
        buyPassEntriesTotal: tpl.entries_total,
        buyPassPrice: tpl.price,
      }
    }
  }
  panel.innerHTML = buildPassPurchaseCards(data, courseId, color, false, selectedTemplate)
  _syncCardPrimaryButton(courseId)
}

function resolveExternalStripeUrl(ctx) {
  const cfg = window.__externalStripePayments || {}
  if (ctx.kind === 'pass') {
    const m = cfg.byPassId || {}
    return m[ctx.passId] ?? m[String(ctx.passId)] ?? cfg.passDefault ?? ''
  }
  if (ctx.kind === 'lesson-single') {
    const m = cfg.byCourseId || {}
    return m[ctx.courseId] ?? m[String(ctx.courseId)] ?? cfg.singleLessonDefault ?? ''
  }
  return ''
}

function _finalizeExternalStripeUrl(url) {
  if (!url || !currentUser?.email) return url
  try {
    const u = new URL(url, window.location.href)
    if (!u.searchParams.has('prefilled_email'))
      u.searchParams.set('prefilled_email', currentUser.email)
    return u.href
  } catch {
    const sep = String(url).includes('?') ? '&' : '?'
    return `${url}${sep}prefilled_email=${encodeURIComponent(currentUser.email)}`
  }
}

function buildExternalStripePaySummary(ctx) {
  const lines = []
  if (ctx.kind === 'pass') {
    lines.push(`${_tp('payment.summaryPass')}: ${_escHtml(ctx.passTitle || '—')}`)
    lines.push(
      `${_tp('payment.summaryPrice')}: <strong>${_escHtml(fmtPrice(Number(ctx.price) || 0))}</strong>`,
    )
    if (ctx.lessonWhen) {
      lines.push(
        `${_tp('payment.summarySessionAfterPay')}: ${_escHtml(ctx.lessonWhen)}`,
      )
    }
  } else {
    lines.push(`${_tp('payment.summaryCourse')}: ${_escHtml(ctx.courseTitle || '—')}`)
    if (ctx.lessonWhen) {
      lines.push(`${_tp('payment.summarySession')}: ${_escHtml(ctx.lessonWhen)}`)
    }
    lines.push(
      `${_tp('payment.summaryPrice')}: <strong>${_escHtml(fmtPrice(Number(ctx.price) || 0))}</strong>`,
    )
  }
  return lines.map(l => `<div class="ep-line">${l}</div>`).join('')
}

window.openExternalStripePaymentModal = ctx => {
  const pop = document.getElementById('pop-external-pay')
  if (!pop) {
    console.warn('[Payment] Missing #pop-external-pay in index.html')
    return
  }
  const rawUrl = resolveExternalStripeUrl(ctx)
  const stripeUrl = rawUrl ? _finalizeExternalStripeUrl(rawUrl) : ''
  window._externalPayCtx = { ...ctx, stripeUrl, rawUrl }

  const title = document.getElementById('ep-title')
  const lead = document.getElementById('ep-lead')
  const sum = document.getElementById('ep-summary')
  const btn = document.getElementById('ep-stripe-btn')
  const warn = document.getElementById('ep-no-url')
  if (title) title.textContent = _tp('payment.externalTitle')
  if (lead) {
    lead.textContent = _tp('payment.externalLead')
  }
  if (sum) sum.innerHTML = buildExternalStripePaySummary(ctx)
  if (warn) {
    warn.style.display = stripeUrl ? 'none' : 'block'
    warn.textContent = _tp('payment.externalMissingUrl')
  }
  if (btn) {
    btn.disabled = !stripeUrl
    btn.style.background = '#635bff'
    btn.style.color = '#fff'
    btn.textContent = _tp('payment.payStripe')
  }
  const back = document.getElementById('ep-back-btn')
  if (back) back.textContent = _tp('common.back')

  const bk = document.getElementById('pop-booking')
  if (ctx.reopenBookingPopup && bk) bk.style.display = 'none'

  pop.style.display = 'flex'
}

window.confirmExternalStripePayment = () => {
  const ctx = window._externalPayCtx
  if (!ctx?.stripeUrl) {
    window.showToast?.(_tp('payment.stripeMissingToast'), 'error')
    return
  }
  window.open(ctx.stripeUrl, '_blank', 'noopener,noreferrer')
  document.getElementById('pop-external-pay').style.display = 'none'
  const pb = document.getElementById('pop-booking')
  if (pb) pb.style.display = 'none'
  window.showToast?.(_tp('payment.stripeOpenedToast'), 'ok')
  window._externalPayCtx = null
}

window.cancelExternalStripePayment = () => {
  const pop = document.getElementById('pop-external-pay')
  if (pop) pop.style.display = 'none'
  const ctx = window._externalPayCtx
  window._externalPayCtx = null
  if (ctx?.reopenBookingPopup) {
    const bk = document.getElementById('pop-booking')
    if (bk) bk.style.display = 'flex'
  }
}

/** Uživatel má aktivní permanentku vycházející ze stejné šablony (passes.id). */
function _userOwnsActivePassTemplate(templatePassId) {
  if (templatePassId == null || templatePassId === '') return false
  const want = String(templatePassId)
  return (userPasses ?? []).some(up => {
    const tid = up.pass?.id ?? up.pass_id
    return tid != null && String(tid) === want
  })
}

async function _userOwnsActivePassTemplateFresh(templatePassId) {
  if (!currentUser?.id || templatePassId == null || templatePassId === '') return false
  if (_userOwnsActivePassTemplate(templatePassId)) return true
  const { data, error } = await sb
    .from('user_passes')
    .select('id')
    .eq('user_id', currentUser.id)
    .eq('pass_id', templatePassId)
    .eq('status', 'active')
    .limit(1)
  if (error) {
    console.warn('[buyPass] duplicate pass check failed:', error)
    return _userOwnsActivePassTemplate(templatePassId)
  }
  return (data ?? []).length > 0
}

/** Obecné potvrzení, že uživatel chce nákup dokončit. */
function _confirmUserWantsToCompletePurchase({ pilot = false } = {}) {
  return window.confirm(_tp(pilot ? 'purchase.confirmPilotComplete' : 'purchase.confirmComplete'))
}

window.buyPass = async (
  passId,
  entriesTotal,
  price,
  courseId,
  btn,
  preselectedLessonId = null,
  extra = {},
) => {
  if (!currentUser) { window.openAuthPopup?.(); return }

  if (await _userOwnsActivePassTemplateFresh(passId)) {
    const ok = window.confirm(_tp('purchase.duplicatePass'))
    if (!ok) return
  }

  const priceNum = Number(price) || 0
  if (!_confirmUserWantsToCompletePurchase({ pilot: PILOT_FREE_CHECKOUT && priceNum > 0 })) return

  const originalBtnText = btn?.textContent ?? ''
  const passTitle = (extra.passTitle && String(extra.passTitle).trim()) || _tp('common.pass')
  const reopenBooking = !!extra.reopenBooking

  const les = preselectedLessonId
    ? window.AppState.upcomingLessons?.find(l => String(l.lesson_id ?? l.id) === String(preselectedLessonId))
    : null
  const lessonWhen = les?.start_time ? fmtLessonPill(les.start_time) : ''

  if (priceNum > 0 && !PILOT_FREE_CHECKOUT) {
    if (btn) btn.disabled = true
    try {
      window.openExternalStripePaymentModal?.({
        kind: 'pass',
        passId,
        passTitle,
        price: priceNum,
        lessonWhen,
        reopenBookingPopup: reopenBooking,
      })
    } finally {
      if (btn) {
        btn.disabled = false
        btn.textContent = originalBtnText || _tp('booking.btn.buyPass')
      }
      if (courseId) _syncCardPrimaryButton(courseId)
      _syncPopupPrimaryButton()
    }
    return
  }

  if (btn) { btn.disabled = true; btn.textContent = _tp('booking.btn.buying') }

  try {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + (entriesTotal + 2) * 7)

    const { error } = await sb.from('user_passes').insert({
      user_id:           currentUser.id,
      pass_id:           passId,
      entries_total:     entriesTotal,
      entries_remaining: entriesTotal,
      price_paid:        PILOT_FREE_CHECKOUT && priceNum > 0 ? 0 : price,
      expires_at:        expiresAt.toISOString(),
      status:            'active',
    })
    if (error) throw error

    await loadUserPasses(currentUser.id)
    if (courseId) {
      await loadPassesForCourse(courseId)
      const bookingPopup = document.getElementById('pop-booking')
      if (bookingPopup?.style.display === 'flex') {
        const selectedLessonId = preselectedLessonId ?? (document.getElementById('bk-lesson-select')?.value || null)
        await window.openBookingPopup?.(courseId, passId, selectedLessonId)
      }
    } else {
      window.renderProfile?.()
      if (document.getElementById('screen-permanentky')?.classList.contains('active')) {
        void renderPermanentkyShop()
      }
    }
    window.showToast?.(_tp('purchase.passPurchased'), 'ok')
  } catch (err) {
    console.error('[buyPass]', err)
    window.showToast?.(
      _tp('purchase.passPurchaseErrorPrefix') + (err.message ?? err),
      'error',
    )
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = originalBtnText || _tp('booking.btn.buyPass')
    }
    if (courseId) _syncCardPrimaryButton(courseId)
    _syncPopupPrimaryButton()
  }
}

window._buyPassShopClick = el => {
  if (!el?.dataset) return
  const id = el.dataset.buyPassId
  if (!id) return
  const total = Number(el.dataset.buyPassEntries || 0)
  const price = Number(el.dataset.buyPassPrice || 0)
  const courseRaw = el.dataset.buyPassCourse
  const courseId = courseRaw && String(courseRaw).trim() ? courseRaw : null
  const passTitle = el.dataset.buyPassTitle || ''
  void window.buyPass(id, total, price, courseId, el, null, { passTitle, reopenBooking: false })
}

window.toggleC = id => {
  void _toggleCourseAccordion(id)
}

async function _toggleCourseAccordion(id) {
  const exp  = document.getElementById('cx-' + id)
  const chev = document.getElementById('cv-' + id)
  if (!exp) return
  const wasOpen = exp.classList.contains('on')
  document.querySelectorAll('.cex').forEach(e => e.classList.remove('on'))
  document.querySelectorAll('[id^="cv-"]').forEach(e => e.textContent = '›')
  if (!wasOpen) {
    exp.classList.add('on')
    if (chev) chev.textContent = '⌄'
    await _loadPassesForExpandedKurzyCard(id)
  }
}

async function _loadPassesForExpandedKurzyCard(courseId) {
  const course = window.AppState.courses.find(c => c.id === courseId)
  if (!course || !currentUser || _isStaffUser() || !canBookCourse(course)) return
  const upcoming = window.AppState.upcomingLessons.filter(l => l.course_id === courseId)
  if (!upcoming.length || !upcoming.some(l => l.available_spots > 0)) return
  if (course.is_workshop && upcoming.length > 1) {
    _syncCardPrimaryButton(courseId)
    return
  }
  try {
    await loadPassesForCourse(courseId)
  } catch (e) {
    console.warn('[Kurzy] loadPassesForCourse:', e)
  }
  _refreshCardPassSlotsRow(courseId)
  _syncCardPrimaryButton(courseId)
}

window.toggleML = id => {
  const exp = document.getElementById('ml-cx-' + id)
  if (!exp) return
  const wasOpen = exp.classList.contains('on')
  document.querySelectorAll('.ml-cx').forEach(e => e.classList.remove('on'))
  if (!wasOpen) exp.classList.add('on')
}

window.toggleStaffArchiveSection = id => {
  const body = document.getElementById('staff-archive-' + id)
  const chev = document.getElementById('staff-archive-chev-' + id)
  if (!body) return
  const isOpen = body.style.display !== 'none'
  body.style.display = isOpen ? 'none' : 'block'
  if (chev) chev.textContent = isOpen ? '›' : '⌄'
}

function _bkBindLessonCheckboxDelegation() {
  const box = document.getElementById('bk-lesson-checkboxes')
  if (!box || box.dataset.delegBound === '1') return
  box.dataset.delegBound = '1'
  box.addEventListener('change', ev => {
    const payEl = document.getElementById('bk-payment-opts')
    const sel = payEl?.dataset.selected ?? ''
    if (!sel.startsWith('up-')) return

    const passId = sel.replace(/^up-/, '')
    const cap = _remainingEntriesOnUserPass(passId)
    const inp = ev.target
    if (inp?.name !== 'bk-lesson-cb') return

    const checked = [...box.querySelectorAll('input[name="bk-lesson-cb"]:checked')]
    if (checked.length > cap) {
      inp.checked = false
      _toastPassEntriesLimitReached()
    }
    _enforceBkLessonCheckboxCapsFromPayOpts()
    window._bkUpdateMultiBtnLabel?.()
  })
}

window._bkUpdateMultiBtnLabel = () => {
  const payEl = document.getElementById('bk-payment-opts')
  if (!(payEl?.dataset.selected ?? '').startsWith('up-')) return
  _syncPopupPrimaryButton()
  _refreshPopupPassSlotsCounter()
}


function _courseLessonsForBooking(courseId) {
  return window.AppState.upcomingLessons
    .filter(l => l.course_id === courseId && _isFutureBookableLesson(l))
    .slice()
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
}

function _workshopBundleLessons(courseId) {
  const course = window.AppState.courses.find(c => c.id === courseId)
  if (!course?.is_workshop) return null
  const lessons = _courseLessonsForBooking(courseId)
  return lessons.length > 1 ? lessons : null
}

function _isFutureBookableLesson(lesson) {
  const startTs = lesson?.start_time ? new Date(lesson.start_time).getTime() : NaN
  return Number.isFinite(startTs) && startTs > Date.now()
}

function _findFutureBookableLessonById(lessonId) {
  return window.AppState.upcomingLessons.find(l => {
    const lid = String(l.lesson_id ?? l.id)
    return lid === String(lessonId) && _isFutureBookableLesson(l)
  }) ?? null
}

function _fmtBkLessonLine(l) {
  const start = new Date(l.start_time)
  const end = new Date(l.end_time)
  return `${fmtDayFull(start)} · ${fmtTime(start)}–${fmtTime(end)}`
}

/** Při platbě permanentkou: výběr více termínů (checkboxy), jinak klasický select. */
function _syncBkLessonPicker(course, courseLessons, preselectedLessonId, preselectedLessonIds = null) {
  const payEl = document.getElementById('bk-payment-opts')
  const payVal = payEl?.dataset.selected ?? 'single'
  const singleW = document.getElementById('bk-lesson-single-wrap')
  const multiW = document.getElementById('bk-lesson-multi-wrap')
  const hint = document.getElementById('bk-multi-hint')
  const btn = document.getElementById('bk-confirm-btn')
  const color = courseThemeHex(course?.color_code)

  const isPass = payVal.startsWith('up-')
  const userPassId = isPass ? payVal.replace('up-', '') : null
  const up = userPassId ? userPasses.find(p => p.id === userPassId) : null
  const bundleLessons = !isPass && course?.id ? _workshopBundleLessons(course.id) : null

  if (bundleLessons) {
    if (singleW) singleW.style.display = 'none'
    if (multiW) multiW.style.display = 'block'
    const box = document.getElementById('bk-lesson-checkboxes')
    if (box) {
      box.innerHTML = bundleLessons.map(l => {
        const lid = String(l.lesson_id ?? l.id)
        const enrolled = isEnrolled(lid)
        const full = !enrolled && l.available_spots <= 0
        const line = _fmtBkLessonLine(l)
        if (enrolled || full) {
          const tag = enrolled ? _tp('booking.option.enrolled') : _tp('booking.option.full')
          return `<div class="bk-lesson-enrolled" style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:0.5px solid rgba(0,0,0,.06);opacity:.55;color:#9b9b9b;">
            <span style="font-size:12px;flex:1;">${_escHtml(line)}</span>
            <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:#E8EEF9;color:#2854B9;white-space:nowrap;">${_escHtml(tag)}</span>
          </div>`
        }
        return `<label style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:0.5px solid rgba(0,0,0,.06);opacity:.85;">
          <input type="checkbox" name="bk-lesson-cb" value="${lid}" checked disabled style="margin-top:3px;accent-color:${color};"/>
          <span style="font-size:12px;">${_escHtml(line)}</span>
        </label>`
      }).join('')
    }
    if (hint) {
      hint.textContent = _tp('booking.workshopBundleHint', { n: bundleLessons.length })
    }
    if (btn) btn.style.background = color
    _syncPopupPrimaryButton()
    return
  }

  if (!isPass || !up) {
    if (singleW) singleW.style.display = 'block'
    if (multiW) multiW.style.display = 'none'
    if (btn) {
      btn.style.background = color
    }
    _syncPopupPrimaryButton()
    return
  }

  if (singleW) singleW.style.display = 'none'
  if (multiW) multiW.style.display = 'block'

  const bookable = courseLessons.filter(l => {
    const lid = String(l.lesson_id ?? l.id)
    return l.available_spots > 0 && !isEnrolled(lid)
  })

  const box = document.getElementById('bk-lesson-checkboxes')
  _bkBindLessonCheckboxDelegation()

  const preSet = new Set(
    Array.isArray(preselectedLessonIds) && preselectedLessonIds.length
      ? preselectedLessonIds.map(String)
      : (preselectedLessonId != null ? [String(preselectedLessonId)] : []),
  )

  if (box) {
    box.innerHTML = courseLessons.length
      ? courseLessons.map(l => {
          const lid = String(l.lesson_id ?? l.id)
          const enrolled = isEnrolled(lid)
          if (enrolled) {
            return `<div class="bk-lesson-enrolled" style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:0.5px solid rgba(0,0,0,.06);opacity:.55;color:#9b9b9b;">
              <span style="font-size:12px;flex:1;">${_fmtBkLessonLine(l)}</span>
              <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:#E8EEF9;color:#2854B9;white-space:nowrap;">${_escHtml(_tp('common.enrolled'))}</span>
            </div>`
          }
          const checked = preSet.has(lid) ? ' checked' : ''
          return `<label style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:0.5px solid rgba(0,0,0,.06);cursor:pointer;">
            <input type="checkbox" name="bk-lesson-cb" value="${lid}"${checked} style="margin-top:3px;accent-color:${color};"/>
            <span style="font-size:12px;">${_fmtBkLessonLine(l)} <span style="color:#6b6b6b;">(${_tp('booking.option.spotsSuffix', { n: l.available_spots })})</span></span>
          </label>`
        }).join('')
      : `<div style="font-size:12px;color:#9b9b9b;">${_escHtml(_tp('booking.empty.noScheduledSessions'))}</div>`
  }

  if (hint) {
    const cap = Number(up.entries_remaining ?? 0) || 0
    hint.textContent = _tp('booking.multiHint', {
      max: cap,
      sessionsWord: _multiSessionsWord(cap),
    })
  }

  if (btn) btn.style.background = color

  const cap = Math.max(0, Number(up?.entries_remaining ?? 0) || 0)
  if (box && up && bookable.length) {
    const checkedInputs = [...box.querySelectorAll('input[name="bk-lesson-cb"]:checked')]
    if (checkedInputs.length > cap) {
      checkedInputs.slice(cap).forEach(inp => { inp.checked = false })
      _toastPassEntriesLimitReached()
    }
    _enforceBkLessonCheckboxCapsFromPayOpts()
  }

  _syncPopupPrimaryButton()
}

// ── Booking popup ─────────────────────────────────────────────
window.openBookingPopup = async (courseId, passId, preselectedLessonId, preferredPayValue = null, preselectedLessonIds = null) => {
  const cardSt = window._cardState?.[courseId]
  if (preselectedLessonId == null && cardSt) {
    if (cardSt.paymentType === 'single' || cardSt.paymentType === 'buy-pass') {
      preselectedLessonId = cardSt.lessonId ?? null
    }
  }
  if (preferredPayValue == null) {
    preferredPayValue = _preferredPayFromCardState(cardSt)
  }
  if (preselectedLessonIds == null && cardSt?.paymentType === 'pass' && cardSt.passId) {
    preselectedLessonIds = Array.isArray(cardSt.lessonIds) ? cardSt.lessonIds : []
  }

  if (!currentUser) {
    const course = window.AppState.courses.find(c => c.id === courseId)
    saveBookingReturn({
      courseId,
      lessonId: preselectedLessonId ?? cardSt?.lessonId ?? null,
      lessonIds: preselectedLessonIds ?? cardSt?.lessonIds ?? null,
      paymentType: cardSt?.paymentType ?? null,
      passId: cardSt?.passId ?? null,
      buyPassTemplateId: cardSt?.buyPassTemplateId ?? null,
      preferredPayValue: preferredPayValue ?? _preferredPayFromCardState(cardSt),
      openBooking: true,
    })
    const les = preselectedLessonId
      ? window.AppState.upcomingLessons?.find(l => String(l.lesson_id ?? l.id) === String(preselectedLessonId))
      : null
    window.openAuthPopup?.({
      courseTitle: course ? loc(course.title) : '',
      lessonDate: les?.start_time ? fmtLessonPill(les.start_time) : '',
      courseId,
    })
    return
  }
  if (_isStaffUser()) {
    window.showToast?.(_staffBookingDisabledMessage(), 'error')
    return
  }

  const course = window.AppState.courses.find(c => c.id === courseId)
  if (!course) return
  if (!canBookCourse(course)) {
    window.showToast?.(_tp('courses.cannotBookRestricted'), 'error')
    return
  }
  const color = courseThemeHex(course.color_code)

  if (preselectedLessonId && !_findFutureBookableLessonById(preselectedLessonId)) {
    window.showToast?.(_tp('booking.toast.sessionNoLongerAvailable'), 'error')
    await fetchUpcomingLessons()
    renderKurzy()
    renderKalendar()
    return
  }

  const popup = document.getElementById('pop-booking')
  if (!popup) return

  const bar = document.getElementById('bk-bar')
  if (bar) bar.style.background = color

  const nameEl = document.getElementById('bk-name')
  if (nameEl) nameEl.textContent = loc(course.title)

  const courseLessons = _courseLessonsForBooking(courseId)
  const lessonSel = document.getElementById('bk-lesson-select')
  if (lessonSel) {
    if (courseLessons.length) {
      const selectable = courseLessons.filter(l => {
        const lid = String(l.lesson_id ?? l.id)
        return !isEnrolled(lid) && l.available_spots > 0
      })
      lessonSel.innerHTML = courseLessons.map(l => {
        const lid   = String(l.lesson_id ?? l.id)
        const enrolled = isEnrolled(lid)
        const full = !enrolled && l.available_spots <= 0
        const line = _fmtBkLessonLine(l)
        if (enrolled) {
          return `<option value="" disabled>${line} · ${_escHtml(_tp('booking.option.enrolled'))}</option>`
        }
        if (full) {
          return `<option value="" disabled>${line} · ${_escHtml(_tp('booking.option.full'))}</option>`
        }
        const selected = String(lid) === String(preselectedLessonId ?? '') ? 'selected' : ''
        return `<option value="${lid}" ${selected}>${line} (${_tp('booking.option.spotsSuffix', { n: l.available_spots })})</option>`
      }).join('')
      if (!selectable.length && !preselectedLessonId) {
        lessonSel.innerHTML = `<option value="">${_escHtml(_tp('booking.empty.noFreeSlotsOption'))}</option>` + lessonSel.innerHTML
      }
    } else {
      lessonSel.innerHTML = `<option value="">${_escHtml(_tp('booking.empty.noSlotsToBook'))}</option>`
    }
  }

  // Platební možnosti: jednorázový vstup + permanentky platné pro tento kurz
  const activePasses = userPasses.filter(up => {
    if (up.entries_remaining <= 0) return false
    const ids = up.pass?.allowed_course_ids
    return !ids?.length || ids.includes(courseId)
  })
  let purchasablePasses = []
  if (activePasses.length === 0) {
    try {
      purchasablePasses = await fetchPassTemplatesForCourse(courseId)
    } catch (err) {
      console.warn('[Booking popup] passes:', err)
    }
  }
  const preselectedUp = passId
    ? activePasses.find(up => up.pass?.id === passId || up.id === passId)
    : null
  const defaultPass = preselectedUp || activePasses[0] || null
  const allowSinglePayment = activePasses.length === 0
  const preferred = String(preferredPayValue ?? '').trim()
  const preferredIsOwnedPass = preferred.startsWith('up-')
    && activePasses.some(up => String(up.id) === preferred.replace(/^up-/, ''))
  const preferredIsBuyPass = preferred.startsWith('tpl-')
    && activePasses.length === 0
    && purchasablePasses.some(p => String(p.id) === preferred.replace(/^tpl-/, ''))
  const preferredIsSingle = preferred === 'single' && allowSinglePayment
  const defaultPay = preferredIsOwnedPass
    ? preferred
    : (preferredIsBuyPass
        ? preferred
        : (preferredIsSingle ? 'single' : (defaultPass ? `up-${defaultPass.id}` : 'single')))

  const workshopBundlePay = _workshopBundleLessons(courseId)
  const singlePayTitle = workshopBundlePay
    ? loc(course.title)
    : _tp('booking.payment.singleSession')

  const payEl = document.getElementById('bk-payment-opts')
  if (payEl) {
    payEl.dataset.selected  = defaultPay
    payEl.dataset.color     = color
    payEl.dataset.courseid  = courseId
    payEl.dataset.singleAllowed = allowSinglePayment ? '1' : '0'
    payEl.innerHTML = `
      ${allowSinglePayment ? `
        <label class="bk-opt ${defaultPay === 'single' ? 'bk-opt-sel' : ''}"
               data-accent-color="${color}"
               style="${defaultPay === 'single' ? `border-color:${color};border-width:1.5px;` : ''}"
               onclick="window._bkSelectPayment(this,'single')">
          <div class="bk-opt-radio ${defaultPay === 'single' ? 'on' : ''}"
               style="border-color:${color};${defaultPay === 'single' ? `background:${color};` : ''}"></div>
          <div style="flex:1;">
            <div class="bnm">${_escHtml(singlePayTitle)}</div>
            <div class="bsb">${fmtPrice(course.price_single)}</div>
          </div>
        </label>
      ` : ''}
      ${activePasses.map(up => {
        const sel = defaultPay === `up-${up.id}`
        const pc = passThemeHex(up.pass?.color_code)
        return `
          <label class="bk-opt ${sel ? 'bk-opt-sel' : ''}"
                 data-accent-color="${pc}"
                 style="${passCardSurfaceCss(pc)}${sel ? `border-color:${pc};border-width:1.5px;` : ''}"
                 onclick="window._bkSelectPayment(this,'up-${up.id}')">
            <div class="bk-opt-radio ${sel ? 'on' : ''}"
                 style="border-color:${pc};${sel ? `background:${pc};` : ''}"></div>
            <div style="flex:1;">
              <div class="bnm">${loc(up.pass?.name ?? {})}</div>
              <div class="bsb">${_tp('booking.payment.entriesLeft', { n: up.entries_remaining })}</div>
            </div>
          </label>`
      }).join('')}
      ${activePasses.length === 0 ? purchasablePasses.map(p => {
        const sel = defaultPay === `tpl-${p.id}`
        const perEntry = fmtPrice(p.price / p.entries_total)
        const pc = passThemeHex(p.color_code)
        return `
          <label class="bk-opt ${sel ? 'bk-opt-sel' : ''}"
                 data-accent-color="${pc}"
                 style="${passCardSurfaceCss(pc)}${sel ? `border-color:${pc};border-width:1.5px;` : ''}"
                 data-buy-pass-template-id="${p.id}"
                 data-buy-pass-entries="${p.entries_total}"
                 data-buy-pass-price="${p.price}"
                 onclick="window._bkSelectPayment(this,'tpl-${p.id}')">
            <div class="bk-opt-radio ${sel ? 'on' : ''}"
                 style="border-color:${pc};${sel ? `background:${pc};` : ''}"></div>
            <div style="flex:1;">
              <div class="bnm">${loc(p.name)}</div>
              <div class="bsb">
                ${p.entries_total} ${_tp('booking.payment.entriesLabel')} · ${perEntry}/${_tp('booking.payment.perEntry')}
                <span style="display:block;margin-top:3px;color:${pc};font-weight:500;">
                  ${_tp('booking.payment.passAvailableToBuy')}
                </span>
              </div>
            </div>
          </label>`
      }).join('') : ''}
    `
  }

  const buyPanel = document.getElementById('bk-pass-buy-panel')
  if (buyPanel) {
    buyPanel.style.display = 'none'
    buyPanel.innerHTML = ''
  }

  const confirmBtn = document.getElementById('bk-confirm-btn')
  if (confirmBtn) {
    confirmBtn.style.background = color
    confirmBtn.disabled = false
  }

  _bindBkLessonSelectPrimaryLabelSync()

  _syncBkLessonPicker(
    course,
    _courseLessonsForBooking(courseId),
    preselectedLessonId,
    preselectedLessonIds,
  )

  popup.style.display = 'flex'
}

window._bkSelectPayment = (el, value) => {
  const payEl = document.getElementById('bk-payment-opts')
  if (!payEl) return
  const courseFallback = courseThemeHex(payEl.dataset.color)
  payEl.dataset.selected = value
  payEl.querySelectorAll('.bk-opt').forEach(o => {
    o.classList.remove('bk-opt-sel')
    const accent = o.dataset.accentColor || courseFallback
    o.style.borderColor = /^#[0-9A-Fa-f]{6}$/.test(accent) ? `${accent}55` : ''
    o.style.borderWidth = '1px'
  })
  payEl.querySelectorAll('.bk-opt-radio').forEach(r => {
    r.classList.remove('on')
    const label = r.closest('.bk-opt')
    const acc = label?.dataset.accentColor || courseFallback
    r.style.borderColor = acc
    r.style.background = acc && /^#[0-9A-Fa-f]{6}$/.test(acc) ? 'transparent' : ''
  })
  el.classList.add('bk-opt-sel')
  const accent = el.dataset.accentColor || courseFallback
  el.style.borderColor = accent
  el.style.borderWidth = '1.5px'
  const radio = el.querySelector('.bk-opt-radio')
  if (radio) {
    radio.classList.add('on')
    radio.style.borderColor = accent
    radio.style.background = accent
  }

  const courseId = payEl.dataset.courseid
  const course = window.AppState.courses.find(c => c.id === courseId)
  const st = window._cardState?.[courseId]
  const selVal = document.getElementById('bk-lesson-select')?.value || ''
  const preLesson = selVal || st?.lessonId || null
  const preIds = value.startsWith('up-') && st?.lessonIds?.length ? st.lessonIds : null
  _syncBkLessonPicker(course, _courseLessonsForBooking(courseId), preLesson, preIds)
}

window.confirmBooking = async () => {
  if (!currentUser?.id) { window.openAuthPopup?.(); return }
  if (_isStaffUser()) {
    window.showToast?.(_staffBookingDisabledMessage(), 'error')
    return
  }

  const confirmBtn = document.getElementById('bk-confirm-btn')
  if (confirmBtn?.disabled) return

  const payEl    = document.getElementById('bk-payment-opts')
  const payVal   = payEl?.dataset.selected ?? 'single'
  const courseId = payEl?.dataset.courseid
  const course   = window.AppState.courses.find(c => c.id === courseId)
  const singleAllowed = payEl?.dataset.singleAllowed !== '0'

  if (course && !canBookCourse(course)) {
    window.showToast?.(_tp('courses.cannotBookRestricted'), 'error')
    resetBtn()
    return
  }

  const isPass     = payVal.startsWith('up-')
  const isBuyPass  = payVal.startsWith('tpl-')
  const userPassId = isPass ? payVal.replace('up-', '') : null
  const buyPassMetaEl = isBuyPass ? payEl?.querySelector('.bk-opt-sel[data-buy-pass-template-id]') : null
  const buyPassTemplateId = isBuyPass ? payVal.replace('tpl-', '') : null
  const buyPassEntriesTotal = Number(buyPassMetaEl?.dataset.buyPassEntries ?? 0)
  const buyPassPrice = Number(buyPassMetaEl?.dataset.buyPassPrice ?? 0)
  const pricePaid  = isPass ? 0 : (course?.price_single ?? 0)
  if (!isPass && !isBuyPass && !singleAllowed) {
    window.showToast?.(_tp('booking.toast.singleUnavailableWithPass'), 'error')
    return
  }
  if (isBuyPass) {
    const selectedLessonId = document.getElementById('bk-lesson-select')?.value || null
    if (!buyPassTemplateId || !buyPassEntriesTotal) {
      window.showToast?.(_tp('booking.toast.selectValidPass'), 'error')
      return
    }
    const passTitle = buyPassMetaEl?.querySelector('.bnm')?.textContent?.trim() || ''
    await window.buyPass?.(
      buyPassTemplateId,
      buyPassEntriesTotal,
      buyPassPrice,
      courseId,
      confirmBtn,
      selectedLessonId,
      { passTitle, reopenBooking: true },
    )
    return
  }

  /** Obnoví text tlačítka podle aktuálního režimu výběru. */
  const resetBtn = () => {
    if (!confirmBtn) return
    confirmBtn.disabled = false
    confirmBtn.style.pointerEvents = ''
    _syncPopupPrimaryButton()
  }

  let lessonIds = []
  const bundleLessons = !isPass && !isBuyPass ? _workshopBundleLessons(courseId) : null
  if (isPass && userPassId) {
    lessonIds = [...document.querySelectorAll('#bk-lesson-checkboxes input[name="bk-lesson-cb"]:checked')].map(cb => cb.value)
    if (!lessonIds.length) {
      window.showToast?.(_tp('booking.toast.selectAtLeastOne'), 'error')
      return
    }
  } else if (bundleLessons) {
    const bookable = bundleLessons.filter(l => {
      const lid = String(l.lesson_id ?? l.id)
      return l.available_spots > 0 && !isEnrolled(lid)
    })
    if (bookable.length !== bundleLessons.length) {
      window.showToast?.(_tp('booking.toast.workshopFull'), 'error')
      resetBtn()
      return
    }
    lessonIds = bookable.map(l => String(l.lesson_id ?? l.id))
  } else {
    const lessonId = document.getElementById('bk-lesson-select')?.value
    if (!lessonId) {
      window.showToast?.(_tp('booking.toast.selectSession'), 'error')
      return
    }
    lessonIds = [lessonId]
  }

  const selectedLessons = lessonIds.map(lid => _findFutureBookableLessonById(lid))
  if (selectedLessons.some(l => !l)) {
    window.showToast?.(_tp('booking.toast.sessionNoLongerAvailable'), 'error')
    await Promise.all([fetchUpcomingLessons(), fetchLessons()])
    _syncBkLessonPicker(course, _courseLessonsForBooking(courseId), null)
    renderKurzy()
    renderKalendar()
    return
  }

  const priceNum = Number(pricePaid) || 0
  if (!isPass && !isBuyPass && priceNum > 0) {
    if (!_confirmUserWantsToCompletePurchase({ pilot: PILOT_FREE_CHECKOUT })) return
    if (!PILOT_FREE_CHECKOUT) {
      const courseTitle = loc(course?.title) || ''
      const lessonWhen = selectedLessons.length > 1
        ? selectedLessons.map(l => l.start_time ? fmtLessonPill(l.start_time) : '').filter(Boolean).join(', ')
        : (selectedLessons[0]?.start_time ? fmtLessonPill(selectedLessons[0].start_time) : '')
      window.openExternalStripePaymentModal?.({
        kind: 'lesson-single',
        courseId,
        courseTitle,
        price: priceNum,
        lessonWhen,
        lessonIds,
        reopenBookingPopup: true,
      })
      return
    }
  }

  console.log('[Booking] Popup reserve start', { lessonIds, payVal, courseId })
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.style.pointerEvents = 'none'; confirmBtn.textContent = _tp('booking.btn.booking') }

  try {
    if (isPass && userPassId) {
      const passRow = userPasses.find(p => p.id === userPassId)
      if (!passRow || passRow.entries_remaining < lessonIds.length) {
        window.showToast?.(_tp('booking.toast.passEntriesLimitReached'), 'error')
        resetBtn()
        return
      }
      const allowed = passRow.pass?.allowed_course_ids
      for (const lid of lessonIds) {
        const les = _findFutureBookableLessonById(lid)
        if (!les || les.available_spots <= 0 || isEnrolled(lid)) {
          window.showToast?.(_tp('booking.toast.sessionNoLongerAvailable'), 'error')
          resetBtn()
          return
        }
        if (allowed?.length && !allowed.includes(les.course_id)) {
          window.showToast?.(_tp('booking.toast.passNotForCourse'), 'error')
          resetBtn()
          return
        }
      }
      for (const lesson_id of lessonIds) {
        const { error } = await sb.from('bookings').insert({
          user_id:      currentUser.id,
          lesson_id,
          payment_type: 'pass',
          price_paid:   0,
          status:       PARTICIPATION_STATUS.CONFIRMED,
          user_pass_id: userPassId,
        })
        if (error) throw error
      }
    } else {
      const isWorkshopBundle = !!bundleLessons && lessonIds.length > 1
      for (let i = 0; i < lessonIds.length; i++) {
        const lesson_id = lessonIds[i]
        const paid = isWorkshopBundle
          ? (i === 0 ? (PILOT_FREE_CHECKOUT && priceNum > 0 ? 0 : pricePaid) : 0)
          : (PILOT_FREE_CHECKOUT && priceNum > 0 ? 0 : pricePaid)
        const { error } = await sb.from('bookings').insert({
          user_id:      currentUser.id,
          lesson_id,
          payment_type: 'single',
          price_paid:   paid,
          status:       PARTICIPATION_STATUS.CONFIRMED,
        })
        if (error) throw error
      }
    }

    console.log('[Booking] Popup rezervace úspěšná', lessonIds)
    document.getElementById('pop-booking').style.display = 'none'
    const n = lessonIds.length
    const isWorkshopBundleDone = !!bundleLessons && n > 1 && !isPass
    window.showToast?.(
      isWorkshopBundleDone
        ? _tp('booking.success.workshop', { n })
        : (n > 1 ? _tp('booking.success.many', { n }) : _tp('booking.success.one')),
      'ok',
    )

    await Promise.all([fetchUpcomingLessons(), fetchLessons()])
    renderKurzy()
    renderKalendar()
    window.refreshUserBookings?.()
  } catch (err) {
    console.error('[Booking] Popup rezervace selhala:', err)
    window.showToast?.(_tp('booking.toast.errorPrefix') + (err.message ?? err), 'error')
  } finally {
    resetBtn()
  }
}

// ── Galerie + lightbox (fotky z courses.images) ───────────────
function ensureCourseGalleryLightbox() {
  if (document.getElementById('course-gallery-lightbox')) {
    const cbtn = document.getElementById('course-gallery-lb-close')
    if (cbtn) cbtn.textContent = _tp('common.close')
    return
  }
  document.body.insertAdjacentHTML('beforeend', `
    <div id="course-gallery-lightbox" class="course-gallery-lb" style="display:none;" role="dialog" aria-modal="true">
      <button type="button" class="course-gallery-lb-close" id="course-gallery-lb-close">${_escHtml(_tp('common.close'))}</button>
      <div class="course-gallery-lb-shell">
        <button type="button" class="course-gallery-lb-arrow course-gallery-lb-prev" id="course-gallery-lb-prev" aria-label="${_escHtml(_tp('courses.galleryPrev'))}">‹</button>
        <div class="course-gallery-lb-imgwrap"><img id="course-gallery-lb-img" class="course-gallery-lb-img" alt="" /></div>
        <button type="button" class="course-gallery-lb-arrow course-gallery-lb-next" id="course-gallery-lb-next" aria-label="${_escHtml(_tp('courses.galleryNext'))}">›</button>
      </div>
    </div>`)

  const root = document.getElementById('course-gallery-lightbox')
  const shell = root?.querySelector('.course-gallery-lb-shell')
  const img = document.getElementById('course-gallery-lb-img')
  document.getElementById('course-gallery-lb-close')?.addEventListener('click', e => {
    e.stopPropagation()
    window.closeCourseGalleryLightbox?.()
  })
  shell?.addEventListener('click', e => { e.stopPropagation() })
  root?.addEventListener('click', () => window.closeCourseGalleryLightbox?.())

  const sync = () => {
    const st = window._courseLbState
    const urls = st?.urls ?? []
    if (!urls.length || !img) return
    let i = Number(st.index) || 0
    i = ((i % urls.length) + urls.length) % urls.length
    st.index = i
    img.src = urls[i]
    const multi = urls.length >= 2
    const pv = document.getElementById('course-gallery-lb-prev')
    const nx = document.getElementById('course-gallery-lb-next')
    if (pv) { pv.hidden = !multi; pv.style.visibility = multi ? '' : 'hidden' }
    if (nx) { nx.hidden = !multi; nx.style.visibility = multi ? '' : 'hidden' }
  }
  window._courseLbSync = sync

  document.getElementById('course-gallery-lb-prev')?.addEventListener('click', e => {
    e.stopPropagation()
    if (window._courseLbState) window._courseLbState.index = (window._courseLbState.index || 0) - 1
    sync()
  })
  document.getElementById('course-gallery-lb-next')?.addEventListener('click', e => {
    e.stopPropagation()
    if (window._courseLbState) window._courseLbState.index = (window._courseLbState.index || 0) + 1
    sync()
  })
}

window._courseGalleryKb = (e) => {
  const root = document.getElementById('course-gallery-lightbox')
  if (!root || root.style.display === 'none') return
  if (e.key === 'Escape') window.closeCourseGalleryLightbox?.()
  if (!window._courseLbState?.urls?.length) return
  if (e.key === 'ArrowLeft') {
    window._courseLbState.index = (window._courseLbState.index || 0) - 1
    window._courseLbSync?.()
  }
  if (e.key === 'ArrowRight') {
    window._courseLbState.index = (window._courseLbState.index || 0) + 1
    window._courseLbSync?.()
  }
}

window.openCourseGalleryLightbox = (courseId, startIdx) => {
  ensureCourseGalleryLightbox()
  const urls = window.__courseGalleryById?.[courseId]
  if (!urls?.length) return
  let idx = Number(startIdx)
  if (!Number.isFinite(idx)) idx = 0
  idx = Math.max(0, Math.min(idx, urls.length - 1))
  window._courseLbState = { urls: [...urls], index: idx }
  const root = document.getElementById('course-gallery-lightbox')
  if (root) root.style.display = 'flex'
  document.body.style.overflow = 'hidden'
  window._courseLbSync?.()
  document.addEventListener('keydown', window._courseGalleryKb, true)
}

window.closeCourseGalleryLightbox = () => {
  const root = document.getElementById('course-gallery-lightbox')
  if (root) root.style.display = 'none'
  document.body.style.overflow = ''
  document.removeEventListener('keydown', window._courseGalleryKb, true)
}

function _buildDetailBookingSection(course, courseId, color, upcoming, bookable) {
  return _buildCourseBookingInline(course, courseId, color, upcoming, bookable, {
    wrapSection: true,
    btnFullWidth: true,
  })
}

// ── Otevření detailu kurzu ────────────────────────────────────
window.openDetail = async (courseId) => {
  try {
    await window.refreshPublicData?.()
  } catch (e) {
    console.warn('[App] openDetail refresh:', e)
  }
  const course = window.AppState?.courses?.find(c => c.id === courseId)
  if (!course) {
    window.showToast?.(_tp('courses.notAvailable'), 'error')
    window.nav?.('kurzy')
    return
  }
  window._detailCourseId = courseId
  window.nav?.('detail-kurzu')
}

async function renderCourseDetail(courseId) {
  const el = document.getElementById('detail-kurzu-content')
  if (!el) return
  const course = window.AppState.courses.find(c => c.id === courseId)
  if (!course) { el.innerHTML = `<div class="empty">${_tp('courses.notAvailable')}</div>`; return }

  const color     = courseThemeHex(course.color_code)
  const title     = loc(course.title)
  const descShort = loc(course.description_short)
  const descLong  = loc(course.description_long)
  const descLongBlock = _formatCourseDetailLong(descLong)
  const imageUrls = courseImageUrls(course)
  const ownerName = Array.isArray(course.owner) ? course.owner[0]?.name : course.owner?.name
  const upcoming  = window.AppState.upcomingLessons.filter(l => l.course_id === courseId)
  const isWorkshopBundle = !!course.is_workshop && upcoming.length > 1
  const priceSuffix = isWorkshopBundle ? _tp('courses.perWorkshop') : _tp('courses.perSession')
  const bookable = canBookCourse(course)
  const restricted = !!course.is_restricted

  _ensureCardStateForCourse(courseId, upcoming)

  const DAYS_CS = ['Po','Út','St','Čt','Pá','So','Ne']
  const scheduleDays = (course.schedule_days ?? []).map(d => DAYS_CS[d]).join(', ')
  const durMin = _calcDurMin(course.schedule_time_start, course.schedule_time_end)

  let passes = []
  try {
    const res = await sb
      .from('passes')
      .select('id, name, price, entries_total, color_code')
      .eq('is_active', true)
      .contains('allowed_course_ids', [courseId])
    if (res.error) console.warn('[Debug] Detail kurzu — passes:', res.error)
    passes = res?.data ?? []
  } catch (e) {
    console.warn('[Debug] Detail kurzu — permanentky (chyba), pokračuji bez seznamu permanentek:', e?.message)
    console.dir(e, { depth: null })
  }

  window.__courseGalleryById ??= {}
  window.__courseGalleryById[courseId] = imageUrls

  const heroImg = imageUrls[0] ?? null
  const galleryThumbUrls = imageUrls.length > 1 ? imageUrls.slice(1) : []
  const backTarget = _isStaffUser() ? 'admin-kurzy' : 'kurzy'

  el.innerHTML = `
    <div style="max-width:760px;">
      <button class="btn-wide" onclick="window.nav?.('${backTarget}')" style="margin-bottom:16px;">
        ‹ ${_tp('courses.backToCourses')}
      </button>
      <div style="height:4px;background:${color};border-radius:99px;margin-bottom:16px;"></div>

      ${heroImg
        ? `<img src="${heroImg}" class="detail-hero" alt="${title}" />`
        : `<div class="detail-hero-ph">${_escHtml(_tp('courses.photoAlt'))}</div>`}

      <div style="font-size:22px;font-weight:700;margin-bottom:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${title}${restricted ? ` ${_restrictedBadgeHtml()}` : ''}</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:12px;">
        ${ownerName ?? '—'}${scheduleDays ? ' · ' + scheduleDays : ''}
      </div>

      ${restricted && !bookable && !_isStaffUser()
        ? `<div style="font-size:13px;color:#2854B9;background:#E8EEF8;padding:12px 14px;border-radius:10px;margin-bottom:16px;line-height:1.55;">${_escHtml(_tp('courses.restrictedBookingHint'))}</div>`
        : ''}

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">
        ${durMin ? `<span style="font-size:12px;padding:5px 10px;border-radius:var(--btn-radius);background:var(--muted-surface);">${durMin} min</span>` : ''}
        <span style="font-size:12px;padding:5px 10px;border-radius:var(--btn-radius);background:var(--muted-surface);">${course.capacity_default} ${_tp('courses.capacitySpots')}</span>
        ${upcoming.length ? `<span style="font-size:12px;padding:5px 10px;border-radius:var(--btn-radius);background:#eaf5ea;color:#085041;">${upcoming[0].available_spots} ${_tp('courses.spotsFree')}</span>` : ''}
        <span style="font-size:12px;padding:5px 10px;border-radius:var(--btn-radius);background:var(--primary-100);color:var(--primary);font-weight:600;">${fmtPrice(course.price_single)} / ${priceSuffix}</span>
      </div>

      ${isWorkshopBundle && !(!_isStaffUser() && bookable && upcoming.length)
        ? `<p style="font-size:13px;color:var(--muted);margin:0 0 12px;line-height:1.5;">${_escHtml(_tp('courses.workshopSessionsNote', { n: upcoming.length }))}</p>`
        : ''}
      ${descShort ? `<p class="detail-course-annotation${descLongBlock ? ' is-before-long-desc' : ''}">${descShort}</p>` : ''}
      ${descLongBlock ? `<div style="font-size:14px;line-height:1.75;margin-bottom:${descLongBlock ? '20' : '16'}px;">${descLongBlock}</div>` : ''}

      <div class="detail-info-table">
        <div class="detail-info-row"><span class="lbl">${_tp('courses.instructor')}</span><span class="val">${ownerName ?? '—'}</span></div>
        ${scheduleDays ? `<div class="detail-info-row"><span class="lbl">${_tp('courses.scheduleLabel')}</span><span class="val">${scheduleDays}</span></div>` : ''}
        ${(passes ?? []).map(p => {
          const pc = passThemeHex(p.color_code)
          return `<div class="detail-info-row" style="border-left:4px solid ${pc};background:${pc}12;padding-left:12px;">
            <span class="lbl">${loc(p.name)}</span><span class="val" style="color:${pc};">${fmtPrice(p.price)}</span>
          </div>`
        }).join('')}
        <div class="detail-info-row"><span class="lbl">${_tp('courses.freeCancellation')}</span><span class="val">${course.cancellation_hours}h ${_tp('courses.ahead')}</span></div>
      </div>

      ${galleryThumbUrls.length ? `
        <div class="detail-gallery-section">
          <div class="blbl" style="margin-bottom:10px;">${_tp('courses.gallery')}</div>
          <div class="detail-gallery-grid">
            ${galleryThumbUrls.map((u, thumbIdx) => {
              const fullIdx = thumbIdx + 1
              return `
              <button type="button" class="detail-gallery-cell"
                aria-label="${_escHtml(_tp('courses.enlargePhoto'))} ${fullIdx}"
                onclick="window.openCourseGalleryLightbox?.('${courseId}', ${fullIdx})">
                <span class="detail-gallery-cell-frame"><img src="${u}" alt="" loading="lazy" /></span>
              </button>`
            }).join('')}
          </div>
        </div>` : ''}

      ${_buildDetailBookingSection(course, courseId, color, upcoming, bookable)}
    </div>`

  _refreshCardPassSlotsRow(courseId)
  if (!_isStaffUser() && bookable && upcoming.length && upcoming.some(l => l.available_spots > 0)) {
    const bundle = !!course.is_workshop && upcoming.length > 1
    if (currentUser && !bundle) {
      try {
        await loadPassesForCourse(courseId)
      } catch (e) {
        console.warn('[renderCourseDetail] loadPassesForCourse:', e)
      }
    }
    _syncCardPrimaryButton(courseId)
  }
}

window.pickTerm = (el, color, courseId) => {
  const st = window._cardState[courseId] ?? {}
  const lid = el.dataset.lessonId

  if (st.paymentType === 'pass' && st.passId) {
    const arr = Array.isArray(st.lessonIds) ? [...st.lessonIds] : []
    const i = arr.indexOf(lid)
    if (i >= 0) arr.splice(i, 1)
    else {
      const maxSel = _remainingEntriesOnUserPass(st.passId)
      if (arr.length >= maxSel) {
        _toastPassEntriesLimitReached()
        return
      }
      arr.push(lid)
    }
    window._cardState[courseId] = { ...st, lessonIds: arr, lessonId: null }

    document.querySelectorAll(`.term-pill[data-course-id="${courseId}"]`).forEach(p => {
      const id = p.dataset.lessonId
      const sel = arr.includes(id)
      if (p.dataset.full === '1') return
      p.style.borderColor = sel ? color : 'rgba(0,0,0,.08)'
      p.style.borderWidth = sel ? '1.5px' : '0.5px'
      p.style.color = sel ? color : '#6b6b6b'
    })
    const btn = document.getElementById(`res-btn-${courseId}`)
    const n = arr.length
    if (btn) {
      btn.textContent = n ? _tp('booking.btn.bookSelected', { n }) : _tp('booking.btn.book')
    }
    _refreshCardPassSlotsRow(courseId)
    _refreshCardPassSlotsRow(courseId)
    return
  }

  document.querySelectorAll(`.term-pill[data-course-id="${courseId}"]`).forEach(s => {
    s.style.borderColor = 'rgba(0,0,0,.08)'
    s.style.borderWidth = '0.5px'
    s.style.color       = '#6b6b6b'
  })
  el.style.borderColor = color
  el.style.borderWidth = '1.5px'
  el.style.color       = color
  window._cardState[courseId] = window._cardState[courseId] ?? {}
  window._cardState[courseId].lessonId = lid
}

window.selectPayment = (el, courseId, type, passId, buyEntries = null, buyPrice = null) => {
  const color = courseThemeHex(el.dataset.color)
  document.querySelectorAll(`.bo-pay[data-course-id="${courseId}"]`).forEach(b => {
    b.style.borderColor = 'rgba(0,0,0,.12)'
    b.style.borderWidth = '0.5px'
  })
  el.style.borderColor = color
  el.style.borderWidth = '1.5px'
  const prev = window._cardState[courseId] ?? {}
  let nextLessonIds = type === 'pass' ? [...(prev.lessonIds ?? [])] : []
  if (type === 'pass' && passId) {
    const m = _remainingEntriesOnUserPass(passId)
    const before = nextLessonIds.length
    if (nextLessonIds.length > m) nextLessonIds = nextLessonIds.slice(0, m)
    if (before > m) _toastPassEntriesLimitReached()
  }
  const upcoming = window.AppState.upcomingLessons.filter(l => l.course_id === courseId)
  const firstAvail = upcoming.find(l => l.available_spots > 0)
  window._cardState[courseId] = {
    ...prev,
    paymentType: type,
    passId:      type === 'pass' ? (passId ?? null) : null,
    lessonIds:   nextLessonIds,
    buyPassTemplateId: type === 'buy-pass' ? (passId ?? null) : null,
    buyPassEntriesTotal: type === 'buy-pass' ? Number(buyEntries ?? el.dataset.buyPassEntries ?? 0) : null,
    buyPassPrice: type === 'buy-pass' ? Number(buyPrice ?? el.dataset.buyPassPrice ?? 0) : null,
  }
  if (type === 'single' || type === 'buy-pass') {
    window._cardState[courseId].lessonId = firstAvail ? (firstAvail.lesson_id ?? firstAvail.id) : null
    window._cardState[courseId].lessonIds = []
  } else {
    window._cardState[courseId].lessonId = null
  }

  document.querySelectorAll(`.term-pill[data-course-id="${courseId}"]`).forEach(p => {
    if (p.dataset.full === '1') return
    const id = p.dataset.lessonId
    const ids = window._cardState[courseId].lessonIds ?? []
    const sel = type === 'pass'
      ? ids.includes(id)
      : String(window._cardState[courseId].lessonId ?? '') === String(id)
    p.style.borderColor = sel ? color : 'rgba(0,0,0,.08)'
    p.style.borderWidth = sel ? '1.5px' : '0.5px'
    p.style.color = sel ? color : '#6b6b6b'
  })

  _syncCardPrimaryButton(courseId)
  _refreshCardPassSlotsRow(courseId)
}

window.reserveFromCard = async (courseId) => {
  if (!currentUser) {
    const course = window.AppState.courses.find(c => c.id === courseId)
    const st = window._cardState?.[courseId] ?? {}
    saveBookingReturn({
      courseId,
      lessonId: st.lessonId ?? null,
      lessonIds: st.lessonIds ?? null,
      paymentType: st.paymentType ?? null,
      passId: st.passId ?? null,
      buyPassTemplateId: st.buyPassTemplateId ?? null,
      preferredPayValue: _preferredPayFromCardState(st),
      openBooking: true,
    })
    window.openAuthPopup?.({
      courseTitle: course ? loc(course.title) : '',
      courseId,
    })
    return
  }
  if (_isStaffUser()) {
    window.showToast?.(_staffBookingDisabledMessage(), 'error')
    return
  }

  const course = window.AppState.courses.find(c => c.id === courseId)
  if (course && !canBookCourse(course)) {
    window.showToast?.(_tp('courses.cannotBookRestricted'), 'error')
    return
  }

  const btn = document.getElementById(`res-btn-${courseId}`)
  if (btn?.disabled) return  // Prevence duplicitního kliknutí

  const hasScheduledFutureLessons = _courseLessonsForBooking(courseId).length > 0
  if (!hasScheduledFutureLessons) {
    window.showToast?.(_tp('courses.noDates'), 'error')
    renderKurzy()
    return
  }

  const state         = window._cardState?.[courseId] ?? {}
  const paymentType = state.paymentType ?? 'single'
  const passId      = state.passId ?? null
  const preferredPayValue = _preferredPayFromCardState(state) ?? 'single'
  const preselectedLessonId = (paymentType === 'single' || paymentType === 'buy-pass')
    ? (state.lessonId ?? null)
    : null
  const preselectedLessonIds = paymentType === 'pass' && passId
    ? (state.lessonIds ?? [])
    : null

  window.openBookingPopup?.(
    courseId,
    passId || null,
    preselectedLessonId,
    preferredPayValue,
    preselectedLessonIds,
  )
}

function showCardMsg(courseId, msg, type) {
  const el = document.getElementById(`card-msg-${courseId}`)
  if (!el) return
  el.textContent      = msg
  el.style.color      = type === 'ok' ? '#085041' : '#791F1F'
  el.style.background = type === 'ok' ? '#eaf5ea' : '#fdeaea'
  el.style.display    = 'block'
  if (type === 'warn') setTimeout(() => { el.style.display = 'none' }, 4000)
}

// ── Enrolled stav na nástěnce ─────────────────────────────────
function updateEnrolledOnNastenska() {
  // Překreslit enrolled indikátory na nástěnce po změně bookings
  document.querySelectorAll('[data-lesson-enrolled]').forEach(el => {
    const lid = el.dataset.lessonId
    if (lid) el.dataset.lessonEnrolled = isEnrolled(lid) ? '1' : '0'
  })
}

// ── Pomocné funkce ────────────────────────────────────────────
function fmtPrice(n) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency', currency: 'CZK', maximumFractionDigits: 0
  }).format(n)
}

function fmtTime(d) {
  return d.toLocaleTimeString(lang === 'cs' ? 'cs-CZ' : 'en-GB', {
    hour: '2-digit', minute: '2-digit'
  })
}

function fmtDayFull(d) {
  return d.toLocaleDateString(lang === 'cs' ? 'cs-CZ' : 'en-GB', {
    weekday: 'short', day: 'numeric', month: 'numeric'
  })
}

function fmtLessonPill(iso) {
  const d = new Date(iso)
  return `${fmtDayFull(d)} ${fmtTime(d)}`
}

function fmtWeekRange(monday) {
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  const lc = lang === 'cs' ? 'cs-CZ' : 'en-GB'
  return `${monday.toLocaleDateString(lc, { day:'numeric', month:'numeric' })}–${sunday.toLocaleDateString(lc, { day:'numeric', month:'numeric', year:'numeric' })}`
}

function getMondayOf(d) {
  const day = new Date(d)
  day.setDate(day.getDate() - (day.getDay() + 6) % 7)
  day.setHours(0, 0, 0, 0)
  return day
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate()
}

// ── Moje lekce (lektor / admin) ───────────────────────────────
let _staffLessonsScope = 'vsechny'
let _staffPastLessonsPage = 1
const STAFF_PAST_LESSONS_PAGE_SIZE = 10

function _staffLessonsIsAdmin() {
  return (window.__userRole ?? window.AppState?.role) === 'admin'
}

function _staffLessonsPageTitle() {
  return (window.__userRole ?? window.AppState?.role) === 'lektor'
    ? _tp('pages.myLessonsTitle')
    : _tp('nav.myLessons')
}

function _staffScopeSwitchHtml() {
  if (!_staffLessonsIsAdmin()) return ''
  const active = _staffLessonsScope === 'vsechny' ? 'vsechny' : 'moje'
  const allLabel = _escHtml(_tp('common.all')).toUpperCase()
  const mineLabel = _escHtml(_tp('common.mine')).toUpperCase()
  const btn = isActive => [
    'padding:8px 14px',
    'border-radius:999px',
    'border:1px solid var(--section-heading-accent)',
    `background:${isActive ? 'var(--section-heading-accent)' : '#fff'}`,
    `color:${isActive ? '#fff' : 'var(--section-heading-accent)'}`,
    'font-size:11px',
    'font-weight:700',
    'letter-spacing:.08em',
    'cursor:pointer',
  ].join(';')
  return `
    <div style="display:flex;gap:8px;align-items:center;justify-content:flex-start;flex-wrap:wrap;margin-bottom:22px;">
      <button type="button" style="${btn(active === 'vsechny')}" onclick="window.setStaffLessonsScope?.('vsechny')">${allLabel}</button>
      <button type="button" style="${btn(active === 'moje')}" onclick="window.setStaffLessonsScope?.('moje')">${mineLabel}</button>
    </div>`
}

window.setStaffLessonsScope = (scope) => {
  const next = scope === 'vsechny' && _staffLessonsIsAdmin() ? 'vsechny' : 'moje'
  if (_staffLessonsScope === next) return
  _staffLessonsScope = next
  _staffPastLessonsPage = 1
  void window.renderMojeLekce?.()
}

window.setStaffPastLessonsPage = (page) => {
  const next = Math.max(1, Number(page) || 1)
  if (_staffPastLessonsPage === next) return
  _staffPastLessonsPage = next
  void window.renderMojeLekce?.()
}

export async function buildStaffLessonsSectionHtml({
  sectionTitle = 'Lekce',
  sectionClass = 'section-h',
  sectionStyle = '',
  includeDeactivated = true,
  maxActive = null,
  scope = 'moje',
} = {}) {
  const titleHtml = sectionTitle
    ? `<div class="${sectionClass}"${sectionStyle ? ` style="${sectionStyle}"` : ''}>${sectionTitle}</div>`
    : ''

  if (!currentUser?.id) {
    return titleHtml + `<div class="empty">${_escHtml(_tp('shop.signInPrompt'))}</div>`
  }

  const showAllStaffLessons = scope === 'vsechny' && _staffLessonsIsAdmin()
  let coursesQuery = sb.from('courses')
    .select('id, title, color_code, is_workshop, description_short, images')
  if (!showAllStaffLessons) coursesQuery = coursesQuery.eq('owner_id', currentUser.id)
  const { data: myCourses } = await coursesQuery

  if (!myCourses?.length) {
    return titleHtml + `<div class="empty">Zatím nejsou přiřazeny žádné kurzy ani workshopy.</div>`
  }

  const courseMap = Object.fromEntries(myCourses.map(c => [c.id, normalizeCourseRecord(c)]))
  const courseIds = myCourses.map(c => c.id)
  const workshopCourseIds = myCourses.filter(c => c.is_workshop).map(c => c.id)
  const nowIso = new Date().toISOString()

  const { data: terms } = await sb.from('lesson_availability')
    .select('lesson_id, course_id, start_time, end_time, capacity, booked_count, available_spots, status')
    .in('course_id', courseIds)
    .gte('start_time', nowIso)
    .in('status', ['active', 'cancelled'])
    .order('start_time')
    .limit(80)

  const pastFrom = (_staffPastLessonsPage - 1) * STAFF_PAST_LESSONS_PAGE_SIZE
  const pastTo = pastFrom + STAFF_PAST_LESSONS_PAGE_SIZE - 1
  const { data: pastLessons, count: pastLessonsCount, error: pastLessonsErr } = await sb.from('lessons')
    .select('id, course_id, start_time, end_time, status', { count: 'exact' })
    .in('course_id', courseIds)
    .lt('start_time', nowIso)
    .in('status', ['active', 'cancelled'])
    .order('start_time', { ascending: false })
    .range(pastFrom, pastTo)
  if (pastLessonsErr) {
    console.warn('[Moje lekce] Uplynulé lekce se nepodařilo načíst:', pastLessonsErr)
  }

  const { count: pastDeactivatedLessonsCount, error: pastDeactivatedErr } = await sb.from('lessons')
    .select('id', { count: 'exact', head: true })
    .in('course_id', courseIds)
    .lt('start_time', nowIso)
    .eq('status', 'cancelled')
  if (pastDeactivatedErr) {
    console.warn('[Moje lekce] Počet uplynulých deaktivovaných lekcí se nepodařilo načíst:', pastDeactivatedErr)
  }

  let allTerms = terms ?? []
  if (workshopCourseIds.length) {
    const seenLessonIds = new Set(allTerms.map(l => String(l.lesson_id ?? l.id)))
    const { data: workshopLessons, error: workshopLessonsErr } = await sb.from('lessons')
      .select('id, course_id, start_time, end_time, capacity, status')
      .in('course_id', workshopCourseIds)
      .gte('start_time', nowIso)
      .in('status', ['active', 'cancelled'])
      .order('start_time')
      .limit(80)
    if (workshopLessonsErr) {
      console.warn('[Moje lekce] Workshopy z lessons se nepodařilo načíst:', workshopLessonsErr)
    } else {
      const missingWorkshopLessons = (workshopLessons ?? [])
        .filter(l => !seenLessonIds.has(String(l.id)))
      const missingLessonIds = missingWorkshopLessons.map(l => l.id)
      let bookedByLessonId = {}
      if (missingLessonIds.length) {
        const { data: bookingRows, error: bookingErr } = await sb.from('bookings')
          .select('lesson_id')
          .in('lesson_id', missingLessonIds)
          .in('status', BLOCKING_PARTICIPATION_STATUSES)
        if (bookingErr) {
          console.warn('[Moje lekce] Obsazenost workshopů se nepodařilo načíst:', bookingErr)
        } else {
          bookedByLessonId = (bookingRows ?? []).reduce((acc, row) => {
            const id = String(row.lesson_id)
            acc[id] = (acc[id] ?? 0) + 1
            return acc
          }, {})
        }
      }
      allTerms = allTerms.concat(missingWorkshopLessons.map(l => {
        const booked = bookedByLessonId[String(l.id)] ?? 0
        const cap = Number(l.capacity ?? 0)
        return {
          lesson_id: l.id,
          course_id: l.course_id,
          start_time: l.start_time,
          end_time: l.end_time,
          capacity: cap,
          booked_count: booked,
          available_spots: Math.max(0, cap - booked),
          status: l.status ?? 'active',
        }
      }))
    }
  }
  allTerms.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))

  let active = allTerms.filter(l => l.status === 'active')
  const deactivated = includeDeactivated ? allTerms.filter(l => l.status === 'cancelled') : []
  if (maxActive != null && maxActive > 0) active = active.slice(0, maxActive)

  const renderTermCard = l => {
    const course  = courseMap[l.course_id]
    const color   = courseThemeHex(course?.color_code)
    const title   = loc(course?.title) || 'Lekce'
    const booked  = Number(l.booked_count || 0)
    const cap     = l.capacity ?? 0
    const pct     = cap > 0 ? Math.round((booked / cap) * 100) : 0
    const start   = new Date(l.start_time)
    const end     = new Date(l.end_time)
    const dateStr = start.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' })
    const timeStr = `${fmtTime(start)}–${fmtTime(end)}`
    const lid     = l.lesson_id ?? l.id
    const imgUrl = courseImageUrls(course)[0] ?? null
    const desc    = loc(course?.description_short)
    const isOff   = l.status === 'cancelled'
    const actions = window.adminLessonActionButtons?.(lid, l.status ?? 'active', l.start_time) ?? ''
    return `
          <div class="staff-term-card" style="border:1px solid ${color};border-radius:12px;overflow:hidden;margin-bottom:8px;background:#fff;${isOff ? 'opacity:.75;' : ''}">
            <div style="display:flex;cursor:pointer;" onclick="window.toggleML('${lid}')">
              <div style="flex:1;padding:12px 14px;display:flex;align-items:flex-start;gap:12px;">
                <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;margin-top:5px;"></div>
                <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;">
                  <div style="font-size:13px;font-weight:600;line-height:1.35;">
                    ${title}${course?.is_workshop ? ' <span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:20px;background:#FFF4E0;color:#8B5C00;">WORKSHOP</span>' : ''}
                    ${isOff ? '<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:20px;background:#F3F4F6;color:#6b6b6b;margin-left:6px;">DEAKTIVOVÁNO</span>' : ''}
                  </div>
                  <div style="font-size:11px;color:#6b6b6b;">${dateStr} · ${timeStr}</div>
                  <div style="margin-top:2px;">
                    <div style="font-size:13px;font-weight:600;">${booked}/${cap}</div>
                    <div style="font-size:10px;color:#9b9b9b;margin-bottom:4px;">${_tp('courses.occupied')}</div>
                    <div style="width:100%;height:4px;background:rgba(0,0,0,.08);border-radius:99px;overflow:hidden;">
                      <div style="height:100%;width:${pct}%;background:${color};border-radius:99px;"></div>
                    </div>
                  </div>
                </div>
                <div style="flex-shrink:0;">
                  <div style="display:flex;flex-direction:column;gap:6px;">
                    ${actions}
                  </div>
                </div>
              </div>
            </div>
            <div class="ml-cx" id="ml-cx-${lid}">
              <div style="padding:0 14px 14px 14px;">
                <div style="font-size:12px;color:#6b6b6b;line-height:1.65;overflow:hidden;margin-bottom:10px;">
                  ${imgUrl ? `<img src="${imgUrl}" style="float:left;width:108px;height:108px;object-fit:cover;border-radius:8px;margin:0 12px 8px 0;" alt="" />` : ''}
                  ${desc || ''}
                </div>
                <button class="btn-detail" onclick="window.openDetail('${l.course_id}')">
                  ${_tp('courses.detailLink')}
                </button>
              </div>
            </div>
          </div>`
  }

  const renderPastLessonRow = l => {
    const course = courseMap[l.course_id]
    const color = courseThemeHex(course?.color_code)
    const title = loc(course?.title) || _tp('common.lessonFallback')
    const start = new Date(l.start_time)
    const end = new Date(l.end_time || l.start_time)
    const dateStr = start.toLocaleDateString(lang === 'cs' ? 'cs-CZ' : 'en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    })
    const timeStr = `${fmtTime(start)}–${fmtTime(end)}`
    const lid = _escHtml(String(l.id ?? l.lesson_id ?? ''))
    return `
      <div class="staff-term-card" style="border:1px solid ${color};border-radius:12px;background:#fff;margin-bottom:8px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;opacity:.75;">
        <div style="min-width:0;display:flex;align-items:flex-start;gap:12px;">
          <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;margin-top:5px;"></div>
          <div style="min-width:0;">
            <div style="font-size:13px;font-weight:600;line-height:1.35;">${_escHtml(title)}</div>
            <div style="font-size:11px;color:#6b6b6b;margin-top:4px;">${_escHtml(dateStr)} · ${_escHtml(timeStr)}</div>
          </div>
        </div>
        <button type="button" class="btn-small" style="font-size:11px;padding:6px 10px;flex-shrink:0;"
          onclick="window.adminOpenLessonDetail?.('${lid}')">${_escHtml(_tp('admin.btn.attendees'))}</button>
      </div>`
  }

  const renderArchiveAccordion = (id, title, count, bodyHtml) => `
    <div style="margin-top:20px;">
      <button type="button"
        onclick="window.toggleStaffArchiveSection?.('${id}')"
        style="width:100%;border:0;background:transparent;padding:0;margin:0 0 10px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;text-align:left;">
        <span style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--section-heading-accent);font-weight:600;">${_escHtml(title)}</span>
        <span style="display:flex;align-items:center;gap:8px;font-size:11px;color:#9b9b9b;">
          ${Number.isFinite(Number(count)) ? `<span>${Number(count)}</span>` : ''}
          <span id="staff-archive-chev-${id}" style="font-size:18px;line-height:1;">›</span>
        </span>
      </button>
      <div id="staff-archive-${id}" style="display:none;">
        ${bodyHtml}
      </div>
    </div>`

  const renderPastPagination = total => {
    const pageCount = Math.ceil((Number(total) || 0) / STAFF_PAST_LESSONS_PAGE_SIZE)
    if (pageCount <= 1) return ''
    const current = Math.min(_staffPastLessonsPage, pageCount)
    const pages = []
    const addPage = n => {
      if (n >= 1 && n <= pageCount && !pages.includes(n)) pages.push(n)
    }
    addPage(1)
    for (let n = current - 2; n <= current + 2; n += 1) addPage(n)
    addPage(pageCount)
    pages.sort((a, b) => a - b)

    let last = 0
    const btns = []
    for (const n of pages) {
      if (last && n - last > 1) {
        btns.push(`<span style="font-size:12px;color:#9b9b9b;padding:0 2px;">…</span>`)
      }
      const activePage = n === current
      btns.push(`
        <button type="button"
          style="min-width:30px;height:30px;border-radius:999px;border:1px solid ${activePage ? 'var(--primary)' : 'var(--section-heading-accent)'};background:${activePage ? 'var(--primary)' : '#fff'};color:${activePage ? '#fff' : 'var(--section-heading-accent)'};font-size:11px;font-weight:700;cursor:pointer;"
          onclick="window.setStaffPastLessonsPage?.(${n})">${n}</button>`)
      last = n
    }
    return `<div style="display:flex;gap:6px;justify-content:center;align-items:center;flex-wrap:wrap;margin-top:14px;">${btns.join('')}</div>`
  }

  const sections = []
  if (active.length) {
    sections.push(`<div style="font-size:12px;color:#6b6b6b;margin-bottom:12px;">${active.length} aktivních termínů</div>`)
    sections.push(`<div class="nastenka-cards-2col">${active.map(renderTermCard).join('')}</div>`)
  } else if (!deactivated.length) {
    sections.push(`<div class="empty">Žádné nadcházející termíny.</div>`)
  }
  const pastBulkDeleteHtml = Number(pastDeactivatedLessonsCount ?? 0) > 0
    ? `<div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
        <button type="button" class="btn-small danger" style="font-size:11px;padding:6px 10px;"
          onclick="window.adminDeleteAllPastDeactivatedLessons?.('${_escHtml(_staffLessonsScope)}')">${_escHtml(_tp('admin.lessonActions.deleteAllPastDeactivated'))}</button>
      </div>`
    : ''
  const pastBodyHtml = (pastLessons ?? []).length
    ? `${pastBulkDeleteHtml}<div>${(pastLessons ?? []).map(renderPastLessonRow).join('')}</div>${renderPastPagination(pastLessonsCount ?? 0)}`
    : `<div class="empty">${_escHtml(_tp('admin.lessonActions.emptyPast'))}</div>`
  sections.push(renderArchiveAccordion(
    'past',
    _tp('admin.lessonActions.sectionPast'),
    pastLessonsCount ?? 0,
    pastBodyHtml,
  ))
  if (deactivated.length) {
    const deactivatedBodyHtml = `
      <div style="font-size:12px;color:#6b6b6b;margin-bottom:12px;">${_escHtml(_tp('admin.lessonActions.futureDeactivatedHint', { n: deactivated.length }))}</div>
      <div class="nastenka-cards-2col">${deactivated.map(renderTermCard).join('')}</div>`
    sections.push(renderArchiveAccordion('deactivated', _tp('admin.lessonActions.sectionDeactivated'), deactivated.length, deactivatedBodyHtml))
  }

  return titleHtml + sections.join('')
}

export async function buildMojeLekceMarkup() {
  const title = _staffLessonsPageTitle()
  const body = await buildStaffLessonsSectionHtml({
    sectionTitle: '',
    sectionClass: 'sec-title',
    includeDeactivated: true,
    scope: _staffLessonsScope,
  })
  return `<div class="page-title" style="margin-bottom:16px;">${_escHtml(title)}</div>${_staffScopeSwitchHtml()}${body}`
}


async function renderMojeLekce() {
  const el = document.getElementById('screen-moje-lekce')
  if (!el) return

  if (!currentUser) {
    el.innerHTML = `<div class="page-title" style="margin-bottom:16px;">${_escHtml(_staffLessonsPageTitle())}</div><div class="empty">Přihlaste se.</div>`
    return
  }

  window._renderMojeLekceSeq = (window._renderMojeLekceSeq ?? 0) + 1
  const seq = window._renderMojeLekceSeq

  el.innerHTML = `<div class="page-title" style="margin-bottom:16px;">${_escHtml(_staffLessonsPageTitle())}</div>${_staffScopeSwitchHtml()}<div class="empty" style="padding:40px;">Načítám…</div>`

  const canApply = () => {
    if ((window._renderMojeLekceSeq ?? 0) !== seq) return false
    const sc = document.getElementById('screen-moje-lekce')
    return !!(sc && sc.classList.contains('active'))
  }

  const applyHtml = html => {
    if (!canApply()) return
    el.innerHTML = html
  }

  try {
    const html = await buildMojeLekceMarkup()
    applyHtml(html)
  } catch (e) {
    console.error('[renderMojeLekce] chyba — plný objekt:')
    console.dir(e, { depth: null })
    applyHtml(`<div class="page-title" style="margin-bottom:16px;">${_escHtml(_staffLessonsPageTitle())}</div>${_staffScopeSwitchHtml()}<div class="empty">Chyba při načítání (detail v konzoli).</div>`)
  }
}

window.renderMojeLekce = renderMojeLekce

async function renderPermanentkyShop() {
  const container = document.getElementById('permanentky-shop-content')
  if (!container) return

  container.innerHTML = `<div class="empty" style="padding:28px;">${_escHtml(_tp('common.loading'))}</div>`

  try {
    if (currentUser?.id) {
      await loadUserPasses(currentUser.id)
    }

    const { data: passes, error } = await sb
      .from('passes')
      .select('id, name, entries_total, price, validity_weeks, allowed_course_ids, color_code')
      .eq('is_active', true)
      .order('created_at')

    if (error) throw error

    const rows = passes ?? []
    if (!rows.length) {
      container.innerHTML = `<div class="empty" style="padding:28px;">${_escHtml(_tp('shop.emptyCatalog'))}</div>`
      return
    }

    const courses = window.AppState.courses ?? []
    const courseTitle = cid => loc(courses.find(c => String(c.id) === String(cid))?.title) || ''

    container.innerHTML = `<div class="pass-shop-grid">${rows.map(p => {
      const name = _escHtml(loc(p.name) || _tp('common.pass'))
      const pc = passThemeHex(p.color_code)
      const surf = passCardSurfaceCss(pc)
      const total = Number(p.entries_total) || 0
      const priceNum = Number(p.price) || 0
      const perEntryRaw = total > 0 ? fmtPrice(priceNum / total) : '—'
      const ids = Array.isArray(p.allowed_course_ids) ? p.allowed_course_ids : []
      const coursesHtml = passShopCourseTagsBlock(ids, courseTitle, pc)
      const weeks = p.validity_weeks != null ? Number(p.validity_weeks) : null
      const validityBlock = weeks && weeks > 0
        ? `<div class="pass-shop-accent" style="background:${pc}14;border:1px solid ${pc}38;">${_escHtml(_passShopValidityLine(weeks))}</div>`
        : ''
      const refCourseId = ids.length ? ids[0] : ''
      const priceEsc = fmtPrice(priceNum)
      const buyLabel = _tp('booking.btn.buyPass')
      const entriesLabel = _tp('booking.payment.entriesLabel')
      const perSlash = _tp('booking.payment.perEntry')
      const chipPer = total > 0
        ? `${_escHtml(perEntryRaw)}/${_escHtml(perSlash)}`
        : '—'

      const passIdAttr = _escHtml(String(p.id))
      const courseIdAttr = refCourseId ? _escHtml(String(refCourseId)) : ''
      const passTitleRaw = loc(p.name) || _tp('common.pass')
      const passTitleAttr = _escHtml(passTitleRaw)

      return `
        <div class="pass-shop-card" style="${surf}">
          <div class="pass-shop-head">
            <div class="pass-shop-title">${name}</div>
            <div class="pass-shop-price" style="color:${pc};">${priceEsc}</div>
          </div>
          <div class="pass-shop-stats">
            <span class="pass-shop-chip" style="background:${pc}26;color:${pc};"><strong>${total}</strong> ${_escHtml(entriesLabel)}</span>
            <span class="pass-shop-chip pass-shop-chip--neutral" style="background:${pc}12;color:var(--anno);">${chipPer}</span>
          </div>
          ${validityBlock}
          <div class="pass-shop-scope">${coursesHtml}</div>
          <button type="button" class="btn-res" style="width:100%;padding:11px;border:none;font-size:13px;font-weight:600;cursor:pointer;background:${pc};"
            onclick="window._buyPassShopClick?.(this)"
            data-buy-pass-id="${passIdAttr}"
            data-buy-pass-entries="${total}"
            data-buy-pass-price="${priceNum}"
            data-buy-pass-course="${courseIdAttr}"
            data-buy-pass-title="${passTitleAttr}">${_escHtml(buyLabel)}</button>
        </div>`
    }).join('')}</div>`
  } catch (e) {
    console.error('[renderPermanentkyShop]', e)
    container.innerHTML = `<div class="empty" style="padding:28px;color:#791F1F;">${_escHtml(_tp('shop.fetchError'))}</div>`
  }
}

window.renderPermanentkyShop = renderPermanentkyShop

// ── Navigace: index.html volá globální `nav()` → __appNavHooks na konci těla ──
;(window.__appNavHooks ??= []).push((id) => {
  console.log('[Debug] __appNavHooks (atelier-data): lokální render pro', id)
  if (id === 'kurzy')        renderKurzy()
  if (id === 'kalendar')     renderKalendar()
  if (id === 'moje-lekce')   void renderMojeLekce()
  if (id === 'permanentky')  void renderPermanentkyShop()
  if (id === 'detail-kurzu') renderCourseDetail(window._detailCourseId)
})

// ── Spuštění ─────────────────────────────────────────────────
init()
