// ============================================================
// atelier-auth.js — Auth & session layer (finální)
// Magic Link, Google/Apple OAuth, ghost účty, enrolled stav.
// Použití: <script type="module" src="atelier-auth.js"></script>
// ============================================================

import { sb } from './atelier-supabase.js'

// ── Globální stav aplikace (single source of truth; merge kvůli pořadí skriptů v index.html) ──
window.AppState ??= {}
Object.assign(window.AppState, {
  user:              window.AppState.user ?? null,
  role:              window.AppState.role ?? 'uzivatel',
  courses:           window.AppState.courses ?? [],
  lessons:           window.AppState.lessons ?? [],
  upcomingLessons:   window.AppState.upcomingLessons ?? [],
  weekStart:         window.AppState.weekStart ?? null,
  initialized:       window.AppState.initialized ?? false,
})

// Promise, která se splní jakmile proběhne počáteční auth check.
// atelier-data.js ji čeká před načtením dat.
let _resolveAuthReady
window.__authReady = new Promise(resolve => { _resolveAuthReady = resolve })

// ── Veřejný stav ─────────────────────────────────────────────
export let currentUser  = null        // { id, email, name, role, is_ghost }
export let userBookings = new Set()   // Set<lesson_id> aktivních rezervací
export let userPasses   = []          // active user passes
export let myBookings   = []          // active booked lessons (enriched)

const PASS_RECONCILE_COOLDOWN_MS = 5 * 60 * 1000
let _lastPassReconcileAt = 0

const AVATAR_COLORS = [
  '#2854B9', '#FD8D40', '#E05C5C', '#4CAF50', '#9C27B0',
  '#00BCD4', '#795548', '#607D8B', '#E91E63', '#111827',
]

// Jednoduchý „auth flag“ pro ostatní části UI (např. navigaci v index.html)
export function isAuthenticated() { return !!currentUser }
window.isAuthenticated = () => !!currentUser

// Settings UI entrypoints (index.html volá z nav())
window.renderSettings = () => renderSettings(currentUser)
window.openDeleteAccountModal = () => {
  const m = document.getElementById('modal-del')
  if (m) m.classList.add('on')
}
window.closeDeleteAccountModal = () => {
  const m = document.getElementById('modal-del')
  if (m) m.classList.remove('on')
}
window.saveSettings = async () => saveSettings()
window.confirmDeleteAccount = async () => confirmDeleteAccount()
window.changePassword = async () => {
  const CHANGE_PASSWORD_TIMEOUT_MS = 15000
  const currentPw = document.getElementById('set-pw-current')?.value ?? ''
  const pw1 = document.getElementById('set-pw1')?.value ?? ''
  const pw2 = document.getElementById('set-pw2')?.value ?? ''
  if (pw1.length < 8)  { alert('Heslo musí mít alespoň 8 znaků.'); return }
  if (pw1 !== pw2)     { alert('Hesla se neshodují.'); return }
  const btn = document.getElementById('set-pw-btn')
  if (btn) { btn.disabled = true; btn.textContent = 'Ukládám…' }
  try {
    const payload = currentPw.trim()
      ? { password: pw1, current_password: currentPw }
      : { password: pw1 }

    // Některé auth odpovědi mohou v prohlížeči viset příliš dlouho.
    // UI raději po timeoutu odblokujeme a dáme uživateli jasnou další akci.
    const result = await Promise.race([
      sb.auth.updateUser(payload)
        .then(({ error }) => ({ kind: 'result', error }))
        .catch(error => ({ kind: 'thrown', error })),
      new Promise(resolve => setTimeout(() => resolve({ kind: 'timeout' }), CHANGE_PASSWORD_TIMEOUT_MS)),
    ])

    if (result?.kind === 'timeout') {
      window.showToast?.(
        'Uložení hesla trvá příliš dlouho. Heslo se mohlo uložit, ale klient nedostal odpověď. Ověř ho prosím v anonymním okně novým přihlášením.',
        'error',
      )
      return
    }

    if (result?.kind === 'thrown') throw result.error
    if (result?.error) throw result.error

    window.showToast?.(langPick('✓ Heslo bylo uloženo. Už ho můžeš znovu použít k přihlášení.', '✓ Password saved.'), 'ok')
    ;['set-pw-current', 'set-pw1', 'set-pw2'].forEach(id => { const e = document.getElementById(id); if (e) e.value = '' })
  } catch (err) {
    console.error('[Auth] changePassword:', err)
    const rawMsg = String(err?.message ?? err ?? '')
    const msg = rawMsg.toLowerCase()
    let uiMsg = rawMsg
    if (msg.includes('reauthentication') || msg.includes('update password requires') || msg.includes('current password')) {
      uiMsg = 'Tato změna vyžaduje i současné heslo. Doplň ho do prvního pole a zkus to znovu.'
    } else if (msg.includes('same password')) {
      uiMsg = 'Nové heslo musí být jiné než současné.'
    }
    window.showToast?.(langPick('Nepodařilo se uložit heslo: ', 'Could not save password: ') + uiMsg, 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Uložit heslo' }
  }
}

function langPick(cs, en) {
  const l = (document.documentElement?.lang || 'cs').toLowerCase()
  return l.startsWith('en') ? en : cs
}

// ── Inicializace ──────────────────────────────────────────────
export async function initAuth() {
  let initSession = null
  try {
    const { data } = await sb.auth.getSession()
    initSession = data.session
  } catch (err) {
    console.error('[Auth] getSession failed:', err)
  }

  try {
    if (initSession) {
      await onSessionChange(initSession)
    } else {
      renderAuthUI(null)
      renderProtectedSections(null)
    }
  } catch (err) {
    console.error('[Auth] onSessionChange selhal:', err)
  } finally {
    // Signál pro atelier-data.js — musí se zavolat vždy, i při výjimce.
    // Pokud by se nezavolalo, data.js čeká donekonečna → deadlock.
    _resolveAuthReady?.()
    console.log('[Auth] authReady resolved')
  }

  /** Po návratu na tab často dorazí znovu SIGNED_IN se stejným user.id — bez tohoto taháme DB a render dokola → zamrzání. */
  const sameSessionUserAlreadyActive = sess => {
    const uid = sess?.user?.id
    if (!uid || !currentUser?.id) return false
    return currentUser.id === uid
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    console.log('[Auth event]', event, session?.user?.email ?? '–')

    switch (event) {
      case 'INITIAL_SESSION':
        // Supabase JS v2 pošle INITIAL_SESSION při magic link redirectu;
        // zpracujeme jen pokud getSession() výše nic nevrátil (currentUser je null)
        if (!session) break
        if (sameSessionUserAlreadyActive(session)) {
          console.log('[Auth] INITIAL_SESSION přeskočeno — uživatel už je z hydrate z initAuth / předchozího toku')
          break
        }
        if (!currentUser) await onSessionChange(session)
        break
      case 'SIGNED_IN':
        // Duplicitní SIGNED_IN: stále spustit pending booking (idempotentní), ale ne celý onSessionChange
        if (sameSessionUserAlreadyActive(session)) {
          console.log('[Auth] SIGNED_IN přeskočeno (stejný uživatel) — jen pending booking')
          handlePendingBooking()
          break
        }
        await onSessionChange(session)
        handlePendingBooking()
        break
      case 'SIGNED_OUT':
        currentUser = null
        userBookings.clear()
        window.AppState.user = null
        window.AppState.role = 'uzivatel'
        renderAuthUI(null)
        renderProtectedSections(null)
        rerenderCalendar()
        break
      case 'USER_UPDATED':
        await loadUserProfile(session.user.id)
        renderAuthUI(currentUser)
        renderProtectedSections(currentUser)
        break
      case 'TOKEN_REFRESHED':
        break
    }
  })
}

