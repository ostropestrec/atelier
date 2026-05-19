// ============================================================
// atelier-admin.js — Admin sekce: Dashboard, Kurzy, Zákazníci, Platby, Permanentky
// ============================================================

import { sb } from './atelier-supabase.js'
import { currentUser, userPasses, myBookings, canUserCancelBooking } from './atelier_auth.js'
import { sanitizeCourseRichText } from './atelier-sanitize.js'
import { normalizeCourseRecord, courseImageUrls } from './atelier-data.js'
import { t } from './translations.js'
import {
  BLOCKING_PARTICIPATION_STATUSES,
  PARTICIPATION_STATUS,
} from './atelier-booking-status.js'

function _adminLocale() {
  return window.__uiLang === 'en' ? 'en' : 'cs'
}
/** @param {Record<string, string | number>} [params] */
function _adm(key, params) {
  return t(_adminLocale(), 'admin.' + key, params)
}
function _adminFmtLocaleTag() {
  return _adminLocale() === 'en' ? 'en-GB' : 'cs-CZ'
}
function _adminWeekdayShortLabels() {
  return _adminLocale() === 'en'
    ? ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
    : ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']
}

// ── Role-aware scoping helpers ──────────────────────────────
// Admin vidí všechno; lektor jen vlastní (owner_id = jeho uid). RLS to zaručuje na DB straně,
// ale i v UI musíme explicitně filtrovat, jinak by lektor v seznamu kurzů viděl všechny veřejné
// (active) kurzy / permanentky a klikat na cizí, kde mu update tiše selže.
function _roleNow() {
  return window.__userRole ?? window.AppState?.role ?? 'uzivatel'
}
function _isStaffLektor() {
  return _roleNow() === 'lektor'
}
function _isStaffAdmin() {
  return _roleNow() === 'admin'
}
/** Pokud je aktuální uživatel lektor, přidá .eq('owner_id', currentUser.id). Admin/uzivatel beze změny. */
function _scopeOwnerQuery(query) {
  if (_isStaffLektor() && currentUser?.id) {
    return query.eq('owner_id', currentUser.id)
  }
  return query
}
/** Po storno akcích: admin překreslí dashboard, lektor svou „Moje lekce" — kde akci typicky inicioval. */
function _refreshStaffViewAfterCancel() {
  if (_isStaffAdmin()) {
    void renderAdminDashboard()
  } else if (_isStaffLektor()) {
    if (document.getElementById('screen-nastenka')?.classList.contains('active')) {
      void renderLektorDashboard()
    } else {
      void window.renderMojeLekce?.()
    }
  }
}

// ── Konstanty ─────────────────────────────────────────────────
const PRESET_COLORS = [
  '#2854B9', '#E05C5C', '#4CAF50', '#FF9800', '#9C27B0',
  '#00BCD4', '#795548', '#607D8B', '#E91E63', '#FF5722',
]
/** Paleta jen pro permanentky — teplé pastelové tóny (keramika / hlína), oddělené od sytých PRESET_COLORS u kurzů */
const PASS_PALETTE = [
  '#C4806E', // terrakota
  '#D4947C', // broskvová engoba
  '#9AAA8F', // šalvěj / celadon
  '#C9A7B4', // prachová růže
  '#C6AE7E', // písková glazura
  '#A691C3', // teplá levandule (šamot)
  '#E0B87A', // medová poleva
  '#8FA9B2', // šedomodrá redukce
  '#B89880', // cappuccino hlína
  '#9FB8A8', // mint celadin
]
// ── Stav modálů ──────────────────────────────────────────────
let _ncSelectedDays  = new Set()
let _ncSelectedColor = PRESET_COLORS[0]
let _mcInviteCandidates = []
let _mcAllowedUserIds = new Set()
let _mcAllowedUsersQuery = ''
let _wsSelectedColor = PRESET_COLORS[0]
let _mpSelectedColor = PASS_PALETTE[0]
let _ncExistingImages = []
let _ncNewFiles       = []
let _mwExistingImages = []
let _mwNewFiles       = []

function _passHexOrDefault(hex) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(hex || '').trim()) ? String(hex).trim() : PASS_PALETTE[0]
}
function _courseThemeHex(hex) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(hex || '').trim()) ? String(hex).trim() : PRESET_COLORS[0]
}

function _passCardSurfaceStyle(hex) {
  const h = _passHexOrDefault(hex)
  return `background:${h}18;border:1px solid ${h}44;`
}

function _passCancellationLimit(entriesTotal) {
  const total = Number(entriesTotal)
  if (!Number.isFinite(total) || total <= 0) return 0
  return total <= 5 ? 1 : 2
}

const MAX_COURSE_PHOTOS = 4
const MAX_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024
const COMPRESS_OVER_BYTES = 5 * 1024 * 1024

/** WYSIWYG: Quill se lazy-loaduje až při prvním otevření admin modálu kurzu/workshopu (~63 KB JS + CSS). */
let _quillMcLong = null
let _quillMwLong = null
const QUILL_CSS_URL = 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.snow.css'
const QUILL_JS_URL  = 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js'

let _quillLoadPromise = null
function _ensureQuillLoaded() {
  if (typeof window !== 'undefined' && typeof window.Quill === 'function') return Promise.resolve()
  if (_quillLoadPromise) return _quillLoadPromise
  _quillLoadPromise = new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve()
    if (!document.querySelector('link[data-quill-css="1"]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = QUILL_CSS_URL
      link.crossOrigin = 'anonymous'
      link.dataset.quillCss = '1'
      document.head.appendChild(link)
    }
    if (typeof window.Quill === 'function') return resolve()
    const existing = document.querySelector('script[data-quill-js="1"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => resolve(), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = QUILL_JS_URL
    script.crossOrigin = 'anonymous'
    script.async = true
    script.dataset.quillJs = '1'
    script.onload = () => resolve()
    script.onerror = (e) => {
      console.warn('[Admin] Lazy načtení Quillu selhalo — modál ohlásí chybu:', e)
      resolve()
    }
    document.head.appendChild(script)
  })
  return _quillLoadPromise
}

let _adminDashboardView = 'vsechny'
let _adminCoursesScope = 'vsechny'
let _adminPassesScope = 'vsechny'

function _adminScopeSwitchHtml(active, setterName) {
  const current = active === 'moje' ? 'moje' : 'vsechny'
  const allLabel = esc(t(_adminLocale(), 'common.all')).toUpperCase()
  const mineLabel = esc(t(_adminLocale(), 'common.mine')).toUpperCase()
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
      <button type="button" style="${btn(current === 'vsechny')}" onclick="window.${setterName}?.('vsechny')">${allLabel}</button>
      <button type="button" style="${btn(current === 'moje')}" onclick="window.${setterName}?.('moje')">${mineLabel}</button>
    </div>`
}

window.adminSetCoursesScope = (scope) => {
  const next = scope === 'moje' ? 'moje' : 'vsechny'
  if (_adminCoursesScope === next) return
  _adminCoursesScope = next
  void renderAdminKurzy()
}

window.adminSetPassesScope = (scope) => {
  const next = scope === 'moje' ? 'moje' : 'vsechny'
  if (_adminPassesScope === next) return
  _adminPassesScope = next
  void renderAdminPermanentky()
}

window.adminSetDashboardView = (view) => {
  const next = view === 'moje' ? view : 'vsechny'
  if (_adminDashboardView === next) return
  _adminDashboardView = next
  void renderAdminDashboard()
}

// Prewarm: admin modul se loaduje jen pro adminy, takže Quill bezpečně předtáhneme — k otevření modálu
// stejně dojde téměř určitě, a tady aspoň běží paralelně s prvním renderem admin sekce.
_ensureQuillLoaded().catch(() => {})

function _getQuillCtor() {
  const Q = typeof window !== 'undefined' ? window.Quill : null
  return typeof Q === 'function' ? Q : null
}

function _destroyMcLongQuill() {
  const wrap = document.getElementById('mc-long-wrap')
  _quillMcLong = null
  if (!wrap) return
  wrap.innerHTML = '<div id="mc-long-editor"></div>'
}

function _destroyMwLongQuill() {
  const wrap = document.getElementById('mw-long-wrap')
  _quillMwLong = null
  if (!wrap) return
  wrap.innerHTML = '<div id="mw-long-editor"></div>'
}

function _ensureMcLongQuill() {
  const Q = _getQuillCtor()
  if (!Q || !document.getElementById('mc-long-editor')) return null
  if (_quillMcLong) return _quillMcLong
  _quillMcLong = new Q('#mc-long-editor', {
    theme: 'snow',
    modules: {
      toolbar: [[{ header: [2, 3, false] }], ['bold', 'italic', 'underline'], [{ list: 'bullet' }]],
    },
    placeholder: _adm('quill.coursePlaceholder'),
  })
  return _quillMcLong
}

function _ensureMwLongQuill() {
  const Q = _getQuillCtor()
  if (!Q || !document.getElementById('mw-long-editor')) return null
  if (_quillMwLong) return _quillMwLong
  _quillMwLong = new Q('#mw-long-editor', {
    theme: 'snow',
    modules: {
      toolbar: [[{ header: [2, 3, false] }], ['bold', 'italic', 'underline'], [{ list: 'bullet' }]],
    },
    placeholder: _adm('quill.workshopPlaceholder'),
  })
  return _quillMwLong
}

function _pasteSanitizedIntoQuill(q, sanitizedHtml) {
  const Q = _getQuillCtor()
  if (!q || !Q) return
  const inner = sanitizedHtml.trim() ? sanitizedHtml : '<p><br></p>'
  const Delta = Q.import('delta')
  try {
    q.setContents(new Delta(), 'silent')
    q.clipboard.dangerouslyPasteHTML(0, inner, 'silent')
  } catch (e) {
    console.warn('[Admin] Quill paste selhalo:', e)
  }
}

async function _setMcLongHtml(html) {
  await _ensureQuillLoaded()
  _destroyMcLongQuill()
  const q = _ensureMcLongQuill()
  if (!q) {
    console.warn('[Admin] Quill není dostupný (lazy-load selhal — zkuste obnovit stránku).')
    return
  }
  _pasteSanitizedIntoQuill(q, sanitizeCourseRichText(html))
}

async function _setMwLongHtml(html) {
  await _ensureQuillLoaded()
  _destroyMwLongQuill()
  const q = _ensureMwLongQuill()
  if (!q) {
    console.warn('[Admin] Quill není dostupný (lazy-load selhal — zkuste obnovit stránku).')
    return
  }
  _pasteSanitizedIntoQuill(q, sanitizeCourseRichText(html))
}

function _normalizeStoredRichHtml(sanitized) {
  const t = String(sanitized ?? '').trim()
  if (!t) return ''
  const c = t.replace(/\s/g, '').toLowerCase()
  if (c === '<p><br></p>' || c === '<p></p>' || c === '<br>' || c === '<p><br/></p>') return ''
  return t
}

function _getMcLongHtml() {
  if (!_quillMcLong || !_getQuillCtor()) return ''
  const raw = _quillMcLong.root.innerHTML
  return _normalizeStoredRichHtml(sanitizeCourseRichText(raw))
}

function _getMwLongHtml() {
  if (!_quillMwLong || !_getQuillCtor()) return ''
  const raw = _quillMwLong.root.innerHTML
  return _normalizeStoredRichHtml(sanitizeCourseRichText(raw))
}

/** Dříve 3000 ms — při pomalejší síti / vytíženém API končilo vše „TIMEOUT:admin-kurzy“ místo reálné chyby. */
// const ADMIN_FETCH_DEADLINE_MS = 3000

/** Bez časového limitu — jen propaguje promise (stejný záměr jako vypnutý withTimeout v atelier-data.js). */
function adminRace(promiseOrThenable, _label) {
  return Promise.resolve(promiseOrThenable)
}

/** Má aktivní blok už „skutečný“ obsah (ne jen placeholder)? */
function _adminHadStableContent(html, needle) {
  const h = String(html ?? '')
  return h.length > 80 && !h.includes(needle)
}

// ── Helpers ──────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function loc(obj) {
  if (!obj) return ''
  if (typeof obj === 'string') return obj
  return obj.cs ?? obj.en ?? ''
}

function fmtPrice(n) {
  return new Intl.NumberFormat(_adminFmtLocaleTag(), {
    style: 'currency', currency: 'CZK', maximumFractionDigits: 0,
  }).format(Number(n) || 0)
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(_adminFmtLocaleTag(), { day: 'numeric', month: 'numeric', year: 'numeric' })
}

function _adminDashboardSwitchHtml(active = _adminDashboardView) {
  const mineActive = active === 'moje'
  const allActive = active === 'vsechny'
  const allLabel = esc(t(_adminLocale(), 'common.all')).toUpperCase()
  const mineLabel = esc(t(_adminLocale(), 'common.mine')).toUpperCase()
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
    <div style="display:flex;gap:8px;align-items:center;justify-content:flex-start;flex-wrap:wrap;">
      <button type="button" style="${btn(allActive)}" onclick="window.adminSetDashboardView?.('vsechny')">${allLabel}</button>
      <button type="button" style="${btn(mineActive)}" onclick="window.adminSetDashboardView?.('moje')">${mineLabel}</button>
    </div>`
}

function _adminBookingWhen(iso) {
  const d = new Date(iso)
  const day = d.toLocaleDateString(_adminFmtLocaleTag(), { weekday: 'short', day: 'numeric', month: 'numeric' })
  const time = d.toLocaleTimeString(_adminFmtLocaleTag(), { hour: '2-digit', minute: '2-digit' })
  return `${day} · ${time}`
}

function _adminPassCourseTagsHtml(allowedIds, colorHex) {
  const ph = _passHexOrDefault(colorHex)
  const courses = window.AppState?.courses ?? []
  const ids = Array.isArray(allowedIds) ? allowedIds : []
  const hdr = esc(t(_adminLocale(), 'nav.courses'))
  const pill = txt => `<span class="pass-shop-tag" style="background:${ph}22;color:${ph};">${esc(txt)}</span>`
  const labels = ids
    .map(id => {
      const c = courses.find(x => String(x.id) === String(id))
      return loc(c?.title)
    })
    .filter(Boolean)
  const inner = ids.length
    ? (labels.length ? labels.map(pill).join('') : pill(t(_adminLocale(), 'catalog.selectedCoursesDetail')))
    : pill(t(_adminLocale(), 'catalog.validAllCourses'))
  return `
    <div class="pass-shop-scope-heading">${hdr}</div>
    <div class="pass-shop-course-tags">${inner}</div>`
}

function _adminAccountPassCard(up) {
  const p = up.pass
  const name = loc(p?.name) || t(_adminLocale(), 'dashboard.passFallback')
  const total = Number(up.entries_total ?? p?.entries_total ?? 0) || 0
  const remaining = Number(up.entries_remaining ?? 0) || 0
  const used = Math.max(0, total - remaining)
  const pct = total ? Math.round((used / total) * 100) : 0
  const ph = _passHexOrDefault(p?.color_code)
  const exp = up.expires_at ? fmtDate(up.expires_at) : ''
  return `
    <div class="pass-item" style="${_passCardSurfaceStyle(ph)}">
      <div class="pass-top">
        <div>
          <div class="pass-name">${esc(name)}</div>
          <div class="pass-meta">${esc(t(_adminLocale(), 'dashboard.passMeta', { remaining, total, date: exp }))}</div>
        </div>
        <div class="pass-count" style="color:${ph};">${remaining}</div>
      </div>
      ${_adminPassCourseTagsHtml(p?.allowed_course_ids, p?.color_code)}
      <div class="bar"><i style="width:${pct}%;background:${ph};"></i></div>
    </div>`
}

function _adminAccountBookingCard(b) {
  const lesson = b.lesson
  const course = lesson?.course
  const color = _courseThemeHex(course?.color_code)
  const title = loc(course?.title) || t(_adminLocale(), 'dashboard.lessonFallback')
  const owner = course?.owner?.name ?? '—'
  const when = lesson?.start_time ? _adminBookingWhen(lesson.start_time) : ''
  const courseId = esc(String(course?.id ?? ''))
  const bookingId = esc(String(b.id ?? ''))
  return `
    <div class="booking-item" style="border:1px solid ${color};">
      <div class="bk-left">
        <span class="dot" style="background:${color}"></span>
        <div style="min-width:0">
          <div class="bk-title">
            <a href="javascript:void(0)" onclick="window.openDetail?.('${courseId}')"
              style="color:inherit;text-decoration:none;">
              ${esc(title)}
            </a>
          </div>
          <div class="bk-sub">${esc(when)} · ${esc(owner)}</div>
        </div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;">
        <span class="pill ok">${esc(t(_adminLocale(), 'common.enrolled'))}</span>
        ${canUserCancelBooking(b)
          ? `<button class="btn-small danger" onclick="window.cancelMyBooking?.('${bookingId}')">${esc(t(_adminLocale(), 'dashboard.unenroll'))}</button>`
          : ''}
      </div>
    </div>`
}

function _adminAccountSectionHtml() {
  const passesHtml = (userPasses ?? []).map(_adminAccountPassCard).join('')
  const bookingsHtml = (myBookings ?? []).map(_adminAccountBookingCard).join('')
  return `
    <div class="section-h" style="margin-top:0;">${esc(t(_adminLocale(), 'dashboard.sectionPasses'))}</div>
    ${passesHtml ? `<div class="nastenka-cards-2col">${passesHtml}</div>` : `<div class="empty">${esc(t(_adminLocale(), 'dashboard.emptyPasses'))}</div>`}
    ${passesHtml ? `
      <div class="card-meta" style="margin-top:10px;">
        ${esc(t(_adminLocale(), 'dashboard.refundNote'))}
      </div>
    ` : ''}
    <div class="section-h">${esc(t(_adminLocale(), 'dashboard.sectionBookings'))}</div>
    ${bookingsHtml ? `<div class="nastenka-cards-2col">${bookingsHtml}</div>` : `<div class="empty">${esc(t(_adminLocale(), 'dashboard.emptyBookings'))}</div>`}
  `
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const tag = _adminFmtLocaleTag()
  return d.toLocaleDateString(tag, { weekday: 'short', day: 'numeric', month: 'numeric' })
    + ' ' + d.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' })
}

/** Hodnota pro `<input type="datetime-local">` v lokálním čase. */
function _isoToDatetimeLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function _datetimeLocalInputToIso(s) {
  const t = String(s ?? '').trim()
  if (!t) return null
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function fmtTimeOnly(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString(_adminFmtLocaleTag(), { hour: '2-digit', minute: '2-digit' })
}

function initials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

function showErr(el, msg) {
  if (!el) return
  el.textContent = msg
  el.style.display = 'block'
}

async function fetchCoursesMap() {
  const cached = window.AppState?.courses
  if (cached?.length) {
    return Object.fromEntries(cached.map(c => [c.id, normalizeCourseRecord(c)]))
  }
  try {
    const { data } = await adminRace(
      sb.from('courses').select('id, title, color_code, description_short, images, is_workshop, owner_id'),
      'fetchCoursesMap',
    )
    return Object.fromEntries((data ?? []).map(c => [c.id, normalizeCourseRecord(c)]))
  } catch (e) {
    console.warn('[Debug] fetchCoursesMap: timeout nebo chyba → mapa bez titulků:', e?.message ?? e)
    return {}
  }
}

let _adminCustomersData = []
let _adminCustomersQuery = ''
let _adminCustomerHistoryUserId = null
let _adminCustomerHistoryDisplayName = ''

function _normalizeSearch(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function _sortTs(iso) {
  const t = iso ? new Date(iso).getTime() : 0
  return Number.isFinite(t) ? t : 0
}

function _adminBookingStatusLabel(status) {
  const k = String(status || '')
  const known = [
    PARTICIPATION_STATUS.PENDING_PAYMENT,
    PARTICIPATION_STATUS.CONFIRMED,
    PARTICIPATION_STATUS.CANCELLED,
    PARTICIPATION_STATUS.PAYMENT_EXPIRED,
    PARTICIPATION_STATUS.ATTENDED,
    PARTICIPATION_STATUS.MISSED,
  ]
  if (known.includes(k)) return _adm('bookingLessonStatus.' + k)
  return status || _adm('misc.dash')
}

function _adminLessonHistoryStatusColors(status) {
  const s = String(status || '')
  if (s === PARTICIPATION_STATUS.CONFIRMED || s === PARTICIPATION_STATUS.ATTENDED) return { bg: '#E1F5EE', c: '#085041' }
  if (s === PARTICIPATION_STATUS.PENDING_PAYMENT) return { bg: '#FFF4E0', c: '#8B5C00' }
  if (s === PARTICIPATION_STATUS.CANCELLED || s === PARTICIPATION_STATUS.PAYMENT_EXPIRED) return { bg: '#FCEBEB', c: '#791F1F' }
  if (s === PARTICIPATION_STATUS.MISSED) return { bg: '#FFF4E0', c: '#8B5C00' }
  return { bg: '#F3F4F6', c: '#6b6b6b' }
}

function _adminBookingSearchTokens(booking) {
  const lessonStart = booking?.lesson?.start_time
  if (!lessonStart) return []
  const d = new Date(lessonStart)
  if (Number.isNaN(d.getTime())) return []
  const weekday = d.toLocaleDateString('cs-CZ', { weekday: 'short' })
  const dateCs = fmtDate(lessonStart)
  const dateTimeCs = fmtDateTime(lessonStart)
  const timeCs = d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
  const dayMonth = d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })
  return [weekday, dateCs, dateTimeCs, timeCs, dayMonth, _adminBookingStatusLabel(booking?.status)]
}

function _adminPriceSearchTokens(amount) {
  const value = Number(amount)
  if (!Number.isFinite(value) || value < 0) return []
  const fixed = value.toFixed(2)
  const plain = fixed.replace(/\.00$/, '')
  const cs = fixed.replace('.', ',')
  return Array.from(new Set([
    plain,
    fixed,
    cs,
    `${plain} kc`,
    `${plain} kč`,
    `${fixed} kc`,
    `${cs} kč`,
    fmtPrice(value),
  ].map(_normalizeSearch).filter(Boolean)))
}

function _looksLikeMissingRefundColumns(err) {
  const msg = String(err?.message ?? err ?? '')
  return /refund_status|refund_note|refunded_at|refund_amount/i.test(msg) && /column/i.test(msg)
}

function _canFallbackAdminBookingCancel(err) {
  const msg = String(err?.message ?? err ?? '')
  return err?.code === 'PGRST202'
    || /Could not find the function/i.test(msg)
    || /admin_cancel_customer_booking/i.test(msg)
    || /booking_cancelled_admin/i.test(msg)
    || /email_notification_queue/i.test(msg)
    || _looksLikeMissingRefundColumns(err)
}

function _paymentAmount(payment) {
  const value = Number(payment?.amount ?? payment?.price_paid ?? 0)
  return Number.isFinite(value) ? value : 0
}

function _paymentRefundStatus(payment) {
  return payment?.refundStatus ?? payment?.refund_status ?? null
}

function _paymentRefundAmount(payment) {
  const stored = Number(payment?.refundAmount ?? payment?.refund_amount)
  if (Number.isFinite(stored) && stored >= 0) return stored
  return _paymentRefundStatus(payment) === 'completed' ? _paymentAmount(payment) : 0
}

function _paymentSupportsRefund(payment) {
  if (_paymentAmount(payment) <= 0) return false
  return payment?.type === 'pass'
    || (payment?.type === 'single' && payment?.status === 'cancelled')
}

function _effectiveRefundStatus(payment) {
  if (!_paymentSupportsRefund(payment)) return 'not_required'
  const stored = _paymentRefundStatus(payment)
  if (stored === 'completed' || stored === 'pending' || stored === 'not_required') return stored
  return payment?.type === 'single' && payment?.status === 'cancelled' ? 'pending' : 'not_required'
}

function _paymentCanStartRefund(payment) {
  return payment?.type === 'pass'
    && _paymentSupportsRefund(payment)
    && _effectiveRefundStatus(payment) === 'not_required'
}

function _sumGrossRevenue(rows) {
  return (rows ?? []).reduce((sum, row) => sum + _paymentAmount(row), 0)
}

function _sumCompletedRefunds(rows) {
  return (rows ?? []).reduce((sum, row) => {
    if (_effectiveRefundStatus(row) !== 'completed') return sum
    return sum + _paymentRefundAmount(row)
  }, 0)
}

function _refundFieldId(type, id, field) {
  return `refund-${field}-${type}-${id}`
}

function _renderAdminZakazniciList() {
  const listEl = document.getElementById('admin-zakaznici-list')
  const countEl = document.getElementById('admin-zakaznici-count')
  if (!listEl || !countEl) return

  const q = _normalizeSearch(_adminCustomersQuery)
  const filtered = !_adminCustomersData.length
    ? []
    : _adminCustomersData.filter(u => !q || u.searchText.includes(q))

  countEl.textContent = q
    ? _adm('customers.countShown', { shown: filtered.length, total: _adminCustomersData.length })
    : _adm('customers.countTotal', { total: _adminCustomersData.length })

  listEl.innerHTML = filtered.length
    ? `<div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;">${filtered.map(_zakaznikRow).join('')}</div>`
    : `<div class="empty">${esc(q ? _adm('customers.emptySearch') : _adm('customers.empty'))}</div>`
}

window.adminFilterZakaznici = (value) => {
  _adminCustomersQuery = String(value ?? '')
  _renderAdminZakazniciList()
}

