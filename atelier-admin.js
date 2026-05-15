// ============================================================
// atelier-admin.js — Admin sekce: Dashboard, Kurzy, Zákazníci, Platby, Permanentky
// ============================================================

import { sb } from './atelier-supabase.js'
import { currentUser } from './atelier_auth.js'
import { sanitizeCourseRichText } from './atelier-sanitize.js'

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
    void window.renderMojeLekce?.()
  }
}

// ── Konstanty ─────────────────────────────────────────────────
const PRESET_COLORS = [
  '#2854B9', '#E05C5C', '#4CAF50', '#FF9800', '#9C27B0',
  '#00BCD4', '#795548', '#607D8B', '#E91E63', '#FF5722',
]
/** Paleta jen pro permanentky — odlišná od kurzů/workshopů */
const PASS_PALETTE = [
  '#0D9488', '#4338CA', '#A21CAF', '#B45309', '#047857',
  '#7E22CE', '#BE185D', '#0369A1', '#15803D', '#A16207',
]
const DAYS_CS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']

// ── Stav modálů ──────────────────────────────────────────────
let _ncSelectedDays  = new Set()
let _ncSelectedColor = PRESET_COLORS[0]
let _wsSelectedColor = PRESET_COLORS[0]
let _mpSelectedColor = PASS_PALETTE[0]
let _ncExistingImages = []
let _ncNewFiles       = []
let _mwExistingImages = []
let _mwNewFiles       = []

function _passHexOrDefault(hex) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(hex || '').trim()) ? String(hex).trim() : PASS_PALETTE[0]
}