/** Volá atelier-data při timeoutu getSession po startu — vyčistí session a otevře přihlášení (raději než „mrtvá“ aplikace). */
export async function forceConnectionFailureLogout(reason) {
  const r = reason != null && String(reason).trim() ? String(reason) : 'neznámý důvod'
  console.warn('[Auth] forceConnectionFailureLogout:', r)

  const withCap = (p, ms) =>
    Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('signOut-timeout')), ms)),
    ])

  try {
    await withCap(sb.auth.signOut({ scope: 'local' }), 8000)
  } catch (e) {
    console.warn('[Auth] signOut(scope: local) — fallback pokračuji:', e?.message ?? e)
  }

  currentUser = null
  userBookings.clear()
  userPasses = []
  myBookings = []
  window.AppState.user = null
  window.AppState.role = 'uzivatel'
  window.__userRole = 'uzivatel'
  renderAuthUI(null)
  renderProtectedSections(null)
  try {
    rerenderCalendar()
  } catch (_) { /* může být ještě nezaregistrované */ }

  window.openAuthPopup?.({})
  window.showToast?.(
    'Nepodařilo se ověřit spojení se serverem. Přihlas se prosím znovu.',
    'error',
  )
}

// ── Po přihlášení ─────────────────────────────────────────────
/** Ochrana proti paralelním běhům (např. INITIAL_SESSION + SIGNED_IN téměř současně). */
let _sessionHydrateInFlight = null

async function onSessionChange(session) {
  const uid = session?.user?.id
  if (!uid || !session.user) return

  if (_sessionHydrateInFlight === uid) {
    console.log('[Auth] onSessionChange: hydrate pro účet už běží — přeskakuji duplicitní volání')
    return
  }
  _sessionHydrateInFlight = uid

  try {
    console.log('[Auth] onSessionChange:', session.user.email)
    try {
      await mergeGhostIfNeeded(session.user)
      await loadUserProfile(session.user.id)
      await loadUserBookings(session.user.id)
      await Promise.all([
        loadUserPasses(session.user.id),
        loadMyBookings(session.user.id),
      ])
    } catch (err) {
      console.error('[Auth] Chyba při načítání profilu:', err)
      // Záloha: uživatel je přihlášen v auth, i když profil neslo
      if (!currentUser) {
        currentUser = {
          id: session.user.id,
          email: session.user.email,
          name: session.user.user_metadata?.full_name
            ?? session.user.email?.split('@')[0]
            ?? '',
          role: 'uzivatel',
          avatar_color: '#2854B9',
          is_ghost: false,
        }
      }
    }
    window.AppState.user = currentUser
    window.AppState.role = currentUser?.role ?? 'uzivatel'

    renderAuthUI(currentUser)
    renderProtectedSections(currentUser)
    renderSettings(currentUser)
    rerenderCalendar()
    updateEnrolledOnNastenska()
  } finally {
    _sessionHydrateInFlight = null
  }
}

// ── Profil ────────────────────────────────────────────────────
async function loadUserProfile(userId) {
  const { data, error } = await sb
    .from('users')
    .select('id, email, name, role, is_ghost, reminder_hours, avatar_color')
    .eq('id', userId)
    .single()

  if (error?.code === 'PGRST116') {
    await createUserProfile(userId)
  } else if (!error) {
    // Pokud byl účet GDPR-anonymizován, reaktivujeme ho
    if (data.email?.startsWith('deleted_') || data.name === 'Smazaný uživatel') {
      await reactivateUserProfile(userId)
    } else {
      currentUser = data
    }
  } else {
    console.error('loadUserProfile:', error)
  }
}

async function createUserProfile(userId) {
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return

  const name = user.user_metadata?.full_name
    ?? user.user_metadata?.name
    ?? user.email?.split('@')[0]
    ?? 'Nový uživatel'

  const provider = user.app_metadata?.provider ?? 'magic_link'
  const created_via = provider === 'email' ? 'magic_link' : provider

  const { data, error } = await sb
    .from('users')
    .insert({
      id: userId,
      email: user.email,
      name,
      role: 'uzivatel',
      is_ghost: false,
      created_via,
      avatar_color: '#2854B9',
    })
    .select()
    .single()

  if (!error) currentUser = data
  else console.error('createUserProfile:', error)
}

async function reactivateUserProfile(userId) {
  const { data: { user: authUser } } = await sb.auth.getUser()
  if (!authUser) return

  const name = authUser.user_metadata?.full_name
    ?? authUser.user_metadata?.name
    ?? authUser.email?.split('@')[0]
    ?? ''

  const { data, error } = await sb
    .from('users')
    .update({ email: authUser.email, name, role: 'uzivatel', avatar_url: null, avatar_color: '#2854B9' })
    .eq('id', userId)
    .select('id, email, name, role, is_ghost, reminder_hours, avatar_color')
    .single()

  if (!error) {
    currentUser = data
    console.log('[Auth] Účet reaktivován:', currentUser.email)
  } else {
    console.error('reactivateUserProfile:', error)
    // Záloha: DB update selhal, ale uživatel je auth přihlášen
    currentUser = { id: userId, email: authUser.email, name, role: 'uzivatel', is_ghost: false, avatar_color: '#2854B9' }
  }
}