function buildAdminCustomerHistoryModal() {
  if (document.getElementById('modal-admin-customer-history')) return
  document.body.insertAdjacentHTML('beforeend', `
    <div id="modal-admin-customer-history" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.38);
      z-index:300;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;"
      onclick="if(event.target===this)window.closeAdminCustomerHistoryModal?.()">
      <div style="background:#fff;border-radius:18px;border:1px solid var(--border);box-shadow:var(--shadow);
        width:min(860px, calc(100vw - 32px));max-width:860px;overflow:hidden;margin:auto;" onclick="event.stopPropagation()">
        <div style="padding:18px 18px 4px;">
          <div style="font-size:18px;font-weight:700;" id="mch-title">${esc(_adm('customers.historyModalTitle'))}</div>
        </div>
        <div id="mch-body" style="padding:14px 18px;overflow-y:auto;max-height:calc(100vh - 160px);"></div>
        <div style="display:flex;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--border);">
          <button type="button" class="btn-wide" onclick="window.closeAdminCustomerHistoryModal?.()">${esc(_adm('btn.close'))}</button>
        </div>
      </div>
    </div>`)
}

function _adminCustomerHistoryHtml(user) {
  const rows = user?.bookingHistory ?? []
  if (!rows.length) {
    return `<div class="empty" style="padding:12px 0;">${esc(_adm('customers.historyEmpty'))}</div>`
  }
  return `
    <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;">
      ${rows.map(b => {
        const title = loc(b.lesson?.course?.title) || _adm('misc.lessonFallback')
        const when = b.lesson?.start_time ? fmtDateTime(b.lesson.start_time) : _adm('misc.dash')
        const pay = b.payment_type === 'pass' ? _adm('payType.pass') : _adm('payType.single')
        const rawSt = b.status
        const status = _adminBookingStatusLabel(rawSt)
        const st = _adminLessonHistoryStatusColors(rawSt)
        return `
          <div style="display:flex;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);align-items:flex-start;">
            <div style="min-width:0;flex:1;">
              <div style="font-size:13px;font-weight:600;margin-bottom:4px;">${esc(title)}</div>
              <div style="font-size:11px;color:#6b6b6b;line-height:1.5;">${esc(when)} · ${esc(pay)}</div>
              <div style="font-size:10px;color:#9b9b9b;margin-top:4px;">${_adm('customers.historyBookedOn', { date: b.created_at ? fmtDate(b.created_at) : _adm('misc.dash') })}</div>
            </div>
            <span style="font-size:10px;font-weight:600;padding:3px 8px;border-radius:20px;background:${st.bg};color:${st.c};white-space:nowrap;">
              ${esc(status)}
            </span>
          </div>`
      }).join('')}
    </div>`
}

window.openAdminCustomerHistoryModal = (userId, displayName = null) => {
  buildAdminCustomerHistoryModal()
  _adminCustomerHistoryUserId = userId
  const user = _adminCustomersData.find(u => String(u.id) === String(userId))
  _adminCustomerHistoryDisplayName = displayName || user?.name || user?.email || _adm('misc.customerFallback')
  const titleEl = document.getElementById('mch-title')
  const bodyEl = document.getElementById('mch-body')
  const modal = document.getElementById('modal-admin-customer-history')
  if (!bodyEl || !modal) return
  if (titleEl) titleEl.textContent = _adm('customers.historyTitle', { name: _adminCustomerHistoryDisplayName })
  bodyEl.innerHTML = _adminCustomerHistoryHtml(user)
  modal.style.display = 'flex'
}

window.closeAdminCustomerHistoryModal = () => {
  const modal = document.getElementById('modal-admin-customer-history')
  if (modal) modal.style.display = 'none'
  _adminCustomerHistoryUserId = null
}

// ── Admin Dashboard ──────────────────────────────────────────
export async function renderAdminDashboard() {
  // Dashboard agreguje statistiky napříč všemi lektory — pro lektora není relevantní (a RLS by mu vrátila částečná čísla).
  if (!_isStaffAdmin()) return
  const el = document.getElementById('admin-dash-content')
  if (!el) return

  const prevHtml = el.innerHTML
  const loadNeedle = _adm('loading.overview')
  const stable = _adminHadStableContent(prevHtml, loadNeedle)
  if (stable) {
    console.log('[Debug] Admin dashboard: obnovuji data na pozadí (ponechávám předchozí obsah až 3 s)')
  } else {
    el.innerHTML = `<div class="empty" style="padding:40px;">${esc(loadNeedle)}</div>`
  }

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const weekEnd  = new Date(today); weekEnd.setDate(today.getDate() + 7)

  try {
    await adminRace((async () => {
    const [
      { data: todayAvail },
      { data: weekAvail },
      { data: allAvail },
      activePassRowsRes,
    ] = await Promise.all([
      sb.from('lesson_availability')
        .select('lesson_id, course_id, start_time, end_time, capacity, booked_count, available_spots')
        .gte('start_time', today.toISOString()).lt('start_time', tomorrow.toISOString())
        .eq('status', 'active').order('start_time'),
      sb.from('lesson_availability')
        .select('lesson_id, course_id, start_time, end_time, capacity, booked_count, available_spots')
        .gte('start_time', tomorrow.toISOString()).lt('start_time', weekEnd.toISOString())
        .eq('status', 'active').order('start_time'),
      sb.from('lesson_availability')
        .select('lesson_id, course_id, start_time, end_time, capacity, booked_count, available_spots')
        .gte('start_time', today.toISOString())
        .eq('status', 'active').order('start_time').limit(80),
      sb.from('user_passes')
        .select('id, pass:passes(owner_id)')
        .eq('status', 'active'),
    ])

    const courseMap = await fetchCoursesMap()
    const enrich = rows => (rows ?? []).map(l => ({ ...l, course: courseMap[l.course_id] }))
    const todayLessons = enrich(todayAvail)
    const weekLessons  = enrich(weekAvail)
    const allLessons   = enrich(allAvail)
    const ownCourseOwnerId = String(currentUser?.id ?? '')
    const belongsToCurrentAdmin = l => String(l.course?.owner_id ?? l.course?.owner?.id ?? '') === ownCourseOwnerId
    const useMineScope = _adminDashboardView === 'moje'
    const shownTodayLessons = useMineScope ? todayLessons.filter(belongsToCurrentAdmin) : todayLessons
    const shownWeekLessons  = useMineScope ? weekLessons.filter(belongsToCurrentAdmin) : weekLessons
    const shownAllLessons   = useMineScope ? allLessons.filter(belongsToCurrentAdmin) : allLessons
    if (activePassRowsRes.error) throw activePassRowsRes.error
    const activePassRows = activePassRowsRes.data ?? []
    const activePassCount = useMineScope
      ? activePassRows.filter(row => {
          const pass = Array.isArray(row.pass) ? row.pass[0] : row.pass
          return String(pass?.owner_id ?? '') === ownCourseOwnerId
        }).length
      : activePassRows.length

    const totalCap    = shownTodayLessons.reduce((s, l) => s + (l.capacity ?? 0), 0)
    const totalBooked = shownTodayLessons.reduce((s, l) => s + (Number(l.booked_count) || 0), 0)
    const occupancy   = totalCap > 0 ? Math.round((totalBooked / totalCap) * 100) : 0

    const lessonScopeHtml = `
      <div class="admin-stat-grid">
        <div class="admin-stat-card">
          <div class="admin-stat-value">${shownTodayLessons.length}</div>
          <div class="admin-stat-label">${esc(_adm('dashboard.statTodayLessons'))}</div>
        </div>
        <div class="admin-stat-card">
          <div class="admin-stat-value">${occupancy}&thinsp;%</div>
          <div class="admin-stat-label">${esc(_adm('dashboard.statOccupancy'))}</div>
        </div>
        <div class="admin-stat-card">
          <div class="admin-stat-value">${activePassCount}</div>
          <div class="admin-stat-label">${esc(_adm('dashboard.statActivePasses'))}</div>
        </div>
      </div>
      <div class="admin-section-title">${esc(_adm('dashboard.sectionToday'))}</div>
      ${shownTodayLessons.length ? `<div class="nastenka-cards-2col">${shownTodayLessons.map(l => _lessonRow(l)).join('')}</div>` : `<div class="empty">${esc(_adm('dashboard.emptyToday'))}</div>`}
      <div class="admin-section-title">${esc(_adm('dashboard.sectionWeek'))}</div>
      ${shownWeekLessons.length ? `<div class="nastenka-cards-2col">${shownWeekLessons.map(l => _lessonRow(l, true)).join('')}</div>` : `<div class="empty">${esc(_adm('dashboard.emptyWeek'))}</div>`}
      <div class="admin-section-title">${esc(_adminLocale() === 'en' ? 'All lessons' : 'Všechny lekce')}</div>
      ${shownAllLessons.length ? `<div class="nastenka-cards-2col">${shownAllLessons.map(l => _lessonRow(l, true)).join('')}</div>` : `<div class="empty">${esc(_adminLocale() === 'en' ? 'No upcoming lessons.' : 'Žádné nadcházející lekce.')}</div>`}`

    el.innerHTML = `
      <div style="margin-bottom:22px;">
        <div class="page-title" style="margin-bottom:14px;">${esc(_adm('dashboard.title'))}</div>
        ${_adminDashboardSwitchHtml()}
      </div>
      ${lessonScopeHtml}
    `
    })(), 'admin-dashboard')
  } catch (err) {
    if (err?.code === 'TIMEOUT' && stable) {
      console.warn('[Debug] Admin dashboard: timeout 3 s — obnovuji předchozí obsah (žádný visící spinner)')
      el.innerHTML = prevHtml
      return
    }
    console.error('[Admin] renderAdminDashboard:', err)
    el.innerHTML = `<div class="empty">${esc(_adm('err.loadData'))}</div>`
  }
}

export async function renderLektorDashboard() {
  if (!_isStaffLektor()) return
  const el = document.getElementById('nastenka-content')
  if (!el) return

  const prevHtml = el.innerHTML
  const loadNeedle = _adm('loading.overview')
  const stable = _adminHadStableContent(prevHtml, loadNeedle)
  if (stable) {
    console.log('[Debug] Lektor dashboard: obnovuji data na pozadí')
  } else {
    el.innerHTML = `<div class="empty" style="padding:40px;">${esc(loadNeedle)}</div>`
  }

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7)

  try {
    await adminRace((async () => {
      const { data: ownCourses, error: coursesErr } = await sb.from('courses')
        .select('id, title, color_code, description_short, images, is_workshop, owner_id')
        .eq('owner_id', currentUser?.id)
        .eq('is_active', true)
      if (coursesErr) throw coursesErr

      const courseRows = ownCourses ?? []
      const courseIds = courseRows.map(c => c.id)
      const courseMap = Object.fromEntries(courseRows.map(c => [c.id, normalizeCourseRecord(c)]))

      let todayAvail = []
      let weekAvail = []
      let allAvail = []
      if (courseIds.length) {
        ;[
          { data: todayAvail = [] },
          { data: weekAvail = [] },
          { data: allAvail = [] },
        ] = await Promise.all([
          sb.from('lesson_availability')
            .select('lesson_id, course_id, start_time, end_time, capacity, booked_count, available_spots')
            .in('course_id', courseIds)
            .gte('start_time', today.toISOString()).lt('start_time', tomorrow.toISOString())
            .eq('status', 'active').order('start_time'),
          sb.from('lesson_availability')
            .select('lesson_id, course_id, start_time, end_time, capacity, booked_count, available_spots')
            .in('course_id', courseIds)
            .gte('start_time', tomorrow.toISOString()).lt('start_time', weekEnd.toISOString())
            .eq('status', 'active').order('start_time'),
          sb.from('lesson_availability')
            .select('lesson_id, course_id, start_time, end_time, capacity, booked_count, available_spots')
            .in('course_id', courseIds)
            .gte('start_time', today.toISOString())
            .eq('status', 'active').order('start_time').limit(80),
        ])
      }

      const enrich = rows => (rows ?? []).map(l => ({ ...l, course: courseMap[l.course_id] }))
      const todayLessons = enrich(todayAvail)
      const weekLessons = enrich(weekAvail)
      const allLessons = enrich(allAvail)

      let activePassCount = 0
      try {
        const { data: ownPasses, error: passesErr } = await sb.from('passes')
          .select('id')
          .eq('owner_id', currentUser?.id)
          .eq('is_active', true)
        if (passesErr) throw passesErr
        const passIds = (ownPasses ?? []).map(p => p.id)
        if (passIds.length) {
          const { count, error: userPassesErr } = await sb.from('user_passes')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'active')
            .in('pass_id', passIds)
          if (userPassesErr) throw userPassesErr
          activePassCount = count ?? 0
        }
      } catch (passErr) {
        console.warn('[Lektor dashboard] Aktivní permanentky se nepodařilo načíst:', passErr)
      }

      const totalCap = todayLessons.reduce((s, l) => s + (l.capacity ?? 0), 0)
      const totalBooked = todayLessons.reduce((s, l) => s + (Number(l.booked_count) || 0), 0)
      const occupancy = totalCap > 0 ? Math.round((totalBooked / totalCap) * 100) : 0

      el.innerHTML = `
        <div class="admin-stat-grid">
          <div class="admin-stat-card">
            <div class="admin-stat-value">${todayLessons.length}</div>
            <div class="admin-stat-label">${esc(_adm('dashboard.statTodayLessons'))}</div>
          </div>
          <div class="admin-stat-card">
            <div class="admin-stat-value">${occupancy}&thinsp;%</div>
            <div class="admin-stat-label">${esc(_adm('dashboard.statOccupancy'))}</div>
          </div>
          <div class="admin-stat-card">
            <div class="admin-stat-value">${activePassCount}</div>
            <div class="admin-stat-label">${esc(_adm('dashboard.statActivePasses'))}</div>
          </div>
        </div>
        <div class="admin-section-title">${esc(_adm('dashboard.sectionToday'))}</div>
        ${todayLessons.length ? `<div class="nastenka-cards-2col">${todayLessons.map(l => _lessonRow(l)).join('')}</div>` : `<div class="empty">${esc(_adm('dashboard.emptyToday'))}</div>`}
        <div class="admin-section-title">${esc(_adm('dashboard.sectionWeek'))}</div>
        ${weekLessons.length ? `<div class="nastenka-cards-2col">${weekLessons.map(l => _lessonRow(l, true)).join('')}</div>` : `<div class="empty">${esc(_adm('dashboard.emptyWeek'))}</div>`}
        <div class="admin-section-title">${esc(_adminLocale() === 'en' ? 'All lessons' : 'Všechny lekce')}</div>
        ${allLessons.length ? `<div class="nastenka-cards-2col">${allLessons.map(l => _lessonRow(l, true)).join('')}</div>` : `<div class="empty">${esc(_adminLocale() === 'en' ? 'No upcoming lessons.' : 'Žádné nadcházející lekce.')}</div>`}
      `
    })(), 'lektor-dashboard')
  } catch (err) {
    if (err?.code === 'TIMEOUT' && stable) {
      console.warn('[Debug] Lektor dashboard: timeout — obnovuji předchozí obsah')
      el.innerHTML = prevHtml
      return
    }
    console.error('[Admin] renderLektorDashboard:', err)
    el.innerHTML = `<div class="empty">${esc(_adm('err.loadData'))}</div>`
  }
}

window.renderLektorDashboard = renderLektorDashboard