function _passCardSurfaceStyle(hex) {
  const h = _passHexOrDefault(hex)
  return `background:linear-gradient(168deg, ${h}24 0%, #ffffff 93%);border:1px solid ${h}44;`
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
    placeholder: 'Podrobný popis pro stránku detailu kurzu…',
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
    placeholder: 'Podrobný popis programu workshopu…',
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
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency', currency: 'CZK', maximumFractionDigits: 0,
  }).format(Number(n) || 0)
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' })
    + ' ' + d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
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
  return new Date(iso).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
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
    return Object.fromEntries(cached.map(c => [c.id, c]))
  }
  try {
    const { data } = await adminRace(
      sb.from('courses').select('id, title, color_code'),
      'fetchCoursesMap',
    )
    return Object.fromEntries((data ?? []).map(c => [c.id, c]))
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
  const map = {
    booked: 'Aktivní',
    attended: 'Absolvováno',
    cancelled: 'Stornováno',
    missed: 'Nedorazil/a',
  }
  return map[status] ?? (status || '—')
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
    ? `${filtered.length} z ${_adminCustomersData.length} zákazníků`
    : `${_adminCustomersData.length} zákazníků`

  listEl.innerHTML = filtered.length
    ? `<div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;">${filtered.map(_zakaznikRow).join('')}</div>`
    : `<div class="empty">${q ? 'Žádný zákazník neodpovídá hledání.' : 'Žádní zákazníci.'}</div>`
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
          <div style="font-size:18px;font-weight:700;" id="mch-title">Historie lekcí</div>
        </div>
        <div id="mch-body" style="padding:14px 18px;overflow-y:auto;max-height:calc(100vh - 160px);"></div>
        <div style="display:flex;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--border);">
          <button type="button" class="btn-wide" onclick="window.closeAdminCustomerHistoryModal?.()">Zavřít</button>
        </div>
      </div>
    </div>`)
}

function _adminCustomerHistoryHtml(user) {
  const rows = user?.bookingHistory ?? []
  if (!rows.length) {
    return '<div class="empty" style="padding:12px 0;">Tento zákazník zatím nemá žádnou historii lekcí.</div>'
  }
  return `
    <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;">
      ${rows.map(b => {
        const title = loc(b.lesson?.course?.title) || 'Lekce'
        const when = b.lesson?.start_time ? fmtDateTime(b.lesson.start_time) : '—'
        const pay = b.payment_type === 'pass' ? 'Permanentka' : 'Jednorázově'
        const status = _adminBookingStatusLabel(b.status)
        const statusMap = {
          'Aktivní': { bg: '#E1F5EE', c: '#085041' },
          'Absolvováno': { bg: '#E1F5EE', c: '#085041' },
          'Stornováno': { bg: '#FCEBEB', c: '#791F1F' },
          'Nedorazil/a': { bg: '#FFF4E0', c: '#8B5C00' },
        }
        const st = statusMap[status] ?? { bg: '#F3F4F6', c: '#6b6b6b' }
        return `
          <div style="display:flex;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);align-items:flex-start;">
            <div style="min-width:0;flex:1;">
              <div style="font-size:13px;font-weight:600;margin-bottom:4px;">${esc(title)}</div>
              <div style="font-size:11px;color:#6b6b6b;line-height:1.5;">${esc(when)} · ${esc(pay)}</div>
              <div style="font-size:10px;color:#9b9b9b;margin-top:4px;">Rezervováno ${b.created_at ? fmtDate(b.created_at) : '—'}</div>
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
  _adminCustomerHistoryDisplayName = displayName || user?.name || user?.email || 'Zákazník'
  const titleEl = document.getElementById('mch-title')
  const bodyEl = document.getElementById('mch-body')
  const modal = document.getElementById('modal-admin-customer-history')
  if (!bodyEl || !modal) return
  if (titleEl) titleEl.textContent = `Historie lekcí — ${_adminCustomerHistoryDisplayName}`
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
  const stable = _adminHadStableContent(prevHtml, 'Načítám přehled')
  if (stable) {
    console.log('[Debug] Admin dashboard: obnovuji data na pozadí (ponechávám předchozí obsah až 3 s)')
  } else {
    el.innerHTML = `<div class="empty" style="padding:40px;">Načítám přehled…</div>`
  }

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const weekEnd  = new Date(today); weekEnd.setDate(today.getDate() + 7)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

  try {
    await adminRace((async () => {
    const [
      { data: todayAvail },
      { data: weekAvail },
      monthPassesRes,
      { count: activePasses },
      monthBookingsRes,
    ] = await Promise.all([
      sb.from('lesson_availability')
        .select('lesson_id, course_id, start_time, end_time, capacity, booked_count, available_spots')
        .gte('start_time', today.toISOString()).lt('start_time', tomorrow.toISOString())
        .eq('status', 'active').order('start_time'),
      sb.from('lesson_availability')
        .select('lesson_id, course_id, start_time, end_time, capacity, booked_count, available_spots')
        .gte('start_time', tomorrow.toISOString()).lt('start_time', weekEnd.toISOString())
        .eq('status', 'active').order('start_time'),
      sb.from('user_passes').select('price_paid, refund_status, refund_amount')
        .gte('created_at', monthStart.toISOString()),
      sb.from('user_passes').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      sb.from('bookings').select('price_paid, status, payment_type, refund_status, refund_amount')
        .eq('payment_type', 'single')
        .gte('created_at', monthStart.toISOString()),
    ])

    let monthPasses = monthPassesRes.data ?? []
    if (monthPassesRes.error) {
      if (!_looksLikeMissingRefundColumns(monthPassesRes.error)) throw monthPassesRes.error
      const fallbackPassesRes = await sb.from('user_passes')
        .select('price_paid')
        .gte('created_at', monthStart.toISOString())
      if (fallbackPassesRes.error) throw fallbackPassesRes.error
      monthPasses = (fallbackPassesRes.data ?? []).map(row => ({
        ...row,
        type: 'pass',
        refund_status: 'not_required',
        refund_amount: null,
      }))
    } else {
      monthPasses = monthPasses.map(row => ({ ...row, type: 'pass' }))
    }

    let monthBookings = monthBookingsRes.data ?? []
    if (monthBookingsRes.error) {
      if (!_looksLikeMissingRefundColumns(monthBookingsRes.error)) throw monthBookingsRes.error
      const fallbackBookingsRes = await sb.from('bookings')
        .select('price_paid, status, payment_type')
        .eq('payment_type', 'single')
        .gte('created_at', monthStart.toISOString())
      if (fallbackBookingsRes.error) throw fallbackBookingsRes.error
      monthBookings = (fallbackBookingsRes.data ?? []).map(row => ({
        ...row,
        type: 'single',
        refund_status: null,
        refund_amount: null,
      }))
    } else {
      monthBookings = monthBookings.map(row => ({ ...row, type: 'single' }))
    }

    const courseMap = await fetchCoursesMap()
    const enrich = rows => (rows ?? []).map(l => ({ ...l, course: courseMap[l.course_id] }))
    const todayLessons = enrich(todayAvail)
    const weekLessons  = enrich(weekAvail)

    const totalCap    = todayLessons.reduce((s, l) => s + (l.capacity ?? 0), 0)
    const totalBooked = todayLessons.reduce((s, l) => s + (Number(l.booked_count) || 0), 0)
    const occupancy   = totalCap > 0 ? Math.round((totalBooked / totalCap) * 100) : 0
    const monthGrossRev = _sumGrossRevenue([...monthPasses, ...monthBookings])
    const monthRefunds = _sumCompletedRefunds([...monthPasses, ...monthBookings])
    const monthNetRev = monthGrossRev - monthRefunds

    const { buildStaffLessonsSectionHtml } = await import('./atelier-data.js')
    const adminMyLessonsHtml = await buildStaffLessonsSectionHtml({
      sectionTitle: 'Moje lekce',
      sectionClass: 'admin-section-title',
      sectionStyle: '',
      includeDeactivated: false,
      maxActive: 20,
    })

    el.innerHTML = `
      <div class="page-title">Přehled</div>
      <div class="admin-stat-grid">
        <div class="admin-stat-card">
          <div class="admin-stat-value">${todayLessons.length}</div>
          <div class="admin-stat-label">Dnešní lekce</div>
        </div>
        <div class="admin-stat-card">
          <div class="admin-stat-value">${occupancy}&thinsp;%</div>
          <div class="admin-stat-label">Obsazenost dnes</div>
        </div>
        <div class="admin-stat-card">
          <div class="admin-stat-value" style="font-size:18px;">${fmtPrice(monthGrossRev)}</div>
          <div class="admin-stat-label">Hrubý příjem</div>
        </div>
        <div class="admin-stat-card">
          <div class="admin-stat-value" style="font-size:18px;">${fmtPrice(monthRefunds)}</div>
          <div class="admin-stat-label">Refundace</div>
        </div>
        <div class="admin-stat-card">
          <div class="admin-stat-value" style="font-size:18px;">${fmtPrice(monthNetRev)}</div>
          <div class="admin-stat-label">Čistý příjem</div>
        </div>
        <div class="admin-stat-card">
          <div class="admin-stat-value">${activePasses ?? 0}</div>
          <div class="admin-stat-label">Aktivní permanentky</div>
        </div>
      </div>
      <div class="admin-section-title">Dnešní lekce</div>
      ${todayLessons.length ? todayLessons.map(l => _lessonRow(l)).join('') : `<div class="empty">Dnes nejsou žádné lekce.</div>`}
      <div class="admin-section-title">Nadcházející tento týden</div>
      ${weekLessons.length ? weekLessons.map(l => _lessonRow(l, true)).join('') : `<div class="empty">Tento týden nejsou další lekce.</div>`}
      ${adminMyLessonsHtml}
    `
    })(), 'admin-dashboard')
  } catch (err) {
    if (err?.code === 'TIMEOUT' && stable) {
      console.warn('[Debug] Admin dashboard: timeout 3 s — obnovuji předchozí obsah (žádný visící spinner)')
      el.innerHTML = prevHtml
      return
    }
    console.error('[Admin] renderAdminDashboard:', err)
    el.innerHTML = `<div class="empty">Chyba při načítání dat.</div>`
  }
}


function _lessonAdminDashButtons(lessonId, status = 'active') {
  const lid = esc(String(lessonId))
  if (status === 'cancelled') {
    return `<button type="button" class="btn-small danger admin-dash-act" style="font-size:11px;padding:6px 10px;"
      data-admin-lesson-act="delete" data-lesson-id="${lid}">Smazat</button>`
  }
  return `
        <button type="button" class="btn-small admin-dash-act" style="font-size:11px;padding:6px 10px;"
          data-admin-lesson-act="attendees" data-lesson-id="${lid}">Účastníci</button>
        <button type="button" class="btn-small danger admin-dash-act" style="font-size:11px;padding:6px 10px;"
          data-admin-lesson-act="deactivate" data-lesson-id="${lid}">Deaktivovat</button>`
}

window.adminLessonActionButtons = (lessonId, status = 'active') => {
  const lid = String(lessonId ?? '').replace(/'/g, "\'")
  if (status === 'cancelled') {
    return `<button type="button" class="btn-small danger" style="font-size:11px;padding:6px 10px;"
      onclick="event.stopPropagation();window.adminDeleteLesson?.('${lid}')">Smazat</button>`
  }
  return `<button type="button" class="btn-small" style="font-size:11px;padding:6px 10px;"
      onclick="event.stopPropagation();window.adminOpenLessonDetail?.('${lid}')">Účastníci</button>
    <button type="button" class="btn-small danger" style="font-size:11px;padding:6px 10px;"
      onclick="event.stopPropagation();window.adminDeactivateLesson?.('${lid}')">Deaktivovat</button>`
}

function _lessonRow(lesson, showDate = false) {
  const color  = lesson.course?.color_code ?? '#2854B9'
  const title  = loc(lesson.course?.title) || 'Lekce'
  const booked = Number(lesson.booked_count || 0)
  const cap    = lesson.capacity ?? 0
  const pct    = cap > 0 ? Math.round((booked / cap) * 100) : 0
  const timeStr = fmtTimeOnly(lesson.start_time)
  const dateStr = new Date(lesson.start_time).toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' })
  const status = lesson.status ?? 'active'
  return `
    <div class="admin-lesson-row"${status === 'cancelled' ? ' style="opacity:.75;"' : ''}>
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
        <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></div>
        <div style="min-width:0;">
          <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(title)}</div>
          <div style="font-size:11px;color:#6b6b6b;">${showDate ? dateStr + ' · ' : ''}${timeStr} · ${booked}/${cap} míst</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">
        <div style="width:72px;">
          <div style="height:4px;background:rgba(0,0,0,.08);border-radius:99px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:99px;"></div>
          </div>
          <div style="font-size:10px;color:#9b9b9b;text-align:right;margin-top:2px;">${pct} %</div>
        </div>
        ${_lessonAdminDashButtons(lesson.lesson_id ?? lesson.id, lesson.status ?? 'active')}
      </div>
    </div>`
}

// ── Admin Kurzy ──────────────────────────────────────────────
export async function renderAdminKurzy() {
  const el = document.getElementById('admin-kurzy-content')
  if (!el) return
  const prevHtml = el.innerHTML
  const stable = _adminHadStableContent(prevHtml, 'Načítám kurzy')
  if (stable) {
    console.log('[Debug] Admin kurzy: obnovuji na pozadí, zachovávám poslední seznam')
  } else {
    el.innerHTML = `<div class="empty" style="padding:40px;">Načítám kurzy…</div>`
  }
  try {
    await adminRace((async () => {
    const baseQuery = sb.from('courses')
      .select('id, title, color_code, is_active, is_workshop, capacity_default, price_single, cancellation_hours, owner:users!owner_id(id,name)')
      .order('title->cs')
    const { data: courses, error } = await _scopeOwnerQuery(baseQuery)
    if (error) throw error
    const pageTitle = _isStaffLektor() ? 'Moje kurzy' : 'Kurzy'
    const activeCourses = (courses ?? []).filter(c => c.is_active)
    const inactiveCourses = (courses ?? []).filter(c => !c.is_active)
    let listBody = ''
    if (!activeCourses.length && !inactiveCourses.length) {
      listBody = `<div class="empty">Žádné kurzy. Vytvořte první kliknutím na tlačítko výše.</div>`
    } else {
      if (activeCourses.length) {
        listBody += `<div style="font-size:12px;color:#6b6b6b;margin-bottom:12px;">${activeCourses.length} aktivních kurzů</div>`
        listBody += activeCourses.map(_courseCard).join('')
      }
      if (inactiveCourses.length) {
        listBody += `<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9b9b9b;font-weight:600;margin:20px 0 10px;">Deaktivované kurzy</div>`
        listBody += `<div style="font-size:12px;color:#6b6b6b;margin-bottom:12px;">${inactiveCourses.length} kurzů — lze trvale smazat</div>`
        listBody += inactiveCourses.map(_courseCard).join('')
      }
    }
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div class="page-title">${pageTitle}</div>
        <div style="display:flex;gap:8px;">
          <button class="btn-small" onclick="window.adminNewWorkshop?.()">+ Nový workshop</button>
          <button class="btn-small" onclick="window.adminNewCourse?.()">+ Nový kurz</button>
        </div>
      </div>
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
    el.innerHTML = `<div class="empty">Chyba při načítání kurzů.</div>`
  }
}