// ── Bookings ──────────────────────────────────────────────────
export async function loadUserBookings(userId) {
  if (!userId) { userBookings.clear(); return }

  const { data, error } = await sb
    .from('bookings')
    .select('lesson_id')
    .eq('user_id', userId)
    .eq('status', 'booked')

  if (error) { console.error('loadUserBookings:', error); return }
  userBookings = new Set(data.map(b => b.lesson_id))
}

export async function loadUserPasses(userId) {
  if (!userId) { userPasses = []; return }
  const now = Date.now()
  if (now - _lastPassReconcileAt >= PASS_RECONCILE_COOLDOWN_MS) {
    try {
      const { error: recErr } = await sb.rpc('reconcile_my_pass_balances')
      if (recErr) {
        console.warn('[Auth] reconcile_my_pass_balances:', recErr)
      } else {
        _lastPassReconcileAt = now
      }
    } catch (e) {
      console.warn('[Auth] reconcile_my_pass_balances', e)
    }
  }
  const { data, error } = await sb
    .from('user_passes')
    .select(`
      id, entries_total, entries_remaining, cancellation_count, expires_at, status,
      pass:passes ( id, name, entries_total, price, validity_weeks, allowed_course_ids )
    `)
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('expires_at', { ascending: true })

  if (error) { console.error('loadUserPasses:', error); userPasses = []; return }
  userPasses = data ?? []
}

export async function loadMyBookings(userId) {
  if (!userId) { myBookings = []; return }

  const { data, error } = await sb
    .from('bookings')
    .select(`
      id, status, payment_type, user_pass_id, created_at,
      user_pass:user_passes ( id, entries_total, cancellation_count ),
      lesson:lessons (
        id, start_time, end_time,
        course:courses ( id, title, color_code, is_workshop, cancellation_hours, owner:users ( name ) )
      )
    `)
    .eq('user_id', userId)
    .eq('status', 'booked')
    .order('created_at', { ascending: false })

  if (error) { console.error('loadMyBookings:', error); myBookings = []; return }
  myBookings = data ?? []
}

function passCancellationLimit(entriesTotal) {
  const total = Number(entriesTotal)
  if (!Number.isFinite(total) || total <= 0) return 0
  return total <= 5 ? 1 : 2
}

function _resolveBookingUserPassMeta(booking) {
  if (!booking) return null
  const fromActivePasses = userPasses.find(up => String(up.id) === String(booking.user_pass_id))
  return fromActivePasses || booking.user_pass || null
}

export function getUserBookingCancellationState(booking) {
  if (!booking) return { allowed: false, reason: 'missing_booking' }
  if (booking.payment_type !== 'pass') return { allowed: false, reason: 'single_entry' }
  const lessonStart = booking.lesson?.start_time
  const cancellationHours = Number(booking.lesson?.course?.cancellation_hours)
  const startTs = lessonStart ? new Date(lessonStart).getTime() : NaN
  if (!Number.isFinite(startTs) || !Number.isFinite(cancellationHours)) {
    return { allowed: false, reason: 'missing_window_data' }
  }
  const userPass = _resolveBookingUserPassMeta(booking)
  const cancellationCount = Number(userPass?.cancellation_count ?? 0)
  const cancellationLimit = passCancellationLimit(userPass?.entries_total)
  if (cancellationLimit <= 0) {
    return { allowed: false, reason: 'missing_pass_data' }
  }
  if (cancellationCount >= cancellationLimit) {
    return { allowed: false, reason: 'limit_reached', cancellationCount, cancellationLimit }
  }
  if (Date.now() > startTs - (cancellationHours * 60 * 60 * 1000)) {
    return { allowed: false, reason: 'window_closed', cancellationCount, cancellationLimit }
  }
  return { allowed: true, reason: 'ok', cancellationCount, cancellationLimit }
}

export function getUserBookingCancellationMessage(booking) {
  const state = getUserBookingCancellationState(booking)
  if (state.reason === 'limit_reached') {
    return 'Dosáhli jste limitu bezplatných storen na této permanentce.'
  }
  if (state.reason === 'window_closed') {
    return 'Storno už není možné, vypršelo storno okno.'
  }
  if (state.reason === 'single_entry') {
    return 'Jednorázový vstup nelze stornovat.'
  }
  return 'Storno této rezervace není možné.'
}

export function canUserCancelBooking(booking) {
  return getUserBookingCancellationState(booking).allowed
}

export async function refreshUserBookings() {
  if (!currentUser) return
  await loadUserBookings(currentUser.id)
  await Promise.all([
    loadUserPasses(currentUser.id),
    loadMyBookings(currentUser.id),
  ])
  rerenderCalendar()
  updateEnrolledOnNastenska()
}
window.refreshUserBookings = refreshUserBookings

// ── Enrolled helper ───────────────────────────────────────────
export function isEnrolled(lessonId) {
  return userBookings.has(lessonId)
}

// ── Sign in: Magic Link ───────────────────────────────────────
export async function signIn(email) {
  if (!email || !isValidEmail(email)) {
    return { error: 'Zadej platný e-mail.' }
  }
  const redirectTo = `${window.location.origin}${window.location.pathname}`
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
  })
  return error ? { error: error.message } : { ok: true }
}