window.adminLessonActionButtons = (lessonId, status = 'active', startTime = null) => {
  const lid = String(lessonId ?? '').replace(/'/g, "\'")
  const isPast = startTime ? new Date(startTime).getTime() < Date.now() : true
  if (status === 'cancelled') {
    const deleteBtn = isPast
      ? `<button type="button" class="btn-small danger" style="font-size:11px;padding:6px 10px;"
          onclick="event.stopPropagation();window.adminDeleteLesson?.('${lid}')">${esc(_adm('btn.delete'))}</button>`
      : ''
    return `<button type="button" class="btn-small" style="font-size:11px;padding:6px 10px;"
      onclick="event.stopPropagation();window.adminActivateLesson?.('${lid}')">${esc(_adm('btn.activate'))}</button>${deleteBtn}`
  }
  return `<button type="button" class="btn-small" style="font-size:11px;padding:6px 10px;"
      onclick="event.stopPropagation();window.adminOpenLessonDetail?.('${lid}')">${esc(_adm('btn.attendees'))}</button>
    <button type="button" class="btn-small danger" style="font-size:11px;padding:6px 10px;"
      onclick="event.stopPropagation();window.adminDeactivateLesson?.('${lid}')">${esc(_adm('btn.deactivate'))}</button>`
}

function _lessonRow(lesson, showDate = false) {
  const color   = _courseThemeHex(lesson.course?.color_code)
  const course  = lesson.course || {}
  const title   = loc(course.title) || _adm('misc.lessonFallback')
  const booked  = Number(lesson.booked_count || 0)
  const cap     = lesson.capacity ?? 0
  const pct     = cap > 0 ? Math.round((booked / cap) * 100) : 0
  const tag     = _adminFmtLocaleTag()
  const dateStr = new Date(lesson.start_time).toLocaleDateString(tag, { weekday: 'short', day: 'numeric', month: 'numeric' })
  const timeStr = `${fmtTimeOnly(lesson.start_time)}–${fmtTimeOnly(lesson.end_time || lesson.start_time)}`
  const status  = lesson.status ?? 'active'
  const lid     = String(lesson.lesson_id ?? lesson.id ?? '')
  const workshopBadge = course.is_workshop
    ? ` <span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:20px;background:#FFF4E0;color:#8B5C00;">${esc(_adm('kurzy.workshopBadge'))}</span>`
    : ''
  const actions = window.adminLessonActionButtons?.(lid, status, lesson.start_time) ?? ''
  const courseId  = esc(String(lesson.course_id ?? course.id ?? ''))
  const rowOpacity = status === 'cancelled' ? 'opacity:.75;' : ''
  return `
    <div class="staff-term-card" style="border:1px solid ${color};border-radius:12px;overflow:hidden;margin-bottom:10px;background:#fff;${rowOpacity}">
      <div style="display:flex;">
        <div onclick="window.openDetail?.('${courseId}')" style="flex:1;padding:12px 14px;display:flex;align-items:flex-start;gap:12px;cursor:pointer;">
          <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;margin-top:5px;"></div>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;">
            <div style="font-size:13px;font-weight:600;line-height:1.35;">${esc(title)}${workshopBadge}</div>
            <div style="font-size:11px;color:#6b6b6b;">${showDate ? esc(dateStr) + ' · ' : ''}${esc(timeStr)}</div>
            <div style="margin-top:2px;">
              <div style="font-size:13px;font-weight:600;">${booked}/${cap}</div>
              <div style="font-size:10px;color:#9b9b9b;margin-bottom:4px;">${esc(t(_adminLocale(), 'courses.occupied'))}</div>
              <div style="width:100%;height:4px;background:rgba(0,0,0,.08);border-radius:99px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:${color};border-radius:99px;"></div>
              </div>
            </div>
          </div>
        </div>
        <div style="flex-shrink:0;padding:12px 14px 12px 0;">
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${actions}
          </div>
        </div>
      </div>
    </div>`
}

// ── Admin Kurzy ──────────────────────────────────────────────
export async function renderAdminKurzy() {
  const el = document.getElementById('admin-kurzy-content')
  if (!el) return
  const prevHtml = el.innerHTML
  const loadNeedle = _adm('loading.courses')
  const stable = _adminHadStableContent(prevHtml, loadNeedle)
  if (stable) {
    console.log('[Debug] Admin kurzy: obnovuji na pozadí, zachovávám poslední seznam')
  } else {
    el.innerHTML = `<div class="empty" style="padding:40px;">${esc(loadNeedle)}</div>`
  }
  try {
    await adminRace((async () => {
    let baseQuery = sb.from('courses')
      .select('id, title, color_code, is_active, is_workshop, is_restricted, capacity_default, price_single, cancellation_hours, schedule_days, schedule_time_start, schedule_time_end, owner:users!owner_id(id,name)')
      .order('title->cs')
    if (_isStaffAdmin() && _adminCoursesScope === 'moje' && currentUser?.id) {
      baseQuery = baseQuery.eq('owner_id', currentUser.id)
    }
    const { data: courses, error } = await _scopeOwnerQuery(baseQuery)
    if (error) throw error
    const courseRows = courses ?? []
    const courseIds = courseRows.map(c => c.id).filter(Boolean)
    let lessonsByCourse = {}
    if (courseIds.length) {
      const { data: lessons, error: lessonsErr } = await sb.from('lessons')
        .select('id, course_id, start_time, end_time, status')
        .in('course_id', courseIds)
        .in('status', ['active', 'cancelled'])
        .order('start_time', { ascending: true })
      if (lessonsErr) throw lessonsErr
      lessonsByCourse = (lessons ?? []).reduce((acc, lesson) => {
        const cid = lesson.course_id
        if (!cid) return acc
        if (!acc[cid]) acc[cid] = []
        acc[cid].push(lesson)
        return acc
      }, {})
    }
    const coursesWithLessons = courseRows.map(course => ({
      ...course,
      _adminLessons: lessonsByCourse[course.id] ?? [],
    }))
    const pageTitle = _isStaffLektor() ? _adm('kurzy.pageMine') : _adm('kurzy.pageAll')
    const scopeSwitchHtml = _isStaffAdmin() ? _adminScopeSwitchHtml(_adminCoursesScope, 'adminSetCoursesScope') : ''
    const activeCourses = coursesWithLessons.filter(c => c.is_active)
    const inactiveCourses = coursesWithLessons.filter(c => !c.is_active)
    let listBody = ''
    if (!activeCourses.length && !inactiveCourses.length) {
      listBody = `<div class="empty">${esc(_adm('kurzy.empty'))}</div>`
    } else {
      if (activeCourses.length) {
        listBody += `<div style="font-size:12px;color:#6b6b6b;margin-bottom:12px;">${_adm('kurzy.nActive', { n: activeCourses.length })}</div>`
        listBody += `<div class="nastenka-cards-2col">${activeCourses.map(_courseCard).join('')}</div>`
      }
      if (inactiveCourses.length) {
        listBody += `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin:20px 0 10px;">
          <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--section-heading-accent);font-weight:600;">${esc(_adm('kurzy.sectionInactive'))}</div>
          <button type="button" class="btn-small danger" style="font-size:11px;padding:6px 10px;"
            onclick="window.adminDeleteAllInactiveCourses?.()">${esc(_adm('courseActions.deleteAll'))}</button>
        </div>`
        listBody += `<div style="font-size:12px;color:#6b6b6b;margin-bottom:12px;">${_adm('kurzy.nInactiveDelete', { n: inactiveCourses.length })}</div>`
        listBody += `<div class="nastenka-cards-2col">${inactiveCourses.map(_courseCard).join('')}</div>`
      }
    }
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div class="page-title">${esc(pageTitle)}</div>
        <div style="display:flex;gap:8px;">
          <button class="btn-small" onclick="window.adminNewWorkshop?.()">${esc(_adm('btn.newWorkshop'))}</button>
          <button class="btn-small" onclick="window.adminNewCourse?.()">${esc(_adm('btn.newCourse'))}</button>
        </div>
      </div>
      ${scopeSwitchHtml}
      ${listBody}
    `
    })(), 'admin-kurzy')
  } catch (err) {
    if (err?.code === 'TIMEOUT' && stable) {
      console.warn('[Debug] Admin kurzy: timeout — vrácen poslední seznam')
      el.innerHTML = prevHtml
      return
    }
    console.error('[Admin] renderAdminKurzy:', err)
    el.innerHTML = `<div class="empty">${esc(_adm('err.loadCourses'))}</div>`
  }
}

function _adminCourseScheduleHtml(course) {
  const infoBox = (label, value, sub = '') => `
    <div style="margin-top:10px;border:1px solid var(--border);border-radius:10px;padding:8px 10px;background:#faf8f5;">
      <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9b6f5f;margin-bottom:3px;">
        ${esc(label)}
      </div>
      <div style="font-size:12px;font-weight:600;color:#2f2a24;">${esc(value)}</div>
      ${sub ? `<div style="font-size:11px;color:#6b6b6b;margin-top:3px;">${esc(sub)}</div>` : ''}
    </div>`

  const lessons = Array.isArray(course._adminLessons) ? course._adminLessons : []
  if (course.is_workshop) {
    const lesson = lessons[0]
    const when = lesson?.start_time
      ? `${fmtDateTime(lesson.start_time)}${lesson.end_time ? `–${fmtTimeOnly(lesson.end_time)}` : ''}`
      : _adm('kurzy.workshopDateMissing')
    return infoBox(_adm('kurzy.workshopDateTime'), when)
  }

  const dayLabels = _adminLocale() === 'en'
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']
  const days = (course.schedule_days ?? [])
    .map(Number)
    .filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b)
    .map(d => dayLabels[d])
  const timeFrom = course.schedule_time_start ? String(course.schedule_time_start).slice(0, 5) : ''
  const timeTo = course.schedule_time_end ? String(course.schedule_time_end).slice(0, 5) : ''
  const scheduleText = days.length && timeFrom && timeTo
    ? `${days.join(', ')} · ${timeFrom}–${timeTo}`
    : _adm('kurzy.scheduleMissing')
  const nowMs = Date.now()
  const upcomingActiveLessons = lessons.filter(lesson =>
    lesson.status === 'active'
    && lesson.start_time
    && new Date(lesson.start_time).getTime() >= nowMs
  )
  const nextLesson = upcomingActiveLessons[0]
  const lastLesson = upcomingActiveLessons[upcomingActiveLessons.length - 1]
  const lessonsText = _adm('kurzy.listedLessonsCount', { n: upcomingActiveLessons.length })
  const lessonsRangeText = nextLesson?.start_time && lastLesson?.start_time
    ? _adm('kurzy.listedLessonsRange', {
      first: fmtDate(nextLesson.start_time),
      last: fmtDate(lastLesson.start_time),
    })
    : _adm('kurzy.noUpcomingLessons')
  return `
    ${infoBox(_adm('kurzy.schedule'), scheduleText)}
    ${infoBox(_adm('kurzy.listedLessons'), lessonsText, lessonsRangeText)}`
}

function _courseCard(course) {
  const color      = _courseThemeHex(course.color_code)
  const title      = loc(course.title) || _adm('misc.courseFallback')
  const ownerName  = Array.isArray(course.owner) ? course.owner[0]?.name : course.owner?.name
  const active     = course.is_active
  const isWorkshop = !!course.is_workshop
  const editFn     = isWorkshop ? 'adminEditWorkshop' : 'adminEditCourse'
  const workshopLbl = _adm('kurzy.workshopBadge')
  const deactBadge = _adm('state.deactivatedBadge')
  const actionBtnStyle = 'font-size:11px;padding:6px 10px;'
  const topUpBtn = active && !isWorkshop
    ? `<button class="btn-small" style="${actionBtnStyle}" onclick="window.adminTopUpCourseLessons?.('${esc(course.id)}')">${esc(_adm('courseActions.topUpLessons'))}</button>`
    : ''
  const scheduleHtml = _adminCourseScheduleHtml(course)
  return `
    <div class="admin-course-card" style="border:1px solid ${color};border-radius:12px;overflow:hidden;margin-bottom:10px;background:#fff;display:flex;${active ? '' : 'opacity:.75;'}">
      <div style="width:5px;background:${color};flex-shrink:0;"></div>
      <div style="flex:1;padding:14px 16px;display:flex;flex-direction:column;">
        <div role="button" tabindex="0" onclick="window.openDetail?.('${esc(course.id)}')"
          onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.openDetail?.('${esc(course.id)}')}"
          style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;cursor:pointer;flex:1;">
          <div>
            <div style="font-size:14px;font-weight:600;margin-bottom:5px;display:flex;align-items:center;gap:8px;">
              ${esc(title)}
              ${isWorkshop ? `<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;background:#FFF4E0;color:#8B5C00;letter-spacing:.04em;">${esc(workshopLbl)}</span>` : ''}
              ${course.is_restricted ? `<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;background:#E8EEF8;color:#2854B9;letter-spacing:.04em;">${esc(_adm('kurzy.restrictedBadge'))}</span>` : ''}
              ${!active ? `<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;background:#F3F4F6;color:#6b6b6b;margin-left:4px;">${esc(deactBadge)}</span>` : ''}
            </div>
            <div style="font-size:11px;color:#6b6b6b;display:flex;gap:12px;flex-wrap:wrap;">
              <span>${esc(_adm('kurzy.instructor'))} <b>${esc(ownerName ?? _adm('misc.dash'))}</b></span>
              <span>${esc(_adm('kurzy.capacity'))} ${course.capacity_default} ${_adm('misc.spotsSuffix')}</span>
              ${!isWorkshop ? `<span>${esc(_adm('kurzy.cancellation'))} ${course.cancellation_hours} ${_adm('kurzy.hoursShort')}</span>` : ''}
            </div>
            ${scheduleHtml}
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:16px;font-weight:700;color:${color};">${fmtPrice(course.price_single)}</div>
            <span style="font-size:10px;font-weight:600;padding:3px 8px;border-radius:20px;
              background:${active ? '#E1F5EE' : '#F3F4F6'};color:${active ? '#085041' : '#6b6b6b'};">
              ${esc(active ? _adm('state.active') : _adm('state.inactive'))}
            </span>
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:auto;padding-top:12px;flex-wrap:wrap;">
          <button class="btn-small" style="${actionBtnStyle}" onclick="window.${editFn}?.('${esc(course.id)}')">${esc(_adm('btn.edit'))}</button>
          ${active
            ? `${topUpBtn}
               <button class="btn-small danger" style="${actionBtnStyle}" onclick="window.adminToggleCourse?.('${esc(course.id)}',false)">${esc(_adm('btn.deactivate'))}</button>`
            : `<button class="btn-small" style="${actionBtnStyle}" onclick="window.adminToggleCourse?.('${esc(course.id)}',true)">${esc(_adm('btn.activate'))}</button>
               <button class="btn-small danger" style="${actionBtnStyle}" onclick="window.adminDeleteCourse?.('${esc(course.id)}')">${esc(_adm('btn.delete'))}</button>`}
        </div>
      </div>
    </div>`
}

// ── Admin Zákazníci ──────────────────────────────────────────
export async function renderAdminZakaznici() {
  // Zákazníci jsou admin-only sekce — lektor v sidebaru nevidí, ale ochrana navíc.
  if (!_isStaffAdmin()) return
  const el = document.getElementById('admin-zakaznici-content')
  if (!el) return
  const prevHtml = el.innerHTML
  const loadNeedle = _adm('loading.customers')
  const stable = _adminHadStableContent(prevHtml, loadNeedle)
  if (stable) {
    console.log('[Debug] Admin zákazníci: obnovuji na pozadí')
  } else {
    el.innerHTML = `<div class="empty" style="padding:40px;">${esc(loadNeedle)}</div>`
  }
  try {
    await adminRace((async () => {
    const { data: users, error } = await sb.from('users')
      .select('id, name, email, created_at').eq('role', 'uzivatel')
      .not('email', 'like', 'deleted_%@%').order('created_at', { ascending: false })
    if (error) throw error

    const userIds = (users ?? []).map(u => u.id)
    let bookingRows = [], passRows = []
    if (userIds.length > 0) {
      const [{ data: bookings }, { data: passes }] = await Promise.all([
        sb.from('bookings')
          .select('id, user_id, status, payment_type, price_paid, created_at, lesson:lessons(start_time,end_time,course:courses(title))')
          .in('user_id', userIds),
        sb.from('user_passes')
          .select('user_id, status, price_paid, created_at, pass:passes(name,allowed_course_ids)')
          .in('user_id', userIds),
      ])
      bookingRows = bookings ?? []
      passRows = passes ?? []
    }

    const bookingsByUser = {}
    const passesByUser = {}
    for (const b of bookingRows) {
      if (!bookingsByUser[b.user_id]) bookingsByUser[b.user_id] = []
      bookingsByUser[b.user_id].push(b)
    }
    for (const up of passRows) {
      if (!passesByUser[up.user_id]) passesByUser[up.user_id] = []
      passesByUser[up.user_id].push(up)
    }

    _adminCustomersData = (users ?? []).map(user => {
      const userBookings = bookingsByUser[user.id] ?? []
      const userPasses = passesByUser[user.id] ?? []
      const activeLessons = userBookings.filter(b => b.status === 'booked')
      const activePasses = userPasses.filter(up => up.status === 'active')
      const lastActivityAt = [...userBookings, ...userPasses]
        .reduce((acc, row) => _sortTs(row?.created_at) > _sortTs(acc) ? row.created_at : acc, user.created_at)
      const lastBookingPurchaseAt = userBookings
        .filter(b => b.payment_type === 'single' && Number(b.price_paid || 0) > 0)
        .reduce((acc, b) => _sortTs(b.created_at) > _sortTs(acc) ? b.created_at : acc, null)
      const lastPassPurchaseAt = userPasses
        .filter(up => Number(up.price_paid || 0) > 0)
        .reduce((acc, up) => _sortTs(up.created_at) > _sortTs(acc) ? up.created_at : acc, null)
      const lastPurchaseAt = _sortTs(lastBookingPurchaseAt) >= _sortTs(lastPassPurchaseAt)
        ? lastBookingPurchaseAt
        : lastPassPurchaseAt
      const activePassLabels = activePasses.map(up => loc(up.pass?.name) || _adm('misc.pass')).filter(Boolean)
      const bookingHistory = [...userBookings].sort((a, b) => {
        const primary = _sortTs(b.lesson?.start_time) - _sortTs(a.lesson?.start_time)
        return primary || (_sortTs(b.created_at) - _sortTs(a.created_at))
      })
      const bookedCourseTitles = userBookings.map(b => loc(b.lesson?.course?.title)).filter(Boolean)
      const purchasedPassTitles = userPasses.map(up => loc(up.pass?.name)).filter(Boolean)
      const paymentAmountTokens = [
        ...userBookings.flatMap(b => _adminPriceSearchTokens(b.price_paid)),
        ...userPasses.flatMap(up => _adminPriceSearchTokens(up.price_paid)),
      ]
      const searchText = _normalizeSearch([
        user.name,
        user.email,
        ...bookedCourseTitles,
        ...purchasedPassTitles,
        ...userBookings.flatMap(_adminBookingSearchTokens),
        ...paymentAmountTokens,
      ].join(' | '))

      return {
        ...user,
        activeLessonsCount: activeLessons.length,
        activePassCount: activePasses.length,
        activePassLabels,
        bookingHistory,
        lastActivityAt,
        lastPurchaseAt,
        sortAt: _sortTs(lastPurchaseAt) || _sortTs(lastActivityAt) || _sortTs(user.created_at),
        searchText,
      }
    }).sort((a, b) => b.sortAt - a.sortAt)

    el.innerHTML = `
      <div class="page-title" style="margin-bottom:8px;">${esc(_adm('customers.pageTitle'))}</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
        <div id="admin-zakaznici-count" style="font-size:12px;color:#6b6b6b;">${esc(_adm('customers.countTotal', { total: 0 }))}</div>
        <input
          id="admin-zakaznici-search"
          type="search"
          value="${esc(_adminCustomersQuery)}"
          placeholder="${esc(_adm('customers.searchPlaceholder'))}"
          oninput="window.adminFilterZakaznici?.(this.value)"
          style="width:100%;max-width:380px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;font-size:13px;background:#fff;outline:none;box-sizing:border-box;"
        />
      </div>
      <div id="admin-zakaznici-list"></div>
    `
    _renderAdminZakazniciList()
    })(), 'admin-zakaznici')
  } catch (err) {
    if (err?.code === 'TIMEOUT' && stable) {
      console.warn('[Debug] Admin zákazníci: timeout — ponechávám poslední tabulku')
      el.innerHTML = prevHtml
      return
    }
    console.error('[Admin] renderAdminZakaznici:', err)
    el.innerHTML = `<div class="empty">${esc(_adm('err.loadCustomers'))}</div>`
  }
}

function _zakaznikRow(user) {
  const passes = user.activePassLabels ?? []
  const summary = [
    _adm('customers.metaActiveLessons', { n: user.activeLessonsCount ?? 0 }),
    _adm('customers.metaActivePasses', { n: user.activePassCount ?? 0 }),
    _adm('customers.metaLastActivity', {
      when: user.lastActivityAt ? fmtDate(user.lastActivityAt) : _adm('customers.metaNoActivity'),
    }),
  ].join(' · ')
  return `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap;">
      <div style="width:36px;height:36px;border-radius:50%;background:var(--primary);color:#fff;
        display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;">
        ${esc(initials(user.name || user.email))}
      </div>
      <div style="flex:1 1 260px;min-width:0;overflow-wrap:anywhere;word-break:break-word;">
        <div style="font-size:13px;font-weight:500;line-height:1.4;">${esc(user.name || _adm('misc.dash'))}</div>
        <div style="font-size:11px;color:#6b6b6b;line-height:1.45;margin-top:2px;">${esc(user.email)}</div>
        <div style="font-size:11px;color:#8a8c90;line-height:1.45;margin-top:4px;">${esc(summary)}</div>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-start;flex:1 1 160px;min-width:0;">
        ${passes.slice(0, 2).map(up => `
          <span style="font-size:10px;font-weight:500;padding:2px 7px;border-radius:20px;
            background:rgba(40,84,185,.10);color:var(--primary);border:1px solid rgba(40,84,185,.18);line-height:1.35;overflow-wrap:anywhere;word-break:break-word;max-width:100%;">
            ${esc(up || _adm('misc.pass'))}
          </span>`).join('')}
      </div>
      <div style="flex:0 1 auto;">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button type="button" class="btn-small"
            onclick="window.openAdminCustomerHistoryModal?.('${esc(user.id)}')">${esc(_adm('customers.btnHistory'))}</button>
          <button type="button" class="btn-small" title="${esc(_adm('customers.tooltipEditPasses'))}"
            data-admin-user-passes-open="1"
            data-user-id="${esc(user.id)}"
            data-display-name="${esc(user.name || user.email || _adm('misc.customerFallback'))}">${esc(_adm('customers.btnPasses'))}</button>
        </div>
      </div>
    </div>`
}

let _mupEditUserId = null
let _mupDisplayName = ''
let _mupAvailablePasses = []

function buildAdminCustomerPassesModal() {
  if (document.getElementById('modal-admin-user-passes')) return
  document.body.insertAdjacentHTML('beforeend', `
    <div id="modal-admin-user-passes" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.38);
      z-index:300;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;"
      onclick="if(event.target===this)window.closeAdminCustomerPassesModal?.()">
      <div id="mup-panel" style="background:#fff;border-radius:18px;border:1px solid var(--border);box-shadow:var(--shadow);
        width:min(860px, calc(100vw - 32px));max-width:860px;overflow:hidden;margin:auto;">
        <div style="padding:18px 18px 4px;">
          <div style="font-size:18px;font-weight:700;" id="mup-title">${esc(_adm('misc.pass'))}</div>
        </div>
        <div id="mup-body" style="padding:14px 18px;overflow-y:auto;max-height:calc(100vh - 160px);"></div>
        <div id="mup-error" style="display:none;margin:0 18px 12px;font-size:12px;color:#791F1F;background:#FCEBEB;
          border-radius:8px;padding:10px 12px;"></div>
        <div style="display:flex;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--border);">
          <button type="button" class="btn-wide" onclick="window.closeAdminCustomerPassesModal?.()">${esc(_adm('btn.close'))}</button>
        </div>
      </div>
    </div>`)
  const panel = document.getElementById('mup-panel')
  if (panel && !panel.dataset.mupDelegation) {
    panel.dataset.mupDelegation = '1'
    panel.addEventListener('click', (e) => {
      const addBtn = e.target.closest('[data-mup-add]')
      if (addBtn && panel.contains(addBtn)) {
        e.preventDefault()
        void window.adminCreateUserPassManual?.()
        return
      }
      const delBtn = e.target.closest('[data-mup-delete]')
      if (delBtn && panel.contains(delBtn)) {
        e.preventDefault()
        void window.adminDeleteCustomerUserPass?.(delBtn)
        return
      }
      const btn = e.target.closest('[data-mup-save]')
      if (!btn || !panel.contains(btn)) return
      e.preventDefault()
      void window.adminSaveUserPassFromCard?.(btn)
    })
  }
}

;(function installAdminCustomerPassesDelegation() {
  if (window.__adminCustomerPassesDelegationInstalled) return
  window.__adminCustomerPassesDelegationInstalled = true
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-admin-user-passes-open]')
    if (!btn) return
    e.preventDefault()
    const userId = btn.getAttribute('data-user-id')
    const displayName = btn.getAttribute('data-display-name') || _adm('misc.customerFallback')
    void window.openAdminCustomerPassesModal?.(userId, displayName)
  })
})()

function _mupPassesListHtml(passes) {
  const addHtml = _mupAddFormHtml()
  if (!passes.length) {
    return `${addHtml}<div class="empty" style="padding:12px 0;">${esc(_adm('customers.passesEmpty'))}</div>`
  }
  const INP = 'width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;'
  return addHtml + passes.map(up => {
    const name = loc(up.pass?.name) || _adm('misc.pass')
    const st = up.status || 'active'
    const cancellationCount = Number(up.cancellation_count ?? 0)
    const cancellationLimit = _passCancellationLimit(up.entries_total)
    return `
    <div data-mup-card="${esc(up.id)}" style="border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:12px;background:#fafafa;">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">${esc(name)}</div>
      <div style="font-size:11px;color:#6b6b6b;margin-bottom:10px;">${_adm('mup.purchasedOn', { date: fmtDate(up.created_at) })}</div>
      <div style="font-size:11px;color:#6b6b6b;margin:-4px 0 10px;">
        ${esc(_adm('mup.cancellationsUsed', { used: cancellationCount, limit: cancellationLimit || 0 }))}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">${esc(_adm('mup.labelRemaining'))}</label>
          <input type="number" min="0" data-mup-field="entries_remaining" value="${up.entries_remaining}" style="${INP}" />
        </div>
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">${esc(_adm('mup.labelTotal'))}</label>
          <input type="number" min="1" data-mup-field="entries_total" value="${up.entries_total}" style="${INP}" />
        </div>
      </div>
      <div style="margin-bottom:8px;">
        <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">${esc(_adm('mup.labelValidUntil'))}</label>
        <input type="datetime-local" data-mup-field="expires_at" value="${esc(_isoToDatetimeLocalInput(up.expires_at))}" style="${INP}" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">${esc(_adm('mup.labelStatus'))}</label>
          <select data-mup-field="status" style="${INP}">
            <option value="active" ${st === 'active' ? 'selected' : ''}>${esc(_adm('userPassUiStatus.active'))}</option>
            <option value="expired" ${st === 'expired' ? 'selected' : ''}>${esc(_adm('userPassUiStatus.expired'))}</option>
            <option value="depleted" ${st === 'depleted' ? 'selected' : ''}>${esc(_adm('userPassUiStatus.depleted'))}</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">${esc(_adm('mup.labelPricePaid'))}</label>
          <input type="number" min="0" step="0.01" data-mup-field="price_paid" value="${Number(up.price_paid) || 0}" style="${INP}" />
        </div>
      </div>
      <div data-mup-row-err style="display:none;font-size:12px;color:#791F1F;margin-bottom:8px;"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button type="button" class="btn-small primary" data-mup-save="${esc(up.id)}">${esc(_adm('btn.save'))}</button>
        <button type="button" class="btn-small danger" data-mup-delete="${esc(up.id)}">${esc(_adm('btn.delete'))}</button>
      </div>
    </div>`
  }).join('')
}

function _mupAddFormHtml() {
  const hasTemplates = _mupAvailablePasses.length > 0
  return `
    <div style="border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:14px;background:#fff;">
      <div style="font-size:13px;font-weight:700;margin-bottom:4px;">${esc(_adm('mup.grantHeading'))}</div>
      <div style="font-size:11px;color:#6b6b6b;margin-bottom:10px;">
        ${esc(_adm('mup.grantLead'))}
      </div>
      ${hasTemplates ? `
        <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end;">
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">${esc(_adm('mup.labelPassType'))}</label>
            <select id="mup-add-pass-id" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;">
              ${_mupAvailablePasses.map((p, idx) => `
                <option value="${esc(p.id)}" ${idx === 0 ? 'selected' : ''}>
                  ${_adm('customers.passLine', {
                    name: loc(p.name) || _adm('misc.pass'),
                    entries: Number(p.entries_total) || 0,
                    price: fmtPrice(p.price),
                  })}
                </option>`).join('')}
            </select>
          </div>
          <button type="button" class="btn-small primary" data-mup-add="1"
            style="white-space:nowrap;">${esc(_adm('btn.assignPass'))}</button>
        </div>
      ` : `<div style="font-size:12px;color:#9b9b9b;">${esc(_adm('customers.noPassTypes'))}</div>`}
      <div id="mup-add-error" style="display:none;font-size:12px;color:#791F1F;margin-top:10px;"></div>
    </div>`
}

async function _mupReloadBody() {
  const body = document.getElementById('mup-body')
  if (!body || !_mupEditUserId) return
  body.innerHTML = `<div style="font-size:12px;color:#9b9b9b;">${esc(_adm('loading.generic'))}</div>`
  const [userPassRes, passTemplatesRes] = await Promise.all([
    sb.from('user_passes')
      .select('id, entries_total, entries_remaining, cancellation_count, expires_at, status, price_paid, created_at, pass:passes(name)')
      .eq('user_id', _mupEditUserId)
      .order('created_at', { ascending: false }),
    sb.from('passes')
      .select('id, name, entries_total, price, validity_weeks')
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
  ])
  if (userPassRes.error) throw userPassRes.error
  if (passTemplatesRes.error) throw passTemplatesRes.error
  _mupAvailablePasses = passTemplatesRes.data ?? []
  body.innerHTML = _mupPassesListHtml(userPassRes.data ?? [])
}

window.openAdminCustomerPassesModal = async (userId, displayName) => {
  const stale = document.getElementById('modal-admin-user-passes')
  if (stale && !document.getElementById('mup-panel')) {
    stale.remove()
  }
  buildAdminCustomerPassesModal()
  _mupEditUserId = userId
  _mupDisplayName = displayName || _adm('misc.customerFallback')
  const title = document.getElementById('mup-title')
  const errGlobal = document.getElementById('mup-error')
  if (title) title.textContent = _adm('mup.modalTitle', { name: _mupDisplayName })
  if (errGlobal) { errGlobal.style.display = 'none'; errGlobal.textContent = '' }
  document.getElementById('modal-admin-user-passes').style.display = 'flex'
  const body = document.getElementById('mup-body')
  body.innerHTML = `<div style="font-size:12px;color:#9b9b9b;">${esc(_adm('loading.generic'))}</div>`
  try {
    await _mupReloadBody()
  } catch (e) {
    console.error('[Admin] openAdminCustomerPassesModal:', e)
    body.innerHTML = `<div class="empty" style="color:#791F1F;padding:12px 0;">${esc(e.message || _adm('err.loadGeneric'))}</div>`
  }
}

window.closeAdminCustomerPassesModal = () => {
  const m = document.getElementById('modal-admin-user-passes')
  if (m) m.style.display = 'none'
  _mupEditUserId = null
  _mupAvailablePasses = []
}

window.adminCreateUserPassManual = async () => {
  if (!_mupEditUserId) {
    window.showToast?.(_adm('customers.grantMissingUser'), 'error')
    return
  }
  const errEl = document.getElementById('mup-add-error')
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = '' }

  const select = document.getElementById('mup-add-pass-id')
  const passId = select?.value
  const tpl = _mupAvailablePasses.find(p => String(p.id) === String(passId))
  if (!tpl) {
    if (errEl) { errEl.textContent = _adm('customers.grantPickType'); errEl.style.display = 'block' }
    return
  }

  const btn = document.getElementById('modal-admin-user-passes')?.querySelector('[data-mup-add]')
  if (btn) { btn.disabled = true; btn.textContent = _adm('customers.grantSaving') }

  try {
    const weeks = Math.max(1, Number(tpl.validity_weeks) || 12)
    const entriesTotal = Math.max(1, Number(tpl.entries_total) || 1)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + weeks * 7)

    const { error } = await sb.from('user_passes').insert({
      user_id: _mupEditUserId,
      pass_id: tpl.id,
      entries_total: entriesTotal,
      entries_remaining: entriesTotal,
      price_paid: Number(tpl.price) || 0,
      expires_at: expiresAt.toISOString(),
      status: 'active',
    })
    if (error) throw error

    window.showToast?.(_adm('customers.grantOk'), 'ok')
    await _mupReloadBody()
    void renderAdminZakaznici()
  } catch (err) {
    console.error('[Admin] adminCreateUserPassManual:', err)
    const msg = String(err?.message ?? err ?? '')
    const looksLikeMissingRls =
      msg.includes('row-level security')
      || msg.includes('permission denied')
      || msg.includes('new row violates row-level security policy')
    const uiMsg = looksLikeMissingRls
      ? _adm('customers.grantInsertPolicy')
      : (err.message || _adm('customers.grantFail'))
    if (errEl) {
      errEl.textContent = uiMsg
      errEl.style.display = 'block'
    }
    window.showToast?.(_adm('toast.errorWithMsg', { msg: uiMsg }), 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = _adm('btn.assignPass') }
  }
}

window.adminSaveUserPassFromCard = async saveBtn => {
  if (!saveBtn?.getAttribute) return
  const userPassId = saveBtn.getAttribute('data-mup-save')
  if (!userPassId) return
  const card = saveBtn.closest('[data-mup-card]')
  if (!card) return
  const errEl = card.querySelector('[data-mup-row-err]')
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = '' }
  const get = field => card.querySelector(`[data-mup-field="${field}"]`)
  const entriesRemaining = Number(get('entries_remaining')?.value)
  const entriesTotal = Number(get('entries_total')?.value)
  const pricePaid = Number(get('price_paid')?.value)
  const status = get('status')?.value
  const expiresLocal = get('expires_at')?.value
  const expiresAt = _datetimeLocalInputToIso(expiresLocal)
  if (!entriesTotal || entriesTotal < 1) {
    if (errEl) { errEl.textContent = _adm('customers.editErrEntriesMin'); errEl.style.display = 'block' }
    return
  }
  if (Number.isNaN(entriesRemaining) || entriesRemaining < 0) {
    if (errEl) { errEl.textContent = _adm('customers.editErrRemaining'); errEl.style.display = 'block' }
    return
  }
  if (entriesRemaining > entriesTotal) {
    if (errEl) { errEl.textContent = _adm('customers.editErrRemainingCap'); errEl.style.display = 'block' }
    return
  }
  if (!['active', 'expired', 'depleted'].includes(status)) {
    if (errEl) { errEl.textContent = _adm('customers.editErrState'); errEl.style.display = 'block' }
    return
  }
  if (!expiresAt) {
    if (errEl) { errEl.textContent = _adm('customers.editErrValidUntil'); errEl.style.display = 'block' }
    return
  }
  if (Number.isNaN(pricePaid) || pricePaid < 0) {
    if (errEl) { errEl.textContent = _adm('customers.editErrPrice'); errEl.style.display = 'block' }
    return
  }
  const btn = card.querySelector('[data-mup-save]')
  if (btn) { btn.disabled = true; btn.textContent = _adm('customers.editSaving') }
  try {
    const { data, error } = await sb.from('user_passes').update({
      entries_total: entriesTotal,
      entries_remaining: entriesRemaining,
      expires_at: expiresAt,
      status,
      price_paid: pricePaid,
    }).eq('id', userPassId).select('id')
    if (error) throw error
    if (!data?.length) {
      throw new Error(_adm('customers.editNoRow'))
    }
    window.showToast?.(_adm('customers.editOk'), 'ok')
    await _mupReloadBody()
    void renderAdminZakaznici()
  } catch (err) {
    console.error('[Admin] adminSaveUserPassFromCard:', err)
    const msg = String(err?.message ?? err ?? '')
    const looksLikeMissingRls =
      msg.includes('row-level security')
      || msg.includes('permission denied')
      || msg.includes('new row violates row-level security policy')
    const uiMsg = looksLikeMissingRls
      ? _adm('customers.editUpdatePolicy')
      : (err.message || _adm('customers.editFail'))
    if (errEl) {
      errEl.textContent = uiMsg
      errEl.style.display = 'block'
    }
    window.showToast?.(_adm('toast.errorWithMsg', { msg: uiMsg }), 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = _adm('btn.save') }
  }
}

window.adminDeleteCustomerUserPass = async (triggerEl) => {
  const userPassId = triggerEl?.getAttribute?.('data-mup-delete')
  if (!userPassId || !_mupEditUserId) return
  if (!confirm(_adm('customers.confirmDeleteUserPass'))) return
  const card = triggerEl.closest?.('[data-mup-card]')
  const errEl = card?.querySelector('[data-mup-row-err]')
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = '' }
  const delBtn = card?.querySelector('[data-mup-delete]')
  const saveBtn = card?.querySelector('[data-mup-save]')
  if (delBtn) { delBtn.disabled = true; delBtn.textContent = _adm('customers.deleteSaving') }
  if (saveBtn) saveBtn.disabled = true
  try {
    const { data, error } = await sb.from('user_passes').delete().eq('id', userPassId).select('id')
    if (error) throw error
    if (!data?.length) {
      throw new Error(_adm('customers.deleteFailPolicy'))
    }
    window.showToast?.(_adm('customers.deleteOk'), 'ok')
    await _mupReloadBody()
    void renderAdminZakaznici()
  } catch (err) {
    console.error('[Admin] adminDeleteCustomerUserPass:', err)
    const msg = String(err?.message ?? err ?? '')
    const looksLikeMissingRls =
      msg.includes('row-level security')
      || msg.includes('permission denied')
      || msg.includes('new row violates row-level security policy')
    const uiMsg = looksLikeMissingRls
      ? _adm('customers.deletePolicy')
      : (err.message || _adm('customers.deleteFail'))
    if (errEl) {
      errEl.textContent = uiMsg
      errEl.style.display = 'block'
    }
    window.showToast?.(_adm('toast.errorWithMsg', { msg: uiMsg }), 'error')
  } finally {
    if (delBtn) { delBtn.disabled = false; delBtn.textContent = _adm('btn.delete') }
    if (saveBtn) saveBtn.disabled = false
  }
}

// ── Platby / Historie lektora (sdílená měsíční rekapitulace) ──
/** @type {Record<'admin'|'lektor', { month: string|null, expandedYears: Set<string>|null }>} */
const _platbyScopeState = {
  admin:  { month: null, expandedYears: null },
  lektor: { month: null, expandedYears: null },
}
const _PLATBY_SCOPE_META = {
  admin: {
    contentId: 'admin-platby-content',
    pickerId: 'admin-platby-picker',
    raceKey: 'admin-platby',
    pageTitleKey: 'platby.pageTitle',
    canRefund: true,
    handlerPrefix: 'adminPlatby',
  },
  lektor: {
    contentId: 'lektor-historie-content',
    pickerId: 'lektor-historie-picker',
    raceKey: 'lektor-historie',
    pageTitleKey: 'historie.pageTitle',
    canRefund: false,
    handlerPrefix: 'lektorHistorie',
  },
}

const _PLATBY_FETCH_LIMIT = 5000  // strop pro all-time fetch; reálně tisícinásobek typického objemu

function _platbyCurrentMonthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function _platbyMonthKeyOf(date) {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function _platbyActiveMonth(scope) {
  return _platbyScopeState[scope].month ?? _platbyCurrentMonthKey()
}
function _platbyHandler(scope, action) {
  const prefix = _PLATBY_SCOPE_META[scope].handlerPrefix
  return `window.${prefix}${action}?.()`
}
function _platbyShiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function _platbyMonthLabel(key) {
  // 'Květen 2026' / 'May 2026' — capitalize kvůli češtině (toLocaleDateString vrací 'květen 2026')
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  const raw = d.toLocaleDateString(_adminFmtLocaleTag(), { month: 'long', year: 'numeric' })
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}
function _platbyMonthShort(monthNum) {
  // monthNum: 1..12 → 'Led' / 'Jan' (capitalize)
  const d = new Date(2000, monthNum - 1, 1)
  const raw = d.toLocaleDateString(_adminFmtLocaleTag(), { month: 'short' })
  return raw.charAt(0).toUpperCase() + raw.slice(1).replace(/\.$/, '')
}

/**
 * Seskupí normalizované platby podle 'YYYY-MM' a vrátí mapu se souhrny.
 * Refundy patří do měsíce **originální platby** (varianta a).
 */
/** Jen platby za vlastní permanentky / kurzy / lekce (ne vlastní nákupy lektora jako zákazníka). */
function _platbyRowsForLektorOwner(allPasses, allSingles) {
  const ownerId = currentUser?.id
  if (!ownerId) return { passes: [], singles: [] }
  const passes = (allPasses ?? []).filter(
    p => p.pass?.owner_id === ownerId,
  )
  const singles = (allSingles ?? []).filter(
    b => b.lesson?.course?.owner_id === ownerId,
  )
  return { passes, singles }
}

function _platbyGroupByMonth(payments) {
  const byMonth = new Map()
  for (const p of payments) {
    const key = _platbyMonthKeyOf(p.date)
    if (!key) continue
    if (!byMonth.has(key)) byMonth.set(key, { gross: 0, refunds: 0, net: 0, items: [] })
    const entry = byMonth.get(key)
    entry.items.push(p)
    entry.gross += _paymentAmount(p)
    if (_effectiveRefundStatus(p) === 'completed') {
      entry.refunds += _paymentRefundAmount(p)
    }
  }
  for (const entry of byMonth.values()) {
    entry.net = entry.gross - entry.refunds
    entry.items.sort((a, b) => new Date(b.date) - new Date(a.date))
  }
  return byMonth
}

export async function renderAdminPlatby() {
  if (!_isStaffAdmin()) return
  return _renderPlatbyHistory('admin')
}

export async function renderLektorHistorie() {
  if (!_isStaffLektor()) return
  return _renderPlatbyHistory('lektor')
}

async function _renderPlatbyHistory(scope) {
  const meta = _PLATBY_SCOPE_META[scope]
  const el = document.getElementById(meta.contentId)
  if (!el) return
  const prevHtml = el.innerHTML
  const loadNeedle = _adm(scope === 'lektor' ? 'loading.history' : 'loading.payments')
  const stable = _adminHadStableContent(prevHtml, loadNeedle)
  if (stable) console.log('[Debug] Platby/historie:', scope, '— obnovuji na pozadí')
  else el.innerHTML = `<div class="empty" style="padding:40px;">${esc(loadNeedle)}</div>`
  try {
    await adminRace((async () => {
    const passSelect = 'id,price_paid,created_at,status,refund_status,refund_note,refunded_at,refund_amount,user:users(name,email),pass:passes(name,owner_id)'
    const singleSelect = 'id,price_paid,status,created_at,refund_status,refund_note,refunded_at,refund_amount,user:users(name,email),lesson:lessons(start_time,course:courses(title,color_code,owner_id))'
    const [allPassesRes, allSinglesRes] = await Promise.all([
      sb.from('user_passes').select(passSelect)
        .order('created_at',{ascending:false}).limit(_PLATBY_FETCH_LIMIT),
      sb.from('bookings').select(singleSelect)
        .eq('payment_type','single').order('created_at',{ascending:false}).limit(_PLATBY_FETCH_LIMIT),
    ])

    let allPasses = allPassesRes.data ?? []
    if (allPassesRes.error) {
      if (!_looksLikeMissingRefundColumns(allPassesRes.error)) throw allPassesRes.error
      const fallbackPassesRes = await sb.from('user_passes')
        .select('id,price_paid,created_at,status,user:users(name,email),pass:passes(name,owner_id)')
        .order('created_at',{ascending:false})
        .limit(_PLATBY_FETCH_LIMIT)
      if (fallbackPassesRes.error) throw fallbackPassesRes.error
      allPasses = (fallbackPassesRes.data ?? []).map(row => ({
        ...row,
        refund_status: 'not_required',
        refund_note: null,
        refunded_at: null,
        refund_amount: null,
      }))
    }

    let allSingles = allSinglesRes.data ?? []
    if (allSinglesRes.error) {
      if (!_looksLikeMissingRefundColumns(allSinglesRes.error)) throw allSinglesRes.error
      const fallbackSinglesRes = await sb.from('bookings')
        .select('id,price_paid,status,created_at,user:users(name,email),lesson:lessons(start_time,course:courses(title,color_code,owner_id))')
        .eq('payment_type','single')
        .order('created_at',{ascending:false})
        .limit(_PLATBY_FETCH_LIMIT)
      if (fallbackSinglesRes.error) throw fallbackSinglesRes.error
      allSingles = (fallbackSinglesRes.data ?? []).map(row => ({
        ...row,
        refund_status: null,
        refund_note: null,
        refunded_at: null,
        refund_amount: null,
      }))
    }

    if (scope === 'lektor') {
      const scoped = _platbyRowsForLektorOwner(allPasses, allSingles)
      allPasses = scoped.passes
      allSingles = scoped.singles
    }

    const allPayments = [
      ...(allPasses ?? []).map(p => ({
        type: 'pass', id: p.id, amount: p.price_paid, date: p.created_at, status: p.status,
        userName: p.user?.name || p.user?.email || _adm('misc.dash'),
        description: loc(p.pass?.name) || _adm('misc.pass'),
        refundStatus: p.refund_status ?? 'not_required',
        refundNote: p.refund_note ?? '',
        refundedAt: p.refunded_at ?? null,
        refundAmount: p.refund_amount ?? null,
      })),
      ...(allSingles ?? []).map(b => ({
        type: 'single', id: b.id, amount: b.price_paid, date: b.created_at, status: b.status,
        userName: b.user?.name || b.user?.email || _adm('misc.dash'),
        description: loc(b.lesson?.course?.title) || _adm('misc.lessonFallback'),
        refundStatus: b.refund_status ?? null,
        refundNote: b.refund_note ?? '',
        refundedAt: b.refunded_at ?? null,
        refundAmount: b.refund_amount ?? null,
      })),
    ]

    const byMonth = _platbyGroupByMonth(allPayments)
    const activeKey = _platbyActiveMonth(scope)
    const activeEntry = byMonth.get(activeKey) ?? { gross: 0, refunds: 0, net: 0, items: [] }

    // Granice pro prev/next: min existující měsíc dat, max = aktuální měsíc (do budoucna nepouštíme)
    const sortedKeys = [...byMonth.keys()].sort()
    const minKey = sortedKeys[0] ?? activeKey
    const maxKey = _platbyCurrentMonthKey()
    const canPrev = activeKey > minKey
    const canNext = activeKey < maxKey

    el.innerHTML = `
      <div class="page-title" style="margin-bottom:16px;">${esc(_adm(meta.pageTitleKey))}</div>
      ${_platbyHeaderHtml(scope, activeKey, canPrev, canNext)}
      <div class="admin-stat-grid">
        <div class="admin-stat-card"><div class="admin-stat-value" style="font-size:18px;">${fmtPrice(activeEntry.gross)}</div><div class="admin-stat-label">${esc(_adm('dashboard.statGross'))}</div></div>
        <div class="admin-stat-card"><div class="admin-stat-value" style="font-size:18px;">${fmtPrice(activeEntry.refunds)}</div><div class="admin-stat-label">${esc(_adm('dashboard.statRefunds'))}</div></div>
        <div class="admin-stat-card"><div class="admin-stat-value" style="font-size:18px;">${fmtPrice(activeEntry.net)}</div><div class="admin-stat-label">${esc(_adm('dashboard.statNet'))}</div></div>
      </div>
      <div class="admin-section-title">${esc(_adm('platby.sectionMonth', { month: _platbyMonthLabel(activeKey) }))}</div>
      ${activeEntry.items.length
        ? `<div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;">${activeEntry.items.map(p => _platbaRow(p, meta.canRefund)).join('')}</div>`
        : `<div class="empty">${esc(_adm('platby.emptyInMonth'))}</div>`}
      ${_monthPickerModalHtml(scope, byMonth, activeKey)}
    `
    })(), meta.raceKey)
  } catch (err) {
    if (err?.code === 'TIMEOUT' && stable) {
      console.warn('[Debug] Admin platby: timeout — poslední známý obsah')
      el.innerHTML = prevHtml
      return
    }
    console.error('[Admin] renderPlatbyHistory:', scope, err)
    el.innerHTML = `<div class="empty">${esc(_adm('err.loadPayments'))}</div>`
  }
}

function _platbaRow(p, canRefund = true) {
  const isPass = p.type === 'pass'
  const paidAmount = _paymentAmount(p)
  const refundApplied = _paymentRefundAmount(p)
  const typeBg = isPass ? 'rgba(40,84,185,.10)' : 'rgba(8,80,65,.10)'
  const typeColor = isPass ? 'var(--primary)' : '#085041'
  const refundStatus = _effectiveRefundStatus(p)
  const refundCanStart = _paymentCanStartRefund(p)
  const refundPending = refundStatus === 'pending'
  const refundCompleted = refundStatus === 'completed'
  const noteId = _refundFieldId(p.type, p.id, 'note')
  const amountId = _refundFieldId(p.type, p.id, 'amount')
  const draftRefundAmount = (() => {
    const base = refundPending || refundCompleted
      ? refundApplied || paidAmount
      : paidAmount
    return Number.isFinite(base) ? String(base).replace(/\.00$/, '') : ''
  })()
  const statusPreset = [
    'active',
    'expired',
    'depleted',
    PARTICIPATION_STATUS.PENDING_PAYMENT,
    PARTICIPATION_STATUS.CONFIRMED,
    PARTICIPATION_STATUS.CANCELLED,
    PARTICIPATION_STATUS.PAYMENT_EXPIRED,
    PARTICIPATION_STATUS.ATTENDED,
    PARTICIPATION_STATUS.MISSED,
  ]
  const stKey = statusPreset.includes(String(p.status)) ? String(p.status) : null
  const statusMap = {
    active:{l:_adm('paymentRowStatus.active'),bg:'#E1F5EE',c:'#085041'}, expired:{l:_adm('paymentRowStatus.expired'),bg:'#F3F4F6',c:'#6b6b6b'},
    depleted:{l:_adm('paymentRowStatus.depleted'),bg:'#F3F4F6',c:'#6b6b6b'},
    [PARTICIPATION_STATUS.PENDING_PAYMENT]:{l:_adm('paymentRowStatus.pending_payment'),bg:'#FFF4E0',c:'#8B5C00'},
    [PARTICIPATION_STATUS.CONFIRMED]:{l:_adm('paymentRowStatus.booked'),bg:'#E1F5EE',c:'#085041'},
    [PARTICIPATION_STATUS.CANCELLED]:{l:_adm('paymentRowStatus.cancelled'),bg:'#FCEBEB',c:'#791F1F'},
    [PARTICIPATION_STATUS.PAYMENT_EXPIRED]:{l:_adm('paymentRowStatus.payment_expired'),bg:'#FCEBEB',c:'#791F1F'},
    [PARTICIPATION_STATUS.ATTENDED]:{l:_adm('paymentRowStatus.attended'),bg:'#E1F5EE',c:'#085041'},
    [PARTICIPATION_STATUS.MISSED]:{l:_adm('paymentRowStatus.missed'),bg:'#FFF4E0',c:'#8B5C00'},
  }
  const st = stKey ? statusMap[stKey] : { l: String(p.status ?? ''), bg: '#F3F4F6', c: '#6b6b6b' }
  const refundBadge = refundPending
    ? `<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:#FCEBEB;color:#791F1F;">${esc(_adm('refund.pendingBadge'))}</span>`
    : refundCompleted
      ? `<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:#E1F5EE;color:#085041;">${esc(_adm('refund.doneBadge'))}</span>`
      : ''
  const refundMeta = refundCompleted
    ? `<div style="font-size:11px;color:#085041;margin-top:6px;">
        ${_adm('platby.refundedLine', { amount: fmtPrice(refundApplied || paidAmount) })}
        ${p.refundedAt ? ` · ${fmtDateTime(p.refundedAt)}` : ''}
        ${p.refundNote ? ` · ${esc(p.refundNote)}` : ''}
      </div>`
    : ''
  const refundControls = canRefund && (refundPending || refundCanStart)
    ? `
      <div style="flex-basis:100%;display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px dashed rgba(0,0,0,.08);">
        <input
          id="${esc(amountId)}"
          type="number"
          min="0.01"
          max="${esc(String(paidAmount))}"
          step="0.01"
          value="${esc(draftRefundAmount)}"
          placeholder="${esc(_adm('platby.refundAmountPh'))}"
          style="width:160px;padding:9px 11px;border:1px solid var(--border);border-radius:10px;font-size:12px;box-sizing:border-box;"
        />
        <input
          id="${esc(noteId)}"
          type="text"
          value="${esc(p.refundNote || '')}"
          placeholder="${esc(_adm('platby.refundNotePh'))}"
          style="flex:1;min-width:240px;padding:9px 11px;border:1px solid var(--border);border-radius:10px;font-size:12px;box-sizing:border-box;"
        />
        ${refundCanStart
          ? `<button type="button" class="btn-small" onclick="window.adminStartPaymentRefund?.('${esc(p.type)}', '${esc(p.id)}', this)">
              ${esc(_adm('refund.btnMarkRefund'))}
            </button>`
          : `<button type="button" class="btn-small primary" onclick="window.adminMarkPaymentRefunded?.('${esc(p.type)}', '${esc(p.id)}', this)">
              ${esc(_adm('refund.btnMarkRefunded'))}
            </button>`}
      </div>`
    : ''
  return `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap;">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap;">
          <span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:${typeBg};color:${typeColor};">${esc(isPass ? _adm('misc.pass') : _adm('misc.singleEntry'))}</span>
          <span style="font-size:12px;font-weight:500;">${esc(p.description)}</span>
        </div>
        <div style="font-size:11px;color:#6b6b6b;">${esc(p.userName)} · ${fmtDateTime(p.date)}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:14px;font-weight:700;margin-bottom:3px;">${fmtPrice(p.amount)}</div>
        <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;">
          <span style="font-size:10px;font-weight:500;padding:2px 7px;border-radius:20px;background:${st.bg};color:${st.c};">${esc(st.l)}</span>
          ${refundBadge}
        </div>
        ${refundMeta}
      </div>
      ${refundControls}
    </div>`
}

// ── Platby header (prev/next + clickable month pill) ─────────
function _platbyHeaderHtml(scope, activeKey, canPrev, canNext) {
  const label = _platbyMonthLabel(activeKey)
  const prevAria = esc(_adm('platby.prevMonthAria'))
  const nextAria = esc(_adm('platby.nextMonthAria'))
  const pickAria = esc(_adm('platby.pickMonth'))
  return `
    <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin:0 0 16px;flex-wrap:wrap;">
      <button type="button"
        aria-label="${prevAria}"
        title="${prevAria}"
        ${canPrev ? '' : 'disabled'}
        onclick="${_platbyHandler(scope, 'PrevMonth')}"
        style="width:36px;height:36px;border:1px solid var(--border);background:#fff;border-radius:50%;font-size:18px;line-height:1;cursor:${canPrev ? 'pointer' : 'not-allowed'};opacity:${canPrev ? '1' : '.35'};display:inline-flex;align-items:center;justify-content:center;padding:0;">
        ‹
      </button>
      <button type="button"
        aria-label="${pickAria}"
        title="${pickAria}"
        onclick="${_platbyHandler(scope, 'OpenMonthPicker')}"
        style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border:1px solid var(--border);background:#fff;border-radius:20px;font-size:14px;font-weight:600;cursor:pointer;min-width:180px;justify-content:center;">
        <span aria-hidden="true">📅</span>
        <span>${esc(label)}</span>
      </button>
      <button type="button"
        aria-label="${nextAria}"
        title="${nextAria}"
        ${canNext ? '' : 'disabled'}
        onclick="${_platbyHandler(scope, 'NextMonth')}"
        style="width:36px;height:36px;border:1px solid var(--border);background:#fff;border-radius:50%;font-size:18px;line-height:1;cursor:${canNext ? 'pointer' : 'not-allowed'};opacity:${canNext ? '1' : '.35'};display:inline-flex;align-items:center;justify-content:center;padding:0;">
        ›
      </button>
    </div>
  `
}

// ── Platby month-picker modal ────────────────────────────────
// Adaptivní year-grouping:
//  – 1 rok  → ploché zobrazení 12 dlaždic (žádné year headery)
//  – 2+ let → každý rok je collapsible sekce; defaultně expandnuté roky:
//             aktuální rok + rok obsahující vybraný měsíc
function _monthPickerModalHtml(scope, byMonth, activeKey) {
  const meta = _PLATBY_SCOPE_META[scope]
  const pickerId = meta.pickerId
  const hp = meta.handlerPrefix
  // Years se daty (jen tam, kde alespoň jeden měsíc obsahuje platby)
  const yearsWithData = [...new Set([...byMonth.keys()].map(k => k.slice(0, 4)))].sort()
  if (yearsWithData.length === 0) {
    // Žádná data → modal je v podstatě jen "zavřít", ale rendrovat ho stejně,
    // aby uživatel viděl konzistentní stav.
    return `
      <div id="${pickerId}" class="pop-overlay" onclick="if(event.target===this) window.${hp}CloseMonthPicker?.()">
        <div class="pop-sheet" style="max-width:560px;">
          <div class="pop-bar"></div>
          <div class="pop-body" style="padding:20px;">
            <div style="font-size:16px;font-weight:600;margin-bottom:12px;">${esc(_adm('platby.pickerTitle'))}</div>
            <div class="empty" style="padding:24px 8px;">${esc(_adm('platby.empty'))}</div>
            <button type="button" class="pop-close" onclick="window.${hp}CloseMonthPicker?.()">${esc(_adm('platby.pickerClose'))}</button>
          </div>
        </div>
      </div>
    `
  }

  // Lazy init Set expandnutých roků: dnes + rok vybraného měsíce
  const scopeState = _platbyScopeState[scope]
  if (scopeState.expandedYears === null) {
    scopeState.expandedYears = new Set([
      String(new Date().getFullYear()),
      activeKey.slice(0, 4),
    ])
  }

  const flat = yearsWithData.length === 1
  const currentMonthKey = _platbyCurrentMonthKey()

  // Roční souhrny (gross − refunds = net) — zobrazujeme net jako "tržbu za rok"
  const yearTotals = new Map()
  for (const [key, entry] of byMonth) {
    const y = key.slice(0, 4)
    yearTotals.set(y, (yearTotals.get(y) ?? 0) + entry.net)
  }

  const renderYear = (year) => {
    const expanded = flat || scopeState.expandedYears.has(year)
    const yearNet = yearTotals.get(year) ?? 0
    const header = flat ? '' : `
      <button type="button"
        onclick="window.${hp}ToggleYear?.('${esc(year)}')"
        style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border:0;background:transparent;cursor:pointer;border-top:1px solid var(--border);font-size:14px;font-weight:600;text-align:left;">
        <span style="display:inline-flex;align-items:center;gap:8px;">
          <span aria-hidden="true" style="display:inline-block;width:12px;transition:transform .15s;transform:rotate(${expanded ? '90deg' : '0'});">▸</span>
          ${esc(year)}
        </span>
        <span style="font-size:12px;color:var(--muted);font-weight:500;">${esc(_adm('platby.pickerYearTotal', { amount: fmtPrice(yearNet) }))}</span>
      </button>
    `
    const monthsGrid = expanded ? `
      <div class="platby-picker-grid">
        ${Array.from({ length: 12 }, (_, i) => {
          const m = i + 1
          const key = `${year}-${String(m).padStart(2, '0')}`
          const entry = byMonth.get(key)
          const isFuture = key > currentMonthKey
          const isActive = key === activeKey
          const hasData = !!entry && entry.items.length > 0
          const monthName = _platbyMonthShort(m)
          const sumLine = hasData
            ? fmtPrice(entry.net)
            : esc(_adm('platby.pickerNoData'))
          const stateClass = isActive
            ? 'platby-picker-tile platby-picker-tile-active'
            : isFuture
              ? 'platby-picker-tile platby-picker-tile-future'
              : hasData
                ? 'platby-picker-tile platby-picker-tile-data'
                : 'platby-picker-tile platby-picker-tile-empty'
          const onClick = isFuture
            ? ''
            : ` onclick="window.${hp}SelectMonth?.('${esc(key)}')"`
          const disabled = isFuture ? ' disabled' : ''
          return `
            <button type="button" class="${stateClass}"${onClick}${disabled}>
              <span class="platby-picker-tile-month">${esc(monthName)}</span>
              <span class="platby-picker-tile-sum">${sumLine}</span>
            </button>
          `
        }).join('')}
      </div>
    ` : ''
    return header + monthsGrid
  }

  // Pro flat zobrazení (1 rok) přidáme i jednoduchý header roku jen jako titulek
  const flatYearTitle = flat ? `
    <div style="padding:8px 16px 0;font-size:16px;font-weight:600;">${esc(yearsWithData[0])}</div>
  ` : ''

  return `
    <style>
      .platby-picker-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        padding: 12px 16px 16px;
      }
      .platby-picker-tile {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 4px;
        padding: 12px 6px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: #fff;
        cursor: pointer;
        font: inherit;
        min-height: 64px;
      }
      .platby-picker-tile:hover:not(:disabled) {
        background: #f7f7f7;
      }
      .platby-picker-tile-month {
        font-size: 13px; font-weight: 600;
      }
      .platby-picker-tile-sum {
        font-size: 11px; color: var(--muted);
      }
      .platby-picker-tile-active {
        background: rgba(40,84,185,.08);
        border-color: var(--primary);
      }
      .platby-picker-tile-active .platby-picker-tile-sum {
        color: var(--primary);
        font-weight: 600;
      }
      .platby-picker-tile-empty,
      .platby-picker-tile-future {
        opacity: .45;
        cursor: not-allowed;
      }
      .platby-picker-tile-future {
        background: #fafafa;
      }
    </style>
    <div id="${pickerId}" class="pop-overlay" onclick="if(event.target===this) window.${hp}CloseMonthPicker?.()">
      <div class="pop-sheet" style="max-width:560px;">
        <div class="pop-bar"></div>
        <div class="pop-body" style="padding:16px 0 16px;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 16px 12px;">
            <div style="font-size:16px;font-weight:600;">${esc(_adm('platby.pickerTitle'))}</div>
            <button type="button"
              onclick="window.${hp}JumpToCurrent?.()"
              style="font-size:12px;padding:6px 12px;border:1px solid var(--border);background:#fff;border-radius:20px;cursor:pointer;">
              ${esc(_adm('platby.pickerJumpToCurrent'))}
            </button>
          </div>
          ${flatYearTitle}
          ${yearsWithData.slice().reverse().map(renderYear).join('')}
          <div style="padding:8px 16px 0;">
            <button type="button" class="pop-close" onclick="window.${hp}CloseMonthPicker?.()">${esc(_adm('platby.pickerClose'))}</button>
          </div>
        </div>
      </div>
    </div>
  `
}

// ── Platby / Historie month-picker window handlers ───────────
function _platbyRerender(scope) {
  if (scope === 'lektor') void renderLektorHistorie()
  else void renderAdminPlatby()
}
function _bindPlatbyPickerHandlers(scope) {
  const meta = _PLATBY_SCOPE_META[scope]
  const hp = meta.handlerPrefix
  const st = _platbyScopeState[scope]
  window[`${hp}OpenMonthPicker`] = () => {
    const el = document.getElementById(meta.pickerId)
    if (el) el.style.display = 'flex'
  }
  window[`${hp}CloseMonthPicker`] = () => {
    const el = document.getElementById(meta.pickerId)
    if (el) el.style.display = 'none'
  }
  window[`${hp}SelectMonth`] = (key) => {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}$/.test(key)) return
    if (key > _platbyCurrentMonthKey()) return
    st.month = key
    _platbyRerender(scope)
  }
  window[`${hp}PrevMonth`] = () => {
    st.month = _platbyShiftMonth(_platbyActiveMonth(scope), -1)
    _platbyRerender(scope)
  }
  window[`${hp}NextMonth`] = () => {
    const next = _platbyShiftMonth(_platbyActiveMonth(scope), +1)
    if (next > _platbyCurrentMonthKey()) return
    st.month = next
    _platbyRerender(scope)
  }
  window[`${hp}ToggleYear`] = (year) => {
    if (typeof year !== 'string') return
    if (st.expandedYears === null) st.expandedYears = new Set()
    if (st.expandedYears.has(year)) st.expandedYears.delete(year)
    else st.expandedYears.add(year)
    _platbyRerender(scope)
  }
  window[`${hp}JumpToCurrent`] = () => {
    st.month = null
    _platbyRerender(scope)
  }
}
_bindPlatbyPickerHandlers('admin')
_bindPlatbyPickerHandlers('lektor')

async function _updatePaymentRefundState(type, paymentId, nextStatus, btnEl = null) {
  if (!paymentId || !['pending', 'completed'].includes(nextStatus)) return
  const noteInput = document.getElementById(_refundFieldId(type, paymentId, 'note'))
  const amountInput = document.getElementById(_refundFieldId(type, paymentId, 'amount'))
  const note = noteInput?.value?.trim() || null
  const refundAmount = Number(amountInput?.value)
  const maxRefund = Number(amountInput?.getAttribute('max'))
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
    window.showToast?.(_adm('refund.invalidAmount'), 'error')
    return
  }
  if (Number.isFinite(maxRefund) && refundAmount > maxRefund) {
    window.showToast?.(_adm('refund.exceedsPaid'), 'error')
    return
  }
  const confirmMsg = nextStatus === 'completed'
    ? _adm('refund.confirmCompleted')
    : _adm('refund.confirmPending')
  if (!confirm(confirmMsg)) return
  if (btnEl) {
    btnEl.disabled = true
    btnEl.textContent = nextStatus === 'completed' ? _adm('refund.saving') : _adm('refund.marking')
  }
  try {
    const table = type === 'pass' ? 'user_passes' : 'bookings'
    let query = sb.from(table).update({
      refund_status: nextStatus,
      refund_note: note,
      refund_amount: refundAmount,
      refunded_at: nextStatus === 'completed' ? new Date().toISOString() : null,
    }).eq('id', paymentId)
    if (type === 'single') {
      query = query.eq('payment_type', 'single').eq('status', 'cancelled')
    }
    const { error } = await query
    if (error) {
      if (_looksLikeMissingRefundColumns(error)) {
        window.showToast?.(
          _adm('refund.migrationColsToast'),
          'error',
        )
        return
      }
      throw error
    }
    window.showToast?.(
      nextStatus === 'completed'
        ? _adm('refund.toastDone')
        : _adm('refund.toastPending'),
      'ok',
    )
    await renderAdminPlatby()
    void renderAdminDashboard()
  } catch (err) {
    console.error('[Admin] _updatePaymentRefundState:', err)
    window.showToast?.(_adm('toast.refundSaveFail', { msg: err.message ?? err }), 'error')
  } finally {
    if (btnEl) {
      btnEl.disabled = false
      btnEl.textContent = nextStatus === 'completed'
        ? _adm('refund.btnMarkRefunded')
        : _adm('refund.btnMarkRefund')
    }
  }
}

