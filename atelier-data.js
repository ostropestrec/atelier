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
} from './atelier_auth.js'

// ── Jazyk ─────────────────────────────────────────────────────
export let lang = 'cs'
export const setLang = l => { lang = l; renderAll() }
const loc = obj => typeof obj === 'object' && obj ? (obj[lang] ?? obj.cs ?? '') : (obj ?? '')

// umožní topbaru v index.html přepínat jazyk
window.__setLang = setLang

// ── Omezení výběru termínů podle zbývajících vstupů na permanentce ──
const PASS_ENTRIES_LIMIT_HINT_CS =
  'Dosáhli jste limitu své permanentky. Pro další lekce si prosím zakupte novou.'
const PASS_ENTRIES_LIMIT_HINT_EN =
  "You've reached your pass limit. Please purchase a new pass for more lessons."

function _toastPassEntriesLimitReached() {
  window.showToast?.(
    lang === 'cs' ? PASS_ENTRIES_LIMIT_HINT_CS : PASS_ENTRIES_LIMIT_HINT_EN,
    'error',
  )
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
  slotEl.textContent =
    lang === 'cs'
      ? `Vybráno ${n} z ${cap} vstupů`
      : `Selected ${n} of ${cap} ${cap === 1 ? 'entry' : 'entries'}`
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
  el.textContent =
    lang === 'cs'
      ? `Vybráno ${n} z ${cap} vstupů`
      : `Selected ${n} of ${cap} ${cap === 1 ? 'entry' : 'entries'}`
}