// ── Sign in: Google / Apple ───────────────────────────────────
export async function signInWithProvider(provider) {
  const { error } = await sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}${window.location.pathname}` },
  })
  if (error) console.error(`signInWithProvider(${provider}):`, error)
}

// ── Sign out ──────────────────────────────────────────────────
export async function signOut() {
  await sb.auth.signOut()
  // Zbytek řeší onAuthStateChange → SIGNED_OUT
}

// aby fungovalo onclick="window.signOut?.()" v index.html
window.signOut = signOut

// ── Ghost → plný účet ─────────────────────────────────────────
async function mergeGhostIfNeeded(authUser) {
  const { data } = await sb
    .from('users')
    .select('id, is_ghost')
    .eq('email', authUser.email)
    .single()

  if (data?.is_ghost) {
    await sb
      .from('users')
      .update({ is_ghost: false, id: authUser.id })
      .eq('email', authUser.email)
  }
}

// ── Pending booking (rezervace čekající na přihlášení) ────────
function handlePendingBooking() {
  const raw = sessionStorage.getItem('pending_booking')
  if (!raw) return
  sessionStorage.removeItem('pending_booking')
  try {
    const { lesson_id, course_id } = JSON.parse(raw)
    window.openBookingPopup?.(course_id, null, lesson_id)
  } catch (e) {
    console.warn('handlePendingBooking: invalid JSON', e)
  }
}

// ── Auth popup (Magic Link formulář) ─────────────────────────
window.openAuthPopup = (opts = {}) => {
  let overlay = document.getElementById('auth-overlay')
  if (!overlay) {
    buildAuthPopup()
    overlay = document.getElementById('auth-overlay')
  }
  if (opts.courseTitle) {
    const ctx = document.getElementById('auth-context')
    const txt = document.getElementById('auth-ctx-text')
    if (ctx) ctx.style.display = 'flex'
    if (txt) txt.textContent   = `Rezervuješ: ${opts.courseTitle}${opts.lessonDate ? ' · ' + opts.lessonDate : ''}`
  }
  if (overlay) overlay.style.display = 'flex'
}

window.closeAuthPopup = () => {
  const overlay = document.getElementById('auth-overlay')
  if (overlay) overlay.style.display = 'none'
}

// ── Přihlášení heslem ─────────────────────────────────────────
window.submitPasswordLogin = async () => {
  const email  = document.getElementById('auth-email-input')?.value.trim()
  const pass   = document.getElementById('auth-pass-input')?.value
  const btn    = document.getElementById('auth-submit-btn')
  const errEl  = document.getElementById('auth-error')
  const sentEl = document.getElementById('auth-sent')

  if (errEl)  errEl.style.display  = 'none'
  if (sentEl) sentEl.style.display = 'none'

  if (!email || !pass) {
    if (errEl) { errEl.textContent = 'Vyplňte e-mail a heslo.'; errEl.style.display = 'block' }
    return
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Přihlašuji…' }

  const { error } = await sb.auth.signInWithPassword({ email, password: pass })

  if (btn) { btn.disabled = false; btn.textContent = 'Přihlásit se' }
  if (error) {
    if (errEl) { errEl.textContent = _authErr(error.message); errEl.style.display = 'block' }
  } else {
    window.closeAuthPopup?.()
  }
}

// ── Magic link ────────────────────────────────────────────────
window.submitForgotPassword = async () => {
  const input = document.getElementById('auth-email-input')
  const errEl = document.getElementById('auth-error')
  const sentEl = document.getElementById('auth-sent')
  const linkBtn = document.getElementById('auth-forgot-link')
  if (!input) return

  const email = input.value.trim()
  if (errEl)  errEl.style.display  = 'none'
  if (sentEl) sentEl.style.display = 'none'

  if (!email || !isValidEmail(email)) {
    if (errEl) { errEl.textContent = 'Zadej platný e-mail (stejný jako u účtu).'; errEl.style.display = 'block' }
    return
  }

  if (linkBtn) { linkBtn.style.pointerEvents = 'none'; linkBtn.textContent = 'Odesílám…' }

  const redirectTo = `${window.location.origin}${window.location.pathname}`
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo })

  if (linkBtn) { linkBtn.style.pointerEvents = ''; linkBtn.textContent = 'Zapomenuté heslo?' }

  if (error) {
    if (errEl) { errEl.textContent = _authErr(error.message); errEl.style.display = 'block' }
  } else {
    if (sentEl) {
      sentEl.textContent = '✓ Pokud účet existuje, poslali jsme odkaz pro obnovu hesla. Zkontroluj e-mail.'
      sentEl.style.display = 'block'
    }
  }
}

window.submitMagicLink = async () => {
  const input  = document.getElementById('auth-email-input')
  const btn    = document.getElementById('auth-magic-btn')
  const errEl  = document.getElementById('auth-error')
  const sentEl = document.getElementById('auth-sent')
  if (!input) return

  if (errEl)  errEl.style.display  = 'none'
  if (sentEl) sentEl.style.display = 'none'
  if (btn) { btn.disabled = true; btn.textContent = 'Odesílám…' }

  const result = await signIn(input.value.trim())

  if (btn) { btn.disabled = false; btn.textContent = 'Zaslat přihlašovací odkaz' }
  if (result.error) {
    if (errEl) { errEl.textContent = result.error; errEl.style.display = 'block' }
  } else {
    if (sentEl) {
      sentEl.textContent = '✓ Přihlašovací odkaz odeslán. Zkontroluj schránku.'
      sentEl.style.display = 'block'
    }
    if (input)  input.value = ''
  }
}

// ── Registrace ────────────────────────────────────────────────
window.submitRegister = async () => {
  const email  = document.getElementById('auth-reg-email')?.value.trim()
  const pass   = document.getElementById('auth-reg-pass')?.value
  const pass2  = document.getElementById('auth-reg-pass2')?.value
  const btn    = document.getElementById('auth-reg-btn')
  const errEl  = document.getElementById('auth-reg-error')
  const sentEl = document.getElementById('auth-reg-sent')

  if (errEl)  errEl.style.display  = 'none'
  if (sentEl) sentEl.style.display = 'none'

  if (!email || !pass) {
    if (errEl) { errEl.textContent = 'Vyplňte e-mail a heslo.'; errEl.style.display = 'block' }
    return
  }
  if (pass.length < 6) {
    if (errEl) { errEl.textContent = 'Heslo musí mít alespoň 6 znaků.'; errEl.style.display = 'block' }
    return
  }
  if (pass !== pass2) {
    if (errEl) { errEl.textContent = 'Hesla se neshodují.'; errEl.style.display = 'block' }
    return
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Registruji…' }

  const { error } = await sb.auth.signUp({ email, password: pass })

  if (btn) { btn.disabled = false; btn.textContent = 'Registrovat se' }
  if (error) {
    if (errEl) { errEl.textContent = _authErr(error.message); errEl.style.display = 'block' }
  } else {
    if (sentEl) sentEl.style.display = 'block'
  }
}

// ── Přepínač tabů ─────────────────────────────────────────────
window.authSwitchTab = (tab) => {
  const isLogin = tab === 'login'
  const ids = {
    formLogin: 'auth-form-login', formReg: 'auth-form-register',
    tabLogin:  'auth-tab-login',  tabReg:  'auth-tab-register',
  }
  const $ = id => document.getElementById(id)
  if ($(ids.formLogin)) $(ids.formLogin).style.display = isLogin ? 'block' : 'none'
  if ($(ids.formReg))   $(ids.formReg).style.display   = isLogin ? 'none'  : 'block'
  ;[
    [ids.tabLogin, isLogin],
    [ids.tabReg,  !isLogin],
  ].forEach(([id, active]) => {
    const el = $(id)
    if (!el) return
    el.style.color        = active ? '#2854B9' : '#6b6b6b'
    el.style.borderBottom = active ? '2px solid #2854B9' : '2px solid transparent'
  })
}

// ── Překlad chybových hlášek ──────────────────────────────────
function _authErr(msg) {
  if (!msg) return 'Nastala chyba. Zkuste to znovu.'
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials') || m.includes('invalid credentials'))
    return 'Nesprávný e-mail nebo heslo.'
  if (m.includes('email not confirmed'))
    return 'E-mail ještě nebyl potvrzen. Zkontroluj schránku.'
  if (m.includes('already registered') || m.includes('user already registered'))
    return 'Účet s tímto e-mailem již existuje. Přihlaš se.'
  if (m.includes('password should be at least 6') || m.includes('weak password'))
    return 'Heslo je příliš slabé. Použij alespoň 6 znaků.'
  if (m.includes('rate limit') || m.includes('too many requests'))
    return 'Příliš mnoho pokusů. Zkus to za chvíli.'
  if (m.includes('signup is disabled'))
    return 'Registrace je momentálně zakázána.'
  return msg
}

// ── Popup HTML ────────────────────────────────────────────────
const _GOOGLE_SVG = `<svg width="15" height="15" viewBox="0 0 18 18" fill="none">
  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
  <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