window.adminStartPaymentRefund = async (type, paymentId, btnEl = null) => {
  await _updatePaymentRefundState(type, paymentId, 'pending', btnEl)
}

window.adminMarkPaymentRefunded = async (type, paymentId, btnEl = null) => {
  await _updatePaymentRefundState(type, paymentId, 'completed', btnEl)
}

// ── Admin Permanentky ─────────────────────────────────────────
export async function renderAdminPermanentky() {
  const el = document.getElementById('admin-permanentky-content')
  if (!el) return
  const prevHtml = el.innerHTML
  const loadNeedle = _adm('loading.passes')
  const stable = _adminHadStableContent(prevHtml, loadNeedle)
  if (stable) console.log('[Debug] Admin permanentky: obnovuji na pozadí')
  else el.innerHTML = `<div class="empty" style="padding:40px;">${esc(loadNeedle)}</div>`
  try {
    await adminRace((async () => {
    let basePassesQuery = sb.from('passes')
      .select('id, name, entries_total, price, validity_weeks, is_active, allowed_course_ids, color_code')
      .order('created_at', { ascending: false })
    if (_isStaffAdmin() && _adminPassesScope === 'moje' && currentUser?.id) {
      basePassesQuery = basePassesQuery.eq('owner_id', currentUser.id)
    }
    const { data: passes, error } = await _scopeOwnerQuery(basePassesQuery)
    if (error) throw error

    const allCourseIds = [...new Set((passes ?? []).flatMap(p => p.allowed_course_ids ?? []))]
    let courseMap = {}
    if (allCourseIds.length > 0) {
      const { data: courses } = await sb.from('courses').select('id, title').in('id', allCourseIds)
      courseMap = Object.fromEntries((courses ?? []).map(c => [c.id, c]))
    }

    const pageTitle = _isStaffLektor() ? _adm('passesPage.pageTitleMine') : _adm('passesPage.pageTitleManage')
    const scopeSwitchHtml = _isStaffAdmin() ? _adminScopeSwitchHtml(_adminPassesScope, 'adminSetPassesScope') : ''
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div class="page-title">${esc(pageTitle)}</div>
        <button class="btn-small" onclick="window.openPassModal?.()">${esc(_adm('passesPage.btnNew'))}</button>
      </div>
      ${scopeSwitchHtml}
      ${passes?.length
        ? `<div class="nastenka-cards-2col">${passes.map(p => _passCard(p, courseMap)).join('')}</div>`
        : `<div class="empty">${esc(_adm('passesPage.empty'))}</div>`}
    `
    })(), 'admin-permanentky')
  } catch (err) {
    if (err?.code === 'TIMEOUT' && stable) {
      console.warn('[Debug] Admin permanentky: timeout — předchozí obsah')
      el.innerHTML = prevHtml
      return
    }
    console.error('[Admin] renderAdminPermanentky:', err)
    el.innerHTML = `<div class="empty">${esc(_adm('err.loadPasses'))}</div>`
  }
}

function _passCard(pass, courseMap) {
  const name = loc(pass.name) || _adm('misc.pass')
  const tint = _passCardSurfaceStyle(pass.color_code)
  const ph = _passHexOrDefault(pass.color_code)
  const courseNames = (pass.allowed_course_ids ?? []).map(id => loc(courseMap[id]?.title)).filter(Boolean)
  return `
    <div class="admin-pass-card" style="border-radius:12px;padding:14px 16px;margin-bottom:10px;${tint}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px;">${esc(name)}</div>
          <div style="font-size:11px;color:#6b6b6b;display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;">
            <span>${_adm('passesPage.cardEntries', { n: pass.entries_total })}</span>
            <span>${_adm('passesPage.cardPerEntryPrice', { price: fmtPrice(pass.price / pass.entries_total) })}</span>
            <span>${_adm('passesPage.cardWeeksLine', { weeks: pass.validity_weeks })}</span>
          </div>
          ${courseNames.length ? `
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
              ${courseNames.map(n => `
                <span style="font-size:10px;font-weight:500;padding:2px 7px;border-radius:20px;
                  background:${ph}22;color:${ph};">${esc(n)}</span>`).join('')}
            </div>` : `<div style="font-size:11px;color:#9b9b9b;">${esc(_adm('passesPage.notLinked'))}</div>`}
        </div>
        <div style="text-align:left;flex-shrink:0;">
          <div style="font-size:18px;font-weight:700;color:${ph};margin-bottom:10px;text-align:left;">${fmtPrice(pass.price)}</div>
          <div style="display:flex;gap:8px;">
            <button class="btn-small" onclick="window.openPassModal?.('${esc(pass.id)}')">${esc(_adm('btn.edit'))}</button>
            <button class="btn-small danger" onclick="window.adminDeletePass?.('${esc(pass.id)}')">${esc(_adm('btn.delete'))}</button>
          </div>
        </div>
      </div>
    </div>`
}

// ── Modal: Permanentka ────────────────────────────────────────
function buildPassModal() {
  if (document.getElementById('modal-pass')) return
  const INP = 'width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:10px;font-size:13px;background:#fff;outline:none;box-sizing:border-box;'
  const passColorDots = PASS_PALETTE.map(c => `
    <button type="button" data-mp-color="${c}" onclick="window._mpPickColor?.('${c}')"
      title="${c}"
      style="width:32px;height:32px;border-radius:50%;background:${c};cursor:pointer;flex-shrink:0;
        border:3px solid transparent;transition:box-shadow .15s,border-color .15s;">
    </button>`).join('')
  document.body.insertAdjacentHTML('beforeend', `
    <div id="modal-pass" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.38);
      z-index:300;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;"
      onclick="if(event.target===this)window.closePassModal?.()">
      <div style="background:#fff;border-radius:18px;border:1px solid var(--border);box-shadow:var(--shadow);
        width:100%;max-width:480px;overflow:hidden;margin:auto;" onclick="event.stopPropagation()">
        <div style="padding:18px 18px 4px;">
          <div style="font-size:18px;font-weight:700;" id="mp-title">${esc(_adm('passesPage.modalTitleNew'))}</div>
        </div>
        <div style="padding:14px 18px;overflow-y:auto;max-height:calc(100vh - 140px);">
          <input type="hidden" id="mp-id" />
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Název permanentky</label>
            <input id="mp-name" type="text" placeholder="např. Základní balíček 10" style="${INP}" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
            <div>
              <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Počet vstupů</label>
              <input id="mp-entries" type="number" min="1" placeholder="10" style="${INP}" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Cena (Kč)</label>
              <input id="mp-price" type="number" min="0" placeholder="3500" style="${INP}" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Platnost (týdny)</label>
              <input id="mp-weeks" type="number" min="1" value="12" style="${INP}" />
            </div>
          </div>
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:6px;">Barva karty permanentky</label>
            <div style="font-size:11px;color:#6b6b6b;line-height:1.45;margin-bottom:10px;">
              Teplé pastelové barvy (hlína / glazura), oddělené od palety kurzů — určují nádech karty permanentky v aplikaci.
            </div>
            <div id="mp-colors" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
              ${passColorDots}
            </div>
          </div>
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:8px;">Platí pro kurzy</label>
            <div id="mp-courses-list"><div style="font-size:12px;color:#9b9b9b;">Načítám kurzy…</div></div>
          </div>
          <div id="mp-error" style="display:none;font-size:12px;color:#791F1F;background:#FCEBEB;
            border-radius:8px;padding:10px 12px;"></div>
        </div>
        <div style="display:flex;gap:10px;padding:12px 18px;border-top:1px solid var(--border);">
          <button class="btn-wide" onclick="window.closePassModal?.()" style="flex:1;">${esc(t(_adminLocale(), 'common.cancel'))}</button>
          <button class="btn-wide primary" id="mp-save-btn" onclick="window.savePass?.()" style="flex:2;">${esc(_adm('btn.savePass'))}</button>
        </div>
      </div>
    </div>`)
}

window.openPassModal = async (passId = null) => {
  buildPassModal()
  const errEl = document.getElementById('mp-error')
  if (errEl) errEl.style.display = 'none'
  document.getElementById('mp-id').value        = passId ?? ''
  document.getElementById('mp-title').textContent = passId ? _adm('passesPage.modalTitleEdit') : _adm('passesPage.modalTitleNew')
  document.getElementById('mp-save-btn').textContent = passId ? _adm('btn.save') : _adm('btn.savePass')
  ;['mp-name','mp-entries','mp-price'].forEach(id => { const e = document.getElementById(id); if(e) e.value = '' })
  document.getElementById('mp-weeks').value = '12'

  const listEl = document.getElementById('mp-courses-list')
  listEl.innerHTML = `<div style="font-size:12px;color:#9b9b9b;">${esc(_adm('loading.modalCourses'))}</div>`

  // Lektor přidává permanentku jen ke svým kurzům (RLS by stejně cizí update zablokovala).
  const coursesQuery = _scopeOwnerQuery(
    sb.from('courses').select('id, title, color_code').eq('is_active', true).eq('is_workshop', false).order('title->cs')
  )
  const [{ data: courses }, existingData] = await Promise.all([
    coursesQuery,
    passId ? sb.from('passes').select('*').eq('id', passId).single() : Promise.resolve({ data: null }),
  ])

  const pass = existingData.data
  if (pass) {
    document.getElementById('mp-name').value    = loc(pass.name)
    document.getElementById('mp-entries').value = pass.entries_total
    document.getElementById('mp-price').value   = pass.price
    document.getElementById('mp-weeks').value   = pass.validity_weeks
    _mpSelectedColor = PASS_PALETTE.includes(pass.color_code)
      ? pass.color_code
      : PASS_PALETTE[0]
  } else {
    _mpSelectedColor = PASS_PALETTE[0]
  }

  const existingIds = pass?.allowed_course_ids ?? []

  if (!courses?.length) {
    listEl.innerHTML = `<div style="font-size:12px;color:#9b9b9b;padding:8px 0;">${esc(_adm('passesPage.modalCoursesEmpty'))}</div>`
  } else {
    listEl.innerHTML = courses.map(c => {
      const color = c.color_code ?? '#2854B9'
      return `
        <label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:var(--btn-radius);
          border:1px solid var(--border);margin-bottom:6px;cursor:pointer;user-select:none;">
          <input type="checkbox" value="${esc(c.id)}" ${existingIds.includes(c.id)?'checked':''}
            style="width:16px;height:16px;accent-color:${color};cursor:pointer;flex-shrink:0;" />
          <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></div>
          <span style="font-size:13px;">${esc(loc(c.title))}</span>
        </label>`
    }).join('')
  }

  window._mpPickColor?.(_mpSelectedColor)

  document.getElementById('modal-pass').style.display = 'flex'
}

window.closePassModal = () => {
  const m = document.getElementById('modal-pass')
  if (m) m.style.display = 'none'
}

window._mpPickColor = (color) => {
  if (!PASS_PALETTE.includes(color)) return
  _mpSelectedColor = color
  document.querySelectorAll('#mp-colors button').forEach(btn => {
    const c = btn.getAttribute('data-mp-color')
    const active = c === color
    btn.style.border = active ? '3px solid #fff' : '3px solid transparent'
    btn.style.boxShadow = active ? `0 0 0 2.5px ${c}` : 'none'
  })
}

window.savePass = async () => {
  const btn   = document.getElementById('mp-save-btn')
  const errEl = document.getElementById('mp-error')
  if (errEl) errEl.style.display = 'none'

  const passId   = document.getElementById('mp-id')?.value || null
  const name     = document.getElementById('mp-name')?.value.trim()
  const entries  = Number(document.getElementById('mp-entries')?.value)
  const price    = Number(document.getElementById('mp-price')?.value)
  const weeks    = Number(document.getElementById('mp-weeks')?.value)
  const courseIds = [...document.querySelectorAll('#mp-courses-list input[type=checkbox]:checked')].map(cb => cb.value)

  if (!name)              { showErr(errEl, _adm('passesPage.errFillName')); return }
  if (!entries || entries < 1) { showErr(errEl, _adm('passesPage.errEntriesMin')); return }
  if (isNaN(price) || price < 0) { showErr(errEl, _adm('passesPage.errPriceInvalid')); return }
  if (!weeks || weeks < 1) { showErr(errEl, _adm('passesPage.errWeeksMin')); return }

  if (btn) { btn.disabled = true; btn.textContent = _adm('customers.editSaving') }

  try {
    const color_code = PASS_PALETTE.includes(_mpSelectedColor) ? _mpSelectedColor : PASS_PALETTE[0]
    const payload = {
      name: { cs: name },
      entries_total: entries,
      price,
      validity_weeks: weeks,
      allowed_course_ids: courseIds,
      color_code,
      is_active: true,
    }
    let error
    if (passId) {
      ;({ error } = await sb.from('passes').update(payload).eq('id', passId))
    } else {
      ;({ error } = await sb.from('passes').insert({ ...payload, owner_id: currentUser?.id }))
    }
    if (error) throw error

    window.closePassModal?.()
    renderAdminPermanentky()
  } catch (err) {
    console.error('[Admin] savePass:', err)
    showErr(errEl, _adm('toast.errorWithMsg', { msg: err.message ?? _adm('customers.editFail') }))
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = passId ? _adm('btn.save') : _adm('btn.savePass') }
  }
}

window.adminDeletePass = async (passId) => {
  if (!passId || !confirm(_adm('passesPage.confirmDeleteType'))) return
  try {
    const { error } = await sb.from('passes').delete().eq('id', passId)
    if (error) throw error
    window.showToast?.(_adm('passesPage.deleteOk'), 'ok')
    renderAdminPermanentky()
  } catch (err) {
    console.error('[Admin] adminDeletePass:', err)
    window.showToast?.(_adm('toast.errorWithMsg', { msg: err.message ?? err }), 'error')
  }
}

// ── Modal: Nový / upravit workshop ───────────────────────────
function buildWorkshopModal() {
  if (document.getElementById('modal-workshop')) return
  const INP = 'width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:10px;font-size:13px;background:#fff;outline:none;box-sizing:border-box;'

  const colorDots = PRESET_COLORS.map((c, i) => `
    <button type="button" data-ws-color="${c}" onclick="window._wsPickColor?.('${c}')"
      style="width:30px;height:30px;border-radius:50%;background:${c};cursor:pointer;flex-shrink:0;
        border:${i===0?'3px solid #fff;box-shadow:0 0 0 2px '+c:'3px solid transparent'};transition:.15s;">
    </button>`).join('')

  document.body.insertAdjacentHTML('beforeend', `
    <div id="modal-workshop" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.38);
      z-index:300;align-items:center;justify-content:center;padding:16px;overflow-y:auto;"
      onclick="if(event.target===this)window.closeWorkshopModal?.()">
      <div style="background:#fff;border-radius:18px;border:1px solid var(--border);box-shadow:var(--shadow);
        width:100%;max-width:520px;overflow:hidden;margin:auto;max-height:90vh;display:flex;flex-direction:column;" onclick="event.stopPropagation()">
        <div style="padding:18px 18px 4px;">
          <div style="font-size:18px;font-weight:700;" id="mw-title">Nový workshop</div>
        </div>
        <div style="padding:14px 18px;overflow-y:auto;flex:1;">
          <input type="hidden" id="mw-id" />
          <input type="hidden" id="mw-lesson-id" />

          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Název workshopu</label>
            <input id="mw-name" type="text" placeholder="např. Úvod do keramiky" style="${INP}" />
          </div>

          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Anotace <span style="font-weight:400;opacity:.7;">(zobrazí se v seznamu)</span></label>
            <textarea id="mw-desc" rows="2" placeholder="Krátký popis workshopu…"
              style="${INP}resize:vertical;min-height:60px;"></textarea>
          </div>

          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Obsah workshopu <span style="font-weight:400;opacity:.7;">(detailní popis)</span></label>
            <div id="mw-long-wrap" class="admin-quill-wrap"><div id="mw-long-editor"></div></div>
          </div>

          <div style="margin-bottom:14px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:8px;">Barva v kalendáři</label>
            <div id="mw-colors" style="display:flex;gap:8px;flex-wrap:wrap;">${colorDots}</div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
            <div>
              <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Cena (Kč)</label>
              <input id="mw-price" type="number" min="0" placeholder="800" style="${INP}" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Kapacita (míst)</label>
              <input id="mw-capacity" type="number" min="1" value="12" style="${INP}" />
            </div>
          </div>

          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Minimální počet účastníků</label>
            <input id="mw-min-p" type="number" min="1" value="1" style="${INP}" />
            <div style="font-size:11px;color:#6b6b6b;margin-top:4px;line-height:1.45;">
              Stejná logika upozornění jako u běžného kurzu (cron + fronta e‑mailů).
            </div>
          </div>

          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Datum</label>
            <input id="mw-date" type="date" style="${INP}" />
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
            <div>
              <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Čas od</label>
              <input id="mw-time-from" type="time" value="09:00" style="${INP}" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Čas do</label>
              <input id="mw-time-to" type="time" value="12:00" style="${INP}" />
            </div>
          </div>

          <div style="margin-bottom:14px;">
            <div id="mw-photos-list" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;"></div>
            <label id="mw-photos-add" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;
              border:1.5px dashed var(--border);border-radius:var(--btn-radius);cursor:pointer;font-size:12px;color:var(--muted);">
              + Přidat foto
              <input type="file" id="mw-photo-input" accept="image/*" multiple style="display:none;"
                onchange="window._mwHandlePhotos(this)" />
            </label>
          </div>

          <div id="mw-error" style="display:none;font-size:12px;color:#791F1F;background:#FCEBEB;
            border-radius:8px;padding:10px 12px;"></div>
        </div>
        <div style="display:flex;gap:10px;padding:12px 18px;border-top:1px solid var(--border);">
          <button class="btn-wide" onclick="window.closeWorkshopModal?.()" style="flex:1;">${esc(t(_adminLocale(), 'common.cancel'))}</button>
          <button class="btn-wide primary" id="mw-save-btn" onclick="window.saveNewWorkshop?.()" style="flex:2;">${esc(_adm('workshop.saveNew'))}</button>
        </div>
      </div>
    </div>`)
}

window._wsPickColor = (color) => {
  _wsSelectedColor = color
  document.querySelectorAll('#mw-colors button').forEach(btn => {
    const active = btn.dataset.wsColor === color
    btn.style.border = active ? '3px solid #fff' : '3px solid transparent'
    btn.style.boxShadow = active ? `0 0 0 2.5px ${color}` : 'none'
  })
}

window.adminNewWorkshop = async () => {
  buildWorkshopModal()
  _wsSelectedColor = PRESET_COLORS[0]
  _mwExistingImages = []
  _mwNewFiles = []
  _mwRenderPhotos()
  document.getElementById('mw-id').value       = ''
  document.getElementById('mw-lesson-id').value = ''
  document.getElementById('mw-title').textContent    = _adm('workshop.titleNew')
  document.getElementById('mw-save-btn').textContent = _adm('workshop.saveNew')
  const errEl = document.getElementById('mw-error')
  if (errEl) errEl.style.display = 'none'
  ;['mw-name','mw-desc','mw-price','mw-date'].forEach(id => { const e = document.getElementById(id); if(e) e.value = '' })
  document.getElementById('mw-capacity').value  = '12'
  document.getElementById('mw-min-p').value     = '1'
  document.getElementById('mw-time-from').value = '09:00'
  document.getElementById('mw-time-to').value   = '12:00'
  window._wsPickColor?.(PRESET_COLORS[0])
  await _setMwLongHtml('')
  document.getElementById('modal-workshop').style.display = 'flex'
}

window.adminEditWorkshop = async (courseId) => {
  buildWorkshopModal()
  const errEl = document.getElementById('mw-error')
  if (errEl) errEl.style.display = 'none'
  _mwExistingImages = []
  _mwNewFiles = []
  document.getElementById('mw-id').value             = courseId
  document.getElementById('mw-title').textContent    = _adm('workshop.titleEdit')
  document.getElementById('mw-save-btn').textContent = _adm('btn.save')

  const [{ data: course }, { data: lessons }] = await Promise.all([
    sb.from('courses').select('*').eq('id', courseId).single(),
    sb.from('lessons').select('id, start_time, end_time').eq('course_id', courseId).order('start_time').limit(1),
  ])

  if (course) {
    document.getElementById('mw-name').value     = loc(course.title)
    document.getElementById('mw-desc').value     = loc(course.description_short)
    document.getElementById('mw-price').value    = course.price_single
    document.getElementById('mw-capacity').value = course.capacity_default
    document.getElementById('mw-min-p').value    = Math.max(1, Number(course.min_participants ?? 1))
    if (course.color_code) {
      _wsSelectedColor = course.color_code
      window._wsPickColor?.(course.color_code)
    }
    const imgs = Array.isArray(course.images) ? course.images.filter(Boolean) : []
    _mwExistingImages = imgs.slice(0, MAX_COURSE_PHOTOS)
    _mwRenderPhotos()
  }

  const lesson = lessons?.[0]
  if (lesson) {
    document.getElementById('mw-lesson-id').value = lesson.id
    const start = new Date(lesson.start_time)
    const end   = new Date(lesson.end_time)
    const pad   = n => String(n).padStart(2, '0')
    document.getElementById('mw-date').value      = `${start.getFullYear()}-${pad(start.getMonth()+1)}-${pad(start.getDate())}`
    document.getElementById('mw-time-from').value = `${pad(start.getHours())}:${pad(start.getMinutes())}`
    document.getElementById('mw-time-to').value   = `${pad(end.getHours())}:${pad(end.getMinutes())}`
  }

  await _setMwLongHtml(course ? loc(course.description_long) : '')
  document.getElementById('modal-workshop').style.display = 'flex'
}

window.closeWorkshopModal = () => {
  _destroyMwLongQuill()
  const m = document.getElementById('modal-workshop')
  if (m) m.style.display = 'none'
}

window.saveNewWorkshop = async () => {
  const btn   = document.getElementById('mw-save-btn')
  const errEl = document.getElementById('mw-error')
  if (errEl) errEl.style.display = 'none'

  const courseId = document.getElementById('mw-id')?.value     || null
  const lessonId = document.getElementById('mw-lesson-id')?.value || null
  const name     = document.getElementById('mw-name')?.value.trim()
  const desc     = document.getElementById('mw-desc')?.value.trim()
  if (!_getQuillCtor()) { showErr(errEl, _adm('workshop.editorNotLoaded')); return }
  const descLong = _getMwLongHtml()
  const price    = Number(document.getElementById('mw-price')?.value)
  const capacity = Number(document.getElementById('mw-capacity')?.value)
  const minPart  = Number(document.getElementById('mw-min-p')?.value)
  const date     = document.getElementById('mw-date')?.value
  const timeFrom = document.getElementById('mw-time-from')?.value
  const timeTo   = document.getElementById('mw-time-to')?.value

  if (!name)                      { showErr(errEl, _adm('workshop.errName')); return }
  if (isNaN(price) || price < 0)  { showErr(errEl, _adm('workshop.errPrice')); return }
  if (!capacity || capacity < 1)  { showErr(errEl, _adm('workshop.errCapacity')); return }
  if (!minPart || minPart < 1 || minPart > capacity) {
    showErr(errEl, _adm('workshop.errMinParticipants')); return
  }
  if (!date)                      { showErr(errEl, _adm('workshop.errPickDate')); return }
  if (!timeFrom || !timeTo)       { showErr(errEl, _adm('workshop.errTimeRange')); return }
  if (timeFrom >= timeTo)         { showErr(errEl, _adm('workshop.errTimeOrder')); return }

  if (btn) { btn.disabled = true; btn.textContent = _adm('customers.editSaving') }

  try {
    const [year, month, day] = date.split('-').map(Number)
    const [fH, fM] = timeFrom.split(':').map(Number)
    const [tH, tM] = timeTo.split(':').map(Number)
    const start = new Date(year, month - 1, day, fH, fM, 0, 0)
    const end   = new Date(year, month - 1, day, tH, tM, 0, 0)

    const coursePayload = {
      title: { cs: name },
      description_short: { cs: desc || '' },
      description_long:  { cs: descLong || '' },
      color_code: _wsSelectedColor,
      price_single: price,
      capacity_default: capacity,
      min_participants: minPart,
      cancellation_hours: 24,
      is_active: true,
      is_workshop: true,
      schedule_days: [],
      schedule_time_start: timeFrom,
      schedule_time_end: timeTo,
    }

    let savedCourseId = courseId
    if (courseId) {
      let lessonHasActiveParticipants = false
      let lessonTimeChanged = false
      if (lessonId) {
        const [{ data: currentLesson, error: currentLessonErr }, { count: activeParticipants, error: participantErr }] = await Promise.all([
          sb.from('lessons')
            .select('id, start_time, end_time')
            .eq('id', lessonId)
            .maybeSingle(),
          sb.from('bookings')
            .select('id', { count: 'exact', head: true })
            .eq('lesson_id', lessonId)
            .in('status', BLOCKING_PARTICIPATION_STATUSES),
        ])
        if (currentLessonErr) throw currentLessonErr
        if (participantErr) throw participantErr
        lessonHasActiveParticipants = Number(activeParticipants ?? 0) > 0
        lessonTimeChanged = !!currentLesson && (
          new Date(currentLesson.start_time).getTime() !== start.getTime()
          || new Date(currentLesson.end_time).getTime() !== end.getTime()
        )
        if (lessonTimeChanged && lessonHasActiveParticipants && !confirm(_adm('workshop.confirmRescheduleWithParticipants', { n: Number(activeParticipants ?? 0) }))) {
          return
        }
      }

      const { error } = await sb.from('courses').update(coursePayload).eq('id', courseId)
      if (error) throw error
      if (lessonId) {
        const { data: rescheduleData, error: lErr } = await sb.rpc('admin_reschedule_lesson', {
          p_lesson_id: lessonId,
          p_start_time: start.toISOString(),
          p_end_time: end.toISOString(),
          p_capacity: capacity,
          p_price_single: price,
        })
        if (lErr) {
          const missFn = lErr.code === 'PGRST202'
            || lErr.message?.includes('Could not find the function')
            || lErr.message?.includes('admin_reschedule_lesson')
          if (missFn && !lessonHasActiveParticipants) {
            const { error: fallbackErr } = await sb.from('lessons').update({
              start_time: start.toISOString(), end_time: end.toISOString(),
              capacity, price_single: price,
            }).eq('id', lessonId)
            if (fallbackErr) throw fallbackErr
          } else if (missFn) {
            throw new Error(_adm('workshop.errRescheduleNoRpc'))
          } else {
            throw lErr
          }
        } else if (rescheduleData && rescheduleData.ok === false) {
          throw new Error(_adminLessonMessageErrorLabel(rescheduleData.error))
        } else if (Number(rescheduleData?.queued ?? rescheduleData?.recipients ?? 0) > 0) {
          window.showToast?.(_adm('workshop.toastRescheduled', { n: Number(rescheduleData?.queued ?? rescheduleData?.recipients ?? 0) }), 'ok')
          await _adminTryProcessEmailQueue()
        }
      }
    } else {
      const { data, error } = await sb.from('courses')
        .insert({ ...coursePayload, owner_id: currentUser?.id }).select('id').single()
      if (error) throw error
      savedCourseId = data.id

      const { error: lErr } = await sb.from('lessons').insert({
        course_id: savedCourseId,
        start_time: start.toISOString(), end_time: end.toISOString(),
        capacity, price_single: price, status: 'active',
      })
      if (lErr) throw lErr
    }

    const uploadResults = await Promise.allSettled(
      _mwNewFiles.map(f => _uploadCourseImage(f, savedCourseId)),
    )
    const imageUrls = [
      ..._mwExistingImages,
      ...uploadResults.filter(r => r.status === 'fulfilled').map(r => r.value),
    ].slice(0, MAX_COURSE_PHOTOS)
    await sb.from('courses').update({ images: imageUrls }).eq('id', savedCourseId)

    window.closeWorkshopModal?.()
    renderAdminKurzy()
    try {
      await window.refreshPublicData?.()
    } catch (refreshErr) {
      console.warn('[Admin] refreshPublicData po uložení workshopu:', refreshErr)
    }
  } catch (err) {
    console.error('[Admin] saveNewWorkshop:', err)
    showErr(errEl, 'Chyba: ' + (err.message ?? 'Zkuste to znovu.'))
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = courseId ? _adm('btn.save') : _adm('workshop.saveNew') }
  }
}

// ── Fotografie kurzu: helpers ─────────────────────────────────
function _photoThumb(src, onRemove) {
  return `
    <div style="position:relative;width:80px;height:60px;flex-shrink:0;">
      <img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;border:1px solid var(--border);" />
      <button type="button" onclick="${onRemove}"
        style="position:absolute;top:-5px;right:-5px;width:18px;height:18px;border-radius:50%;
          background:#fff;border:1px solid var(--border);font-size:12px;cursor:pointer;
          display:flex;align-items:center;justify-content:center;padding:0;line-height:1;">×</button>
    </div>`
}

function _ncRenderPhotos() {
  const list   = document.getElementById('mc-photos-list')
  const addBtn = document.getElementById('mc-photos-add')
  if (!list) return
  const total = _ncExistingImages.length + _ncNewFiles.length
  list.innerHTML = [
    ..._ncExistingImages.map((url, i) => _photoThumb(url, `window._ncRemovePhoto('existing',${i})`)),
    ..._ncNewFiles.map((f, i) => _photoThumb(URL.createObjectURL(f), `window._ncRemovePhoto('new',${i})`)),
  ].join('')
  if (addBtn) addBtn.style.display = total < MAX_COURSE_PHOTOS ? 'inline-flex' : 'none'
}

window._ncHandlePhotos = (input) => {
  const remaining = MAX_COURSE_PHOTOS - _ncExistingImages.length - _ncNewFiles.length
  if (remaining <= 0) { input.value = ''; return }
  const valid = []
  for (const f of [...input.files]) {
    if (!f.type.startsWith('image/')) { alert(_adm('alerts.notImage', { name: f.name })); continue }
    if (f.size > MAX_PHOTO_UPLOAD_BYTES) { alert(_adm('alerts.tooLarge', { name: f.name })); continue }
    valid.push(f)
  }
  _ncNewFiles = [..._ncNewFiles, ...valid].slice(0, _ncNewFiles.length + remaining)
  input.value = ''
  _ncRenderPhotos()
}

window._ncRemovePhoto = (type, index) => {
  if (type === 'existing') _ncExistingImages.splice(index, 1)
  else _ncNewFiles.splice(index, 1)
  _ncRenderPhotos()
}

function _mwRenderPhotos() {
  const list   = document.getElementById('mw-photos-list')
  const addBtn = document.getElementById('mw-photos-add')
  if (!list) return
  const total = _mwExistingImages.length + _mwNewFiles.length
  list.innerHTML = [
    ..._mwExistingImages.map((url, i) => _photoThumb(url, `window._mwRemovePhoto('existing',${i})`)),
    ..._mwNewFiles.map((f, i) => _photoThumb(URL.createObjectURL(f), `window._mwRemovePhoto('new',${i})`)),
  ].join('')
  if (addBtn) addBtn.style.display = total < MAX_COURSE_PHOTOS ? 'inline-flex' : 'none'
}

window._mwHandlePhotos = (input) => {
  const remaining = MAX_COURSE_PHOTOS - _mwExistingImages.length - _mwNewFiles.length
  if (remaining <= 0) { input.value = ''; return }
  const valid = []
  for (const f of [...input.files]) {
    if (!f.type.startsWith('image/')) { alert(_adm('alerts.notImage', { name: f.name })); continue }
    if (f.size > MAX_PHOTO_UPLOAD_BYTES) { alert(_adm('alerts.tooLarge', { name: f.name })); continue }
    valid.push(f)
  }
  _mwNewFiles = [..._mwNewFiles, ...valid].slice(0, _mwNewFiles.length + remaining)
  input.value = ''
  _mwRenderPhotos()
}

window._mwRemovePhoto = (type, index) => {
  if (type === 'existing') _mwExistingImages.splice(index, 1)
  else _mwNewFiles.splice(index, 1)
  _mwRenderPhotos()
}

/** Před nahráním zmenší velké JPG/PNG/WebP (> 5 MB) přes Canvas (JPEG). */
async function compressImageIfNeeded(file) {
  if (!file?.type?.startsWith('image/')) return file
  if (file.size <= COMPRESS_OVER_BYTES) return file
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      try {
        const maxSide = 1920
        let w = img.naturalWidth || img.width
        let h = img.naturalHeight || img.height
        if (w < 1 || h < 1) { resolve(file); return }
        if (w > maxSide || h > maxSide) {
          const k = Math.min(maxSide / w, maxSide / h)
          w = Math.round(w * k)
          h = Math.round(h * k)
        }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(file); return }
        ctx.drawImage(img, 0, 0, w, h)
        canvas.toBlob(
          blob => {
            if (!blob) { resolve(file); return }
            const base = String(file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo'
            resolve(new File([blob], `${base}.jpg`, { type: 'image/jpeg' }))
          },
          'image/jpeg',
          0.85
        )
      } catch (err) {
        console.warn('[Admin] komprese fotky:', err)
        resolve(file)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file)
    }
    img.src = url
  })
}