function _courseCard(course) {
  const color      = course.color_code ?? '#2854B9'
  const title      = loc(course.title) || 'Kurz'
  const ownerName  = Array.isArray(course.owner) ? course.owner[0]?.name : course.owner?.name
  const active     = course.is_active
  const isWorkshop = !!course.is_workshop
  const editFn     = isWorkshop ? 'adminEditWorkshop' : 'adminEditCourse'
  return `
    <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:10px;background:#fff;display:flex;${active ? '' : 'opacity:.75;'}">
      <div style="width:5px;background:${color};flex-shrink:0;"></div>
      <div style="flex:1;padding:14px 16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div>
            <div style="font-size:14px;font-weight:600;margin-bottom:5px;display:flex;align-items:center;gap:8px;">
              ${esc(title)}
              ${isWorkshop ? `<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;background:#FFF4E0;color:#8B5C00;letter-spacing:.04em;">WORKSHOP</span>` : ''}
              ${!active ? '<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;background:#F3F4F6;color:#6b6b6b;margin-left:4px;">DEAKTIVOVÁNO</span>' : ''}
            </div>
            <div style="font-size:11px;color:#6b6b6b;display:flex;gap:12px;flex-wrap:wrap;">
              <span>Lektor: <b>${esc(ownerName ?? '—')}</b></span>
              <span>Kapacita: ${course.capacity_default} míst</span>
              ${!isWorkshop ? `<span>Storno: ${course.cancellation_hours} h</span>` : ''}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:16px;font-weight:700;color:${color};">${fmtPrice(course.price_single)}</div>
            <span style="font-size:10px;font-weight:600;padding:3px 8px;border-radius:20px;
              background:${active ? '#E1F5EE' : '#F3F4F6'};color:${active ? '#085041' : '#6b6b6b'};">
              ${active ? 'aktivní' : 'neaktivní'}
            </span>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="btn-small" onclick="window.openDetail?.('${esc(course.id)}')">Detail</button>
          <button class="btn-small" onclick="window.${editFn}?.('${esc(course.id)}')">Upravit</button>
          ${active
            ? `<button class="btn-small danger" onclick="window.adminToggleCourse?.('${esc(course.id)}',false)">Deaktivovat</button>`
            : `<button class="btn-small" onclick="window.adminToggleCourse?.('${esc(course.id)}',true)">Aktivovat</button>
               <button class="btn-small danger" onclick="window.adminDeleteCourse?.('${esc(course.id)}')">Smazat</button>`}
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
  const stable = _adminHadStableContent(prevHtml, 'Načítám zákazníky')
  if (stable) {
    console.log('[Debug] Admin zákazníci: obnovuji na pozadí')
  } else {
    el.innerHTML = `<div class="empty" style="padding:40px;">Načítám zákazníky…</div>`
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
      const activePassLabels = activePasses.map(up => loc(up.pass?.name) || 'Permanentka').filter(Boolean)
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
      <div class="page-title" style="margin-bottom:8px;">Zákazníci</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
        <div id="admin-zakaznici-count" style="font-size:12px;color:#6b6b6b;">0 zákazníků</div>
        <input
          id="admin-zakaznici-search"
          type="search"
          value="${esc(_adminCustomersQuery)}"
          placeholder="Hledat podle jména, e-mailu, kurzu, permanentky nebo částky"
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
    el.innerHTML = `<div class="empty">Chyba při načítání zákazníků.</div>`
  }
}

function _zakaznikRow(user) {
  const passes = user.activePassLabels ?? []
  const summary = [
    `Aktivní lekce: ${user.activeLessonsCount ?? 0}`,
    `Aktivní permanentky: ${user.activePassCount ?? 0}`,
    `Poslední aktivita: ${user.lastActivityAt ? fmtDate(user.lastActivityAt) : 'zatím žádná'}`,
  ].join(' · ')
  return `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);">
      <div style="width:36px;height:36px;border-radius:50%;background:var(--primary);color:#fff;
        display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;">
        ${esc(initials(user.name || user.email))}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(user.name || '—')}</div>
        <div style="font-size:11px;color:#6b6b6b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(user.email)}</div>
        <div style="font-size:11px;color:#8a8c90;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px;">${esc(summary)}</div>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end;flex-shrink:0;max-width:160px;">
        ${passes.slice(0, 2).map(up => `
          <span style="font-size:10px;font-weight:500;padding:2px 7px;border-radius:20px;
            background:rgba(40,84,185,.10);color:var(--primary);border:1px solid rgba(40,84,185,.18);white-space:nowrap;">
            ${esc(up || 'Permanentka')}
          </span>`).join('')}
      </div>
      <div style="flex-shrink:0;">
        <div style="display:flex;gap:8px;align-items:center;">
          <button type="button" class="btn-small"
            onclick="window.openAdminCustomerHistoryModal?.('${esc(user.id)}')">Historie</button>
          <button type="button" class="btn-small" title="Upravit zakoupené permanentky"
            data-admin-user-passes-open="1"
            data-user-id="${esc(user.id)}"
            data-display-name="${esc(user.name || user.email || 'Zákazník')}">Permanentky</button>
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
      <div style="background:#fff;border-radius:18px;border:1px solid var(--border);box-shadow:var(--shadow);
        width:min(860px, calc(100vw - 32px));max-width:860px;overflow:hidden;margin:auto;" onclick="event.stopPropagation()">
        <div style="padding:18px 18px 4px;">
          <div style="font-size:18px;font-weight:700;" id="mup-title">Permanentky zákazníka</div>
        </div>
        <div id="mup-body" style="padding:14px 18px;overflow-y:auto;max-height:calc(100vh - 160px);"></div>
        <div id="mup-error" style="display:none;margin:0 18px 12px;font-size:12px;color:#791F1F;background:#FCEBEB;
          border-radius:8px;padding:10px 12px;"></div>
        <div style="display:flex;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--border);">
          <button type="button" class="btn-wide" onclick="window.closeAdminCustomerPassesModal?.()">Zavřít</button>
        </div>
      </div>
    </div>`)
  const root = document.getElementById('modal-admin-user-passes')
  if (root && !root.dataset.mupDelegation) {
    root.dataset.mupDelegation = '1'
    root.addEventListener('click', (e) => {
      const addBtn = e.target.closest('[data-mup-add]')
      if (addBtn && root.contains(addBtn)) {
        e.preventDefault()
        void window.adminCreateUserPassManual?.()
        return
      }
      const btn = e.target.closest('[data-mup-save]')
      if (!btn || !root.contains(btn)) return
      e.preventDefault()
      void window.adminSaveUserPassFromCard?.(btn.getAttribute('data-mup-save'))
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
    const displayName = btn.getAttribute('data-display-name') || 'Zákazník'
    void window.openAdminCustomerPassesModal?.(userId, displayName)
  })
})()

function _mupPassesListHtml(passes) {
  const addHtml = _mupAddFormHtml()
  if (!passes.length) {
    return `${addHtml}<div class="empty" style="padding:12px 0;">Tento zákazník nemá žádnou permanentku.</div>`
  }
  const INP = 'width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;'
  return addHtml + passes.map(up => {
    const name = loc(up.pass?.name) || 'Permanentka'
    const st = up.status || 'active'
    return `
    <div data-mup-card="${esc(up.id)}" style="border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:12px;background:#fafafa;">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">${esc(name)}</div>
      <div style="font-size:11px;color:#6b6b6b;margin-bottom:10px;">Zakoupeno ${fmtDate(up.created_at)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Zbývá vstupů</label>
          <input type="number" min="0" data-mup-field="entries_remaining" value="${up.entries_remaining}" style="${INP}" />
        </div>
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Celkem vstupů</label>
          <input type="number" min="1" data-mup-field="entries_total" value="${up.entries_total}" style="${INP}" />
        </div>
      </div>
      <div style="margin-bottom:8px;">
        <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Platnost do</label>
        <input type="datetime-local" data-mup-field="expires_at" value="${esc(_isoToDatetimeLocalInput(up.expires_at))}" style="${INP}" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Stav</label>
          <select data-mup-field="status" style="${INP}">
            <option value="active" ${st === 'active' ? 'selected' : ''}>Aktivní</option>
            <option value="expired" ${st === 'expired' ? 'selected' : ''}>Vypršela</option>
            <option value="depleted" ${st === 'depleted' ? 'selected' : ''}>Vyčerpána</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Cena zaplaceno (Kč)</label>
          <input type="number" min="0" step="0.01" data-mup-field="price_paid" value="${Number(up.price_paid) || 0}" style="${INP}" />
        </div>
      </div>
      <div data-mup-row-err style="display:none;font-size:12px;color:#791F1F;margin-bottom:8px;"></div>
      <button type="button" class="btn-small primary" data-mup-save="${esc(up.id)}">Uložit změny</button>
    </div>`
  }).join('')
}

function _mupAddFormHtml() {
  const hasTemplates = _mupAvailablePasses.length > 0
  return `
    <div style="border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:14px;background:#fff;">
      <div style="font-size:13px;font-weight:700;margin-bottom:4px;">Připsat permanentku ručně</div>
      <div style="font-size:11px;color:#6b6b6b;margin-bottom:10px;">
        Vytvoří novou permanentku zákazníka podle vybraného typu. Po připsání ji můžete dole ještě upravit.
      </div>
      ${hasTemplates ? `
        <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end;">
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Typ permanentky</label>
            <select id="mup-add-pass-id" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;">
              ${_mupAvailablePasses.map((p, idx) => `
                <option value="${esc(p.id)}" ${idx === 0 ? 'selected' : ''}>
                  ${esc(loc(p.name) || 'Permanentka')} · ${Number(p.entries_total) || 0} vstupů · ${fmtPrice(p.price)}
                </option>`).join('')}
            </select>
          </div>
          <button type="button" class="btn-small primary" data-mup-add="1"
            onclick="window.adminCreateUserPassManual?.()" style="white-space:nowrap;">Připsat</button>
        </div>
      ` : `<div style="font-size:12px;color:#9b9b9b;">Nejsou k dispozici žádné aktivní typy permanentek.</div>`}
      <div id="mup-add-error" style="display:none;font-size:12px;color:#791F1F;margin-top:10px;"></div>
    </div>`
}