</svg>`

const _INP  = 'width:100%;padding:8px 10px;border:0.5px solid rgba(0,0,0,.18);border-radius:8px;font-size:12px;margin-bottom:8px;box-sizing:border-box;'
const _BTN  = 'width:100%;padding:10px;border-radius:var(--btn-radius);border:none;background:#2854B9;color:#fff;font-size:12px;font-weight:500;cursor:pointer;'
const _ERR  = 'display:none;font-size:11px;color:#791F1F;background:#FCEBEB;border-radius:6px;padding:8px 10px;margin-bottom:8px;'
const _OK   = 'display:none;font-size:11px;color:#085041;background:#E1F5EE;border-radius:6px;padding:8px 10px;margin-bottom:8px;'
const _LBL  = 'font-size:11px;color:#6b6b6b;display:block;margin-bottom:4px;'
const _DIV  = 'display:flex;align-items:center;gap:8px;margin:10px 0;'

function buildAuthPopup() {
  if (document.getElementById('auth-overlay')) return

  document.body.insertAdjacentHTML('beforeend', `
    <div id="auth-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.38);
      display:none;align-items:center;justify-content:center;z-index:200;padding:16px;"
      onclick="if(event.target===this)closeAuthPopup()">
      <div style="background:#fff;border-radius:12px;border:0.5px solid rgba(0,0,0,.18);
        width:100%;max-width:340px;overflow:hidden;" onclick="event.stopPropagation()">

        <!-- Taby -->
        <div style="display:flex;border-bottom:0.5px solid rgba(0,0,0,.08);">
          <button id="auth-tab-login" onclick="authSwitchTab('login')"
            style="flex:1;padding:11px;font-size:11px;font-weight:500;border:none;background:transparent;
              cursor:pointer;color:#2854B9;border-bottom:2px solid #2854B9;">
            Přihlásit se
          </button>
          <button id="auth-tab-register" onclick="authSwitchTab('register')"
            style="flex:1;padding:11px;font-size:11px;font-weight:500;border:none;background:transparent;
              cursor:pointer;color:#6b6b6b;border-bottom:2px solid transparent;">
            Registrace
          </button>
        </div>

        <div style="padding:16px;">
          <!-- Kontext rezervace -->
          <div id="auth-context" style="display:none;align-items:center;gap:8px;
            background:#F8F8F8;border-radius:8px;padding:8px 10px;margin-bottom:12px;">
            <div style="width:7px;height:7px;border-radius:50%;background:#2854B9;flex-shrink:0;"></div>
            <span id="auth-ctx-text" style="font-size:10px;color:#6b6b6b;line-height:1.4;"></span>
          </div>

          <!-- Google (sdílené) -->
          <button onclick="signInWithProvider('google')"
            style="width:100%;padding:9px 12px;border-radius:var(--btn-radius);border:0.5px solid rgba(0,0,0,.18);
              background:transparent;display:flex;align-items:center;gap:8px;font-size:12px;
              font-weight:500;color:#1a1a1a;cursor:pointer;margin-bottom:2px;">
            ${_GOOGLE_SVG} Pokračovat přes Google
          </button>

          <div style="${_DIV}">
            <div style="flex:1;height:0.5px;background:rgba(0,0,0,.08);"></div>
            <span style="font-size:10px;color:#9b9b9b;">nebo e-mailem</span>
            <div style="flex:1;height:0.5px;background:rgba(0,0,0,.08);"></div>
          </div>

          <!-- ── Formulář: přihlášení ── -->
          <div id="auth-form-login">
            <label style="${_LBL}">E-mail</label>
            <input id="auth-email-input" type="email" placeholder="jmeno@email.cz"
              onkeydown="if(event.key==='Enter')submitPasswordLogin()"
              style="${_INP}" />

            <label style="${_LBL}">Heslo</label>
            <input id="auth-pass-input" type="password" placeholder="········"
              onkeydown="if(event.key==='Enter')submitPasswordLogin()"
              style="${_INP}" />

            <div id="auth-error" style="${_ERR}"></div>
            <div id="auth-sent" style="${_OK}">✓ Přihlašovací odkaz odeslán. Zkontroluj schránku.</div>

            <button id="auth-submit-btn" onclick="submitPasswordLogin()" style="${_BTN}">
              Přihlásit se
            </button>

            <div style="text-align:center;margin-top:10px;display:flex;flex-direction:column;gap:6px;">
              <button type="button" id="auth-forgot-link" onclick="submitForgotPassword()"
                style="background:none;border:none;color:#2854B9;font-size:11px;cursor:pointer;padding:0;">
                Zapomenuté heslo?
              </button>
              <button id="auth-magic-btn" onclick="submitMagicLink()"
                style="background:none;border:none;color:#2854B9;font-size:11px;cursor:pointer;padding:0;">
                Zaslat přihlašovací odkaz místo hesla
              </button>
            </div>
          </div>

          <!-- ── Formulář: registrace ── -->
          <div id="auth-form-register" style="display:none;">
            <label style="${_LBL}">E-mail</label>
            <input id="auth-reg-email" type="email" placeholder="jmeno@email.cz"
              onkeydown="if(event.key==='Enter')submitRegister()"
              style="${_INP}" />

            <label style="${_LBL}">Heslo <span style="color:#9b9b9b;">(min. 6 znaků)</span></label>
            <input id="auth-reg-pass" type="password" placeholder="········"
              onkeydown="if(event.key==='Enter')submitRegister()"
              style="${_INP}" />

            <label style="${_LBL}">Heslo znovu</label>
            <input id="auth-reg-pass2" type="password" placeholder="········"
              onkeydown="if(event.key==='Enter')submitRegister()"
              style="${_INP}" />

            <div id="auth-reg-error" style="${_ERR}"></div>
            <div id="auth-reg-sent" style="${_OK}">
              ✓ Účet vytvořen! Zkontroluj e-mail a potvrď adresu.
            </div>

            <button id="auth-reg-btn" onclick="submitRegister()" style="${_BTN}">
              Registrovat se
            </button>
          </div>
        </div>

        <div style="padding:0 16px 12px;">
          <button onclick="closeAuthPopup()"
            style="width:100%;padding:9px;border-radius:var(--btn-radius);border:0.5px solid rgba(0,0,0,.18);
              background:transparent;font-size:11px;color:#1a1a1a;cursor:pointer;">
            Zavřít
          </button>
        </div>
      </div>
    </div>`)
}

// ── Topbar UI + navigace ──────────────────────────────────────
function renderAuthUI(user) {
  renderNavigation(user)
  const av   = document.getElementById('av') ?? document.querySelector('.avatar')
  const sbtn = document.getElementById('sbtn') ?? document.querySelector('.sbtn')
  const nm   = document.getElementById('user-name') ?? document.querySelector('.top-right span')

  if (!av) return

  if (user) {
    av.textContent = getInitials(user.name || user.email)
    av.classList.remove('g')
    av.classList.add('u')
    av.title   = user.email
    av.onclick = toggleAvatarMenu
    av.style.background = user.avatar_color || '#2854B9'
    av.style.borderColor = 'transparent'
    av.style.color = '#fff'
    if (nm)   nm.textContent           = user.name || user.email
    if (sbtn) sbtn.style.display       = 'none'
  } else {
    av.textContent = '?'
    av.classList.remove('u')
    av.classList.add('g')
    av.title   = 'Přihlásit se'
    av.onclick = () => window.openAuthPopup?.()
    av.style.background = ''
    av.style.borderColor = ''
    av.style.color = ''
    if (nm)   nm.textContent           = 'Přihlásit se'
    if (sbtn) sbtn.style.display       = ''
  }
}

function renderSettings(user) {
  const nameEl = document.getElementById('set-name')
  const emailEl = document.getElementById('set-email')
  const remEl = document.getElementById('set-reminder')
  const previewEl = document.getElementById('set-avatar-preview')
  const colorsEl = document.getElementById('set-avatar-colors')
  if (!nameEl && !emailEl && !remEl && !previewEl && !colorsEl) return

  if (!user) {
    if (nameEl) nameEl.value = ''
    if (emailEl) emailEl.value = ''
    if (remEl) remEl.value = '24'
    if (previewEl) {
      previewEl.textContent = '?'
      previewEl.style.background = '#2854B9'
    }
    if (colorsEl) colorsEl.innerHTML = ''
    return
  }

  if (nameEl) nameEl.value = user.name ?? ''
  if (emailEl) emailEl.value = user.email ?? ''
  if (remEl) remEl.value = user.reminder_hours != null ? String(user.reminder_hours) : ''
  _renderAvatarColorSettings(user)
}

async function saveSettings() {
  if (!currentUser) return
  const btn = document.getElementById('set-save')
  const nameEl = document.getElementById('set-name')
  const remEl = document.getElementById('set-reminder')
  const selectedAvatarBtn = document.querySelector('#set-avatar-colors .avatar-color-btn.active')
  const name = nameEl ? nameEl.value.trim() : (currentUser.name ?? '')
  const reminder_hours = remEl
    ? (remEl.value === '' ? null : Number(remEl.value))
    : (currentUser.reminder_hours ?? 24)
  const avatar_color = selectedAvatarBtn?.getAttribute('data-avatar-color') || currentUser.avatar_color || '#2854B9'

  if (btn) { btn.disabled = true; btn.textContent = 'Ukládám…' }
  try {
    const { data, error } = await sb
      .from('users')
      .update({ name, reminder_hours, avatar_color })
      .eq('id', currentUser.id)
      .select('id, email, name, role, is_ghost, reminder_hours, avatar_color')
      .single()
    if (error) throw error
    currentUser = { ...currentUser, ...data }
    renderAuthUI(currentUser)
    renderProtectedSections(currentUser)
    renderSettings(currentUser)
    window.showToast?.('Změny byly uloženy.', 'ok')
  } catch (err) {
    console.error('saveSettings:', err)
    window.showToast?.('Nepodařilo se uložit změny: ' + (err.message ?? err), 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Uložit změny' }
  }
}

function _renderAvatarColorSettings(user) {
  const previewEl = document.getElementById('set-avatar-preview')
  const colorsEl = document.getElementById('set-avatar-colors')
  const selected = user?.avatar_color || '#2854B9'
  if (previewEl) {
    previewEl.textContent = getInitials(user?.name || user?.email || '?')
    previewEl.style.background = selected
  }
  if (!colorsEl) return
  colorsEl.innerHTML = AVATAR_COLORS.map(color => `
    <button type="button"
      class="avatar-color-btn${selected === color ? ' active' : ''}"
      data-avatar-color="${color}"
      style="--swatch:${color};"
      title="${color}"
      onclick="window.pickAvatarColor?.('${color}')"></button>
  `).join('')
}

window.pickAvatarColor = (color) => {
  if (!color) return
  const previewEl = document.getElementById('set-avatar-preview')
  if (previewEl) previewEl.style.background = color
  document.querySelectorAll('#set-avatar-colors .avatar-color-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-avatar-color') === color)
  })
}

async function confirmDeleteAccount() {
  if (!currentUser) return
  const btn = document.getElementById('del-continue')
  if (btn) { btn.disabled = true; btn.textContent = 'Probíhá…' }

  // Preferovaná cesta: RPC, která běží jako security definer.
  // Pokud RPC není nasazená, spadne to do catch a upozorníme.
  try {
    const { data, error } = await sb.rpc('request_account_deletion', {
      p_reason: 'user_initiated',
      p_ip_hash: null,
    })
    if (error) throw error
    console.log('request_account_deletion:', data)
  } catch (e) {
    console.error('confirmDeleteAccount:', e)
    alert('Smazání účtu není na backendu ještě aktivní. Je potřeba nasadit SQL funkci `request_account_deletion` (pošlu ji do `FINAL_supabase_sql.sql`).')
    if (btn) { btn.disabled = false; btn.textContent = 'Pokračovat →' }
    return
  }

  // Lokální UI cleanup
  window.closeDeleteAccountModal?.()
  alert('✓ Účet byl anonymizován. Budoucí rezervace byly zrušeny a permanentky zneplatněny.')

  // odhlásíme uživatele (session v auth už zůstane, ale profil email se změnil)
  try { await signOut() } catch (_) {}
  if (btn) { btn.disabled = false; btn.textContent = 'Pokračovat →' }
}

// ── Navigace podle role ───────────────────────────────────────
const _SVG = {
  home:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 10.5L12 3l9 7.5v10.25A1.25 1.25 0 0 1 19.75 22H4.25A1.25 1.25 0 0 1 3 20.75V10.5Z"/></svg>`,
  cal:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>`,
  book:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>`,
  clip:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>`,
  user:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg>`,
  cog:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
}