async function _uploadCourseImage(file, courseId) {
  const prepared = await compressImageIfNeeded(file)
  const ext =
    prepared.type === 'image/png' ? 'png'
      : prepared.type === 'image/webp' ? 'webp'
        : 'jpg'
  const path = `${courseId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
  const contentType = prepared.type || 'image/jpeg'
  const { error } = await sb.storage.from('course-images').upload(path, prepared, { contentType })
  if (error) throw error
  return sb.storage.from('course-images').getPublicUrl(path).data.publicUrl
}

// ── Modal: Nový / upravit kurz ────────────────────────────────
function buildCourseModal() {
  if (document.getElementById('modal-course')) return
  const INP = 'width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:10px;font-size:13px;background:#fff;outline:none;box-sizing:border-box;'

  const colorDots = PRESET_COLORS.map((c, i) => `
    <button type="button" data-color="${c}" onclick="window._ncPickColor?.('${c}')"
      style="width:30px;height:30px;border-radius:50%;background:${c};cursor:pointer;flex-shrink:0;
        border:${i===0?'3px solid #fff;box-shadow:0 0 0 2px '+c:'3px solid transparent'};transition:.15s;">
    </button>`).join('')

  const dayBtns = _adminWeekdayShortLabels().map((d, i) => `
    <button type="button" data-day="${i}" onclick="window._ncToggleDay?.(${i},this)"
      style="flex:1;padding:9px 2px;border-radius:var(--btn-radius);border:1px solid var(--border);
        background:transparent;font-size:12px;font-weight:600;cursor:pointer;color:var(--muted);transition:.15s;">
      ${d}
    </button>`).join('')

  document.body.insertAdjacentHTML('beforeend', `
    <div id="modal-course" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.38);
      z-index:300;align-items:center;justify-content:center;padding:16px;overflow-y:auto;"
      onclick="if(event.target===this)window.closeNewCourseModal?.()">
      <div style="background:#fff;border-radius:18px;border:1px solid var(--border);box-shadow:var(--shadow);
        width:100%;max-width:520px;overflow:hidden;margin:auto;max-height:90vh;display:flex;flex-direction:column;" onclick="event.stopPropagation()">
        <div style="padding:18px 18px 4px;">
          <div style="font-size:18px;font-weight:700;" id="mc-title">Nový kurz</div>
        </div>
        <div style="padding:14px 18px;overflow-y:auto;flex:1;">
          <input type="hidden" id="mc-id" />

          <div id="mc-edit-note" style="display:none;font-size:11px;color:#8B5C00;background:#FFF4E0;
            border-radius:8px;padding:10px 12px;margin-bottom:14px;">
            Změna názvu, barvy, ceny, kapacity a času se automaticky projeví u všech budoucích termínů tohoto kurzu.
          </div>

          <!-- Název -->
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Název kurzu</label>
            <input id="mc-name" type="text" placeholder="např. Točení na kruhu" style="${INP}" />
          </div>

          <!-- Anotace (krátký popis) -->
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Anotace <span style="font-weight:400;opacity:.7;">(zobrazí se v seznamu kurzů)</span></label>
            <textarea id="mc-desc" rows="2" placeholder="Stručný popis kurzu…"
              style="${INP}resize:vertical;min-height:60px;"></textarea>
          </div>

          <!-- Obsah kurzu (dlouhý popis) — Quill editor -->
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Obsah kurzu <span style="font-weight:400;opacity:.7;">(detailní popis na stránce kurzu)</span></label>
            <div id="mc-long-wrap" class="admin-quill-wrap"><div id="mc-long-editor"></div></div>
          </div>

          <!-- Barva -->
          <div style="margin-bottom:14px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:8px;">Barva v kalendáři</label>
            <div id="mc-colors" style="display:flex;gap:8px;flex-wrap:wrap;">${colorDots}</div>
          </div>

          <!-- Cena + Kapacita -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
            <div>
              <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Jednorázový vstup (Kč)</label>
              <input id="mc-price" type="number" min="0" placeholder="450" style="${INP}" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Kapacita (míst)</label>
              <input id="mc-capacity" type="number" min="1" value="12" style="${INP}" />
            </div>
          </div>
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Minimální počet účastníků</label>
            <input id="mc-min-p" type="number" min="1" value="1" style="${INP}" />
            <div style="font-size:11px;color:#6b6b6b;margin-top:4px;line-height:1.45;">
              Pokud bude méně přihlášených, lektor dostane e‑mail cca 24 h před začátkem lekce (vyžaduje cron + odesílání fronty).
            </div>
          </div>

          <!-- Storno -->
          <div style="margin-bottom:14px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Storno lhůta</label>
            <select id="mc-cancel" style="${INP}">
              <option value="6">6 hodin předem</option>
              <option value="24" selected>24 hodin předem</option>
              <option value="48">48 hodin předem</option>
            </select>
          </div>

          <!-- Dny v týdnu -->
          <div style="margin-bottom:14px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:8px;">Dny v týdnu</label>
            <div style="display:flex;gap:5px;">${dayBtns}</div>
          </div>

          <!-- Čas od–do -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
            <div>
              <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Čas od</label>
              <input id="mc-time-from" type="time" value="09:00" style="${INP}" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Čas do</label>
              <input id="mc-time-to" type="time" value="10:30" style="${INP}" />
            </div>
          </div>

          <!-- Fotografie -->
          <div style="margin-bottom:14px;">
            <div id="mc-photos-list" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;"></div>
            <label id="mc-photos-add" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;
              border:1.5px dashed var(--border);border-radius:var(--btn-radius);cursor:pointer;font-size:12px;color:var(--muted);">
              + Přidat foto
              <input type="file" id="mc-photo-input" accept="image/*" multiple style="display:none;"
                onchange="window._ncHandlePhotos(this)" />
            </label>
          </div>

          <!-- Omezený přístup -->
          <div style="margin-bottom:14px;padding:12px;border:1px solid var(--border);border-radius:10px;">
            <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;user-select:none;">
              <input type="checkbox" id="mc-restricted" onchange="window._mcToggleRestricted?.()"
                style="width:16px;height:16px;margin-top:2px;accent-color:var(--primary);flex-shrink:0;" />
              <span>
                <span style="font-size:13px;font-weight:600;display:block;">${esc(_adm('courseModal.restrictedLabel'))}</span>
                <span style="font-size:11px;color:#6b6b6b;line-height:1.45;">${esc(_adm('courseModal.restrictedHint'))}</span>
              </span>
            </label>
            <div id="mc-allowed-users-wrap" style="display:none;margin-top:12px;">
              <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:6px;">${esc(_adm('courseModal.allowedUsersLabel'))}</label>
              <input type="search" id="mc-allowed-users-search" placeholder="${esc(_adm('courseModal.allowedUsersSearchPh'))}"
                oninput="window._mcFilterAllowedUsers?.(this.value)"
                style="${INP}margin-bottom:8px;" />
              <div id="mc-allowed-users-list" style="max-height:200px;overflow-y:auto;">
                <div style="font-size:12px;color:#9b9b9b;">${esc(_adm('loading.modalAllowedUsers'))}</div>
              </div>
            </div>
          </div>

          <!-- Povolené permanentky -->
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:8px;">${esc(_adm('passesPage.allowedPassesLabel'))}</label>
            <div id="mc-passes-list"><div style="font-size:12px;color:#9b9b9b;">${esc(_adm('loading.modalPasses'))}</div></div>
          </div>

          <div id="mc-error" style="display:none;font-size:12px;color:#791F1F;background:#FCEBEB;
            border-radius:8px;padding:10px 12px;"></div>
        </div>
        <div style="display:flex;gap:10px;padding:12px 18px;border-top:1px solid var(--border);">
          <button class="btn-wide" onclick="window.closeNewCourseModal?.()" style="flex:1;">${esc(t(_adminLocale(), 'common.cancel'))}</button>
          <button class="btn-wide primary" id="mc-save-btn" onclick="window.saveNewCourse?.()" style="flex:2;">${esc(_adm('btn.saveCourse'))}</button>
        </div>
      </div>
    </div>`)
}

// Interakce v course modalu
window._ncPickColor = (color) => {
  _ncSelectedColor = color
  document.querySelectorAll('#mc-colors button').forEach(btn => {
    const active = btn.dataset.color === color
    btn.style.border = active ? '3px solid #fff' : '3px solid transparent'
    btn.style.boxShadow = active ? `0 0 0 2.5px ${color}` : 'none'
  })
  // Update active day buttons color
  document.querySelectorAll('[data-day].day-active').forEach(btn => {
    btn.style.background = color
    btn.style.borderColor = color
  })
}

window._ncToggleDay = (dayIdx, btn) => {
  if (_ncSelectedDays.has(dayIdx)) {
    _ncSelectedDays.delete(dayIdx)
    btn.classList.remove('day-active')
    btn.style.background = 'transparent'
    btn.style.color = 'var(--muted)'
    btn.style.borderColor = 'var(--border)'
  } else {
    _ncSelectedDays.add(dayIdx)
    btn.classList.add('day-active')
    btn.style.background = _ncSelectedColor
    btn.style.color = '#fff'
    btn.style.borderColor = _ncSelectedColor
  }
}

async function _openCourseModal(courseId = null) {
  buildCourseModal()

  // Reset state
  _ncSelectedDays  = new Set()
  _ncSelectedColor = PRESET_COLORS[0]

  const isEdit = !!courseId
  document.getElementById('mc-id').value          = courseId ?? ''
  document.getElementById('mc-title').textContent  = isEdit ? _adm('courseModal.titleEdit') : _adm('courseModal.titleNew')
  document.getElementById('mc-save-btn').textContent = isEdit ? _adm('btn.save') : _adm('btn.saveCourse')
  const errEl = document.getElementById('mc-error')
  if (errEl) errEl.style.display = 'none'

  // Reset days
  document.querySelectorAll('[data-day]').forEach(btn => {
    btn.classList.remove('day-active')
    btn.style.background = 'transparent'
    btn.style.color = 'var(--muted)'
    btn.style.borderColor = 'var(--border)'
  })
  // Reset color to first
  window._ncPickColor?.(PRESET_COLORS[0])

  // Reset fields
  ;['mc-name','mc-desc','mc-price'].forEach(id => { const e = document.getElementById(id); if(e) e.value = '' })
  document.getElementById('mc-capacity').value  = '12'
  document.getElementById('mc-min-p').value    = '1'
  document.getElementById('mc-cancel').value    = '24'
  document.getElementById('mc-time-from').value = '09:00'
  document.getElementById('mc-time-to').value   = '10:30'
  _ncExistingImages = []
  _ncNewFiles       = []
  _ncRenderPhotos()
  _mcAllowedUserIds = new Set()
  _mcAllowedUsersQuery = ''
  _mcInviteCandidates = []
  const restrictedEl = document.getElementById('mc-restricted')
  if (restrictedEl) restrictedEl.checked = false
  const allowedSearchEl = document.getElementById('mc-allowed-users-search')
  if (allowedSearchEl) allowedSearchEl.value = ''
  window._mcToggleRestricted?.()
  const allowedListEl = document.getElementById('mc-allowed-users-list')
  if (allowedListEl) {
    allowedListEl.innerHTML = `<div style="font-size:12px;color:#9b9b9b;">${esc(_adm('loading.modalAllowedUsers'))}</div>`
  }
  const noteEl = document.getElementById('mc-edit-note')
  if (noteEl) noteEl.style.display = isEdit ? 'block' : 'none'

  // Load passes list
  const passesListEl = document.getElementById('mc-passes-list')
  passesListEl.innerHTML = `<div style="font-size:12px;color:#9b9b9b;">${esc(_adm('loading.modalPasses'))}</div>`

  let passes = []
  let courseData = { data: null }
  let allowedUserIds = []
  let modalDataFailed = false
  try {
    // Lektor v modalu kurzu vidí jen své vlastní permanentky — cizí by mu RLS UPDATE tiše neumožnil.
    const passesQuery = _scopeOwnerQuery(
      sb.from('passes').select('id, name, entries_total, price').eq('is_active', true).order('created_at')
    )
    const [passRes, cRes, , allowedRes] = await Promise.all([
      passesQuery,
      courseId
        ? sb.from('courses').select('*').eq('id', courseId).single()
        : Promise.resolve({ data: null }),
      _loadMcInviteCandidates(),
      courseId
        ? sb.from('course_allowed_users').select('user_id').eq('course_id', courseId)
        : Promise.resolve({ data: [] }),
    ])
    passes = passRes?.data ?? []
    courseData = cRes ?? { data: null }
    allowedUserIds = (allowedRes?.data ?? []).map(r => r.user_id)
  } catch (e) {
    modalDataFailed = true
    console.error('[Admin] modal kurz:', e)
    passesListEl.innerHTML = `<div style="font-size:12px;color:#791F1F;padding:8px 0;">
      ${esc(_adm('courseModal.modalLoadFail'))}</div>`
    if (allowedListEl) {
      allowedListEl.innerHTML = `<div style="font-size:12px;color:#791F1F;padding:8px 0;">
        ${esc(_adm('courseModal.modalLoadFail'))}</div>`
    }
  }

  const course = courseData?.data

  // Pre-fill edit data
  if (course) {
    document.getElementById('mc-name').value     = loc(course.title)
    document.getElementById('mc-desc').value     = loc(course.description_short)
    document.getElementById('mc-price').value    = course.price_single
    document.getElementById('mc-capacity').value = course.capacity_default
    document.getElementById('mc-min-p').value    = Math.max(1, Number(course.min_participants ?? 1))
    document.getElementById('mc-cancel').value   = course.cancellation_hours
    if (course.schedule_time_start) document.getElementById('mc-time-from').value = course.schedule_time_start.slice(0,5)
    if (course.schedule_time_end)   document.getElementById('mc-time-to').value   = course.schedule_time_end.slice(0,5)

    // Restore color
    if (course.color_code) {
      _ncSelectedColor = course.color_code
      window._ncPickColor?.(course.color_code)
    }
    // Restore days
    ;(course.schedule_days ?? []).forEach(d => {
      const btn = document.querySelector(`[data-day="${d}"]`)
      if (btn) window._ncToggleDay?.(d, btn)
    })
    // Load existing images
    _ncExistingImages = (course.images ?? []).filter(Boolean).slice(0, MAX_COURSE_PHOTOS)
    _ncRenderPhotos()
    if (restrictedEl) restrictedEl.checked = !!course.is_restricted
    _mcAllowedUserIds = new Set(allowedUserIds)
    window._mcToggleRestricted?.()
    _mcRenderAllowedUsersList()
  } else if (!modalDataFailed) {
    _mcRenderAllowedUsersList()
  }

  if (!modalDataFailed) {
    // Which passes already apply to this course?
    let linkedPassIds = []
    if (courseId) {
      try {
        const { data: linkedPasses } = await sb.from('passes')
          .select('id').contains('allowed_course_ids', [courseId])
        linkedPassIds = (linkedPasses ?? []).map(p => p.id)
      } catch (e) {
        console.warn('[Admin] linked passes:', e)
      }
    }

    if (!(passes && passes.length)) {
      passesListEl.innerHTML = `<div style="font-size:12px;color:#9b9b9b;padding:8px 0;">${esc(_adm('passesPage.modalPassesEmpty'))}</div>`
    } else {
      passesListEl.innerHTML = passes.map(p => {
        const name = loc(p.name) || _adm('misc.pass')
        return `
        <label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:var(--btn-radius);
          border:1px solid var(--border);margin-bottom:6px;cursor:pointer;user-select:none;">
          <input type="checkbox" value="${esc(p.id)}" ${linkedPassIds.includes(p.id)?'checked':''}
            style="width:16px;height:16px;accent-color:var(--primary);cursor:pointer;flex-shrink:0;" />
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:500;">${esc(name)}</div>
            <div style="font-size:11px;color:#6b6b6b;">${_adm('customers.passLine', { name, entries: p.entries_total, price: fmtPrice(p.price) })}</div>
          </div>
        </label>`
      }).join('')
    }
  }

  await _setMcLongHtml(course ? loc(course.description_long) : '')
  document.getElementById('modal-course').style.display = 'flex'
}

window.adminNewCourse  = () => _openCourseModal(null)
window.adminEditCourse = (id) => _openCourseModal(id)

window.closeNewCourseModal = () => {
  _destroyMcLongQuill()
  const m = document.getElementById('modal-course')
  if (m) m.style.display = 'none'
}

window.saveNewCourse = async () => {
  const btn   = document.getElementById('mc-save-btn')
  const errEl = document.getElementById('mc-error')
  if (errEl) errEl.style.display = 'none'

  const courseId    = document.getElementById('mc-id')?.value || null
  const name        = document.getElementById('mc-name')?.value.trim()
  const desc        = document.getElementById('mc-desc')?.value.trim()
  if (!_getQuillCtor()) { showErr(errEl, _adm('courseModal.editorNotLoaded')); return }
  const descLong    = _getMcLongHtml()
  const price       = Number(document.getElementById('mc-price')?.value)
  const capacity    = Number(document.getElementById('mc-capacity')?.value)
  const minPart     = Number(document.getElementById('mc-min-p')?.value)
  const cancelH     = Number(document.getElementById('mc-cancel')?.value)
  const timeFrom    = document.getElementById('mc-time-from')?.value
  const timeTo      = document.getElementById('mc-time-to')?.value
  const selectedDays    = [..._ncSelectedDays]
  const selectedPassIds = [...document.querySelectorAll('#mc-passes-list input[type=checkbox]:checked')].map(cb => cb.value)
  const isRestricted    = document.getElementById('mc-restricted')?.checked ?? false
  const selectedUserIds = isRestricted ? [..._mcAllowedUserIds] : []

  if (!name)              { showErr(errEl, _adm('courseModal.errName')); return }
  if (!price || price<=0) { showErr(errEl, _adm('courseModal.errTicketPrice')); return }
  if (!capacity || capacity<1) { showErr(errEl, _adm('courseModal.errCapacity')); return }
  if (!minPart || minPart < 1 || minPart > capacity) {
    showErr(errEl, _adm('courseModal.errMinParticipants')); return
  }
  if (selectedDays.length === 0) { showErr(errEl, _adm('courseModal.errPickWeekday')); return }
  if (!timeFrom || !timeTo)       { showErr(errEl, _adm('courseModal.errTimeRange')); return }
  if (timeFrom >= timeTo)         { showErr(errEl, _adm('courseModal.errTimeOrder')); return }

  if (btn) { btn.disabled = true; btn.textContent = _adm('courseModal.saving') }

  try {
    const payload = {
      title: { cs: name },
      description_short: { cs: desc || '' },
      description_long:  { cs: descLong || '' },
      color_code: _ncSelectedColor,
      price_single: price,
      capacity_default: capacity,
      min_participants: minPart,
      cancellation_hours: cancelH,
      is_active: true,
      schedule_days: selectedDays,
      schedule_time_start: timeFrom,
      schedule_time_end: timeTo,
      is_restricted: isRestricted,
    }

    let savedId = courseId
    if (courseId) {
      // Upload any new photos (we already have the ID)
      const uploadResults = await Promise.allSettled(_ncNewFiles.map(f => _uploadCourseImage(f, courseId)))
      const imageUrls = [
        ..._ncExistingImages,
        ...uploadResults.filter(r => r.status === 'fulfilled').map(r => r.value),
      ].slice(0, MAX_COURSE_PHOTOS)
      const { error } = await sb.from('courses').update({ ...payload, images: imageUrls }).eq('id', courseId)
      if (error) throw error

      await _syncFutureCourseLessons(courseId, selectedDays, timeFrom, timeTo, capacity, price)
    } else {
      // New course: insert first (need ID for storage path)
      const { data, error } = await sb.from('courses')
        .insert({ ...payload, owner_id: currentUser?.id }).select('id').single()
      if (error) throw error
      savedId = data.id

      // Upload photos using the new ID, then persist URLs
      const uploadResults = await Promise.allSettled(_ncNewFiles.map(f => _uploadCourseImage(f, savedId)))
      const imageUrls = uploadResults.filter(r => r.status === 'fulfilled').map(r => r.value).slice(0, MAX_COURSE_PHOTOS)
      await sb.from('courses').update({ images: imageUrls }).eq('id', savedId)

      // Generate lessons for next 4 weeks
      const lessons = _generateLessons(savedId, selectedDays, timeFrom, timeTo, capacity, price)
      if (lessons.length > 0) {
        const { error: lErr } = await sb.from('lessons').insert(lessons)
        if (lErr) console.warn('[Admin] createLessons:', lErr)
      }
    }

    // Sync pass associations
    await _syncPassAssociations(savedId, selectedPassIds)
    await _syncCourseAllowedUsers(savedId, selectedUserIds)

    window.closeNewCourseModal?.()
    renderAdminKurzy()
    try {
      await window.refreshPublicData?.()
    } catch (refreshErr) {
      console.warn('[Admin] refreshPublicData po uložení kurzu:', refreshErr)
    }
  } catch (err) {
    console.error('[Admin] saveNewCourse:', err)
    showErr(errEl, _adm('toast.errorWithMsg', {
      msg: err.message ?? _adm('courseModal.errRetryGeneric'),
    }))
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = courseId ? _adm('btn.save') : _adm('btn.saveCourse')
    }
  }
}

function _mcCustomerSearchText(u) {
  return _normalizeSearch(`${u.name ?? ''} ${u.email ?? ''}`)
}

window._mcToggleRestricted = () => {
  const on = document.getElementById('mc-restricted')?.checked
  const wrap = document.getElementById('mc-allowed-users-wrap')
  if (wrap) wrap.style.display = on ? 'block' : 'none'
}

window._mcFilterAllowedUsers = (value) => {
  _mcAllowedUsersQuery = String(value ?? '')
  _mcRenderAllowedUsersList()
}

window._mcToggleAllowedUser = (userId, checked) => {
  if (checked) _mcAllowedUserIds.add(userId)
  else _mcAllowedUserIds.delete(userId)
}

function _mcRenderAllowedUsersList() {
  const listEl = document.getElementById('mc-allowed-users-list')
  if (!listEl) return
  const q = _normalizeSearch(_mcAllowedUsersQuery)
  const filtered = !_mcInviteCandidates.length
    ? []
    : _mcInviteCandidates.filter(u => !q || u.searchText.includes(q))
  if (!filtered.length) {
    listEl.innerHTML = `<div style="font-size:12px;color:#9b9b9b;padding:8px 0;">${esc(_adm('courseModal.allowedUsersEmpty'))}</div>`
    return
  }
  listEl.innerHTML = filtered.map(u => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--btn-radius);
      border:1px solid var(--border);margin-bottom:6px;cursor:pointer;user-select:none;">
      <input type="checkbox" value="${esc(u.id)}" ${_mcAllowedUserIds.has(u.id) ? 'checked' : ''}
        onchange="window._mcToggleAllowedUser?.('${esc(u.id)}', this.checked)"
        style="width:16px;height:16px;accent-color:var(--primary);flex-shrink:0;" />
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(u.name || u.email)}</div>
        <div style="font-size:11px;color:#6b6b6b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(u.email ?? '')}</div>
      </div>
    </label>`).join('')
}

