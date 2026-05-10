// ============================================================
// atelier-admin.js — Admin sekce: Dashboard, Kurzy, Zákazníci, Platby, Permanentky
// ============================================================

import { sb } from './atelier-supabase.js'
import { currentUser } from './atelier_auth.js'

// ── Konstanty ─────────────────────────────────────────────────
const PRESET_COLORS = [
  '#2854B9', '#E05C5C', '#4CAF50', '#FF9800', '#9C27B0',
  '#00BCD4', '#795548', '#607D8B', '#E91E63', '#FF5722',
]
const DAYS_CS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']

// ── Stav modálů ──────────────────────────────────────────────
let _ncSelectedDays  = new Set()
let _ncSelectedColor = PRESET_COLORS[0]
let _wsSelectedColor = PRESET_COLORS[0]
let _ncExistingImages = []
let _ncNewFiles       = []
let _mwExistingImages = []
let _mwNewFiles       = []

const MAX_COURSE_PHOTOS = 4
const MAX_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024
const COMPRESS_OVER_BYTES = 5 * 1024 * 1024

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

// ── Admin Dashboard ──────────────────────────────────────────
export async function renderAdminDashboard() {
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
      { data: monthPasses },
      { count: activePasses },
      { data: monthBookings },
    ] = await Promise.all([
      sb.from('lesson_availability')
        .select('lesson_id, course_id, start_time, end_time, capacity, booked_count, available_spots')
        .gte('start_time', today.toISOString()).lt('start_time', tomorrow.toISOString())
        .eq('status', 'active').order('start_time'),
      sb.from('lesson_availability')
        .select('lesson_id, course_id, start_time, end_time, capacity, booked_count, available_spots')
        .gte('start_time', tomorrow.toISOString()).lt('start_time', weekEnd.toISOString())
        .eq('status', 'active').order('start_time'),
      sb.from('user_passes').select('price_paid').gte('created_at', monthStart.toISOString()),
      sb.from('user_passes').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      sb.from('bookings').select('price_paid').eq('payment_type', 'single').eq('status', 'booked')
        .gte('created_at', monthStart.toISOString()),
    ])

    const courseMap = await fetchCoursesMap()
    const enrich = rows => (rows ?? []).map(l => ({ ...l, course: courseMap[l.course_id] }))
    const todayLessons = enrich(todayAvail)
    const weekLessons  = enrich(weekAvail)

    const totalCap    = todayLessons.reduce((s, l) => s + (l.capacity ?? 0), 0)
    const totalBooked = todayLessons.reduce((s, l) => s + (Number(l.booked_count) || 0), 0)
    const occupancy   = totalCap > 0 ? Math.round((totalBooked / totalCap) * 100) : 0
    const monthRev    = (monthPasses ?? []).reduce((s, p) => s + Number(p.price_paid || 0), 0)
                      + (monthBookings ?? []).reduce((s, b) => s + Number(b.price_paid || 0), 0)

    el.innerHTML = `
      <div class="page-title" style="margin-bottom:16px;">Dashboard</div>
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
          <div class="admin-stat-value" style="font-size:18px;">${fmtPrice(monthRev)}</div>
          <div class="admin-stat-label">Příjmy tento měsíc</div>
        </div>
        <div class="admin-stat-card">
          <div class="admin-stat-value">${activePasses ?? 0}</div>
          <div class="admin-stat-label">Aktivní permanentky</div>
        </div>
      </div>
      <div class="admin-section-title">Dnešní lekce</div>
      ${todayLessons.length ? todayLessons.map(l => _lessonRow(l)).join('') : `<div class="empty">Dnes nejsou žádné lekce.</div>`}
      <div class="admin-section-title" style="margin-top:20px;">Nadcházející tento týden</div>
      ${weekLessons.length ? weekLessons.map(l => _lessonRow(l, true)).join('') : `<div class="empty">Tento týden nejsou další lekce.</div>`}
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

function _lessonRow(lesson, showDate = false) {
  const color  = lesson.course?.color_code ?? '#2854B9'
  const title  = loc(lesson.course?.title) || 'Lekce'
  const booked = Number(lesson.booked_count || 0)
  const cap    = lesson.capacity ?? 0
  const pct    = cap > 0 ? Math.round((booked / cap) * 100) : 0
  const timeStr = fmtTimeOnly(lesson.start_time)
  const dateStr = new Date(lesson.start_time).toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' })
  return `
    <div class="admin-lesson-row">
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
        <button type="button" class="btn-small admin-dash-act" style="font-size:11px;padding:6px 10px;"
          data-admin-lesson-act="attendees" data-lesson-id="${esc(String(lesson.lesson_id ?? lesson.id))}">Účastníci</button>
        <button type="button" class="btn-small danger admin-dash-act" style="font-size:11px;padding:6px 10px;"
          data-admin-lesson-act="cancel" data-lesson-id="${esc(String(lesson.lesson_id ?? lesson.id))}">Zrušit lekci</button>
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
    const { data: courses, error } = await sb.from('courses')
      .select('id, title, color_code, is_active, is_workshop, capacity_default, price_single, cancellation_hours, owner:users!owner_id(id,name)')
      .order('title->cs')
    if (error) throw error
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div class="page-title">Kurzy</div>
        <div style="display:flex;gap:8px;">
          <button class="btn-small" onclick="window.adminNewWorkshop?.()">+ Nový workshop</button>
          <button class="btn-small" onclick="window.adminNewCourse?.()">+ Nový kurz</button>
        </div>
      </div>
      ${courses?.length ? courses.map(_courseCard).join('') : `<div class="empty">Žádné kurzy. Vytvořte první kliknutím na tlačítko výše.</div>`}
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
    <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:10px;background:#fff;display:flex;">
      <div style="width:5px;background:${color};flex-shrink:0;"></div>
      <div style="flex:1;padding:14px 16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div>
            <div style="font-size:14px;font-weight:600;margin-bottom:5px;display:flex;align-items:center;gap:8px;">
              ${esc(title)}
              ${isWorkshop ? `<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;background:#FFF4E0;color:#8B5C00;letter-spacing:.04em;">WORKSHOP</span>` : ''}
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
          <button class="btn-small" onclick="window.${editFn}?.('${esc(course.id)}')">Upravit</button>
          ${active
            ? `<button class="btn-small danger" onclick="window.adminToggleCourse?.('${esc(course.id)}',false)">Deaktivovat</button>`
            : `<button class="btn-small" onclick="window.adminToggleCourse?.('${esc(course.id)}',true)">Aktivovat</button>`}
        </div>
      </div>
    </div>`
}

// ── Admin Zákazníci ──────────────────────────────────────────
export async function renderAdminZakaznici() {
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
      .not('email', 'like', 'deleted_%@%').order('name')
    if (error) throw error

    const userIds = (users ?? []).map(u => u.id)
    let bookingMap = {}, lastMap = {}, passMap = {}
    if (userIds.length > 0) {
      const [{ data: bookings }, { data: passes }] = await Promise.all([
        sb.from('bookings').select('user_id, lesson:lessons(start_time)').in('user_id', userIds).eq('status', 'booked'),
        sb.from('user_passes').select('user_id, pass:passes(name,allowed_course_ids)').in('user_id', userIds).eq('status', 'active'),
      ])
      ;(bookings ?? []).forEach(b => {
        bookingMap[b.user_id] = (bookingMap[b.user_id] ?? 0) + 1
        const t = b.lesson?.start_time
        if (t && (!lastMap[b.user_id] || t > lastMap[b.user_id])) lastMap[b.user_id] = t
      })
      ;(passes ?? []).forEach(up => {
        if (!passMap[up.user_id]) passMap[up.user_id] = []
        passMap[up.user_id].push(up)
      })
    }
    el.innerHTML = `
      <div class="page-title" style="margin-bottom:8px;">Zákazníci</div>
      <div style="font-size:12px;color:#6b6b6b;margin-bottom:16px;">${users?.length ?? 0} zákazníků</div>
      ${users?.length ? `
        <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;">
          ${users.map(u => _zakaznikRow(u, bookingMap, lastMap, passMap)).join('')}
        </div>
      ` : `<div class="empty">Žádní zákazníci.</div>`}
    `
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

function _zakaznikRow(user, bookingMap, lastMap, passMap) {
  const count = bookingMap[user.id] ?? 0
  const last  = lastMap[user.id]
  const passes = passMap[user.id] ?? []
  return `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);">
      <div style="width:36px;height:36px;border-radius:50%;background:var(--primary);color:#fff;
        display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;">
        ${esc(initials(user.name || user.email))}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(user.name || '—')}</div>
        <div style="font-size:11px;color:#6b6b6b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(user.email)}</div>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end;flex-shrink:0;max-width:160px;">
        ${passes.slice(0, 2).map(up => `
          <span style="font-size:10px;font-weight:500;padding:2px 7px;border-radius:20px;
            background:rgba(40,84,185,.10);color:var(--primary);border:1px solid rgba(40,84,185,.18);white-space:nowrap;">
            ${esc(loc(up.pass?.name) || 'Permanentka')}
          </span>`).join('')}
      </div>
      <div style="text-align:right;flex-shrink:0;min-width:60px;">
        <div style="font-size:12px;font-weight:600;">${count} lekcí</div>
        <div style="font-size:10px;color:#9b9b9b;">${last ? fmtDate(last) : 'Žádná'}</div>
      </div>
    </div>`
}

// ── Admin Platby ─────────────────────────────────────────────
export async function renderAdminPlatby() {
  const el = document.getElementById('admin-platby-content')
  if (!el) return
  const prevHtml = el.innerHTML
  const stable = _adminHadStableContent(prevHtml, 'Načítám platby')
  if (stable) console.log('[Debug] Admin platby: obnovuji na pozadí')
  else el.innerHTML = `<div class="empty" style="padding:40px;">Načítám platby…</div>`
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)
  try {
    await adminRace((async () => {
    const [{ data: recentPasses }, { data: recentSingles }, { data: monthPasses }, { data: monthSingles }] = await Promise.all([
      sb.from('user_passes').select('id,price_paid,created_at,status,user:users(name,email),pass:passes(name)')
        .order('created_at',{ascending:false}).limit(40),
      sb.from('bookings').select('id,price_paid,status,created_at,user:users(name,email),lesson:lessons(start_time,course:courses(title,color_code))')
        .eq('payment_type','single').order('created_at',{ascending:false}).limit(40),
      sb.from('user_passes').select('price_paid').gte('created_at', monthStart.toISOString()),
      sb.from('bookings').select('price_paid').eq('payment_type','single').gte('created_at', monthStart.toISOString()),
    ])
    const monthRev       = (monthPasses ?? []).reduce((s,p)=>s+Number(p.price_paid||0),0)
                         + (monthSingles ?? []).reduce((s,b)=>s+Number(b.price_paid||0),0)
    const monthPassRev   = (monthPasses ?? []).reduce((s,p)=>s+Number(p.price_paid||0),0)
    const monthSingleRev = (monthSingles ?? []).reduce((s,b)=>s+Number(b.price_paid||0),0)
    const all = [
      ...(recentPasses ?? []).map(p=>({type:'pass',id:p.id,amount:p.price_paid,date:p.created_at,status:p.status,
        userName:p.user?.name||p.user?.email||'—',description:loc(p.pass?.name)||'Permanentka'})),
      ...(recentSingles ?? []).map(b=>({type:'single',id:b.id,amount:b.price_paid,date:b.created_at,status:b.status,
        userName:b.user?.name||b.user?.email||'—',description:loc(b.lesson?.course?.title)||'Lekce'})),
    ].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,60)
    el.innerHTML = `
      <div class="page-title" style="margin-bottom:16px;">Platby</div>
      <div class="admin-stat-grid">
        <div class="admin-stat-card"><div class="admin-stat-value" style="font-size:18px;">${fmtPrice(monthRev)}</div><div class="admin-stat-label">Příjmy tento měsíc</div></div>
        <div class="admin-stat-card"><div class="admin-stat-value" style="font-size:18px;">${fmtPrice(monthPassRev)}</div><div class="admin-stat-label">Z permanentek</div></div>
        <div class="admin-stat-card"><div class="admin-stat-value" style="font-size:18px;">${fmtPrice(monthSingleRev)}</div><div class="admin-stat-label">Jednorázové vstupy</div></div>
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
  const typeBg = isPass ? 'rgba(40,84,185,.10)' : 'rgba(8,80,65,.10)'
  const typeColor = isPass ? 'var(--primary)' : '#085041'
  const statusMap = {
    active:{l:'Aktivní',bg:'#E1F5EE',c:'#085041'}, expired:{l:'Vypršela',bg:'#F3F4F6',c:'#6b6b6b'},
    depleted:{l:'Vyčerpána',bg:'#F3F4F6',c:'#6b6b6b'}, booked:{l:'Uhrazeno',bg:'#E1F5EE',c:'#085041'},
    cancelled:{l:'Stornováno',bg:'#FCEBEB',c:'#791F1F'}, attended:{l:'Absolvováno',bg:'#E1F5EE',c:'#085041'},
    missed:{l:'Nedorazil',bg:'#FFF4E0',c:'#8B5C00'},
  }
  const st = statusMap[p.status] ?? {l:p.status,bg:'#F3F4F6',c:'#6b6b6b'}
  return `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap;">
          <span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:${typeBg};color:${typeColor};">${isPass?'Permanentka':'Vstup'}</span>
          <span style="font-size:12px;font-weight:500;">${esc(p.description)}</span>
        </div>
        <div style="font-size:11px;color:#6b6b6b;">${esc(p.userName)} · ${fmtDateTime(p.date)}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:14px;font-weight:700;margin-bottom:3px;">${fmtPrice(p.amount)}</div>
        <span style="font-size:10px;font-weight:500;padding:2px 7px;border-radius:20px;background:${st.bg};color:${st.c};">${st.l}</span>
      </div>
    </div>`
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
    const { data: passes, error } = await sb.from('passes')
      .select('id, name, entries_total, price, validity_weeks, is_active, allowed_course_ids')
      .order('created_at', { ascending: false })
    if (error) throw error

    const allCourseIds = [...new Set((passes ?? []).flatMap(p => p.allowed_course_ids ?? []))]
    let courseMap = {}
    if (allCourseIds.length > 0) {
      const { data: courses } = await sb.from('courses').select('id, title').in('id', allCourseIds)
      courseMap = Object.fromEntries((courses ?? []).map(c => [c.id, c]))
    }

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div class="page-title">Správa permanentek</div>
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
  const courseNames = (pass.allowed_course_ids ?? []).map(id => loc(courseMap[id]?.title)).filter(Boolean)
  return `
    <div style="border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px;background:#fff;">
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
                  background:var(--primary-100);color:var(--primary);">${esc(n)}</span>`).join('')}
            </div>` : `<div style="font-size:11px;color:#9b9b9b;">Není přiřazena k žádnému kurzu</div>`}
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:18px;font-weight:700;color:var(--primary);margin-bottom:10px;">${fmtPrice(pass.price)}</div>
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

  const [{ data: courses }, existingData] = await Promise.all([
    sb.from('courses').select('id, title, color_code').eq('is_active', true).eq('is_workshop', false).order('title->cs'),
    passId ? sb.from('passes').select('*').eq('id', passId).single() : Promise.resolve({ data: null }),
  ])

  const pass = existingData.data
  if (pass) {
    document.getElementById('mp-name').value    = loc(pass.name)
    document.getElementById('mp-entries').value = pass.entries_total
    document.getElementById('mp-price').value   = pass.price
    document.getElementById('mp-weeks').value   = pass.validity_weeks
  }

  const existingIds = pass?.allowed_course_ids ?? []

  if (!courses?.length) {
    listEl.innerHTML = `<div style="font-size:12px;color:#9b9b9b;padding:8px 0;">Žádné kurzy nenalezeny. Nejprve vytvořte kurzy.</div>`
  } else {
    listEl.innerHTML = courses.map(c => {
      const color = c.color_code ?? '#2854B9'
      return `
        <label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;
          border:1px solid var(--border);margin-bottom:6px;cursor:pointer;user-select:none;">
          <input type="checkbox" value="${esc(c.id)}" ${existingIds.includes(c.id)?'checked':''}
            style="width:16px;height:16px;accent-color:${color};cursor:pointer;flex-shrink:0;" />
          <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></div>
          <span style="font-size:13px;">${esc(loc(c.title))}</span>
        </label>`
    }).join('')
  }

  document.getElementById('modal-pass').style.display = 'flex'
}

window.closePassModal = () => {
  const m = document.getElementById('modal-pass')
  if (m) m.style.display = 'none'
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
    const payload = {
      name: { cs: name },
      entries_total: entries,
      price,
      validity_weeks: weeks,
      allowed_course_ids: courseIds,
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
            <textarea id="mw-long" rows="4" placeholder="Podrobný popis programu workshopu…"
              style="${INP}resize:vertical;min-height:88px;"></textarea>
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
              border:1.5px dashed var(--border);border-radius:10px;cursor:pointer;font-size:12px;color:var(--muted);">
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

window.adminNewWorkshop = () => {
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
  ;['mw-name','mw-desc','mw-long','mw-price','mw-date'].forEach(id => { const e = document.getElementById(id); if(e) e.value = '' })
  document.getElementById('mw-capacity').value  = '12'
  document.getElementById('mw-time-from').value = '09:00'
  document.getElementById('mw-time-to').value   = '12:00'
  window._wsPickColor?.(PRESET_COLORS[0])
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
    document.getElementById('mw-long').value     = loc(course.description_long)
    document.getElementById('mw-price').value    = course.price_single
    document.getElementById('mw-capacity').value = course.capacity_default
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

  document.getElementById('modal-workshop').style.display = 'flex'
}

window.closeWorkshopModal = () => {
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
  const descLong = document.getElementById('mw-long')?.value.trim()
  const price    = Number(document.getElementById('mw-price')?.value)
  const capacity = Number(document.getElementById('mw-capacity')?.value)
  const date     = document.getElementById('mw-date')?.value
  const timeFrom = document.getElementById('mw-time-from')?.value
  const timeTo   = document.getElementById('mw-time-to')?.value

  if (!name)                      { showErr(errEl, 'Vyplňte název workshopu.'); return }
  if (isNaN(price) || price < 0)  { showErr(errEl, 'Zadejte platnou cenu.'); return }
  if (!capacity || capacity < 1)  { showErr(errEl, 'Zadejte kapacitu (min. 1 místo).'); return }
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
      style="flex:1;padding:9px 2px;border-radius:10px;border:1px solid var(--border);
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

          <!-- Obsah kurzu (dlouhý popis) -->
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Obsah kurzu <span style="font-weight:400;opacity:.7;">(detailní popis na stránce kurzu)</span></label>
            <textarea id="mc-long" rows="5" placeholder="Podrobný popis pro stránku detailu kurzu…"
              style="${INP}resize:vertical;min-height:100px;"></textarea>
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
              border:1.5px dashed var(--border);border-radius:10px;cursor:pointer;font-size:12px;color:var(--muted);">
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
  ;['mc-name','mc-desc','mc-long','mc-price'].forEach(id => { const e = document.getElementById(id); if(e) e.value = '' })
  document.getElementById('mc-capacity').value  = '12'
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
    const [passRes, cRes] = await Promise.all([
      sb.from('passes').select('id, name, entries_total, price').eq('is_active', true).order('created_at'),
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
    document.getElementById('mc-long').value     = loc(course.description_long)
    document.getElementById('mc-price').value    = course.price_single
    document.getElementById('mc-capacity').value = course.capacity_default
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
        <label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;
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

  document.getElementById('modal-course').style.display = 'flex'
}

window.adminNewCourse  = () => _openCourseModal(null)
window.adminEditCourse = (id) => _openCourseModal(id)

window.closeNewCourseModal = () => {
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
  const descLong    = document.getElementById('mc-long')?.value.trim()
  const price       = Number(document.getElementById('mc-price')?.value)
  const capacity    = Number(document.getElementById('mc-capacity')?.value)
  const cancelH     = Number(document.getElementById('mc-cancel')?.value)
  const timeFrom    = document.getElementById('mc-time-from')?.value
  const timeTo      = document.getElementById('mc-time-to')?.value
  const selectedDays    = [..._ncSelectedDays]
  const selectedPassIds = [...document.querySelectorAll('#mc-passes-list input[type=checkbox]:checked')].map(cb => cb.value)

  if (!name)              { showErr(errEl, 'Vyplňte název kurzu.'); return }
  if (!price || price<=0) { showErr(errEl, 'Zadejte platnou cenu vstupného.'); return }
  if (!capacity || capacity<1) { showErr(errEl, 'Zadejte kapacitu (min. 1 místo).'); return }
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

      // Update all future active lessons — keeps bookings intact, only updates time/capacity/price
      const { data: futureLessons } = await sb.from('lessons')
        .select('id, start_time')
        .eq('course_id', courseId)
        .gt('start_time', new Date().toISOString())
        .eq('status', 'active')
      if (futureLessons?.length > 0) {
        const [fH, fM] = timeFrom.split(':').map(Number)
        const [tH, tM] = timeTo.split(':').map(Number)
        await Promise.all(futureLessons.map(l => {
          const d = new Date(l.start_time)
          const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), fH, fM, 0, 0)
          const e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), tH, tM, 0, 0)
          return sb.from('lessons').update({
            start_time: s.toISOString(), end_time: e.toISOString(),
            capacity, price_single: price,
          }).eq('id', l.id)
        }))
      }
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
  } catch (err) {
    console.error('[Admin] saveNewCourse:', err)
    showErr(errEl, 'Chyba: ' + (err.message ?? 'Zkuste to znovu.'))
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = courseId ? 'Uložit změny' : 'Uložit kurz' }
  }
}

// Přidá / odebere courseId z allowed_course_ids na permanentkách
async function _syncPassAssociations(courseId, selectedPassIds) {
  const { data: allPasses } = await sb.from('passes').select('id, allowed_course_ids')
  for (const pass of (allPasses ?? [])) {
    const current = pass.allowed_course_ids ?? []
    const shouldHave = selectedPassIds.includes(pass.id)
    const hasNow     = current.includes(courseId)
    if (shouldHave === hasNow) continue
    const updated = shouldHave ? [...current, courseId] : current.filter(id => id !== courseId)
    await sb.from('passes').update({ allowed_course_ids: updated }).eq('id', pass.id)
  }
}

// Vygeneruje lekce na příštích `numWeeks` týdnů pro zvolené dny + čas
function _generateLessons(courseId, days, timeFrom, timeTo, capacity, price, numWeeks = 4) {
  const today = new Date(); today.setHours(0,0,0,0)
  const [fH, fM] = timeFrom.split(':').map(Number)
  const [tH, tM] = timeTo.split(':').map(Number)
  const lessons = []

  for (const dayIdx of days) {           // 0 = pondělí … 6 = neděle
    const todayDow = (today.getDay()+6) % 7  // JS: 0=Sun → Mon=0
    let daysUntil  = (dayIdx - todayDow + 7) % 7
    if (daysUntil === 0) daysUntil = 7       // nikdy nezačínáme dnes

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

// ── Modal: účastníci lekce (admin) ───────────────────────────
function buildLessonAttendeesModal() {
  if (document.getElementById('modal-lesson-attendees')) return
  document.body.insertAdjacentHTML('beforeend', `
    <div id="modal-lesson-attendees" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.38);
      z-index:300;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;"
      onclick="if(event.target===this)window.closeLessonAttendeesModal?.()">
      <div style="background:#fff;border-radius:18px;border:1px solid var(--border);box-shadow:var(--shadow);
        width:100%;max-width:520px;overflow:hidden;margin:auto;" onclick="event.stopPropagation()">
        <div style="padding:18px 18px 4px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div id="mla-title" style="font-size:18px;font-weight:700;">Účastníci lekce</div>
          <button type="button" onclick="window.closeLessonAttendeesModal?.()"
            style="border:none;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:#6b6b6b;padding:0 4px;">×</button>
        </div>
        <div id="mla-list" style="padding:14px 18px 18px;max-height:60vh;overflow-y:auto;"></div>
      </div>
    </div>`)
}

window.closeLessonAttendeesModal = () => {
  const m = document.getElementById('modal-lesson-attendees')
  if (m) m.style.display = 'none'
}

window.adminOpenLessonDetail = async (lessonId) => {
  if (!lessonId) return
  buildLessonAttendeesModal()
  const modal = document.getElementById('modal-lesson-attendees')
  const listEl = document.getElementById('mla-list')
  const titleEl = document.getElementById('mla-title')
  if (!modal || !listEl) return
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
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="text-align:left;color:#6b6b6b;font-size:11px;">
            <th style="padding:8px 8px 8px 0;">Jméno</th>
            <th style="padding:8px 4px;">E-mail</th>
            <th style="padding:8px 0 8px 8px;text-align:right;">Platba</th>
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
            return `<tr style="border-top:1px solid var(--border);">
              <td style="padding:10px 8px 10px 0;vertical-align:top;">${esc(u?.name || '—')}</td>
              <td style="padding:10px 4px;vertical-align:top;word-break:break-all;">${esc(u?.email || '—')}</td>
              <td style="padding:10px 0 10px 8px;vertical-align:top;text-align:right;white-space:nowrap;">${payCell}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
      <div style="font-size:11px;color:#9b9b9b;margin-top:12px;">Celkem přihlášených: ${rows.length}</div>`
    })(), 'modal-lesson-attendees')
  } catch (err) {
    console.error('[Admin] adminOpenLessonDetail:', err)
    listEl.innerHTML = '<div class="empty" style="padding:20px;color:#791F1F;">Nepodařilo se načíst seznam.</div>'
    window.showToast?.('Chyba při načítání účastníků: ' + (err.message ?? err), 'error')
  }
}

// ── Admin akce ───────────────────────────────────────────────
window.adminCancelLesson = async (lessonId) => {
  if (!lessonId || !confirm('Opravdu zrušit lekci? Všechny rezervace budou stornovány.')) return
  try {
    const [{ error: bErr }, { error: lErr }] = await Promise.all([
      sb.from('bookings').update({ status:'cancelled' }).eq('lesson_id', lessonId).eq('status','booked'),
      sb.from('lessons').update({ status:'cancelled' }).eq('id', lessonId),
    ])
    if (lErr) throw lErr
    if (bErr) console.warn('[Admin] cancelLesson — bookings:', bErr)
    window.showToast?.('Lekce byla zrušena.', 'ok')
    renderAdminDashboard()
  } catch (err) {
    console.error('[Admin] cancelLesson:', err)
    window.showToast?.('Nepodařilo se zrušit lekci: ' + (err.message ?? err), 'error')
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
    } else if (act === 'cancel') {
      console.log('[Debug] Delegace admin dashboard → adminCancelLesson:', id)
      void window.adminCancelLesson?.(id)
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