const _SIDEBAR_CFG = {
  uzivatel: [
    { id: 'nastenka',  label: 'Nástěnka' },
    { id: 'kalendar',  label: 'Kalendář' },
    { id: 'kurzy',     label: 'Kurzy' },
  ],
  lektor: [
    { id: 'nastenka',   label: 'Nástěnka' },
    { id: 'kalendar',   label: 'Kalendář' },
    { id: 'kurzy',      label: 'Kurzy' },
    { id: 'moje-lekce', label: 'Moje lekce' },
  ],
  admin: [
    { section: 'PŘEHLED' },
    { id: 'admin-dashboard', label: 'Dashboard' },
    { id: 'nastenka',       label: 'Nástěnka' },
    { id: 'kalendar',        label: 'Kalendář' },
    { id: 'moje-lekce',     label: 'Moje lekce' },
    { section: 'SPRÁVA' },
    { id: 'admin-kurzy',        label: 'Kurzy' },
    { id: 'admin-permanentky',  label: 'Permanentky' },
    { id: 'admin-zakaznici',    label: 'Zákazníci' },
    { id: 'admin-platby',       label: 'Platby' },
  ],
}

const _BOTTOM_NAV = {
  uzivatel: [
    { id: 'nastenka',  label: 'Nástěnka',  icon: _SVG.home },
    { id: 'kalendar',  label: 'Kalendář',  icon: _SVG.cal  },
    { id: 'kurzy',     label: 'Kurzy',     icon: _SVG.book },
  ],
  lektor: [
    { id: 'nastenka',   label: 'Nástěnka',    icon: _SVG.home },
    { id: 'kalendar',   label: 'Kalendář',    icon: _SVG.cal  },
    { id: 'kurzy',      label: 'Kurzy',       icon: _SVG.book },
    { id: 'moje-lekce', label: 'Moje lekce',  icon: _SVG.clip },
  ],
  admin: [
    { id: 'admin-dashboard', label: 'Přehled',  icon: _SVG.home },
    { id: 'nastenka',       label: 'Nástěnka', icon: _SVG.user },
    { id: 'kalendar',       label: 'Kalendář', icon: _SVG.cal  },
    { id: 'admin-kurzy',    label: 'Kurzy',    icon: _SVG.book },
  ],
}