async function _loadMcInviteCandidates() {
  const { data, error } = await sb.from('users')
    .select('id, name, email')
    .eq('role', 'uzivatel')
    .not('email', 'like', 'deleted_%@%')
    .order('name')
  if (error) throw error
  _mcInviteCandidates = (data ?? []).map(u => ({
    ...u,
    searchText: _mcCustomerSearchText(u),
  }))
}

async function _syncCourseAllowedUsers(courseId, selectedUserIds) {
  const { data: existing, error } = await sb.from('course_allowed_users')
    .select('user_id')
    .eq('course_id', courseId)
  if (error) throw error
  const current = new Set((existing ?? []).map(r => r.user_id))
  const next = new Set(selectedUserIds)
  const toRemove = [...current].filter(id => !next.has(id))
  const toAdd = [...next].filter(id => !current.has(id))
  if (toRemove.length) {
    const { error: delErr } = await sb.from('course_allowed_users')
      .delete()
      .eq('course_id', courseId)
      .in('user_id', toRemove)
    if (delErr) throw delErr
  }
  if (toAdd.length) {
    const rows = toAdd.map(user_id => ({
      course_id: courseId,
      user_id,
      granted_by: currentUser?.id ?? null,
    }))
    const { error: insErr } = await sb.from('course_allowed_users').insert(rows)
    if (insErr) throw insErr
  }
}