async function _mupReloadBody() {
  const body = document.getElementById('mup-body')
  if (!body || !_mupEditUserId) return
  body.innerHTML = '<div style="font-size:12px;color:#9b9b9b;">Načítám…</div>'
  const [userPassRes, passTemplatesRes] = await Promise.all([
    sb.from('user_passes')
      .select('id, entries_total, entries_remaining, expires_at, status, price_paid, created_at, pass:passes(name)')
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
  buildAdminCustomerPassesModal()
  _mupEditUserId = userId
  _mupDisplayName = displayName || 'Zákazník'
  const title = document.getElementById('mup-title')
  const errGlobal = document.getElementById('mup-error')
  if (title) title.textContent = `Permanentky — ${_mupDisplayName}`
  if (errGlobal) { errGlobal.style.display = 'none'; errGlobal.textContent = '' }
  document.getElementById('modal-admin-user-passes').style.display = 'flex'
  const body = document.getElementById('mup-body')
  body.innerHTML = '<div style="font-size:12px;color:#9b9b9b;">Načítám…</div>'
  try {
    await _mupReloadBody()
  } catch (e) {
    console.error('[Admin] openAdminCustomerPassesModal:', e)
    body.innerHTML = `<div class="empty" style="color:#791F1F;padding:12px 0;">${esc(e.message || 'Chyba při načtení')}</div>`
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
    window.showToast?.('Chybí zákazník pro připsání permanentky. Zavřete okno a otevřete ho znovu.', 'error')
    return
  }
  const errEl = document.getElementById('mup-add-error')
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = '' }

  const select = document.getElementById('mup-add-pass-id')
  const passId = select?.value
  const tpl = _mupAvailablePasses.find(p => String(p.id) === String(passId))
  if (!tpl) {
    if (errEl) { errEl.textContent = 'Vyberte typ permanentky.'; errEl.style.display = 'block' }
    return
  }

  const btn = document.getElementById('modal-admin-user-passes')?.querySelector('[data-mup-add]')
  if (btn) { btn.disabled = true; btn.textContent = 'Připisuji…' }

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

    window.showToast?.('Permanentka byla zákazníkovi připsána.', 'ok')
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
      ? 'V databázi chybí admin INSERT politika pro user_passes. Spusťte SQL migraci z FINAL_supabase_sql.sql.'
      : (err.message || 'Připsání se nepodařilo.')
    if (errEl) {
      errEl.textContent = uiMsg
      errEl.style.display = 'block'
    }
    window.showToast?.('Chyba: ' + uiMsg, 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Připsat' }
  }
}

window.adminSaveUserPassFromCard = async (userPassId) => {
  if (!userPassId) return
  const card = document.querySelector(`[data-mup-card="${String(userPassId).replace(/"/g, '')}"]`)
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
    if (errEl) { errEl.textContent = 'Celkový počet vstupů musí být alespoň 1.'; errEl.style.display = 'block' }
    return
  }
  if (Number.isNaN(entriesRemaining) || entriesRemaining < 0) {
    if (errEl) { errEl.textContent = 'Zbývající vstupy musí být 0 nebo více.'; errEl.style.display = 'block' }
    return
  }
  if (entriesRemaining > entriesTotal) {
    if (errEl) { errEl.textContent = 'Zbývá nemůže být víc než celkem vstupů.'; errEl.style.display = 'block' }
    return
  }
  if (!['active', 'expired', 'depleted'].includes(status)) {
    if (errEl) { errEl.textContent = 'Neplatný stav.'; errEl.style.display = 'block' }
    return
  }
  if (!expiresAt) {
    if (errEl) { errEl.textContent = 'Vyplňte platnost do (datum a čas).'; errEl.style.display = 'block' }
    return
  }
  if (Number.isNaN(pricePaid) || pricePaid < 0) {
    if (errEl) { errEl.textContent = 'Zadejte platnou cenu.'; errEl.style.display = 'block' }
    return
  }
  const btn = card.querySelector('[data-mup-save]')
  if (btn) { btn.disabled = true; btn.textContent = 'Ukládám…' }
  try {
    const { error } = await sb.from('user_passes').update({
      entries_total: entriesTotal,
      entries_remaining: entriesRemaining,
      expires_at: expiresAt,
      status,
      price_paid: pricePaid,
    }).eq('id', userPassId)
    if (error) throw error
    window.showToast?.('Permanentka byla uložena.', 'ok')
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
      ? 'V databázi chybí admin UPDATE politika pro user_passes. Spusťte SQL migraci z FINAL_supabase_sql.sql.'
      : (err.message || 'Uložení se nepodařilo.')
    if (errEl) {
      errEl.textContent = uiMsg
      errEl.style.display = 'block'
    }
    window.showToast?.('Chyba: ' + uiMsg, 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Uložit změny' }
  }
}

// ── Admin Platby ─────────────────────────────────────────────
export async function renderAdminPlatby() {
  // Platby jsou admin-only — lektor nemá přístup k souhrnu plateb napříč ateliérem.
  if (!_isStaffAdmin()) return
  const el = document.getElementById('admin-platby-content')
  if (!el) return
  const prevHtml = el.innerHTML
  const stable = _adminHadStableContent(prevHtml, 'Načítám platby')
  if (stable) console.log('[Debug] Admin platby: obnovuji na pozadí')
  else el.innerHTML = `<div class="empty" style="padding:40px;">Načítám platby…</div>`
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)
  try {
    await adminRace((async () => {
    const [recentPassesRes, recentSinglesRes, monthPassesRes, monthSinglesRes] = await Promise.all([
      sb.from('user_passes').select('id,price_paid,created_at,status,refund_status,refund_note,refunded_at,refund_amount,user:users(name,email),pass:passes(name)')
        .order('created_at',{ascending:false}).limit(40),
      sb.from('bookings').select('id,price_paid,status,created_at,refund_status,refund_note,refunded_at,refund_amount,user:users(name,email),lesson:lessons(start_time,course:courses(title,color_code))')
        .eq('payment_type','single').order('created_at',{ascending:false}).limit(40),
      sb.from('user_passes').select('price_paid, refund_status, refund_amount').gte('created_at', monthStart.toISOString()),
      sb.from('bookings').select('price_paid, status, payment_type, refund_status, refund_amount')
        .eq('payment_type','single').gte('created_at', monthStart.toISOString()),
    ])

    let recentPasses = recentPassesRes.data ?? []
    if (recentPassesRes.error) {
      if (!_looksLikeMissingRefundColumns(recentPassesRes.error)) throw recentPassesRes.error
      const fallbackPassesRes = await sb.from('user_passes')
        .select('id,price_paid,created_at,status,user:users(name,email),pass:passes(name)')
        .order('created_at',{ascending:false})
        .limit(40)
      if (fallbackPassesRes.error) throw fallbackPassesRes.error
      recentPasses = (fallbackPassesRes.data ?? []).map(row => ({
        ...row,
        refund_status: 'not_required',
        refund_note: null,
        refunded_at: null,
        refund_amount: null,
      }))
    }

    let recentSingles = recentSinglesRes.data ?? []
    if (recentSinglesRes.error) {
      if (!_looksLikeMissingRefundColumns(recentSinglesRes.error)) throw recentSinglesRes.error
      const fallbackSinglesRes = await sb.from('bookings')
        .select('id,price_paid,status,created_at,user:users(name,email),lesson:lessons(start_time,course:courses(title,color_code))')
        .eq('payment_type','single')
        .order('created_at',{ascending:false})
        .limit(40)
      if (fallbackSinglesRes.error) throw fallbackSinglesRes.error
      recentSingles = (fallbackSinglesRes.data ?? []).map(row => ({
        ...row,
        refund_status: null,
        refund_note: null,
        refunded_at: null,
        refund_amount: null,
      }))
    }

    let monthPasses = monthPassesRes.data ?? []
    if (monthPassesRes.error) {
      if (!_looksLikeMissingRefundColumns(monthPassesRes.error)) throw monthPassesRes.error
      const fallbackMonthPassesRes = await sb.from('user_passes')
        .select('price_paid')
        .gte('created_at', monthStart.toISOString())
      if (fallbackMonthPassesRes.error) throw fallbackMonthPassesRes.error
      monthPasses = (fallbackMonthPassesRes.data ?? []).map(row => ({
        ...row,
        type: 'pass',
        refund_status: 'not_required',
        refund_amount: null,
      }))
    } else {
      monthPasses = monthPasses.map(row => ({ ...row, type: 'pass' }))
    }

    let monthSingles = monthSinglesRes.data ?? []
    if (monthSinglesRes.error) {
      if (!_looksLikeMissingRefundColumns(monthSinglesRes.error)) throw monthSinglesRes.error
      const fallbackMonthSinglesRes = await sb.from('bookings')
        .select('price_paid, status, payment_type')
        .eq('payment_type','single')
        .gte('created_at', monthStart.toISOString())
      if (fallbackMonthSinglesRes.error) throw fallbackMonthSinglesRes.error
      monthSingles = (fallbackMonthSinglesRes.data ?? []).map(row => ({
        ...row,
        type: 'single',
        refund_status: null,
        refund_amount: null,
      }))
    } else {
      monthSingles = monthSingles.map(row => ({ ...row, type: 'single' }))
    }

    const monthGrossRev = _sumGrossRevenue([...monthPasses, ...monthSingles])
    const monthRefunds = _sumCompletedRefunds([...monthPasses, ...monthSingles])
    const monthNetRev = monthGrossRev - monthRefunds
    const all = [
      ...(recentPasses ?? []).map(p=>({type:'pass',id:p.id,amount:p.price_paid,date:p.created_at,status:p.status,
        userName:p.user?.name||p.user?.email||'—',description:loc(p.pass?.name)||'Permanentka',
        refundStatus:p.refund_status ?? 'not_required', refundNote:p.refund_note ?? '', refundedAt:p.refunded_at ?? null,
        refundAmount:p.refund_amount ?? null})),
      ...(recentSingles ?? []).map(b=>({type:'single',id:b.id,amount:b.price_paid,date:b.created_at,status:b.status,
        userName:b.user?.name||b.user?.email||'—',description:loc(b.lesson?.course?.title)||'Lekce',
        refundStatus:b.refund_status ?? null, refundNote:b.refund_note ?? '', refundedAt:b.refunded_at ?? null,
        refundAmount:b.refund_amount ?? null})),
    ].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,60)
    el.innerHTML = `
      <div class="page-title" style="margin-bottom:16px;">Platby</div>
      <div class="admin-stat-grid">
        <div class="admin-stat-card"><div class="admin-stat-value" style="font-size:18px;">${fmtPrice(monthGrossRev)}</div><div class="admin-stat-label">Hrubý příjem</div></div>
        <div class="admin-stat-card"><div class="admin-stat-value" style="font-size:18px;">${fmtPrice(monthRefunds)}</div><div class="admin-stat-label">Refundace</div></div>
        <div class="admin-stat-card"><div class="admin-stat-value" style="font-size:18px;">${fmtPrice(monthNetRev)}</div><div class="admin-stat-label">Čistý příjem</div></div>
      </div>
      <div class="admin-section-title">Všechny platby</div>
      ${all.length ? `<div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;">${all.map(_platbaRow).join('')}</div>`
        : `<div class="empty">Žádné platby.</div>`}
    `
    })(), 'admin-platby')
  } catch (err) {
    if (err?.code === 'TIMEOUT' && stable) {
      console.warn('[Debug] Admin platby: timeout — poslední známý obsah')
      el.innerHTML = prevHtml
      return
    }
    console.error('[Admin] renderAdminPlatby:', err)
    el.innerHTML = `<div class="empty">Chyba při načítání plateb.</div>`
  }
}

function _platbaRow(p) {
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
  const statusMap = {
    active:{l:'Aktivní',bg:'#E1F5EE',c:'#085041'}, expired:{l:'Vypršela',bg:'#F3F4F6',c:'#6b6b6b'},
    depleted:{l:'Vyčerpána',bg:'#F3F4F6',c:'#6b6b6b'}, booked:{l:'Uhrazeno',bg:'#E1F5EE',c:'#085041'},
    cancelled:{l:'Stornováno',bg:'#FCEBEB',c:'#791F1F'}, attended:{l:'Absolvováno',bg:'#E1F5EE',c:'#085041'},
    missed:{l:'Nedorazil',bg:'#FFF4E0',c:'#8B5C00'},
  }
  const st = statusMap[p.status] ?? {l:p.status,bg:'#F3F4F6',c:'#6b6b6b'}
  const refundBadge = refundPending
    ? `<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:#FCEBEB;color:#791F1F;">Refundace čeká</span>`
    : refundCompleted
      ? `<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:#E1F5EE;color:#085041;">Refundace dokončena</span>`
      : ''
  const refundMeta = refundCompleted
    ? `<div style="font-size:11px;color:#085041;margin-top:6px;">
        Refundováno ${fmtPrice(refundApplied || paidAmount)}
        ${p.refundedAt ? ` · ${fmtDateTime(p.refundedAt)}` : ''}
        ${p.refundNote ? ` · ${esc(p.refundNote)}` : ''}
      </div>`
    : ''
  const refundControls = refundPending || refundCanStart
    ? `
      <div style="flex-basis:100%;display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px dashed rgba(0,0,0,.08);">
        <input
          id="${esc(amountId)}"
          type="number"
          min="0.01"
          max="${esc(String(paidAmount))}"
          step="0.01"
          value="${esc(draftRefundAmount)}"
          placeholder="Částka refundace (Kč)"
          style="width:160px;padding:9px 11px;border:1px solid var(--border);border-radius:10px;font-size:12px;box-sizing:border-box;"
        />
        <input
          id="${esc(noteId)}"
          type="text"
          value="${esc(p.refundNote || '')}"
          placeholder="Poznámka k refundaci (volitelné)"
          style="flex:1;min-width:240px;padding:9px 11px;border:1px solid var(--border);border-radius:10px;font-size:12px;box-sizing:border-box;"
        />
        ${refundCanStart
          ? `<button type="button" class="btn-small" onclick="window.adminStartPaymentRefund?.('${esc(p.type)}', '${esc(p.id)}', this)">
              Označit refundaci
            </button>`
          : `<button type="button" class="btn-small primary" onclick="window.adminMarkPaymentRefunded?.('${esc(p.type)}', '${esc(p.id)}', this)">
              Označit jako refundováno
            </button>`}
      </div>`
    : ''
  return `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap;">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap;">
          <span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:${typeBg};color:${typeColor};">${isPass?'Permanentka':'Vstup'}</span>
          <span style="font-size:12px;font-weight:500;">${esc(p.description)}</span>
        </div>
        <div style="font-size:11px;color:#6b6b6b;">${esc(p.userName)} · ${fmtDateTime(p.date)}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:14px;font-weight:700;margin-bottom:3px;">${fmtPrice(p.amount)}</div>
        <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;">
          <span style="font-size:10px;font-weight:500;padding:2px 7px;border-radius:20px;background:${st.bg};color:${st.c};">${st.l}</span>
          ${refundBadge}
        </div>
        ${refundMeta}
      </div>
      ${refundControls}
    </div>`
}

async function _updatePaymentRefundState(type, paymentId, nextStatus, btnEl = null) {
  if (!paymentId || !['pending', 'completed'].includes(nextStatus)) return
  const noteInput = document.getElementById(_refundFieldId(type, paymentId, 'note'))
  const amountInput = document.getElementById(_refundFieldId(type, paymentId, 'amount'))
  const note = noteInput?.value?.trim() || null
  const refundAmount = Number(amountInput?.value)
  const maxRefund = Number(amountInput?.getAttribute('max'))
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
    window.showToast?.('Zadejte platnou částku refundace.', 'error')
    return
  }
  if (Number.isFinite(maxRefund) && refundAmount > maxRefund) {
    window.showToast?.('Refundace nemůže být vyšší než přijatá platba.', 'error')
    return
  }
  const confirmMsg = nextStatus === 'completed'
    ? 'Potvrzujete, že refundace byla skutečně odeslána zákazníkovi?'
    : 'Označit tuto platbu jako čekající refundaci?'
  if (!confirm(confirmMsg)) return
  if (btnEl) {
    btnEl.disabled = true
    btnEl.textContent = nextStatus === 'completed' ? 'Ukládám…' : 'Označuji…'
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
          'V databázi chybí refund sloupce. Spusťte migraci z FINAL_supabase_sql.sql.',
          'error',
        )
        return
      }
      throw error
    }
    window.showToast?.(
      nextStatus === 'completed'
        ? 'Refundace byla označena jako dokončená.'
        : 'Platba byla označena jako čekající refundace.',
      'ok',
    )
    await renderAdminPlatby()
    void renderAdminDashboard()
  } catch (err) {
    console.error('[Admin] _updatePaymentRefundState:', err)
    window.showToast?.('Nepodařilo se uložit refundaci: ' + (err.message ?? err), 'error')
  } finally {
    if (btnEl) {
      btnEl.disabled = false
      btnEl.textContent = nextStatus === 'completed'
        ? 'Označit jako refundováno'
        : 'Označit refundaci'
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
  const stable = _adminHadStableContent(prevHtml, 'Načítám permanentky')
  if (stable) console.log('[Debug] Admin permanentky: obnovuji na pozadí')
  else el.innerHTML = `<div class="empty" style="padding:40px;">Načítám permanentky…</div>`
  try {
    await adminRace((async () => {
    const basePassesQuery = sb.from('passes')
      .select('id, name, entries_total, price, validity_weeks, is_active, allowed_course_ids, color_code')
      .order('created_at', { ascending: false })
    const { data: passes, error } = await _scopeOwnerQuery(basePassesQuery)
    if (error) throw error

    const allCourseIds = [...new Set((passes ?? []).flatMap(p => p.allowed_course_ids ?? []))]
    let courseMap = {}
    if (allCourseIds.length > 0) {
      const { data: courses } = await sb.from('courses').select('id, title').in('id', allCourseIds)
      courseMap = Object.fromEntries((courses ?? []).map(c => [c.id, c]))
    }

    const pageTitle = _isStaffLektor() ? 'Moje permanentky' : 'Správa permanentek'
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div class="page-title">${pageTitle}</div>
        <button class="btn-small" onclick="window.openPassModal?.()">+ Nová permanentka</button>
      </div>
      ${passes?.length
        ? passes.map(p => _passCard(p, courseMap)).join('')
        : `<div class="empty">Žádné permanentky. Vytvořte první kliknutím na tlačítko výše.</div>`}
    `
    })(), 'admin-permanentky')
  } catch (err) {
    if (err?.code === 'TIMEOUT' && stable) {
      console.warn('[Debug] Admin permanentky: timeout — předchozí obsah')
      el.innerHTML = prevHtml
      return
    }
    console.error('[Admin] renderAdminPermanentky:', err)
    el.innerHTML = `<div class="empty">Chyba při načítání permanentek.</div>`
  }
}

function _passCard(pass, courseMap) {
  const name = loc(pass.name) || 'Permanentka'
  const tint = _passCardSurfaceStyle(pass.color_code)
  const ph = _passHexOrDefault(pass.color_code)
  const courseNames = (pass.allowed_course_ids ?? []).map(id => loc(courseMap[id]?.title)).filter(Boolean)
  return `
    <div style="border-radius:12px;padding:14px 16px;margin-bottom:10px;${tint}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px;">${esc(name)}</div>
          <div style="font-size:11px;color:#6b6b6b;display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;">
            <span>${pass.entries_total} vstupů</span>
            <span>${fmtPrice(pass.price / pass.entries_total)} / vstup</span>
            <span>Platnost: ${pass.validity_weeks} týdnů</span>
          </div>
          ${courseNames.length ? `
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
              ${courseNames.map(n => `
                <span style="font-size:10px;font-weight:500;padding:2px 7px;border-radius:20px;
                  background:${ph}22;color:${ph};">${esc(n)}</span>`).join('')}
            </div>` : `<div style="font-size:11px;color:#9b9b9b;">Není přiřazena k žádnému kurzu</div>`}
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:18px;font-weight:700;color:${ph};margin-bottom:10px;">${fmtPrice(pass.price)}</div>
          <div style="display:flex;gap:8px;">
            <button class="btn-small" onclick="window.openPassModal?.('${esc(pass.id)}')">Upravit</button>
            <button class="btn-small danger" onclick="window.adminDeletePass?.('${esc(pass.id)}')">Smazat</button>
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
          <div style="font-size:18px;font-weight:700;" id="mp-title">Nová permanentka</div>
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
              Vlastní paleta barev (nezávislá na kurzech) — určuje nádech pozadí permanentky v aplikaci.
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
          <button class="btn-wide" onclick="window.closePassModal?.()" style="flex:1;">Zrušit</button>
          <button class="btn-wide primary" id="mp-save-btn" onclick="window.savePass?.()" style="flex:2;">Uložit permanentku</button>
        </div>
      </div>
    </div>`)
}

window.openPassModal = async (passId = null) => {
  buildPassModal()
  const errEl = document.getElementById('mp-error')
  if (errEl) errEl.style.display = 'none'
  document.getElementById('mp-id').value        = passId ?? ''
  document.getElementById('mp-title').textContent = passId ? 'Upravit permanentku' : 'Nová permanentka'
  document.getElementById('mp-save-btn').textContent = passId ? 'Uložit změny' : 'Uložit permanentku'
  ;['mp-name','mp-entries','mp-price'].forEach(id => { const e = document.getElementById(id); if(e) e.value = '' })
  document.getElementById('mp-weeks').value = '12'

  const listEl = document.getElementById('mp-courses-list')
  listEl.innerHTML = `<div style="font-size:12px;color:#9b9b9b;">Načítám kurzy…</div>`

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
    listEl.innerHTML = `<div style="font-size:12px;color:#9b9b9b;padding:8px 0;">Žádné kurzy nenalezeny. Nejprve vytvořte kurzy.</div>`
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

  if (!name)              { showErr(errEl, 'Vyplňte název permanentky.'); return }
  if (!entries || entries < 1) { showErr(errEl, 'Počet vstupů musí být alespoň 1.'); return }
  if (isNaN(price) || price < 0) { showErr(errEl, 'Zadejte platnou cenu (0 nebo více).'); return }
  if (!weeks || weeks < 1) { showErr(errEl, 'Platnost musí být alespoň 1 týden.'); return }

  if (btn) { btn.disabled = true; btn.textContent = 'Ukládám…' }

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
    showErr(errEl, 'Chyba: ' + (err.message ?? 'Zkuste to znovu.'))
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = passId ? 'Uložit změny' : 'Uložit permanentku' }
  }
}

window.adminDeletePass = async (passId) => {
  if (!passId || !confirm('Opravdu smazat tuto permanentku? Akce je nevratná.')) return
  try {
    const { error } = await sb.from('passes').delete().eq('id', passId)
    if (error) throw error
    window.showToast?.('Permanentka byla smazána.', 'ok')
    renderAdminPermanentky()
  } catch (err) {
    console.error('[Admin] adminDeletePass:', err)
    window.showToast?.('Chyba: ' + (err.message ?? err), 'error')
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
          <button class="btn-wide" onclick="window.closeWorkshopModal?.()" style="flex:1;">Zrušit</button>
          <button class="btn-wide primary" id="mw-save-btn" onclick="window.saveNewWorkshop?.()" style="flex:2;">Uložit workshop</button>
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
  document.getElementById('mw-title').textContent    = 'Nový workshop'
  document.getElementById('mw-save-btn').textContent = 'Uložit workshop'
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
  document.getElementById('mw-title').textContent    = 'Upravit workshop'
  document.getElementById('mw-save-btn').textContent = 'Uložit změny'

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
  if (!_getQuillCtor()) { showErr(errEl, 'Editor není načtený. Obnovte stránku.'); return }
  const descLong = _getMwLongHtml()
  const price    = Number(document.getElementById('mw-price')?.value)
  const capacity = Number(document.getElementById('mw-capacity')?.value)
  const minPart  = Number(document.getElementById('mw-min-p')?.value)
  const date     = document.getElementById('mw-date')?.value
  const timeFrom = document.getElementById('mw-time-from')?.value
  const timeTo   = document.getElementById('mw-time-to')?.value

  if (!name)                      { showErr(errEl, 'Vyplňte název workshopu.'); return }
  if (isNaN(price) || price < 0)  { showErr(errEl, 'Zadejte platnou cenu.'); return }
  if (!capacity || capacity < 1)  { showErr(errEl, 'Zadejte kapacitu (min. 1 místo).'); return }
  if (!minPart || minPart < 1 || minPart > capacity) {
    showErr(errEl, 'Minimální počet účastníků musí být 1–kapacita.'); return
  }
  if (!date)                      { showErr(errEl, 'Vyberte datum workshopu.'); return }
  if (!timeFrom || !timeTo)       { showErr(errEl, 'Zadejte čas od a čas do.'); return }
  if (timeFrom >= timeTo)         { showErr(errEl, 'Čas do musí být po čase od.'); return }

  if (btn) { btn.disabled = true; btn.textContent = 'Ukládám…' }

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
      const { error } = await sb.from('courses').update(coursePayload).eq('id', courseId)
      if (error) throw error
      if (lessonId) {
        const { error: lErr } = await sb.from('lessons').update({
          start_time: start.toISOString(), end_time: end.toISOString(),
          capacity, price_single: price,
        }).eq('id', lessonId)
        if (lErr) console.warn('[Admin] updateWorkshopLesson:', lErr)
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
    if (btn) { btn.disabled = false; btn.textContent = courseId ? 'Uložit změny' : 'Uložit workshop' }
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
    if (!f.type.startsWith('image/')) { alert(`"${f.name}" není obrázek.`); continue }
    if (f.size > MAX_PHOTO_UPLOAD_BYTES) { alert(`"${f.name}" je příliš velký (max. 10 MB).`); continue }
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
    if (!f.type.startsWith('image/')) { alert(`"${f.name}" není obrázek.`); continue }
    if (f.size > MAX_PHOTO_UPLOAD_BYTES) { alert(`"${f.name}" je příliš velký (max. 10 MB).`); continue }
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

  const dayBtns = DAYS_CS.map((d, i) => `
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

          <!-- Povolené permanentky -->
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:8px;">Povolené permanentky</label>
            <div id="mc-passes-list"><div style="font-size:12px;color:#9b9b9b;">Načítám permanentky…</div></div>
          </div>

          <div id="mc-error" style="display:none;font-size:12px;color:#791F1F;background:#FCEBEB;
            border-radius:8px;padding:10px 12px;"></div>
        </div>
        <div style="display:flex;gap:10px;padding:12px 18px;border-top:1px solid var(--border);">
          <button class="btn-wide" onclick="window.closeNewCourseModal?.()" style="flex:1;">Zrušit</button>
          <button class="btn-wide primary" id="mc-save-btn" onclick="window.saveNewCourse?.()" style="flex:2;">Uložit kurz</button>
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
  document.getElementById('mc-title').textContent  = isEdit ? 'Upravit kurz' : 'Nový kurz'
  document.getElementById('mc-save-btn').textContent = isEdit ? 'Uložit změny' : 'Uložit kurz'
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
  const noteEl = document.getElementById('mc-edit-note')
  if (noteEl) noteEl.style.display = isEdit ? 'block' : 'none'

  // Load passes list
  const passesListEl = document.getElementById('mc-passes-list')
  passesListEl.innerHTML = `<div style="font-size:12px;color:#9b9b9b;">Načítám permanentky…</div>`

  let passes = []
  let courseData = { data: null }
  let modalDataFailed = false
  try {
    // Lektor v modalu kurzu vidí jen své vlastní permanentky — cizí by mu RLS UPDATE tiše neumožnil.
    const passesQuery = _scopeOwnerQuery(
      sb.from('passes').select('id, name, entries_total, price').eq('is_active', true).order('created_at')
    )
    const [passRes, cRes] = await Promise.all([
      passesQuery,
      courseId
        ? sb.from('courses').select('*').eq('id', courseId).single()
        : Promise.resolve({ data: null }),
    ])
    passes = passRes?.data ?? []
    courseData = cRes ?? { data: null }
  } catch (e) {
    modalDataFailed = true
    console.error('[Admin] modal kurz:', e)
    passesListEl.innerHTML = `<div style="font-size:12px;color:#791F1F;padding:8px 0;">
      Nepodařilo se načíst data. Zkuste okno zavřít a otevřít znovu, nebo obnovte stránku.</div>`
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
      passesListEl.innerHTML = `<div style="font-size:12px;color:#9b9b9b;padding:8px 0;">Žádné permanentky nenalezeny. Nejprve je vytvořte v sekci Permanentky.</div>`
    } else {
      passesListEl.innerHTML = passes.map(p => {
        const name = loc(p.name) || 'Permanentka'
        return `
        <label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:var(--btn-radius);
          border:1px solid var(--border);margin-bottom:6px;cursor:pointer;user-select:none;">
          <input type="checkbox" value="${esc(p.id)}" ${linkedPassIds.includes(p.id)?'checked':''}
            style="width:16px;height:16px;accent-color:var(--primary);cursor:pointer;flex-shrink:0;" />
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:500;">${esc(name)}</div>
            <div style="font-size:11px;color:#6b6b6b;">${p.entries_total} vstupů · ${fmtPrice(p.price)}</div>
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
  if (!_getQuillCtor()) { showErr(errEl, 'Editor není načtený. Obnovte stránku.'); return }
  const descLong    = _getMcLongHtml()
  const price       = Number(document.getElementById('mc-price')?.value)
  const capacity    = Number(document.getElementById('mc-capacity')?.value)
  const minPart     = Number(document.getElementById('mc-min-p')?.value)
  const cancelH     = Number(document.getElementById('mc-cancel')?.value)
  const timeFrom    = document.getElementById('mc-time-from')?.value
  const timeTo      = document.getElementById('mc-time-to')?.value
  const selectedDays    = [..._ncSelectedDays]
  const selectedPassIds = [...document.querySelectorAll('#mc-passes-list input[type=checkbox]:checked')].map(cb => cb.value)

  if (!name)              { showErr(errEl, 'Vyplňte název kurzu.'); return }
  if (!price || price<=0) { showErr(errEl, 'Zadejte platnou cenu vstupného.'); return }
  if (!capacity || capacity<1) { showErr(errEl, 'Zadejte kapacitu (min. 1 místo).'); return }
  if (!minPart || minPart < 1 || minPart > capacity) {
    showErr(errEl, 'Minimální počet účastníků musí být 1–kapacita.'); return
  }
  if (selectedDays.length === 0) { showErr(errEl, 'Vyberte alespoň jeden den v týdnu.'); return }
  if (!timeFrom || !timeTo)       { showErr(errEl, 'Zadejte čas od a čas do.'); return }
  if (timeFrom >= timeTo)         { showErr(errEl, 'Čas do musí být po čase od.'); return }

  if (btn) { btn.disabled = true; btn.textContent = 'Ukládám…' }

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

    window.closeNewCourseModal?.()
    renderAdminKurzy()
    try {
      await window.refreshPublicData?.()
    } catch (refreshErr) {
      console.warn('[Admin] refreshPublicData po uložení kurzu:', refreshErr)
    }
  } catch (err) {
    console.error('[Admin] saveNewCourse:', err)
    showErr(errEl, 'Chyba: ' + (err.message ?? 'Zkuste to znovu.'))
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = courseId ? 'Uložit změny' : 'Uložit kurz' }
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
      .eq('status', 'booked')
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
    if (!target) throw new Error('Nepodařilo se zachovat obsazené termíny kurzu.')
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
          <div id="mla-title" style="font-size:18px;font-weight:700;">Účastníci lekce</div>
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

async function _adminCancelCustomerBookingFallback(bookingId, paymentType, userPassId, refundPass) {
  const { error: bookingErr } = await sb.from('bookings').update({
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
  }).eq('id', bookingId).eq('status', 'booked')
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
  if (!confirm('Opravdu zrušit rezervaci tohoto zákazníka na této lekci?')) return
  let refundPass = true
  if (paymentType === 'pass' && userPassId) {
    refundPass = confirm(
      'Vrátit zákazníkovi 1 vstup na permanentku?\n\n'
      + 'OK = ano, vrátit vstup\n'
      + 'Zrušit = ne, vstup zůstane odečtený',
    )
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
          'Rezervace byla zrušena. Vstup na permanentku byl vrácen podle nastavení; e-mail se v nouzovém režimu nezařadil automaticky.',
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
      throw new Error(data.error || 'Operace se nezdařila')
    }
    window.showToast?.('Rezervace byla zrušena. Zákazník obdrží e-mail z fronty.', 'ok')
    if (lessonId) await window.adminOpenLessonDetail?.(lessonId)
    _refreshStaffViewAfterCancel()
  } catch (err) {
    console.error('[Admin] adminCancelCustomerBooking:', err)
    window.showToast?.('Nepodařilo se zrušit rezervaci: ' + (err.message ?? err), 'error')
  }
}

window.adminOpenLessonDetail = async (lessonId) => {
  if (!lessonId) return
  buildLessonAttendeesModal()
  const modal = document.getElementById('modal-lesson-attendees')
  const listEl = document.getElementById('mla-list')
  const titleEl = document.getElementById('mla-title')
  if (!modal || !listEl) return
  modal.dataset.lessonId = String(lessonId)
  listEl.innerHTML = '<div style="font-size:12px;color:#9b9b9b;padding:12px 0;">Načítám…</div>'
  if (titleEl) titleEl.textContent = 'Účastníci lekce'
  modal.style.display = 'flex'
  try {
    await adminRace((async () => {
    const { data: bookings, error: bookingErr } = await sb
      .from('bookings')
      .select('id, payment_type, user_id, created_at, user_pass_id')
      .eq('lesson_id', lessonId)
      .eq('status', 'booked')
      .order('created_at', { ascending: true })

    if (bookingErr) throw bookingErr

    const { data: lessonRow } = await sb
      .from('lessons')
      .select('start_time, course:courses(title)')
      .eq('id', lessonId)
      .maybeSingle()

    const ctitle = lessonRow?.course?.title ? loc(lessonRow.course.title) : 'Lekce'
    const when = lessonRow?.start_time ? fmtDateTime(lessonRow.start_time) : ''
    if (titleEl) titleEl.textContent = when ? `${ctitle} · ${when}` : `Účastníci — ${ctitle}`

    const rows = bookings ?? []
    if (!rows.length) {
      listEl.innerHTML = '<div class="empty" style="padding:24px;">Žádné aktivní přihlášky.</div>'
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
            <th style="padding:8px 8px 8px 0;">Jméno</th>
            <th style="padding:8px 4px;">E-mail</th>
            <th style="padding:8px 0 8px 8px;">Platba</th>
            <th style="padding:8px 0 8px 8px;text-align:right;white-space:nowrap;">Akce</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(b => {
            const u = userMap[b.user_id]
            const pName = b.user_pass_id ? passNames[b.user_pass_id] : null
            const passLabel = pName ? esc(loc(pName)) : ''
            const payCell = b.payment_type === 'pass'
              ? `Permanentka${passLabel ? ': ' + passLabel : ''}`
              : 'Jednorázově'
            const passIdAttr = b.user_pass_id ? esc(b.user_pass_id) : ''
            const lessonIdArg = esc(String(lessonId))
            const bookingIdArg = esc(String(b.id))
            const paymentTypeArg = esc(String(b.payment_type))
            return `<tr style="border-top:1px solid var(--border);">
              <td style="padding:10px 8px 10px 0;vertical-align:top;font-weight:500;line-height:1.45;">${esc(u?.name || '—')}</td>
              <td style="padding:10px 4px;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;line-height:1.45;">${esc(u?.email || '—')}</td>
              <td style="padding:10px 0 10px 8px;vertical-align:top;line-height:1.45;">${payCell}</td>
              <td style="padding:10px 0 10px 8px;vertical-align:top;text-align:right;">
                <button type="button" class="btn-small danger" style="font-size:11px;padding:6px 10px;"
                  onclick="window.adminCancelCustomerBooking?.('${bookingIdArg}','${lessonIdArg}','${paymentTypeArg}','${passIdAttr}')"
                  data-admin-cancel-booking="${esc(b.id)}"
                  data-payment-type="${esc(b.payment_type)}"
                  data-user-pass-id="${passIdAttr}">Zrušit rezervaci</button>
              </td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
      </div>
      <div style="font-size:11px;color:#9b9b9b;margin-top:12px;">Celkem přihlášených: ${rows.length}</div>`
    })(), 'modal-lesson-attendees')
  } catch (err) {
    console.error('[Admin] adminOpenLessonDetail:', err)
    listEl.innerHTML = '<div class="empty" style="padding:20px;color:#791F1F;">Nepodařilo se načíst seznam.</div>'
    window.showToast?.('Chyba při načítání účastníků: ' + (err.message ?? err), 'error')
  }
}

// ── Admin akce ───────────────────────────────────────────────
async function _refreshAfterLessonChange() {
  if (_isStaffAdmin()) void renderAdminDashboard()
  void window.renderMojeLekce?.()
  void window.refreshPublicData?.()
}

window.adminDeactivateLesson = async (lessonId) => {
  if (!lessonId || !confirm('Opravdu deaktivovat lekci? Rezervace budou stornovány a účastníkům se může odeslat e‑mail.')) return
  try {
    const { error: rpcErr } = await sb.rpc('admin_cancel_lesson', { p_lesson_id: lessonId })
    if (rpcErr) {
      const missFn = rpcErr.code === 'PGRST202'
        || rpcErr.message?.includes('Could not find the function')
        || rpcErr.message?.includes('admin_cancel_lesson')
      if (missFn) {
        const [{ error: bErr }, { error: lErr }] = await Promise.all([
          sb.from('bookings').update({ status: 'cancelled' }).eq('lesson_id', lessonId).eq('status', 'booked'),
          sb.from('lessons').update({ status: 'cancelled' }).eq('id', lessonId),
        ])
        if (lErr) throw lErr
        if (bErr) console.warn('[Admin] deactivateLesson — bookings:', bErr)
        window.showToast?.('Lekce deaktivována (bez RPC — e‑maily ze fronty nedostanete, nasaďte SQL).', 'ok')
        _refreshAfterLessonChange()
        return
      }
      throw rpcErr
    }
    window.showToast?.('Lekce byla deaktivována.', 'ok')
    _refreshAfterLessonChange()
  } catch (err) {
    console.error('[Admin] deactivateLesson:', err)
    window.showToast?.('Nepodařilo se deaktivovat lekci: ' + (err.message ?? err), 'error')
  }
}

window.adminCancelLesson = window.adminDeactivateLesson

window.adminDeleteLesson = async (lessonId) => {
  if (!lessonId || !confirm('Opravdu trvale smazat tuto deaktivovanou lekci? Akce je nevratná.')) return
  try {
    const { data: lesson, error: loadErr } = await sb.from('lessons')
      .select('id, status')
      .eq('id', lessonId)
      .maybeSingle()
    if (loadErr) throw loadErr
    if (!lesson) throw new Error('Lekce nenalezena.')
    if (lesson.status !== 'cancelled') {
      throw new Error('Smazat lze jen deaktivovanou lekci — nejprve ji deaktivujte.')
    }
    const { count, error: countErr } = await sb.from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('lesson_id', lessonId)
      .eq('status', 'booked')
    if (countErr) throw countErr
    if ((count ?? 0) > 0) {
      throw new Error('Lekci s aktivními rezervacemi nelze smazat.')
    }
    const { error } = await sb.from('lessons').delete().eq('id', lessonId)
    if (error) throw error
    window.showToast?.('Lekce byla smazána.', 'ok')
    _refreshAfterLessonChange()
  } catch (err) {
    console.error('[Admin] adminDeleteLesson:', err)
    window.showToast?.('Nepodařilo se smazat lekci: ' + (err.message ?? err), 'error')
  }
}

window.adminToggleCourse = async (courseId, activate) => {
  if (!confirm(activate ? 'Aktivovat kurz?' : 'Deaktivovat kurz?')) return
  try {
    const { error } = await sb.from('courses').update({ is_active: activate }).eq('id', courseId)
    if (error) throw error
    window.showToast?.(activate ? 'Kurz je aktivní.' : 'Kurz byl deaktivován.', 'ok')
    renderAdminKurzy()
  } catch (err) {
    console.error('[Admin] adminToggleCourse:', err)
    window.showToast?.('Chyba: ' + (err.message ?? err), 'error')
  }
}

window.adminDeleteCourse = async (courseId) => {
  if (!courseId || !confirm('Opravdu trvale smazat tento deaktivovaný kurz včetně termínů? Akce je nevratná.')) return
  try {
    const { data: course, error: loadErr } = await sb.from('courses')
      .select('id, is_active')
      .eq('id', courseId)
      .maybeSingle()
    if (loadErr) throw loadErr
    if (!course) throw new Error('Kurz nenalezen.')
    if (course.is_active) {
      throw new Error('Smazat lze jen deaktivovaný kurz — nejprve ho deaktivujte.')
    }
    const { data: lessonRows, error: lesErr } = await sb.from('lessons').select('id').eq('course_id', courseId)
    if (lesErr) throw lesErr
    const lessonIds = (lessonRows ?? []).map(l => l.id)
    if (lessonIds.length) {
      const { count, error: bookErr } = await sb.from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'booked')
        .in('lesson_id', lessonIds)
      if (bookErr) throw bookErr
      if ((count ?? 0) > 0) {
        throw new Error('Kurz má stále aktivní rezervace — nelze smazat.')
      }
    }
    const { error } = await sb.from('courses').delete().eq('id', courseId)
    if (error) throw error
    window.showToast?.('Kurz byl smazán.', 'ok')
    renderAdminKurzy()
    void window.refreshPublicData?.()
  } catch (err) {
    console.error('[Admin] adminDeleteCourse:', err)
    window.showToast?.('Nepodařilo se smazat kurz: ' + (err.message ?? err), 'error')
  }
}

// ── Delegace kliků v Dashboardu (řádky lekcí se přepisují innerHTML — jeden listener na body) ──
;(function installAdminDashboardClickDelegation() {
  if (window.__adminDashboardDelegationInstalled) return
  window.__adminDashboardDelegationInstalled = true
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('button.admin-dash-act[data-admin-lesson-act][data-lesson-id]')
    if (!btn) return
    const dash = document.getElementById('admin-dash-content')
    if (!dash?.contains(btn)) return
    const id = btn.getAttribute('data-lesson-id')
    const act = btn.getAttribute('data-admin-lesson-act')
    if (!id || !act) return
    e.preventDefault()
    if (act === 'attendees') {
      console.log('[Debug] Delegace admin dashboard → adminOpenLessonDetail:', id)
      void window.adminOpenLessonDetail?.(id)
    } else if (act === 'deactivate' || act === 'cancel') {
      console.log('[Debug] Delegace admin dashboard → adminDeactivateLesson:', id)
      void window.adminDeactivateLesson?.(id)
    } else if (act === 'delete') {
      console.log('[Debug] Delegace admin dashboard → adminDeleteLesson:', id)
      void window.adminDeleteLesson?.(id)
    }
  })
})()

// ── Navigace podle hooků z index.html (`nav()` → __appNavHooks) ───────────────────
window.__refreshAdminScreen = async (route) => {
  if (!route) return
  console.log('[Debug] __refreshAdminScreen:', route, '(bez init, jen překreslit sekci)')
  if (route === 'admin-dashboard' || route === 'sprava')   await renderAdminDashboard()
  if (route === 'admin-kurzy')       await renderAdminKurzy()
  if (route === 'admin-zakaznici')   await renderAdminZakaznici()
  if (route === 'admin-platby')      await renderAdminPlatby()
  if (route === 'admin-permanentky') await renderAdminPermanentky()
}

;(window.__appNavHooks ??= []).push((id) => {
  void window.__refreshAdminScreen?.(id)
})