function renderNavigation(user) {
  const role = user?.role ?? 'uzivatel'
  window.__userRole = role

  const activeId = document.querySelector('.screen.active')?.id?.replace('screen-', '') ?? 'nastenka'

  // Sidebar
  const sidebar = document.getElementById('sidebar')
  if (sidebar) {
    const items = _SIDEBAR_CFG[role] ?? _SIDEBAR_CFG.uzivatel
    let sectionSeen = false
    sidebar.innerHTML = items.map(item => {
      if (item.section) {
        const separated = sectionSeen
        sectionSeen = true
        const sepCls = separated ? ' side-section-label--sep' : ''
        return `<div class="side-section-label${sepCls}">${item.section}</div>`
      }
      return `<button class="side-link${activeId === item.id ? ' active' : ''}" onclick="nav('${item.id}', this)">${item.label}</button>`
    }).join('')
  }

  // Bottom nav
  const bnav = document.getElementById('bottom-nav')
  if (bnav) {
    const items = _BOTTOM_NAV[role] ?? _BOTTOM_NAV.uzivatel
    bnav.innerHTML = items.map(item =>
      `<button${activeId === item.id ? ' class="active"' : ''} onclick="nav('${item.id}', this)">
        ${item.icon}
        ${item.label}
      </button>`
    ).join('')
  }

}