// Přidá / odebere courseId z allowed_course_ids na permanentkách
async function _syncPassAssociations(courseId, selectedPassIds) {
  // Lektor vidí jen své vlastní permanentky — i RLS by mu update cizí tiše zablokovala.
  const { data: allPasses } = await _scopeOwnerQuery(
    sb.from('passes').select('id, allowed_course_ids')
  )
  for (const pass of (allPasses ?? [])) {
    const current = pass.allowed_course_ids ?? []
    const shouldHave = selectedPassIds.includes(pass.id)
    const hasNow     = current.includes(courseId)
    if (shouldHave === hasNow) continue
    const updated = shouldHave ? [...current, courseId] : current.filter(id => id !== courseId)
    await sb.from('passes').update({ allowed_course_ids: updated }).eq('id', pass.id)
  }
}

async function _syncFutureCourseLessons(courseId, days, timeFrom, timeTo, capacity, price) {
  const nowIso = new Date().toISOString()
  const { data: futureLessons, error: futureErr } = await sb.from('lessons')
    .select('id, start_time, end_time')
    .eq('course_id', courseId)
    .gt('start_time', nowIso)
    .eq('status', 'active')
    .order('start_time')

  if (futureErr) throw futureErr

  const rows = futureLessons ?? []
  const lessonIds = rows.map(l => l.id)
  let bookedCountByLessonId = {}
  if (lessonIds.length) {
    const { data: bookings, error: bookingErr } = await sb.from('bookings')
      .select('lesson_id')
      .in('lesson_id', lessonIds)
      .in('status', BLOCKING_PARTICIPATION_STATUSES)
    if (bookingErr) throw bookingErr
    for (const b of (bookings ?? [])) {
      bookedCountByLessonId[b.lesson_id] = (bookedCountByLessonId[b.lesson_id] ?? 0) + 1
    }
  }

  const bookedLessons = rows.filter(l => (bookedCountByLessonId[l.id] ?? 0) > 0)
  const freeLessons = rows.filter(l => (bookedCountByLessonId[l.id] ?? 0) === 0)

  let desiredLessons = _generateLessons(courseId, days, timeFrom, timeTo, capacity, price, 4, true)
  if (desiredLessons.length < bookedLessons.length) {
    desiredLessons = _generateLessonsUntilCount(courseId, days, timeFrom, timeTo, capacity, price, bookedLessons.length, true)
  }

  const assignedUpdates = []
  let slotIdx = 0

  for (const lesson of bookedLessons) {
    const target = desiredLessons[slotIdx++]
    if (!target) throw new Error(_adm('courseModal.errPreserveBusySlots'))
    assignedUpdates.push({
      id: lesson.id,
      start_time: target.start_time,
      end_time: target.end_time,
      capacity,
      price_single: price,
    })
  }

  const remainingSlots = desiredLessons.slice(slotIdx)
  const reusableFree = freeLessons.slice(0, remainingSlots.length)
  const extraFree = freeLessons.slice(remainingSlots.length)

  reusableFree.forEach((lesson, idx) => {
    const target = remainingSlots[idx]
    assignedUpdates.push({
      id: lesson.id,
      start_time: target.start_time,
      end_time: target.end_time,
      capacity,
      price_single: price,
    })
  })

  for (const upd of assignedUpdates) {
    const { error } = await sb.from('lessons').update({
      start_time: upd.start_time,
      end_time: upd.end_time,
      capacity: upd.capacity,
      price_single: upd.price_single,
    }).eq('id', upd.id)
    if (error) throw error
  }

  if (extraFree.length) {
    const { error } = await sb.from('lessons').update({ status: 'cancelled' })
      .in('id', extraFree.map(l => l.id))
    if (error) throw error
  }

  const createdSlots = remainingSlots.slice(reusableFree.length)
  if (createdSlots.length) {
    const { error } = await sb.from('lessons').insert(createdSlots)
    if (error) throw error
  }
}

// Vygeneruje lekce na příštích `numWeeks` týdnů pro zvolené dny + čas
function _generateLessons(courseId, days, timeFrom, timeTo, capacity, price, numWeeks = 4, includeTodayIfFuture = false) {
  const now = new Date()
  const today = new Date(); today.setHours(0,0,0,0)
  const [fH, fM] = timeFrom.split(':').map(Number)
  const [tH, tM] = timeTo.split(':').map(Number)
  const lessons = []

  for (const dayIdx of days) {           // 0 = pondělí … 6 = neděle
    const todayDow = (today.getDay()+6) % 7  // JS: 0=Sun → Mon=0
    let daysUntil  = (dayIdx - todayDow + 7) % 7
    if (daysUntil === 0) {
      const todayStart = new Date(today)
      todayStart.setHours(fH, fM, 0, 0)
      if (!includeTodayIfFuture || todayStart <= now) daysUntil = 7
    }

    for (let w = 0; w < numWeeks; w++) {
      const start = new Date(today)
      start.setDate(today.getDate() + daysUntil + w * 7)
      start.setHours(fH, fM, 0, 0)

      const end = new Date(start)
      end.setHours(tH, tM, 0, 0)

      lessons.push({ course_id: courseId, start_time: start.toISOString(),
        end_time: end.toISOString(), capacity, price_single: price, status: 'active' })
    }
  }
  return lessons.sort((a,b) => a.start_time.localeCompare(b.start_time))
}

function _generateLessonsUntilCount(courseId, days, timeFrom, timeTo, capacity, price, minCount, includeTodayIfFuture = false) {
  const perWeek = Math.max(1, days.length)
  const weeks = Math.max(4, Math.ceil(minCount / perWeek) + 1)
  return _generateLessons(courseId, days, timeFrom, timeTo, capacity, price, weeks, includeTodayIfFuture).slice(0, minCount)
}

function _generateLessonsAfterDate(courseId, days, timeFrom, timeTo, capacity, price, afterDate, numWeeks = 4) {
  const after = afterDate ? new Date(afterDate) : new Date()
  const base = Number.isFinite(after.getTime()) ? after : new Date()
  const [fH, fM] = timeFrom.split(':').map(Number)
  const [tH, tM] = timeTo.split(':').map(Number)
  const lessons = []
  const uniqueDays = [...new Set((days ?? []).map(Number))]
    .filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b)

  for (const dayIdx of uniqueDays) {
    const baseDay = new Date(base)
    baseDay.setHours(0, 0, 0, 0)
    const baseDow = (baseDay.getDay() + 6) % 7
    let daysUntil = (dayIdx - baseDow + 7) % 7
    const firstStart = new Date(baseDay)
    firstStart.setDate(baseDay.getDate() + daysUntil)
    firstStart.setHours(fH, fM, 0, 0)
    if (firstStart <= base) {
      daysUntil += 7
    }

    for (let w = 0; w < numWeeks; w++) {
      const start = new Date(baseDay)
      start.setDate(baseDay.getDate() + daysUntil + w * 7)
      start.setHours(fH, fM, 0, 0)

      const end = new Date(start)
      end.setHours(tH, tM, 0, 0)

      lessons.push({
        course_id: courseId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        capacity,
        price_single: price,
        status: 'active',
      })
    }
  }
  return lessons.sort((a, b) => a.start_time.localeCompare(b.start_time))
}

// ── Modal: účastníci lekce (admin) ───────────────────────────
function buildLessonAttendeesModal() {
  if (document.getElementById('modal-lesson-attendees')) return
  document.body.insertAdjacentHTML('beforeend', `
    <div id="modal-lesson-attendees" data-lesson-id="" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.38);
      z-index:300;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;"
      onclick="if(event.target===this)window.closeLessonAttendeesModal?.()">
      <div style="background:#fff;border-radius:18px;border:1px solid var(--border);box-shadow:var(--shadow);
        width:100%;max-width:520px;overflow:hidden;margin:auto;" onclick="event.stopPropagation()">
        <div style="padding:18px 18px 4px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div id="mla-title" style="font-size:18px;font-weight:700;">${esc(_adm('lessonDetail.title'))}</div>
          <button type="button" onclick="window.closeLessonAttendeesModal?.()"
            style="border:none;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:#6b6b6b;padding:0 4px;">×</button>
        </div>
        <div id="mla-list" style="padding:14px 18px 18px;max-height:65vh;overflow:auto;"></div>
      </div>
    </div>`)
  const root = document.getElementById('modal-lesson-attendees')
  if (root && !root.dataset.mlaDelegation) {
    root.dataset.mlaDelegation = '1'
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-admin-cancel-booking]')
      if (!btn || !root.contains(btn)) return
      e.preventDefault()
      const bookingId = btn.getAttribute('data-admin-cancel-booking')
      const lessonId = root.dataset.lessonId || ''
      const paymentType = btn.getAttribute('data-payment-type') || ''
      const userPassId = btn.getAttribute('data-user-pass-id') || ''
      void window.adminCancelCustomerBooking?.(bookingId, lessonId, paymentType, userPassId || null)
    })
  }
}

window.closeLessonAttendeesModal = () => {
  const m = document.getElementById('modal-lesson-attendees')
  if (m) m.style.display = 'none'
}

window.adminToggleLessonParticipantMessage = () => {
  const panel = document.getElementById('mla-message-panel')
  if (!panel) return
  const willOpen = panel.hidden
  panel.hidden = !willOpen
  panel.style.display = willOpen ? 'grid' : 'none'
  if (willOpen) {
    setTimeout(() => document.getElementById('mla-message-subject')?.focus(), 0)
  }
}

function _adminLessonMessageErrorLabel(code) {
  const map = {
    not_authenticated: _adm('lessonDetail.messageNotAuthenticated'),
    missing_lesson: _adm('lessonActions.errLessonNotFound'),
    invalid_time_range: _adm('workshop.errTimeRange'),
    invalid_subject: _adm('lessonDetail.messageMissingSubject'),
    invalid_body: _adm('lessonDetail.messageMissingBody'),
    lesson_not_found: _adm('lessonActions.errLessonNotFound'),
    forbidden: _adm('lessonDetail.messageForbidden'),
  }
  return map[code] || code || _adm('lessonDetail.errOperationFailed')
}

async function _adminTryProcessEmailQueue() {
  try {
    const { error: invokeErr } = await sb.functions.invoke('process-email-queue')
    if (invokeErr) console.warn('[Admin] process-email-queue invoke failed:', invokeErr)
  } catch (invokeErr) {
    console.warn('[Admin] process-email-queue invoke failed:', invokeErr)
  }
}

window.adminSendLessonParticipantMessage = async (lessonId) => {
  if (!lessonId) return
  const subjectEl = document.getElementById('mla-message-subject')
  const bodyEl = document.getElementById('mla-message-body')
  const sendBtn = document.getElementById('mla-message-send')
  const subject = String(subjectEl?.value || '').trim()
  const body = String(bodyEl?.value || '').trim()

  if (!subject) {
    window.showToast?.(_adm('lessonDetail.messageMissingSubject'), 'error')
    subjectEl?.focus()
    return
  }
  if (!body) {
    window.showToast?.(_adm('lessonDetail.messageMissingBody'), 'error')
    bodyEl?.focus()
    return
  }
  if (!confirm(_adm('lessonDetail.messageConfirm'))) return

  if (sendBtn) sendBtn.disabled = true
  try {
    const { data, error } = await sb.rpc('enqueue_lesson_participant_message', {
      p_lesson_id: lessonId,
      p_subject: subject,
      p_body_plain: body,
    })
    if (error) throw error
    if (data && data.ok === false) {
      throw new Error(_adminLessonMessageErrorLabel(data.error))
    }

    const queued = Number(data?.queued ?? data?.recipients ?? 0)
    if (queued > 0) {
      window.showToast?.(_adm('lessonDetail.messageQueued', { n: queued }), 'ok')
      subjectEl.value = ''
      bodyEl.value = ''
      const panel = document.getElementById('mla-message-panel')
      if (panel) {
        panel.hidden = true
        panel.style.display = 'none'
      }
      await _adminTryProcessEmailQueue()
    } else {
      window.showToast?.(_adm('lessonDetail.messageQueuedNone'), 'info')
    }
  } catch (err) {
    console.error('[Admin] adminSendLessonParticipantMessage:', err)
    window.showToast?.(_adm('lessonDetail.messageQueueFail', { msg: err.message ?? err }), 'error')
  } finally {
    if (sendBtn) sendBtn.disabled = false
  }
}

async function _adminCancelCustomerBookingFallback(bookingId, paymentType, userPassId, refundPass) {
  const { error: bookingErr } = await sb.from('bookings').update({
    status: PARTICIPATION_STATUS.CANCELLED,
    cancelled_at: new Date().toISOString(),
  }).eq('id', bookingId).in('status', BLOCKING_PARTICIPATION_STATUSES)
  if (bookingErr) throw bookingErr

  if (paymentType === 'pass' && userPassId && refundPass === false) {
    const { data: passRow, error: passLoadErr } = await sb.from('user_passes')
      .select('id, entries_remaining, expires_at')
      .eq('id', userPassId)
      .maybeSingle()
    if (passLoadErr) throw passLoadErr
    if (passRow) {
      const nextRemaining = Math.max(0, Number(passRow.entries_remaining || 0) - 1)
      const nextStatus = passRow.expires_at && new Date(passRow.expires_at).getTime() < Date.now()
        ? 'expired'
        : (nextRemaining <= 0 ? 'depleted' : 'active')
      const { error: passUpdateErr } = await sb.from('user_passes').update({
        entries_remaining: nextRemaining,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      }).eq('id', userPassId)
      if (passUpdateErr) throw passUpdateErr
    }
  }
}