function _refreshDetailPassSlotsRow(courseId) {
  const el = document.getElementById(`detail-pass-indicator-${courseId}`)
  const st = window._cardState?.[courseId]
  if (!el) return
  if (!st || st.paymentType !== 'pass' || !st.passId) {
    el.style.display = 'none'
    return
  }
  const cap = _remainingEntriesOnUserPass(st.passId)
  const n = Array.isArray(st.lessonIds) ? st.lessonIds.length : 0
  el.style.display = 'block'
  el.textContent =
    lang === 'cs'
      ? `Vybráno ${n} z ${cap} vstupů`
      : `Selected ${n} of ${cap} ${cap === 1 ? 'entry' : 'entries'}`
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

// Per-karta stav: { lessonId, paymentType, passId }
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

  console.log('[App] Inicializace start — spouští se jen při loadu modulu; nav() jen přehazuje screeny a volá hooky')
  showAppLoader()
  try {
    logSupabaseClientDebug()

    if (window.__authReady) await window.__authReady
    console.log('[App] Auth ready — jediný první krok: await supabase.auth.getSession() (bez časového limitu)…')

    try {
      const sessionResult = await sb.auth.getSession()
      if (sessionResult?.error) {
        console.error('[App] getSession vrátil error — plný objekt:')
        console.dir(sessionResult.error, { depth: null })
        showRetryScreen()
        return
      }
      console.log('[Debug] getSession po startu: OK (žádný error v odpovědi)')
    } catch (e) {
      console.error('[App] getSession vyhodilo výjimku — plný objekt:')
      console.dir(e, { depth: null })
      showRetryScreen()
      return
    }

    console.log('[App] Jednorázově stahuji kurzy + lekce (bez withTimeout; tab resume sync je ' + (ENABLE_TAB_RESUME_SYNC ? 'ZAP' : 'VY') + 'PNUTÝ)…')

    await Promise.all([
      fetchCourses().catch(e => {
        console.warn('[Debug] Init: fetchCourses chyba — pokračuji s prázdnými kurzy:', e?.message ?? e)
        console.dir(e, { depth: null })
        return null
      }),
      fetchLessons().catch(e => {
        console.warn('[Debug] Init: fetchLessons:', e?.message ?? e)
        console.dir(e, { depth: null })
        return null
      }),
      fetchUpcomingLessons().catch(e => {
        console.warn('[Debug] Init: fetchUpcomingLessons:', e?.message ?? e)
        console.dir(e, { depth: null })
        return null
      }),
    ])
    console.log('[App] První kolo dat dokončeno')

    window.AppState.initialized = true
    renderAll()

    const defaultPage = window.AppState.role === 'admin' ? 'admin-dashboard' : 'nastenka'
    window.nav?.(defaultPage)

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
function courseImageUrls(course) {
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

function normalizeCourseRecord(c) {
  if (!c || typeof c !== 'object') return c
  return { ...c, images: courseImageUrls(c) }
}

// ── Fetch: kurzy ─────────────────────────────────────────────
const _COURSE_COLS = `
  id, title, description_short, description_long,
  color_code, price_single, capacity_default,
  cancellation_hours, images, is_workshop, owner_id,
  schedule_days, schedule_time_start, schedule_time_end
`

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
}

function _calcDurMin(startStr, endStr) {
  if (!startStr || !endStr) return null
  const [sh, sm] = startStr.split(':').map(Number)
  const [eh, em] = endStr.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

// ── Fetch: lekce pro aktuální týden ──────────────────────────
async function fetchLessons(from = window.AppState.weekStart) {
  const to = new Date(from)
  to.setDate(to.getDate() + 7)
  const { data, error } = await sb
    .from('lesson_availability')
    .select('*')
    .eq('status', 'active')
    .gte('start_time', from.toISOString())
    .lt('start_time',  to.toISOString())
    .order('start_time')
  if (error) { console.error('fetchLessons:', error); return }
  window.AppState.lessons = data ?? []
}

// ── Fetch: všechny budoucí lekce (pro kurzy + booking) ───────
async function fetchUpcomingLessons() {
  const { data, error } = await sb
    .from('lesson_availability')
    .select('lesson_id, course_id, start_time, end_time, capacity, booked_count, available_spots')
    .eq('status', 'active')
    .gte('start_time', new Date().toISOString())
    .order('start_time')
    .limit(300)
  if (error) { console.error('fetchUpcomingLessons:', error); return }
  window.AppState.upcomingLessons = data ?? []
}

// ── Realtime: živá obsazenost (debounce — tab / burst events nesmí zahltit UI) ──
let _bookingsLiveTimer = null
function _flushBookingsRealtime() {
  _bookingsLiveTimer = null
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

function renderAll() { renderKalendar(); renderKurzy() }

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

function _isWorkshopCourseId(cid) {
  const c = window.AppState.courses.find(x => x.id === cid)
  if (c) return !!c.is_workshop
  const fromBooking = (myBookings ?? []).find(b => b.lesson?.course?.id === cid)
  return !!fromBooking?.lesson?.course?.is_workshop
}

function _nastenkaCourseRow(cid, sub) {
  const course = window.AppState.courses.find(c => c.id === cid)
  const title = course ? loc(course.title) : (lang === 'cs' ? 'Kurz' : 'Course')
  const color = course?.color_code ?? '#2854B9'
  return `
      <div class="booking-item" style="margin-bottom:10px;">
        <div class="bk-left" style="min-width:0;flex:1;">
          <span class="dot" style="background:${color};flex-shrink:0;"></span>
          <div style="min-width:0">
            <div class="bk-title">${_escHtml(title)}</div>
            <div class="bk-sub">${sub}</div>
          </div>
        </div>
        <button type="button" class="btn-small" style="flex-shrink:0;"
          onclick="window.openDetail?.('${cid}')">${lang === 'cs' ? 'Detail' : 'Detail'}</button>
      </div>`
}

/** Kurzy a workshopy z aktivních rezervací. */
function renderNastenkaMyCourses() {
  const wrapK = document.getElementById('nastenka-courses-wrap')
  const elK = document.getElementById('nastenka-courses')
  const wrapW = document.getElementById('nastenka-workshops-wrap')
  const elW = document.getElementById('nastenka-workshops')
  if (!wrapK || !elK || !wrapW || !elW) return

  if (!currentUser) {
    wrapK.style.display = 'none'
    elK.innerHTML = ''
    wrapW.style.display = 'none'
    elW.innerHTML = ''
    return
  }

  const ids = [...new Set((myBookings ?? []).map(b => b.lesson?.course?.id).filter(Boolean))]
  const regular = ids.filter(id => !_isWorkshopCourseId(id))
  const wshop = ids.filter(id => _isWorkshopCourseId(id))

  const subK = lang === 'cs' ? 'Aktivní rezervace v kurzu' : 'Active booking in this course'
  const subW = lang === 'cs' ? 'Aktivní rezervace ve workshopu' : 'Active booking in this workshop'

  if (!regular.length) {
    wrapK.style.display = 'none'
    elK.innerHTML = ''
  } else {
    wrapK.style.display = 'block'
    elK.innerHTML = regular.map(cid => _nastenkaCourseRow(cid, subK)).join('')
  }

  if (!wshop.length) {
    wrapW.style.display = 'none'
    elW.innerHTML = ''
  } else {
    wrapW.style.display = 'block'
    elW.innerHTML = wshop.map(cid => _nastenkaCourseRow(cid, subW)).join('')
  }
}

window.renderNastenkaMyCourses = renderNastenkaMyCourses

// ============================================================
// KALENDÁŘ
// ============================================================
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

  window.AppState.lessons.forEach(l => {
    const course  = window.AppState.courses.find(c => c.id === l.course_id)
    const color   = course?.color_code ?? '#2854B9'
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

    const enrolled = isEnrolled(l.lesson_id ?? l.id)
    const full     = l.available_spots <= 0 && !enrolled
    const name     = course ? loc(course.title) : '—'
    const timeStr  = `${fmtTime(start)}–${fmtTime(end)}`

    const el = document.createElement('div')
    el.className = 'ev'
    el.style.cssText = [
      `top:${topPx}px`,
      `height:${heightPx}px`,
      `background:${enrolled ? color + '33' : color + '18'}`,
      `border-left:3px solid ${color}`,
      full ? 'opacity:.45' : '',
    ].filter(Boolean).join(';')

    el.innerHTML = `
      <div class="evn" style="color:${color};">${name}</div>
      <div class="evt" style="color:${color};">${timeStr}</div>
      ${course?.is_workshop ? `<div class="evb" style="color:${color};opacity:.7;">WORKSHOP</div>` : ''}
      ${enrolled ? `<div class="evb" style="color:${color};">✓ ${lang === 'cs' ? 'PŘIHLÁŠENA' : 'ENROLLED'}</div>` : ''}
      ${full && !enrolled ? `<div class="evb" style="color:${color};">${lang === 'cs' ? 'PLNO' : 'FULL'}</div>` : ''}
    `

    el.addEventListener('click', () => openKalendarPopup(l, course, enrolled))
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
  window.AppState.lessons.forEach(l => {
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
function openKalendarPopup(lesson, course, enrolled) {
  const color   = course?.color_code ?? '#2854B9'
  const name    = course ? loc(course.title) : '—'
  const start   = new Date(lesson.start_time)
  const end     = new Date(lesson.end_time)
  const durMin  = Math.round((end - start) / 60000)
  const ownerName = Array.isArray(course?.owner) ? course.owner[0]?.name : course?.owner?.name

  const bar = document.getElementById('kal-bar')
  if (bar) bar.style.background = color

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val }
  setEl('kal-name',   name)
  setEl('kal-meta',   `${fmtDayFull(start)} · ${fmtTime(start)}–${fmtTime(end)}`)
  setEl('kal-lektor', ownerName ?? '—')
  setEl('kal-delka',  `${durMin} min`)
  setEl('kal-mista',  `${lesson.available_spots} / ${lesson.capacity}`)

  const lid = lesson.lesson_id ?? lesson.id
  window._kalOpenLessonId = lid != null ? String(lid) : ''

  const enrBadge = document.getElementById('kal-enrolled')
  const bEnr     = document.getElementById('kal-btns-enr')
  const bFree    = document.getElementById('kal-btns-free')
  const rezBtn   = document.getElementById('kal-rez-btn')

  if (enrBadge) enrBadge.style.display = enrolled ? 'inline-block' : 'none'
  if (bEnr)     bEnr.style.display     = enrolled ? 'block' : 'none'
  if (bFree)    bFree.style.display    = enrolled ? 'none'  : 'grid'
  if (rezBtn) {
    rezBtn.style.background = color
    rezBtn.textContent = lang === 'cs' ? 'Rezervovat' : 'Book'
    rezBtn.onclick = () => {
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
    window.showToast?.(lang === 'cs' ? 'Nelze zrušit rezervaci (chybí lekce).' : 'Cannot cancel (no lesson).', 'error')
    return
  }
  try {
    const { data, error } = await sb
      .from('bookings')
      .select('id')
      .eq('user_id', currentUser.id)
      .eq('lesson_id', lid)
      .eq('status', 'booked')
      .maybeSingle()
    if (error) throw error
    if (!data?.id) {
      window.showToast?.(lang === 'cs' ? 'Aktivní rezervace nenalezena.' : 'No active booking found.', 'error')
      return
    }
    const { error: uErr } = await sb
      .from('bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', data.id)
    if (uErr) throw uErr

    window.showToast?.(lang === 'cs' ? 'Rezervace byla zrušena.' : 'Booking cancelled.', 'ok')
    const pop = document.getElementById('pop-kal')
    if (pop) pop.style.display = 'none'
    await Promise.all([fetchUpcomingLessons(), fetchLessons()])
    renderKurzy()
    renderKalendar()
    window.refreshUserBookings?.()
  } catch (err) {
    console.error('[cancelBookingFromPopup]', err)
    window.showToast?.((lang === 'cs' ? 'Chyba: ' : 'Error: ') + (err.message ?? err), 'error')
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
        ${lang === 'cs' ? 'Žádné aktivní kurzy' : 'No active courses'}
      </div>`)
    return
  }

  window.AppState.courses.forEach(c => {
    const color    = c.color_code ?? '#2854B9'
    const title    = loc(c.title)
    const desc     = loc(c.description_short)
    const ownerName = Array.isArray(c.owner) ? c.owner[0]?.name : c.owner?.name
    const soldOut  = !window.AppState.upcomingLessons.some(l => l.course_id === c.id && l.available_spots > 0)
    const upcoming = window.AppState.upcomingLessons.filter(l => l.course_id === c.id).slice(0, 3)
    const pricePerEntry = c.price_single

    // Pre-select prvního dostupného termínu a jednorázový vstup
    const firstAvail = upcoming.find(l => l.available_spots > 0)
    window._cardState[c.id] = {
      lessonId:    firstAvail ? (firstAvail.lesson_id ?? firstAvail.id) : null,
      lessonIds:   [],
      paymentType: 'single',
      passId:      null,
    }

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
          <div class="cname">${title}</div>
          <div class="cmeta">
            <span class="cmi">${ownerName ?? '—'}</span>
            <span class="cmi">${c.capacity_default} míst</span>
            ${soldOut
              ? `<span class="badge" style="background:#fdeaea;color:#791F1F;">${lang === 'cs' ? 'plno' : 'full'}</span>`
              : `<span class="badge" style="background:#eaf5ea;color:#085041;">${lang === 'cs' ? 'volná místa' : 'spots available'}</span>`
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
          <div>
            ${buildCourseImage(c)}
            <div style="font-size:11px;color:#6b6b6b;line-height:1.6;margin-bottom:10px;">${desc}</div>
            <div class="blbl">${lang === 'cs' ? 'Nejbližší termíny' : 'Upcoming dates'}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
              ${buildTermPills(upcoming, color, c.id)}
            </div>
            <button class="btn-detail" onclick="openDetail('${c.id}')">
              ${lang === 'cs' ? 'Detail kurzu →' : 'Course detail →'}
            </button>
          </div>
          <div>
            <div class="blbl">${lang === 'cs' ? 'Koupit vstup' : 'Buy entry'}</div>
            ${buildBuyPanel(c, color)}
          </div>
        </div>
      </div>`

    container.appendChild(card)
  })
}

function buildCourseImage(c) {
  const url = courseImageUrls(c)[0] ?? null
  return url
    ? `<img src="${url}" style="width:100%;height:78px;object-fit:cover;border-radius:8px;margin-bottom:10px;" alt="" />`
    : `<div style="background:#F8F8F8;border-radius:8px;height:78px;display:flex;align-items:center;justify-content:center;margin-bottom:10px;font-size:10px;color:#9b9b9b;">
         ${lang === 'cs' ? 'foto kurzu' : 'course photo'}
       </div>`
}

function buildTermPills(upcoming, color, courseId) {
  if (!upcoming.length) {
    return `<span style="font-size:10px;color:#9b9b9b;">${lang === 'cs' ? 'Žádné termíny' : 'No dates available'}</span>`
  }
  const firstAvailIdx = upcoming.findIndex(l => l.available_spots > 0)
  return upcoming.map((l, i) => {
    const label = fmtLessonPill(l.start_time)
    const full  = l.available_spots <= 0
    const sel   = i === firstAvailIdx
    const lid   = l.lesson_id ?? l.id
    return `<span
      class="term-pill"
      data-lesson-id="${lid}"
      data-course-id="${courseId}"
      data-full="${full ? '1' : ''}"
      style="font-size:10px;padding:3px 9px;border-radius:20px;
             border:${sel ? `1.5px solid ${color}` : '0.5px solid rgba(0,0,0,.08)'};
             color:${sel ? color : '#6b6b6b'};
             cursor:${full ? 'default' : 'pointer'};
             ${full ? 'opacity:.5;' : ''}"
      ${!full ? `onclick="window.pickTerm(this,'${color}','${courseId}')"` : ''}
    >${label}${full ? ` (${lang === 'cs' ? 'plno' : 'full'})` : ''}</span>`
  }).join('')
}

function buildBuyPanel(c, color) {
  return `
    <div class="bo bo-pay"
      id="buy-single-${c.id}"
      style="border-color:${color};border-width:1.5px;"
      data-pay-type="single" data-color="${color}" data-course-id="${c.id}"
      onclick="window.selectPayment(this,'${c.id}','single',null)">
      <div class="brow">
        <span class="bnm">${lang === 'cs' ? 'Jednorázový vstup' : 'Single entry'}</span>
        <span style="font-size:11px;font-weight:500;color:${color};">${fmtPrice(c.price_single)}</span>
      </div>
      <div class="bsb">${lang === 'cs' ? 'Platí pro jednu lekci' : 'Valid for one lesson'}</div>
    </div>
    <div id="pass-panel-${c.id}"></div>
    <div id="card-pass-count-${c.id}" style="display:none;font-size:11px;color:#6b6b6b;margin:8px 0 2px;line-height:1.45;text-align:center;"></div>
    <div id="card-msg-${c.id}" style="display:none;border-radius:8px;padding:8px 12px;font-size:11px;text-align:center;margin-top:4px;"></div>
    <button class="btn-res" id="res-btn-${c.id}" style="background:${color};"
      onclick="window.reserveFromCard('${c.id}')">
      ${lang === 'cs' ? 'Rezervovat' : 'Book'}
    </button>`
}

// Lazy load platebních možností při rozbalení kurzu
async function loadPassesForCourse(courseId) {
  const panel     = document.getElementById(`pass-panel-${courseId}`)
  const singleDiv = document.getElementById(`buy-single-${courseId}`)
  if (!panel) return

  const c     = window.AppState.courses.find(x => x.id === courseId)
  const color = c?.color_code ?? '#2854B9'

  // ── 1. Aktivní permanentky uživatele platné pro tento kurz ──
  const ownedPasses = userPasses.filter(up => {
    if (up.entries_remaining <= 0) return false
    const ids = up.pass?.allowed_course_ids
    return !ids?.length || ids.includes(courseId)
  })

  if (ownedPasses.length > 0) {
    // Uživatel má permanentku → skryjeme jednorázový vstup, ukážeme pouze permanentky
    if (singleDiv) singleDiv.style.display = 'none'

    // Pre-select první permanentky
    window._cardState[courseId] = {
      ...(window._cardState[courseId] ?? {}),
      paymentType: 'pass',
      passId:      ownedPasses[0].id,
      lessonId:    null,
      lessonIds:   [],
    }

    panel.innerHTML = ownedPasses.map((up, i) => {
      const sel  = i === 0
      const name = loc(up.pass?.name ?? {})
      const exp  = up.expires_at
        ? new Date(up.expires_at).toLocaleDateString(lang === 'cs' ? 'cs-CZ' : 'en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' })
        : null
      return `
        <div class="bo bo-pay"
          style="${sel ? `border-color:${color};border-width:1.5px;` : 'border:0.5px solid rgba(0,0,0,.12);'}"
          data-pay-type="pass" data-color="${color}" data-course-id="${courseId}"
          onclick="window.selectPayment(this,'${courseId}','pass','${up.id}')">
          <div class="brow">
            <span class="bnm">${name}</span>
            <span style="font-size:11px;font-weight:600;color:${color};">${up.entries_remaining} ${lang === 'cs' ? 'vstupů' : 'entries'}</span>
          </div>
          <div class="bsb">${exp ? (lang === 'cs' ? `Platí do ${exp}` : `Valid until ${exp}`) : ''}</div>
        </div>`
    }).join('')
    document.querySelectorAll(`.term-pill[data-course-id="${courseId}"]`).forEach(p => {
      if (p.dataset.full === '1') return
      p.style.borderColor = 'rgba(0,0,0,.08)'
      p.style.borderWidth = '0.5px'
      p.style.color = '#6b6b6b'
    })
    _refreshCardPassSlotsRow(courseId)
    return
  }

  // ── 2. Uživatel nemá permanentku → ukážeme jednorázový vstup + nabídka koupě ──
  if (singleDiv) singleDiv.style.display = ''

  const { data, error } = await sb
    .from('passes')
    .select('id, name, entries_total, price, validity_weeks')
    .eq('is_active', true)
    .contains('allowed_course_ids', [courseId])

  if (error || !data?.length) { panel.innerHTML = ''; return }

  panel.innerHTML = data.map(p => {
    const name     = loc(p.name)
    const perEntry = fmtPrice(p.price / p.entries_total)
    return `
      <div class="bo" style="border:0.5px solid rgba(0,0,0,.08);">
        <div class="brow">
          <span class="bnm">${name}</span>
          <span style="font-size:11px;font-weight:500;color:${color};">${fmtPrice(p.price)}</span>
        </div>
        <div class="bsb" style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
          <span>${p.entries_total} ${lang === 'cs' ? 'vstupů' : 'entries'} · ${perEntry}/${lang === 'cs' ? 'vstup' : 'entry'}</span>
          <button
            id="buy-btn-${p.id}"
            style="font-size:10px;padding:3px 9px;border-radius:6px;
                   border:1px solid ${color};color:${color};
                   background:transparent;cursor:pointer;white-space:nowrap;"
            onclick="event.stopPropagation();window.buyPass('${p.id}',${p.entries_total},${p.price},'${courseId}',this)">
            ${lang === 'cs' ? 'Koupit' : 'Buy'}
          </button>
        </div>
      </div>`
  }).join('')
}

window.buyPass = async (passId, entriesTotal, price, courseId, btn) => {
  if (!currentUser) { window.openAuthPopup?.(); return }

  if (btn) { btn.disabled = true; btn.textContent = lang === 'cs' ? 'Kupuji…' : 'Buying…' }

  try {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + (entriesTotal + 2) * 7)

    const { error } = await sb.from('user_passes').insert({
      user_id:           currentUser.id,
      pass_id:           passId,
      entries_total:     entriesTotal,
      entries_remaining: entriesTotal,
      price_paid:        price,
      expires_at:        expiresAt.toISOString(),
      status:            'active',
    })
    if (error) throw error

    await loadUserPasses(currentUser.id)
    await loadPassesForCourse(courseId)
    window.showToast?.(lang === 'cs' ? '✓ Permanentka zakoupena.' : '✓ Pass purchased.', 'ok')
  } catch (err) {
    console.error('[buyPass]', err)
    window.showToast?.(
      (lang === 'cs' ? 'Chyba při nákupu: ' : 'Purchase error: ') + (err.message ?? err),
      'error',
    )
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = lang === 'cs' ? 'Koupit' : 'Buy' }
  }
}

window.toggleC = id => {
  const exp  = document.getElementById('cx-' + id)
  const chev = document.getElementById('cv-' + id)
  if (!exp) return
  const wasOpen = exp.classList.contains('on')
  document.querySelectorAll('.cex').forEach(e => e.classList.remove('on'))
  document.querySelectorAll('[id^="cv-"]').forEach(e => e.textContent = '›')
  if (!wasOpen) {
    exp.classList.add('on')
    if (chev) chev.textContent = '⌄'
    loadPassesForCourse(id)
  }
}

window.toggleML = id => {
  const exp = document.getElementById('ml-cx-' + id)
  if (!exp) return
  const wasOpen = exp.classList.contains('on')
  document.querySelectorAll('.ml-cx').forEach(e => e.classList.remove('on'))
  if (!wasOpen) exp.classList.add('on')
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
    _refreshPopupPassSlotsCounter()
  })
}

window._bkUpdateMultiBtnLabel = () => {
  const btn = document.getElementById('bk-confirm-btn')
  const payEl = document.getElementById('bk-payment-opts')
  if (!btn || !(payEl?.dataset.selected ?? '').startsWith('up-')) return
  const n = document.querySelectorAll('#bk-lesson-checkboxes input[name="bk-lesson-cb"]:checked').length
  btn.textContent = n
    ? (lang === 'cs' ? `Rezervovat vybrané (${n})` : `Book selected (${n})`)
    : (lang === 'cs' ? 'Rezervovat vybrané' : 'Book selected')
  _refreshPopupPassSlotsCounter()
}

/** Při platbě permanentkou: výběr více termínů (checkboxy), jinak klasický select. */
function _syncBkLessonPicker(course, courseLessons, preselectedLessonId) {
  const payEl = document.getElementById('bk-payment-opts')
  const payVal = payEl?.dataset.selected ?? 'single'
  const singleW = document.getElementById('bk-lesson-single-wrap')
  const multiW = document.getElementById('bk-lesson-multi-wrap')
  const hint = document.getElementById('bk-multi-hint')
  const btn = document.getElementById('bk-confirm-btn')
  const color = course?.color_code ?? '#2854B9'

  const isPass = payVal.startsWith('up-')
  const userPassId = isPass ? payVal.replace('up-', '') : null
  const up = userPassId ? userPasses.find(p => p.id === userPassId) : null

  if (!isPass || !up) {
    if (singleW) singleW.style.display = 'block'
    if (multiW) multiW.style.display = 'none'
    if (btn) {
      btn.textContent = lang === 'cs' ? 'Potvrdit rezervaci' : 'Confirm booking'
      btn.style.background = color
    }
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

  const pre = preselectedLessonId != null ? String(preselectedLessonId) : ''

  if (box) {
    box.innerHTML = bookable.length
      ? bookable.map(l => {
          const lid = String(l.lesson_id ?? l.id)
          const start = new Date(l.start_time)
          const end = new Date(l.end_time)
          const checked = pre && lid === pre ? ' checked' : ''
          return `<label style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:0.5px solid rgba(0,0,0,.06);cursor:pointer;">
            <input type="checkbox" name="bk-lesson-cb" value="${lid}"${checked} style="margin-top:3px;accent-color:${color};"/>
            <span style="font-size:12px;">${fmtDayFull(start)} · ${fmtTime(start)}–${fmtTime(end)} <span style="color:#6b6b6b;">(${l.available_spots} ${lang === 'cs' ? 'míst' : 'spots'})</span></span>
          </label>`
        }).join('')
      : `<div style="font-size:12px;color:#9b9b9b;">${lang === 'cs' ? 'Žádné volné termíny.' : 'No available slots.'}</div>`
  }

  if (hint) {
    const cap = Number(up.entries_remaining ?? 0) || 0
    hint.textContent = lang === 'cs'
      ? `Můžeš vybrat nejvýše ${cap} ${cap === 1 ? 'termín' : 'termínů'} (tolik zbývá na permanentce).`
      : `You may select up to ${cap} session(s) — matching your remaining pass entries.`
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

  window._bkUpdateMultiBtnLabel?.()
}

// ── Booking popup ─────────────────────────────────────────────
window.openBookingPopup = async (courseId, passId, preselectedLessonId) => {
  if (!currentUser) { window.openAuthPopup?.(); return }

  const course = window.AppState.courses.find(c => c.id === courseId)
  if (!course) return
  const color = course.color_code ?? '#2854B9'

  const popup = document.getElementById('pop-booking')
  if (!popup) return

  const bar = document.getElementById('bk-bar')
  if (bar) bar.style.background = color

  const nameEl = document.getElementById('bk-name')
  if (nameEl) nameEl.textContent = loc(course.title)

  // Termíny s volnými místy
  const courseLessons = window.AppState.upcomingLessons.filter(l => l.course_id === courseId && l.available_spots > 0)
  const lessonSel = document.getElementById('bk-lesson-select')
  if (lessonSel) {
    if (courseLessons.length) {
      lessonSel.innerHTML = courseLessons.map(l => {
        const start = new Date(l.start_time)
        const end   = new Date(l.end_time)
        const lid   = l.lesson_id ?? l.id
        return `<option value="${lid}" ${String(lid) === String(preselectedLessonId ?? '') ? 'selected' : ''}>
          ${fmtDayFull(start)} · ${fmtTime(start)}–${fmtTime(end)} (${l.available_spots}${lang === 'cs' ? ' míst' : ' spots'})</option>`
      }).join('')
    } else if (preselectedLessonId) {
      lessonSel.innerHTML = `<option value="${preselectedLessonId}">${lang === 'cs' ? 'Vybraná lekce' : 'Selected lesson'}</option>`
    } else {
      lessonSel.innerHTML = `<option value="">${lang === 'cs' ? 'Momentálně žádné volné termíny' : 'No available slots'}</option>`
    }
  }

  // Platební možnosti: jednorázový vstup + permanentky platné pro tento kurz
  const activePasses = userPasses.filter(up => {
    if (up.entries_remaining <= 0) return false
    const ids = up.pass?.allowed_course_ids
    return !ids?.length || ids.includes(courseId)
  })
  const preselectedUp = passId
    ? activePasses.find(up => up.pass?.id === passId || up.id === passId)
    : null
  const defaultPay = preselectedUp ? `up-${preselectedUp.id}` : 'single'

  const payEl = document.getElementById('bk-payment-opts')
  if (payEl) {
    payEl.dataset.selected  = defaultPay
    payEl.dataset.color     = color
    payEl.dataset.courseid  = courseId
    payEl.innerHTML = `
      <label class="bk-opt ${defaultPay === 'single' ? 'bk-opt-sel' : ''}"
             style="${defaultPay === 'single' ? `border-color:${color};border-width:1.5px;` : ''}"
             onclick="window._bkSelectPayment(this,'single')">
        <div class="bk-opt-radio ${defaultPay === 'single' ? 'on' : ''}"
             style="border-color:${color};${defaultPay === 'single' ? `background:${color};` : ''}"></div>
        <div style="flex:1;">
          <div class="bnm">${lang === 'cs' ? 'Jednorázový vstup' : 'Single entry'}</div>
          <div class="bsb">${fmtPrice(course.price_single)}</div>
        </div>
      </label>
      ${activePasses.map(up => {
        const sel = defaultPay === `up-${up.id}`
        return `
          <label class="bk-opt ${sel ? 'bk-opt-sel' : ''}"
                 style="${sel ? `border-color:${color};border-width:1.5px;` : ''}"
                 onclick="window._bkSelectPayment(this,'up-${up.id}')">
            <div class="bk-opt-radio ${sel ? 'on' : ''}"
                 style="border-color:${color};${sel ? `background:${color};` : ''}"></div>
            <div style="flex:1;">
              <div class="bnm">${loc(up.pass?.name ?? {})}</div>
              <div class="bsb">${up.entries_remaining} ${lang === 'cs' ? 'vstupů zbývá' : 'entries left'}</div>
            </div>
          </label>`
      }).join('')}
    `
  }

  const confirmBtn = document.getElementById('bk-confirm-btn')
  if (confirmBtn) {
    confirmBtn.style.background = color
    confirmBtn.disabled = false
    confirmBtn.textContent = lang === 'cs' ? 'Potvrdit rezervaci' : 'Confirm booking'
  }

  _syncBkLessonPicker(course, courseLessons, preselectedLessonId)

  popup.style.display = 'flex'
}

window._bkSelectPayment = (el, value) => {
  const payEl = document.getElementById('bk-payment-opts')
  if (!payEl) return
  const color = payEl.dataset.color ?? '#2854B9'
  payEl.dataset.selected = value
  payEl.querySelectorAll('.bk-opt').forEach(o => { o.classList.remove('bk-opt-sel'); o.style.borderColor = ''; o.style.borderWidth = '' })
  payEl.querySelectorAll('.bk-opt-radio').forEach(r => { r.classList.remove('on'); r.style.background = '' })
  el.classList.add('bk-opt-sel')
  el.style.borderColor = color
  el.style.borderWidth = '1.5px'
  const radio = el.querySelector('.bk-opt-radio')
  if (radio) { radio.classList.add('on'); radio.style.background = color }

  const courseId = payEl.dataset.courseid
  const course = window.AppState.courses.find(c => c.id === courseId)
  const selVal = document.getElementById('bk-lesson-select')?.value || ''
  const courseLessons = window.AppState.upcomingLessons.filter(
    l => l.course_id === courseId && l.available_spots > 0,
  )
  _syncBkLessonPicker(course, courseLessons, value.startsWith('up-') ? selVal : null)
}

window.confirmBooking = async () => {
  if (!currentUser?.id) { window.openAuthPopup?.(); return }

  const confirmBtn = document.getElementById('bk-confirm-btn')
  if (confirmBtn?.disabled) return

  const payEl    = document.getElementById('bk-payment-opts')
  const payVal   = payEl?.dataset.selected ?? 'single'
  const courseId = payEl?.dataset.courseid
  const course   = window.AppState.courses.find(c => c.id === courseId)

  const isPass     = payVal.startsWith('up-')
  const userPassId = isPass ? payVal.replace('up-', '') : null
  const pricePaid  = isPass ? 0 : (course?.price_single ?? 0)

  /** Obnoví text tlačítka podle aktuálního režimu výběru. */
  const resetBtn = () => {
    if (!confirmBtn) return
    confirmBtn.disabled = false
    confirmBtn.style.pointerEvents = ''
    if (isPass) window._bkUpdateMultiBtnLabel?.()
    else confirmBtn.textContent = lang === 'cs' ? 'Potvrdit rezervaci' : 'Confirm booking'
  }

  let lessonIds = []
  if (isPass && userPassId) {
    lessonIds = [...document.querySelectorAll('#bk-lesson-checkboxes input[name="bk-lesson-cb"]:checked')].map(cb => cb.value)
    if (!lessonIds.length) {
      window.showToast?.(lang === 'cs' ? 'Vyberte alespoň jeden termín.' : 'Select at least one session.', 'error')
      return
    }
  } else {
    const lessonId = document.getElementById('bk-lesson-select')?.value
    if (!lessonId) {
      window.showToast?.(lang === 'cs' ? 'Vyberte prosím termín.' : 'Please select a session.', 'error')
      return
    }
    lessonIds = [lessonId]
  }

  console.log('[Booking] Popup reserve start', { lessonIds, payVal, courseId })
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.style.pointerEvents = 'none'; confirmBtn.textContent = lang === 'cs' ? 'Rezervuji…' : 'Booking…' }

  try {
    if (isPass && userPassId) {
      const passRow = userPasses.find(p => p.id === userPassId)
      if (!passRow || passRow.entries_remaining < lessonIds.length) {
        window.showToast?.(
          lang === 'cs' ? PASS_ENTRIES_LIMIT_HINT_CS : PASS_ENTRIES_LIMIT_HINT_EN,
          'error',
        )
        resetBtn()
        return
      }
      const allowed = passRow.pass?.allowed_course_ids
      for (const lid of lessonIds) {
        const les = window.AppState.upcomingLessons.find(l => String(l.lesson_id ?? l.id) === String(lid))
        if (!les || les.available_spots <= 0 || isEnrolled(lid)) {
          window.showToast?.(lang === 'cs' ? 'Některý termín už není k dispozici.' : 'A session is no longer available.', 'error')
          resetBtn()
          return
        }
        if (allowed?.length && !allowed.includes(les.course_id)) {
          window.showToast?.(lang === 'cs' ? 'Permanentka neplatí pro tento kurz.' : 'Pass is not valid for this course.', 'error')
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
          status:       'booked',
          user_pass_id: userPassId,
        })
        if (error) throw error
      }
    } else {
      const lesson_id = lessonIds[0]
      const { error } = await sb.from('bookings').insert({
        user_id:      currentUser.id,
        lesson_id,
        payment_type: 'single',
        price_paid:   pricePaid,
        status:       'booked',
      })
      if (error) throw error
    }

    console.log('[Booking] Popup rezervace úspěšná', lessonIds)
    document.getElementById('pop-booking').style.display = 'none'
    const n = lessonIds.length
    window.showToast?.(
      lang === 'cs'
        ? (n > 1 ? `✓ Rezervováno ${n} lekcí.` : '✓ Lekce rezervována!')
        : (n > 1 ? `✓ ${n} bookings confirmed!` : '✓ Booking confirmed!'),
      'ok',
    )

    await Promise.all([fetchUpcomingLessons(), fetchLessons()])
    renderKurzy()
    renderKalendar()
    window.refreshUserBookings?.()
  } catch (err) {
    console.error('[Booking] Popup rezervace selhala:', err)
    window.showToast?.((lang === 'cs' ? 'Chyba: ' : 'Error: ') + (err.message ?? err), 'error')
  } finally {
    resetBtn()
  }
}

// ── Galerie + lightbox (fotky z courses.images) ───────────────
function ensureCourseGalleryLightbox() {
  if (document.getElementById('course-gallery-lightbox')) {
    const cbtn = document.getElementById('course-gallery-lb-close')
    if (cbtn) cbtn.textContent = lang === 'cs' ? 'Zavřít' : 'Close'
    return
  }
  document.body.insertAdjacentHTML('beforeend', `
    <div id="course-gallery-lightbox" class="course-gallery-lb" style="display:none;" role="dialog" aria-modal="true">
      <button type="button" class="course-gallery-lb-close" id="course-gallery-lb-close">${lang === 'cs' ? 'Zavřít' : 'Close'}</button>
      <div class="course-gallery-lb-shell">
        <button type="button" class="course-gallery-lb-arrow course-gallery-lb-prev" id="course-gallery-lb-prev" aria-label="Předchozí fotografie">‹</button>
        <div class="course-gallery-lb-imgwrap"><img id="course-gallery-lb-img" class="course-gallery-lb-img" alt="" /></div>
        <button type="button" class="course-gallery-lb-arrow course-gallery-lb-next" id="course-gallery-lb-next" aria-label="Další fotografie">›</button>
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

// ── Otevření detailu kurzu ────────────────────────────────────
window.openDetail = (courseId) => {
  window._detailCourseId = courseId
  window.nav?.('detail-kurzu')
}

async function renderCourseDetail(courseId) {
  const el = document.getElementById('detail-kurzu-content')
  if (!el) return
  const course = window.AppState.courses.find(c => c.id === courseId)
  if (!course) { el.innerHTML = `<div class="empty">Kurz nenalezen.</div>`; return }

  const color     = course.color_code ?? '#2854B9'
  const title     = loc(course.title)
  const descShort = loc(course.description_short)
  const descLong  = loc(course.description_long)
  const descLongBlock = _formatCourseDetailLong(descLong)
  const imageUrls = courseImageUrls(course)
  const ownerName = Array.isArray(course.owner) ? course.owner[0]?.name : course.owner?.name
  const upcoming  = window.AppState.upcomingLessons.filter(l => l.course_id === courseId).slice(0, 3)

  const ownedForDetail = userPasses.filter(up => {
    if (up.entries_remaining <= 0) return false
    const ids = up.pass?.allowed_course_ids
    return !ids?.length || ids.includes(courseId)
  })
  if (ownedForDetail.length) {
    window._cardState[courseId] = {
      lessonId: null,
      lessonIds: [],
      paymentType: 'pass',
      passId: ownedForDetail[0].id,
    }
  } else {
    const firstAvailD = upcoming.find(l => l.available_spots > 0)
    window._cardState[courseId] = {
      lessonId: firstAvailD ? (firstAvailD.lesson_id ?? firstAvailD.id) : null,
      lessonIds: [],
      paymentType: 'single',
      passId: null,
    }
  }

  const DAYS_CS = ['Po','Út','St','Čt','Pá','So','Ne']
  const scheduleDays = (course.schedule_days ?? []).map(d => DAYS_CS[d]).join(', ')
  const durMin = _calcDurMin(course.schedule_time_start, course.schedule_time_end)

  let passes = []
  try {
    const res = await sb
      .from('passes')
      .select('id, name, price, entries_total')
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

  el.innerHTML = `
    <div style="max-width:760px;">
      <button class="btn-wide" onclick="window.nav?.('kurzy')" style="margin-bottom:16px;">
        ‹ ${lang === 'cs' ? 'Zpět na kurzy' : 'Back to courses'}
      </button>
      <div style="height:4px;background:${color};border-radius:99px;margin-bottom:16px;"></div>

      ${heroImg
        ? `<img src="${heroImg}" class="detail-hero" alt="${title}" />`
        : `<div class="detail-hero-ph">${lang === 'cs' ? 'foto kurzu' : 'course photo'}</div>`}

      <div style="font-size:22px;font-weight:700;margin-bottom:4px;">${title}</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:12px;">
        ${ownerName ?? '—'}${scheduleDays ? ' · ' + scheduleDays : ''}
      </div>

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">
        ${durMin ? `<span style="font-size:12px;padding:5px 10px;border-radius:99px;background:var(--muted-surface);">${durMin} min</span>` : ''}
        <span style="font-size:12px;padding:5px 10px;border-radius:99px;background:var(--muted-surface);">${course.capacity_default} ${lang === 'cs' ? 'míst' : 'spots'}</span>
        ${upcoming.length ? `<span style="font-size:12px;padding:5px 10px;border-radius:99px;background:#eaf5ea;color:#085041;">${upcoming[0].available_spots} ${lang === 'cs' ? 'volných' : 'free'}</span>` : ''}
        <span style="font-size:12px;padding:5px 10px;border-radius:99px;background:var(--primary-100);color:var(--primary);font-weight:600;">${fmtPrice(course.price_single)} / ${lang === 'cs' ? 'vstup' : 'entry'}</span>
      </div>

      ${descShort ? `<p style="font-size:13px;color:var(--course-detail-anno);line-height:1.7;margin-bottom:${descLongBlock ? '10' : '16'}px;">${descShort}</p>` : ''}
      ${descLongBlock ? `<div style="font-size:14px;line-height:1.75;margin-bottom:${descLongBlock ? '20' : '16'}px;">${descLongBlock}</div>` : ''}

      ${galleryThumbUrls.length ? `
        <div class="detail-gallery-section">
          <div class="blbl" style="margin-bottom:10px;">${lang === 'cs' ? 'Galerie' : 'Gallery'}</div>
          <div class="detail-gallery-grid">
            ${galleryThumbUrls.map((u, thumbIdx) => {
              const fullIdx = thumbIdx + 1
              return `
              <button type="button" class="detail-gallery-cell"
                aria-label="${lang === 'cs' ? 'Zvětšit fotografii' : 'Enlarge photo'} ${fullIdx + 1}"
                onclick="window.openCourseGalleryLightbox?.('${courseId}', ${fullIdx})">
                <span class="detail-gallery-cell-frame"><img src="${u}" alt="" loading="lazy" /></span>
              </button>`
            }).join('')}
          </div>
        </div>` : ''}

      <div class="detail-info-table">
        <div class="detail-info-row"><span class="lbl">${lang === 'cs' ? 'Lektor/ka' : 'Instructor'}</span><span class="val">${ownerName ?? '—'}</span></div>
        ${scheduleDays ? `<div class="detail-info-row"><span class="lbl">${lang === 'cs' ? 'Termíny' : 'Schedule'}</span><span class="val">${scheduleDays}</span></div>` : ''}
        ${(passes ?? []).map(p => `<div class="detail-info-row"><span class="lbl">${loc(p.name)}</span><span class="val">${fmtPrice(p.price)}</span></div>`).join('')}
        <div class="detail-info-row"><span class="lbl">${lang === 'cs' ? 'Storno zdarma' : 'Free cancellation'}</span><span class="val">${course.cancellation_hours}h ${lang === 'cs' ? 'předem' : 'ahead'}</span></div>
      </div>

      ${upcoming.length ? `
        <div style="margin-top:18px;">
          <div class="blbl" style="margin-bottom:8px;">${lang === 'cs' ? 'Nejbližší termíny' : 'Upcoming dates'}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">${buildTermPills(upcoming, color, courseId)}</div>
          <div id="detail-pass-indicator-${courseId}" style="display:none;font-size:12px;color:var(--muted);margin-top:12px;line-height:1.45;"></div>
        </div>` : ''}

      ${upcoming.some(l => l.available_spots > 0)
        ? `<button class="btn-res" style="background:${color};width:100%;padding:14px;border-radius:12px;border:none;font-size:15px;font-weight:600;cursor:pointer;margin-top:20px;"
             onclick="window.openBookingPopup?.('${courseId}')">
             ${lang === 'cs' ? 'Rezervovat' : 'Book'}
           </button>`
        : `<div style="margin-top:20px;text-align:center;font-size:13px;color:#791F1F;background:#fdeaea;padding:12px;border-radius:10px;">
             ${lang === 'cs' ? 'Lekce je plně obsazena.' : 'All sessions are full.'}
           </div>`}
    </div>`

  _refreshDetailPassSlotsRow(courseId)
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
      btn.textContent = n
        ? (lang === 'cs' ? `Rezervovat vybrané (${n})` : `Book selected (${n})`)
        : (lang === 'cs' ? 'Rezervovat' : 'Book')
    }
    _refreshCardPassSlotsRow(courseId)
    _refreshDetailPassSlotsRow(courseId)
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

window.selectPayment = (el, courseId, type, passId) => {
  const color = el.dataset.color ?? '#2854B9'
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
  window._cardState[courseId] = {
    ...prev,
    paymentType: type,
    passId:      passId ?? null,
    lessonIds:   nextLessonIds,
  }
  if (type === 'single') {
    const upcoming = window.AppState.upcomingLessons.filter(l => l.course_id === courseId)
    const firstAvail = upcoming.find(l => l.available_spots > 0)
    window._cardState[courseId].lessonId = firstAvail ? (firstAvail.lesson_id ?? firstAvail.id) : null
    window._cardState[courseId].lessonIds = []
  } else {
    window._cardState[courseId].lessonId = null
  }

  document.querySelectorAll(`.term-pill[data-course-id="${courseId}"]`).forEach(p => {
    if (p.dataset.full === '1') return
    const id = p.dataset.lessonId
    const ids = window._cardState[courseId].lessonIds ?? []
    const sel = type === 'pass' && ids.includes(id)
    p.style.borderColor = sel ? color : 'rgba(0,0,0,.08)'
    p.style.borderWidth = sel ? '1.5px' : '0.5px'
    p.style.color = sel ? color : '#6b6b6b'
  })

  const btn = document.getElementById(`res-btn-${courseId}`)
  const n = (window._cardState[courseId].lessonIds ?? []).length
  if (btn) {
    btn.textContent = type === 'pass' && n
      ? (lang === 'cs' ? `Rezervovat vybrané (${n})` : `Book selected (${n})`)
      : (lang === 'cs' ? 'Rezervovat' : 'Book')
  }
  _refreshCardPassSlotsRow(courseId)
  _refreshDetailPassSlotsRow(courseId)
}

window.reserveFromCard = async (courseId) => {
  if (!currentUser) { window.openAuthPopup?.(); return }

  const btn = document.getElementById(`res-btn-${courseId}`)
  if (btn?.disabled) return  // Prevence duplicitního kliknutí

  const state         = window._cardState?.[courseId] ?? {}
  const lessonId      = state.lessonId
  const lessonIdsMulti = state.paymentType === 'pass' && state.passId && Array.isArray(state.lessonIds) && state.lessonIds.length
    ? state.lessonIds
    : null
  const paymentType = state.paymentType ?? 'single'
  const passId      = state.passId ?? null

  if (!lessonIdsMulti && !lessonId) {
    showCardMsg(courseId, lang === 'cs' ? 'Vyberte prosím termín.' : 'Please select a date.', 'warn')
    return
  }

  const course    = window.AppState.courses.find(c => c.id === courseId)
  const isPass    = paymentType === 'pass'
  const pricePaid = isPass ? 0 : (course?.price_single ?? 0)

  let toBook = lessonIdsMulti ?? [lessonId]

  if (isPass && passId) {
    const passRow = userPasses.find(p => p.id === passId)
    if (!passRow || passRow.entries_remaining < toBook.length) {
      showCardMsg(courseId, lang === 'cs' ? PASS_ENTRIES_LIMIT_HINT_CS : PASS_ENTRIES_LIMIT_HINT_EN, 'warn')
      return
    }
    const allowed = passRow.pass?.allowed_course_ids
    for (const lid of toBook) {
      const lesson = window.AppState.upcomingLessons.find(l => String(l.lesson_id ?? l.id) === String(lid))
      if (!lesson || lesson.available_spots <= 0 || isEnrolled(lid)) {
        showCardMsg(courseId, lang === 'cs' ? 'Některý termín není dostupný.' : 'A session is not available.', 'warn')
        return
      }
      if (allowed?.length && !allowed.includes(lesson.course_id)) {
        showCardMsg(courseId, lang === 'cs' ? 'Permanentka neplatí pro tento kurz.' : 'Pass not valid for this course.', 'warn')
        return
      }
    }
  } else {
    const lesson = window.AppState.upcomingLessons.find(l => String(l.lesson_id ?? l.id) === String(lessonId))
    if (!lesson || lesson.available_spots <= 0) {
      showCardMsg(courseId, lang === 'cs' ? 'Tento termín je plně obsazen.' : 'This session is full.', 'warn')
      return
    }
    toBook = [lessonId]
  }

  console.log('[Booking] Start reserve', { courseId, toBook, paymentType })
  if (btn) { btn.disabled = true; btn.style.pointerEvents = 'none'; btn.textContent = lang === 'cs' ? 'Rezervuji…' : 'Booking…' }

  try {
    if (isPass && passId) {
      for (const lid of toBook) {
        const { error } = await sb.from('bookings').insert({
          user_id:      currentUser.id,
          lesson_id:    lid,
          payment_type: 'pass',
          price_paid:   0,
          status:       'booked',
          user_pass_id: passId,
        })
        if (error) throw error
      }
    } else {
      const { error } = await sb.from('bookings').insert({
        user_id:      currentUser.id,
        lesson_id:    toBook[0],
        payment_type: 'single',
        price_paid:   pricePaid,
        status:       'booked',
      })
      if (error) throw error
    }

    console.log('[Booking] Rezervace úspěšná', courseId)
    const msg = toBook.length > 1 && isPass
      ? (lang === 'cs' ? `✓ Rezervováno ${toBook.length} lekcí!` : `✓ ${toBook.length} bookings confirmed!`)
      : (lang === 'cs' ? '✓ Místo máš rezervované!' : '✓ Booking confirmed!')
    showCardMsg(courseId, msg, 'ok')
    await Promise.all([fetchUpcomingLessons(), fetchLessons()])
    setTimeout(() => { renderKurzy(); renderKalendar(); window.refreshUserBookings?.() }, 1200)
  } catch (err) {
    console.error('[Booking] Rezervace selhala:', err)
    showCardMsg(courseId, (lang === 'cs' ? 'Chyba: ' : 'Error: ') + (err.message ?? err), 'warn')
  } finally {
    if (btn) {
      btn.disabled = false
      btn.style.pointerEvents = ''
      const st = window._cardState?.[courseId] ?? {}
      const n = st.paymentType === 'pass' && Array.isArray(st.lessonIds) ? st.lessonIds.length : 0
      btn.textContent = n && st.paymentType === 'pass'
        ? (lang === 'cs' ? `Rezervovat vybrané (${n})` : `Book selected (${n})`)
        : (lang === 'cs' ? 'Rezervovat' : 'Book')
    }
  }
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
async function buildMojeLekceMarkup() {
  const { data: myCourses } = await sb.from('courses')
    .select('id, title, color_code, is_workshop, description_short, images')
    .eq('owner_id', currentUser.id)
    .eq('is_active', true)

  if (!myCourses?.length) {
    return `<div class="sec-title">Moje lekce</div>
      <div class="empty">Zatím nemáte přiřazeny žádné kurzy ani workshopy.</div>`
  }

  const courseMap = Object.fromEntries(myCourses.map(c => [c.id, normalizeCourseRecord(c)]))
  const courseIds = myCourses.map(c => c.id)

  const { data: upcoming } = await sb.from('lesson_availability')
    .select('lesson_id, course_id, start_time, end_time, capacity, booked_count, available_spots')
    .in('course_id', courseIds)
    .gte('start_time', new Date().toISOString())
    .eq('status', 'active')
    .order('start_time')
    .limit(60)

  if (!upcoming?.length) {
    return `<div class="sec-title">Moje lekce</div>
      <div class="empty">Žádné nadcházející termíny.</div>`
  }

  return `
    <div class="sec-title">Moje lekce</div>
    <div style="font-size:12px;color:#6b6b6b;margin-bottom:16px;">${upcoming.length} nadcházejících termínů</div>
    ${upcoming.map(l => {
      const course  = courseMap[l.course_id]
      const color   = course?.color_code ?? '#2854B9'
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
      return `
          <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:8px;background:#fff;">
            <div style="display:flex;cursor:pointer;" onclick="window.toggleML('${lid}')">
              <div style="width:5px;background:${color};flex-shrink:0;"></div>
              <div style="flex:1;padding:12px 14px;display:flex;align-items:center;gap:12px;">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${title}${course?.is_workshop ? ' <span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:20px;background:#FFF4E0;color:#8B5C00;">WORKSHOP</span>' : ''}
                  </div>
                  <div style="font-size:11px;color:#6b6b6b;">${dateStr} · ${timeStr}</div>
                </div>
                <div style="flex-shrink:0;text-align:right;min-width:60px;">
                  <div style="font-size:13px;font-weight:600;">${booked}/${cap}</div>
                  <div style="font-size:10px;color:#9b9b9b;margin-bottom:4px;">obsazeno</div>
                  <div style="width:60px;height:4px;background:rgba(0,0,0,.08);border-radius:99px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:${color};border-radius:99px;"></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="ml-cx" id="ml-cx-${lid}">
              <div style="padding:0 14px 14px 19px;display:grid;grid-template-columns:${imgUrl ? '80px 1fr' : '1fr'};gap:12px;align-items:start;">
                ${imgUrl ? `<img src="${imgUrl}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;" alt="" />` : ''}
                <div>
                  ${desc ? `<div style="font-size:12px;color:#6b6b6b;line-height:1.6;margin-bottom:8px;">${desc}</div>` : ''}
                  <button class="btn-detail" onclick="window.openDetail('${l.course_id}')">
                    ${lang === 'cs' ? 'Detail kurzu →' : 'Course detail →'}
                  </button>
                </div>
              </div>
            </div>
          </div>`
    }).join('')}
  `
}

async function renderMojeLekce() {
  const el = document.getElementById('screen-moje-lekce')
  if (!el) return

  if (!currentUser) {
    el.innerHTML = `<div class="sec-title">Moje lekce</div><div class="empty">Přihlaste se.</div>`
    return
  }

  window._renderMojeLekceSeq = (window._renderMojeLekceSeq ?? 0) + 1
  const seq = window._renderMojeLekceSeq

  el.innerHTML = `<div class="sec-title">Moje lekce</div><div class="empty" style="padding:40px;">Načítám…</div>`

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
    applyHtml(`<div class="sec-title">Moje lekce</div><div class="empty">Chyba při načítání (detail v konzoli).</div>`)
  }
}

window.renderMojeLekce = renderMojeLekce

// ── Navigace: index.html volá globální `nav()` → __appNavHooks na konci těla ──
;(window.__appNavHooks ??= []).push((id) => {
  console.log('[Debug] __appNavHooks (atelier-data): lokální render pro', id)
  if (id === 'kurzy')        renderKurzy()
  if (id === 'kalendar')     renderKalendar()
  if (id === 'moje-lekce')   void renderMojeLekce()
  if (id === 'detail-kurzu') renderCourseDetail(window._detailCourseId)
})

// ── Spuštění ─────────────────────────────────────────────────
init()