// ── Chráněné sekce: profil ─────────────────────────────────────
function renderProtectedSections(user) {
  const main = document.getElementById('nastenka-content')
  const coursesWrap = document.getElementById('nastenka-courses-wrap')
  const workshopsWrap = document.getElementById('nastenka-workshops-wrap')
  if (!main) return

  if (!user) {
    main.innerHTML = `
      <div class="card">
        <div class="card-title">Vítejte v Ateliéru</div>
        <div class="card-meta">Přihlaste se pro přehled rezervací a permanentek. Nastavení účtu je pod avatarem. Mezitím můžete procházet kurzy a kalendář.</div>
      </div>`
    if (coursesWrap) {
      coursesWrap.style.display = 'none'
      const nc = document.getElementById('nastenka-courses')
      if (nc) nc.innerHTML = ''
    }
    if (workshopsWrap) {
      workshopsWrap.style.display = 'none'
      const nw = document.getElementById('nastenka-workshops')
      if (nw) nw.innerHTML = ''
    }
    return
  }

  {
    const passHtml = (userPasses ?? [])
      .map(up => {
        const p = up.pass
        const name = locJson(p?.name) || 'Permanentka'
        const total = Number(up.entries_total ?? p?.entries_total ?? 0) || 0
        const remaining = Number(up.entries_remaining ?? 0) || 0
        const used = Math.max(0, total - remaining)
        const pct = total ? Math.round((used / total) * 100) : 0
        const exp = up.expires_at ? fmtDate(up.expires_at) : ''
        return `
          <div class="pass-item">
            <div class="pass-top">
              <div>
                <div class="pass-name">${escapeHtml(name)}</div>
                <div class="pass-meta">z ${total} vstupů · platí do ${escapeHtml(exp)}</div>
              </div>
              <div class="pass-count">${remaining}</div>
            </div>
            <div class="bar"><i style="width:${pct}%"></i></div>
          </div>
        `
      })
      .join('')

    main.innerHTML = `
      <div class="profile-head">
        <div class="hello">Dobrý den, ${escapeHtml((user.name || '').split(' ')[0] || user.name || 'uživateli')}</div>
        <div class="subtle">${escapeHtml(user.email || '')}</div>
      </div>

      <div class="section-h">Aktivní permanentky</div>
      ${passHtml || `<div class="empty">Nemáte žádné aktivní permanentky.</div>`}
      ${passHtml ? `
        <div class="card-meta" style="margin-top:10px;">
          V případě potřeby zrušení permanentky a vrácení peněz za zbylé vstupy nás prosím kontaktujte na jatakidu@gmail.com.
        </div>
      ` : ''}

      <div class="section-h">Přihlášené lekce</div>
      ${(myBookings?.length
        ? (myBookings.slice(0, 5).map(b => {
            const lesson = b.lesson
            const course = lesson?.course
            const color = course?.color_code ?? '#2854B9'
            const title = locJson(course?.title)
            const owner = course?.owner?.name ?? '—'
            const when = lesson?.start_time ? fmtBookingWhen(lesson.start_time) : ''
            return `
              <div class="booking-item">
                <div class="bk-left">
                  <span class="dot" style="background:${color}"></span>
                  <div style="min-width:0">
                    <div class="bk-title">${escapeHtml(title || 'Lekce')}</div>
                    <div class="bk-sub">${escapeHtml(when)} · ${escapeHtml(owner)}</div>
                  </div>
                </div>
                <div style="display:flex;gap:10px;align-items:center;">
                  <span class="pill ok">Přihlášena</span>
                  ${canUserCancelBooking(b)
                    ? `<button class="btn-small danger" onclick="window.cancelMyBooking?.('${b.id}')">Odhlásit</button>`
                    : ''}
                </div>
              </div>
            `
          })).join('')
        : `<div class="empty">Zatím nemáte žádné přihlášené lekce.</div>`)}
    `
  }
  window.renderNastenkaMyCourses?.()
}

window.refreshMyAuthUI = async () => {
  if (!currentUser) return
  await refreshUserBookings()
  renderProtectedSections(currentUser)
  window.renderNastenkaMyCourses?.()
}

// aby profil šel vykreslit i po přepnutí sekce (nav() maže obsah)
window.renderProfile = () => renderProtectedSections(currentUser)

window.cancelMyBooking = async (bookingId) => {
  if (!currentUser || !bookingId) return
  const booking = myBookings.find(b => String(b.id) === String(bookingId))
  const cancelState = getUserBookingCancellationState(booking)
  if (booking && !cancelState.allowed) {
    window.showToast?.(getUserBookingCancellationMessage(booking), 'error')
    return
  }
  try {
    const { data, error } = await sb.rpc('cancel_my_pass_booking', {
      p_booking_id: bookingId,
    })
    if (error) throw error
    if (data?.ok === false) {
      const msg = data.error === 'cancel_not_allowed'
        ? getUserBookingCancellationMessage(booking)
        : (data.error || 'Storno se nepodařilo.')
      throw new Error(msg)
    }
    window.showToast?.('Rezervace byla zrušena.', 'ok')
    await refreshMyAuthUI()
  } catch (err) {
    console.error('cancelMyBooking:', err)
    window.showToast?.('Storno se nepodařilo: ' + (err.message ?? err), 'error')
  }
}

function positionAvatarMenu() {
  const menu = document.getElementById('av-menu')
  const av = document.getElementById('av')
  if (!menu || !av) return

  const rect = av.getBoundingClientRect()
  const gap = 8
  const viewportPad = 12

  const prevDisplay = menu.style.display
  const prevVisibility = menu.style.visibility
  const needsMeasure = !menu.classList.contains('on')
  if (needsMeasure) {
    menu.style.visibility = 'hidden'
    menu.style.display = 'block'
  }

  const menuWidth = menu.offsetWidth || 160
  const left = Math.min(
    Math.max(viewportPad, rect.right - menuWidth),
    window.innerWidth - menuWidth - viewportPad,
  )
  const top = rect.bottom + gap

  menu.style.left = `${Math.round(left)}px`
  menu.style.top = `${Math.round(top)}px`

  if (needsMeasure) {
    menu.style.display = prevDisplay
    menu.style.visibility = prevVisibility
  }
}

function toggleAvatarMenu() {
  const menu = document.getElementById('av-menu')
  if (!menu) return
  const nextOpen = !menu.classList.contains('on')
  menu.classList.toggle('on', nextOpen)
  if (nextOpen) {
    positionAvatarMenu()
  }
}

window.addEventListener('resize', () => {
  const menu = document.getElementById('av-menu')
  if (menu?.classList.contains('on')) positionAvatarMenu()
})

window.addEventListener('scroll', () => {
  const menu = document.getElementById('av-menu')
  if (menu?.classList.contains('on')) positionAvatarMenu()
}, true)

// ── Rerendery (registrované z atelier-data.js) ────────────────
let rerenderCalendar       = () => {}
let updateEnrolledOnNastenska = () => {}

export function registerRerenderers(calFn, nastFn) {
  rerenderCalendar          = calFn  ?? (() => {})
  updateEnrolledOnNastenska = nastFn ?? (() => {})
}

// ── Helpers ───────────────────────────────────────────────────
function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
}

function getInitials(nameOrEmail) {
  if (!nameOrEmail) return '?'
  const parts = nameOrEmail.split(/[\s@]/).filter(Boolean)
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : nameOrEmail.slice(0, 2).toUpperCase()
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function locJson(obj) {
  if (!obj) return ''
  if (typeof obj === 'string') return obj
  const l = (document.documentElement?.lang || 'cs').toLowerCase()
  return obj[l] ?? obj.cs ?? obj.en ?? ''
}

function fmtDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

function fmtBookingWhen(iso) {
  const d = new Date(iso)
  const day = d.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' })
  const time = d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
  return `${day} · ${time}`
}

// ── Spuštění ─────────────────────────────────────────────────
initAuth()