window.adminCancelCustomerBooking = async (bookingId, lessonId, paymentType, userPassId) => {
  if (!bookingId) return
  if (!confirm(_adm('lessonDetail.confirmCancelBooking'))) return
  let refundPass = true
  if (paymentType === 'pass' && userPassId) {
    refundPass = confirm(_adm('lessonDetail.confirmRefundPassBlocks'))
  }
  try {
    const { data, error } = await sb.rpc('admin_cancel_customer_booking', {
      p_booking_id: bookingId,
      p_refund_pass: refundPass,
    })
    if (error) {
      try {
        await _adminCancelCustomerBookingFallback(bookingId, paymentType, userPassId, refundPass)
        window.showToast?.(
          _adm('lessonDetail.toastCancelledFallback'),
          'ok',
        )
        if (lessonId) await window.adminOpenLessonDetail?.(lessonId)
        _refreshStaffViewAfterCancel()
        return
      } catch (fallbackErr) {
        console.error('[Admin] adminCancelCustomerBooking fallback failed:', fallbackErr)
        const rpcMsg = error?.message || error
        const fbMsg = fallbackErr?.message || fallbackErr
        throw new Error(`RPC: ${rpcMsg} | fallback: ${fbMsg}`)
      }
    }
    if (data && data.ok === false) {
      throw new Error(data.error || _adm('lessonDetail.errOperationFailed'))
    }
    window.showToast?.(_adm('lessonDetail.toastCancelledQueue'), 'ok')
    if (lessonId) await window.adminOpenLessonDetail?.(lessonId)
    _refreshStaffViewAfterCancel()
  } catch (err) {
    console.error('[Admin] adminCancelCustomerBooking:', err)
    window.showToast?.(_adm('toast.bookingCancelFail', { msg: err.message ?? err }), 'error')
  }
}

window.adminOpenLessonDetail = async (lessonId) => {
  if (!lessonId) return
  if (_isStaffLektor()) {
    try {
      const { data: lesson, error: lessonErr } = await sb.from('lessons')
        .select('id, course:courses(owner_id)')
        .eq('id', lessonId)
        .maybeSingle()
      if (lessonErr) throw lessonErr
      if (!lesson) throw new Error(_adm('lessonActions.errLessonNotFound'))
      const course = Array.isArray(lesson.course) ? lesson.course[0] : lesson.course
      if (String(course?.owner_id ?? '') !== String(currentUser?.id ?? '')) {
        window.showToast?.(_adm('lessonActions.errNotOwnAttendees'), 'error')
        return
      }
    } catch (err) {
      console.error('[Admin] adminOpenLessonDetail ownership:', err)
      window.showToast?.(err.message ?? _adm('lessonActions.errNotOwnAttendees'), 'error')
      return
    }
  }
  buildLessonAttendeesModal()
  const modal = document.getElementById('modal-lesson-attendees')
  const listEl = document.getElementById('mla-list')
  const titleEl = document.getElementById('mla-title')
  if (!modal || !listEl) return
  modal.dataset.lessonId = String(lessonId)
  listEl.innerHTML = `<div style="font-size:12px;color:#9b9b9b;padding:12px 0;">${esc(_adm('loading.attendees'))}</div>`
  if (titleEl) titleEl.textContent = _adm('lessonDetail.title')
  modal.style.display = 'flex'
  try {
    await adminRace((async () => {
    const { data: bookings, error: bookingErr } = await sb
      .from('bookings')
      .select('id, payment_type, user_id, created_at, user_pass_id, status')
      .eq('lesson_id', lessonId)
      .in('status', BLOCKING_PARTICIPATION_STATUSES)
      .order('created_at', { ascending: true })

    if (bookingErr) throw bookingErr

    const { data: lessonRow } = await sb
      .from('lessons')
      .select('start_time, course:courses(title)')
      .eq('id', lessonId)
      .maybeSingle()

    const ctitle = lessonRow?.course?.title ? loc(lessonRow.course.title) : _adm('misc.lessonFallback')
    const when = lessonRow?.start_time ? fmtDateTime(lessonRow.start_time) : ''
    if (titleEl) titleEl.textContent = when
      ? _adm('lessonDetail.titleWithWhen', { course: ctitle, when })
      : _adm('lessonDetail.titleAttendeesOnly', { course: ctitle })

    const rows = bookings ?? []
    if (!rows.length) {
      listEl.innerHTML = `<div class="empty" style="padding:24px;">${esc(_adm('lessonDetail.emptyBookings'))}</div>`
      return
    }

    const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))]
    let userMap = {}
    if (userIds.length) {
      const { data: users, error: userErr } = await sb.from('users').select('id, name, email').in('id', userIds)
      if (!userErr && users?.length) userMap = Object.fromEntries(users.map(u => [u.id, u]))
    }

    let passNames = {}
    const passBookingIds = [...new Set(rows.map(r => r.user_pass_id).filter(Boolean))]
    if (passBookingIds.length) {
      const { data: upRows } = await sb
        .from('user_passes')
        .select('id, pass:passes(name)')
        .in('id', passBookingIds)
      if (upRows?.length) passNames = Object.fromEntries(upRows.map(r => [r.id, r.pass?.name]))
    }

    listEl.innerHTML = `
      <div style="border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:14px;background:#faf8f5;">
        <button type="button" class="btn-small" style="width:100%;justify-content:center;"
          onclick="window.adminToggleLessonParticipantMessage?.()">${esc(_adm('lessonDetail.messageToggle'))}</button>
        <div id="mla-message-panel" hidden style="margin-top:12px;display:none;gap:10px;">
          <label style="display:grid;gap:5px;font-size:12px;color:#6b6b6b;font-weight:600;">
            ${esc(_adm('lessonDetail.messageSubjectLabel'))}
            <input id="mla-message-subject" type="text" maxlength="160"
              placeholder="${esc(_adm('lessonDetail.messageSubjectPh'))}"
              style="width:100%;border:1px solid var(--border);border-radius:10px;padding:9px 10px;font:inherit;color:#2f2a24;background:white;">
          </label>
          <label style="display:grid;gap:5px;font-size:12px;color:#6b6b6b;font-weight:600;">
            ${esc(_adm('lessonDetail.messageBodyLabel'))}
            <textarea id="mla-message-body" maxlength="5000" rows="6"
              placeholder="${esc(_adm('lessonDetail.messageBodyPh'))}"
              style="width:100%;border:1px solid var(--border);border-radius:10px;padding:9px 10px;font:inherit;color:#2f2a24;background:white;resize:vertical;"></textarea>
          </label>
          <button id="mla-message-send" type="button" class="btn-small primary" style="justify-content:center;"
            onclick="window.adminSendLessonParticipantMessage?.('${esc(String(lessonId))}')">${esc(_adm('lessonDetail.messageSend'))}</button>
        </div>
      </div>
      <div style="overflow-x:auto;">
      <table style="width:100%;min-width:700px;border-collapse:collapse;font-size:13px;table-layout:fixed;">
        <colgroup>
          <col style="width:18%;">
          <col style="width:26%;">
          <col style="width:36%;">
          <col style="width:20%;">
        </colgroup>
        <thead>
          <tr style="text-align:left;color:#6b6b6b;font-size:11px;">
            <th style="padding:8px 8px 8px 0;">${esc(_adm('lessonDetail.tableName'))}</th>
            <th style="padding:8px 4px;">${esc(_adm('lessonDetail.tableEmail'))}</th>
            <th style="padding:8px 0 8px 8px;">${esc(_adm('lessonDetail.tablePayment'))}</th>
            <th style="padding:8px 0 8px 8px;text-align:right;white-space:nowrap;">${esc(_adm('lessonDetail.tableAction'))}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(b => {
            const u = userMap[b.user_id]
            const pName = b.user_pass_id ? passNames[b.user_pass_id] : null
            const passLabel = pName ? esc(loc(pName)) : ''
            const payCell = b.payment_type === 'pass'
              ? `${esc(_adm('lessonDetail.paymentPassLabel'))}${passLabel ? ': ' + passLabel : ''}`
              : esc(_adm('payType.single'))
            const stColors = _adminLessonHistoryStatusColors(b.status)
            const statusBadge = `<span style="display:inline-block;margin-top:4px;font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:${stColors.bg};color:${stColors.c};">${esc(_adminBookingStatusLabel(b.status))}</span>`
            const passIdAttr = b.user_pass_id ? esc(b.user_pass_id) : ''
            const lessonIdArg = esc(String(lessonId))
            const bookingIdArg = esc(String(b.id))
            const paymentTypeArg = esc(String(b.payment_type))
            return `<tr style="border-top:1px solid var(--border);">
              <td style="padding:10px 8px 10px 0;vertical-align:top;font-weight:500;line-height:1.45;">${esc(u?.name || _adm('misc.dash'))}</td>
              <td style="padding:10px 4px;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;line-height:1.45;">${esc(u?.email || _adm('misc.dash'))}</td>
              <td style="padding:10px 0 10px 8px;vertical-align:top;line-height:1.45;">${payCell}<br>${statusBadge}</td>
              <td style="padding:10px 0 10px 8px;vertical-align:top;text-align:right;">
                <button type="button" class="btn-small danger" style="font-size:11px;padding:6px 10px;"
                  onclick="window.adminCancelCustomerBooking?.('${bookingIdArg}','${lessonIdArg}','${paymentTypeArg}','${passIdAttr}')"
                  data-admin-cancel-booking="${esc(b.id)}"
                  data-payment-type="${esc(b.payment_type)}"
                  data-user-pass-id="${passIdAttr}">${esc(_adm('lessonDetail.cancelBooking'))}</button>
              </td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
      </div>
      <div style="font-size:11px;color:#9b9b9b;margin-top:12px;">${_adm('lessonDetail.footerTotal', { n: rows.length })}</div>`
    })(), 'modal-lesson-attendees')
  } catch (err) {
    console.error('[Admin] adminOpenLessonDetail:', err)
    listEl.innerHTML = `<div class="empty" style="padding:20px;color:#791F1F;">${esc(_adm('lessonDetail.loadListFail'))}</div>`
    window.showToast?.(_adm('err.loadAttendees', { msg: err.message ?? err }), 'error')
  }
}

// ── Admin akce ───────────────────────────────────────────────
async function _refreshAfterLessonChange() {
  if (_isStaffAdmin()) void renderAdminDashboard()
  void window.renderMojeLekce?.()
  void window.refreshPublicData?.()
}

window.adminDeactivateLesson = async (lessonId) => {
  if (!lessonId) return
  try {
    if (_isStaffLektor()) {
      const { data: lesson, error: lessonErr } = await sb.from('lessons')
        .select('id, course:courses(owner_id)')
        .eq('id', lessonId)
        .maybeSingle()
      if (lessonErr) throw lessonErr
      if (!lesson) throw new Error(_adm('lessonActions.errLessonNotFound'))
      const course = Array.isArray(lesson.course) ? lesson.course[0] : lesson.course
      if (String(course?.owner_id ?? '') !== String(currentUser?.id ?? '')) {
        throw new Error(_adm('lessonActions.errNotOwnLesson'))
      }
    }
    if (!confirm(_adm('lessonActions.confirmDeactivate'))) return
    const { data, error: rpcErr } = await sb.rpc('admin_cancel_lesson', { p_lesson_id: lessonId })
    if (rpcErr) {
      const missFn = rpcErr.code === 'PGRST202'
        || rpcErr.message?.includes('Could not find the function')
        || rpcErr.message?.includes('admin_cancel_lesson')
      if (missFn) {
        const [{ error: bErr }, { error: lErr }] = await Promise.all([
          sb.from('bookings').update({ status: PARTICIPATION_STATUS.CANCELLED }).eq('lesson_id', lessonId).in('status', BLOCKING_PARTICIPATION_STATUSES),
          sb.from('lessons').update({ status: 'cancelled' }).eq('id', lessonId),
        ])
        if (lErr) throw lErr
        if (bErr) console.warn('[Admin] deactivateLesson — bookings:', bErr)
        window.showToast?.(_adm('lessonActions.toastDeactivateNoRpc'), 'ok')
        _refreshAfterLessonChange()
        return
      }
      throw rpcErr
    }
    if (data && data.ok === false) {
      throw new Error(_adminLessonMessageErrorLabel(data.error))
    }
    window.showToast?.(_adm('lessonActions.toastDeactivated'), 'ok')
    if (Number(data?.queued ?? data?.recipients ?? 0) > 0) {
      await _adminTryProcessEmailQueue()
    }
    _refreshAfterLessonChange()
  } catch (err) {
    console.error('[Admin] deactivateLesson:', err)
    window.showToast?.(_adm('toast.lessonDeactivateFail', { msg: err.message ?? err }), 'error')
  }
}

window.adminCancelLesson = window.adminDeactivateLesson

window.adminActivateLesson = async (lessonId) => {
  if (!lessonId || !confirm(_adm('lessonActions.confirmActivate'))) return
  try {
    if (_isStaffLektor()) {
      const { data: lesson, error: lessonErr } = await sb.from('lessons')
        .select('id, course:courses(owner_id)')
        .eq('id', lessonId)
        .maybeSingle()
      if (lessonErr) throw lessonErr
      if (!lesson) throw new Error(_adm('lessonActions.errLessonNotFound'))
      const course = Array.isArray(lesson.course) ? lesson.course[0] : lesson.course
      if (String(course?.owner_id ?? '') !== String(currentUser?.id ?? '')) {
        throw new Error(_adm('lessonActions.errNotOwnLesson'))
      }
    }

    const { error: bookingErr } = await sb.from('bookings')
      .update({
        status: PARTICIPATION_STATUS.CANCELLED,
        cancelled_at: new Date().toISOString(),
      })
      .eq('lesson_id', lessonId)
      .in('status', BLOCKING_PARTICIPATION_STATUSES)
    if (bookingErr) throw bookingErr

    const { error: lessonErr } = await sb.from('lessons')
      .update({ status: 'active' })
      .eq('id', lessonId)
    if (lessonErr) throw lessonErr

    window.showToast?.(_adm('lessonActions.toastActivated'), 'ok')
    _refreshAfterLessonChange()
  } catch (err) {
    console.error('[Admin] adminActivateLesson:', err)
    window.showToast?.(_adm('toast.errorWithMsg', { msg: err.message ?? err }), 'error')
  }
}

window.adminDeleteLesson = async (lessonId) => {
  if (!lessonId || !confirm(_adm('lessonActions.confirmDelete'))) return
  try {
    const { data: lesson, error: loadErr } = await sb.from('lessons')
      .select('id, status, start_time')
      .eq('id', lessonId)
      .maybeSingle()
    if (loadErr) throw loadErr
    if (!lesson) throw new Error(_adm('lessonActions.errLessonNotFound'))
    if (lesson.status !== 'cancelled') {
      throw new Error(_adm('lessonActions.errDeleteOnlyDeactivated'))
    }
    if (lesson.start_time && new Date(lesson.start_time).getTime() >= Date.now()) {
      throw new Error(_adm('lessonActions.errDeleteOnlyPast'))
    }
    const { count, error: countErr } = await sb.from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('lesson_id', lessonId)
      .in('status', BLOCKING_PARTICIPATION_STATUSES)
    if (countErr) throw countErr
    if ((count ?? 0) > 0) {
      throw new Error(_adm('lessonActions.errDeleteActiveBookings'))
    }
    const { error } = await sb.from('lessons').delete().eq('id', lessonId)
    if (error) throw error
    window.showToast?.(_adm('lessonActions.toastDeleted'), 'ok')
    _refreshAfterLessonChange()
  } catch (err) {
    console.error('[Admin] adminDeleteLesson:', err)
    window.showToast?.(_adm('toast.lessonDeleteFail', { msg: err.message ?? err }), 'error')
  }
}

window.adminDeleteAllPastDeactivatedLessons = async (scope = 'moje') => {
  if (!confirm(_adm('lessonActions.confirmDeleteAllPastDeactivated'))) return
  try {
    let courseQuery = sb.from('courses').select('id')
    if (_isStaffAdmin() && scope !== 'vsechny' && currentUser?.id) {
      courseQuery = courseQuery.eq('owner_id', currentUser.id)
    }
    const { data: courses, error: courseErr } = await _scopeOwnerQuery(courseQuery)
    if (courseErr) throw courseErr

    const courseIds = (courses ?? []).map(c => c.id).filter(Boolean)
    if (!courseIds.length) {
      window.showToast?.(_adm('lessonActions.toastDeleteAllResult', { deleted: 0, skipped: 0 }), 'ok')
      return
    }

    const { data: lessons, error: lessonErr } = await sb.from('lessons')
      .select('id')
      .in('course_id', courseIds)
      .lt('start_time', new Date().toISOString())
      .eq('status', 'cancelled')
    if (lessonErr) throw lessonErr

    const lessonIds = (lessons ?? []).map(l => l.id).filter(Boolean)
    if (!lessonIds.length) {
      window.showToast?.(_adm('lessonActions.toastDeleteAllResult', { deleted: 0, skipped: 0 }), 'ok')
      return
    }

    const { data: bookings, error: bookingErr } = await sb.from('bookings')
      .select('lesson_id')
      .in('lesson_id', lessonIds)
      .in('status', BLOCKING_PARTICIPATION_STATUSES)
    if (bookingErr) throw bookingErr

    const blockedLessonIds = new Set((bookings ?? []).map(b => b.lesson_id))
    const safeIds = lessonIds.filter(id => !blockedLessonIds.has(id))
    if (safeIds.length) {
      const { error: deleteErr } = await sb.from('lessons')
        .delete()
        .lt('start_time', new Date().toISOString())
        .eq('status', 'cancelled')
        .in('id', safeIds)
      if (deleteErr) throw deleteErr
    }

    window.showToast?.(_adm('lessonActions.toastDeleteAllResult', {
      deleted: safeIds.length,
      skipped: lessonIds.length - safeIds.length,
    }), 'ok')
    _refreshAfterLessonChange()
  } catch (err) {
    console.error('[Admin] adminDeleteAllPastDeactivatedLessons:', err)
    window.showToast?.(_adm('lessonActions.toastDeleteAllFail', { msg: err.message ?? err }), 'error')
  }
}

window.adminToggleCourse = async (courseId, activate) => {
  if (!confirm(activate ? _adm('courseActions.confirmToggleOn') : _adm('courseActions.confirmToggleOff'))) return
  try {
    const { error } = await sb.from('courses').update({ is_active: activate }).eq('id', courseId)
    if (error) throw error
    window.showToast?.(activate ? _adm('courseActions.toastActive') : _adm('courseActions.toastInactive'), 'ok')
    renderAdminKurzy()
  } catch (err) {
    console.error('[Admin] adminToggleCourse:', err)
    window.showToast?.(_adm('toast.errorWithMsg', { msg: err.message ?? err }), 'error')
  }
}

window.adminTopUpCourseLessons = async (courseId) => {
  if (!courseId) return
  if (!confirm(_adm('courseActions.confirmTopUpLessons'))) return

  try {
    const { data: course, error: courseErr } = await _scopeOwnerQuery(
      sb.from('courses')
        .select('id, schedule_days, schedule_time_start, schedule_time_end, capacity_default, price_single')
        .eq('id', courseId)
        .maybeSingle()
    )
    if (courseErr) throw courseErr
    if (!course) throw new Error(_adm('courseActions.errCourseNotFound'))

    const days = Array.isArray(course.schedule_days) ? course.schedule_days : []
    const timeFrom = course.schedule_time_start
    const timeTo = course.schedule_time_end
    if (!days.length || !timeFrom || !timeTo) {
      throw new Error(_adm('courseActions.errTopUpNoSchedule'))
    }

    const { data: lastLessons, error: lessonErr } = await sb.from('lessons')
      .select('start_time')
      .eq('course_id', courseId)
      .eq('status', 'active')
      .order('start_time', { ascending: false })
      .limit(1)
    if (lessonErr) throw lessonErr

    const lastStart = lastLessons?.[0]?.start_time || new Date().toISOString()
    const lessons = _generateLessonsAfterDate(
      courseId,
      days,
      timeFrom,
      timeTo,
      Number(course.capacity_default),
      Number(course.price_single),
      lastStart,
      4,
    )

    if (!lessons.length) throw new Error(_adm('courseActions.errTopUpNoLessons'))

    const { error: insertErr } = await sb.from('lessons').insert(lessons)
    if (insertErr) throw insertErr

    window.showToast?.(_adm('courseActions.toastTopUpLessons', { n: lessons.length }), 'ok')
    renderAdminKurzy()
    await window.refreshPublicData?.()
  } catch (err) {
    console.error('[Admin] adminTopUpCourseLessons:', err)
    window.showToast?.(_adm('courseActions.toastTopUpFail', { msg: err.message ?? err }), 'error')
  }
}

window.adminDeleteAllInactiveCourses = async () => {
  if (!confirm(_adm('courseActions.confirmDeleteAll'))) return
  try {
    let courseQuery = sb.from('courses')
      .select('id')
      .eq('is_active', false)
    if (_isStaffAdmin() && _adminCoursesScope === 'moje' && currentUser?.id) {
      courseQuery = courseQuery.eq('owner_id', currentUser.id)
    }
    const { data: courses, error: courseErr } = await _scopeOwnerQuery(courseQuery)
    if (courseErr) throw courseErr

    const courseIds = (courses ?? []).map(c => c.id).filter(Boolean)
    if (!courseIds.length) {
      window.showToast?.(_adm('courseActions.toastDeleteAllResult', { deleted: 0, skipped: 0 }), 'ok')
      return
    }

    const { data: lessons, error: lessonErr } = await sb.from('lessons')
      .select('id, course_id, start_time')
      .in('course_id', courseIds)
    if (lessonErr) throw lessonErr

    const nowMs = Date.now()
    const lessonToCourse = {}
    const futureCourseIds = new Set()
    for (const lesson of (lessons ?? [])) {
      lessonToCourse[lesson.id] = lesson.course_id
      if (lesson.start_time && new Date(lesson.start_time).getTime() >= nowMs) {
        futureCourseIds.add(lesson.course_id)
      }
    }

    const lessonIds = (lessons ?? []).map(l => l.id).filter(Boolean)
    const blockingCourseIds = new Set()
    if (lessonIds.length) {
      const { data: bookings, error: bookingErr } = await sb.from('bookings')
        .select('lesson_id')
        .in('lesson_id', lessonIds)
        .in('status', BLOCKING_PARTICIPATION_STATUSES)
      if (bookingErr) throw bookingErr
      for (const booking of (bookings ?? [])) {
        const cid = lessonToCourse[booking.lesson_id]
        if (cid) blockingCourseIds.add(cid)
      }
    }

    const safeIds = courseIds.filter(id => !futureCourseIds.has(id) && !blockingCourseIds.has(id))
    if (safeIds.length) {
      let deleteQuery = sb.from('courses')
        .delete()
        .eq('is_active', false)
        .in('id', safeIds)
      deleteQuery = _scopeOwnerQuery(deleteQuery)
      const { error: deleteErr } = await deleteQuery
      if (deleteErr) throw deleteErr
    }

    window.showToast?.(_adm('courseActions.toastDeleteAllResult', {
      deleted: safeIds.length,
      skipped: courseIds.length - safeIds.length,
    }), 'ok')
    renderAdminKurzy()
    void window.refreshPublicData?.()
  } catch (err) {
    console.error('[Admin] adminDeleteAllInactiveCourses:', err)
    window.showToast?.(_adm('courseActions.toastDeleteAllFail', { msg: err.message ?? err }), 'error')
  }
}

window.adminDeleteCourse = async (courseId) => {
  if (!courseId || !confirm(_adm('courseActions.confirmDelete'))) return
  try {
    const { data: course, error: loadErr } = await sb.from('courses')
      .select('id, is_active')
      .eq('id', courseId)
      .maybeSingle()
    if (loadErr) throw loadErr
    if (!course) throw new Error(_adm('courseActions.errCourseNotFound'))
    if (course.is_active) {
      throw new Error(_adm('courseActions.errDeleteOnlyDeactivated'))
    }
    const { data: lessonRows, error: lesErr } = await sb.from('lessons').select('id').eq('course_id', courseId)
    if (lesErr) throw lesErr
    const lessonIds = (lessonRows ?? []).map(l => l.id)
    if (lessonIds.length) {
      const { count, error: bookErr } = await sb.from('bookings')
        .select('*', { count: 'exact', head: true })
        .in('status', BLOCKING_PARTICIPATION_STATUSES)
        .in('lesson_id', lessonIds)
      if (bookErr) throw bookErr
      if ((count ?? 0) > 0) {
        throw new Error(_adm('courseActions.errDeleteHasBookings'))
      }
    }
    const { error } = await sb.from('courses').delete().eq('id', courseId)
    if (error) throw error
    window.showToast?.(_adm('courseActions.toastDeleted'), 'ok')
    renderAdminKurzy()
    void window.refreshPublicData?.()
  } catch (err) {
    console.error('[Admin] adminDeleteCourse:', err)
    window.showToast?.(_adm('toast.courseDeleteFail', { msg: err.message ?? err }), 'error')
  }
}

// ── Navigace podle hooků z index.html (`nav()` → __appNavHooks) ───────────────────
window.__refreshAdminScreen = async (route) => {
  if (!route) return
  console.log('[Debug] __refreshAdminScreen:', route, '(bez init, jen překreslit sekci)')
  if (route === 'nastenka' && _isStaffLektor()) await renderLektorDashboard()
  if (route === 'admin-dashboard' || route === 'sprava')   await renderAdminDashboard()
  if (route === 'admin-kurzy')       await renderAdminKurzy()
  if (route === 'admin-zakaznici')   await renderAdminZakaznici()
  if (route === 'admin-platby')      await renderAdminPlatby()
  if (route === 'lektor-historie')   await renderLektorHistorie()
  if (route === 'admin-permanentky') await renderAdminPermanentky()
}

;(window.__appNavHooks ??= []).push((id) => {
  void window.__refreshAdminScreen?.(id)
})
