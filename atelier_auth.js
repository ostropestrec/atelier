// ============================================================
// atelier-auth.js — Auth & session layer (finální)
// Magic Link, Google/Apple OAuth, ghost účty, enrolled stav.
// Použití: <script type="module" src="atelier-auth.js"></script>
// ============================================================

import { sb } from './atelier-supabase.js'
import { entriesWordFrom, t } from './translations.js'
import {
  PARTICIPATION_STATUS,
  VISIBLE_USER_PARTICIPATION_STATUSES,
} from './atelier-booking-status.js'

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

const CHANGE_PASSWORD_TIMEOUT_MS = 15000
const PROFILE_UPDATE_TIMEOUT_MS = 12000
const SIGN_OUT_TIMEOUT_MS = 6000

/** Obalí libovolné asynchronní volání timeoutem; ten brání zamrznutí UI při nedostupném serveru. */
function _withTimeout(promise, ms, label) {
  return Promise.race([
    Promise.resolve(promise).then(value => ({ kind: 'ok', value }), error => ({ kind: 'err', error })),
    new Promise(resolve => setTimeout(() => resolve({ kind: 'timeout', label }), ms)),
  ])
}

function _buildPasswordChangePayload() {
  const currentPw = document.getElementById('set-pw-current')?.value ?? ''
  const pw1 = document.getElementById('set-pw1')?.value ?? ''
  const pw2 = document.getElementById('set-pw2')?.value ?? ''
  const wantsChange = !!(currentPw || pw1 || pw2)
  if (!wantsChange) return null
  if (!pw1 || !pw2) throw new Error('Pro změnu hesla vyplň obě pole nového hesla.')
  if (pw1.length < 8) throw new Error('Heslo musí mít alespoň 8 znaků.')
  if (pw1 !== pw2) throw new Error('Hesla se neshodují.')
  return currentPw.trim()
    ? { password: pw1, current_password: currentPw }
    : { password: pw1 }
}

function _clearPasswordSettingsFields() {
  ;['set-pw-current', 'set-pw1', 'set-pw2'].forEach(id => {
    const e = document.getElementById(id)
    if (e) e.value = ''
  })
}

async function _savePasswordSettingsIfNeeded(payload) {
  if (!payload) return { changed: false, status: 'noop' }

  const result = await Promise.race([
    sb.auth.updateUser(payload)
      .then(({ error }) => ({ kind: 'result', error }))
      .catch(error => ({ kind: 'thrown', error })),
    new Promise(resolve => setTimeout(() => resolve({ kind: 'timeout' }), CHANGE_PASSWORD_TIMEOUT_MS)),
  ])

  if (result?.kind === 'timeout') {
    return { changed: true, status: 'timeout' }
  }

  if (result?.kind === 'thrown') throw result.error
  if (result?.error) throw result.error

  _clearPasswordSettingsFields()
  return { changed: true, status: 'saved' }
}

function _mapPasswordChangeError(err) {
    const rawMsg = String(err?.message ?? err ?? '')
    const msg = rawMsg.toLowerCase()
  if (msg.includes('reauthentication') || msg.includes('update password requires') || msg.includes('current password')) {
    return 'Tato změna vyžaduje i současné heslo. Doplň ho do prvního pole a zkus to znovu.'
  }
  if (msg.includes('same password')) {
    return 'Nové heslo musí být jiné než současné.'
  }
  return rawMsg
}

function langPick(cs, en) {
  const l = (document.documentElement?.lang || 'cs').toLowerCase()
  return l.startsWith('en') ? en : cs
}

window.__passwordRecoveryMode = false

function _readAuthRedirectState() {
  const search = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''))
  return {
    error: search.get('error') || hash.get('error') || '',
    errorCode: search.get('error_code') || hash.get('error_code') || '',
    errorDescription: search.get('error_description') || hash.get('error_description') || '',
    type: search.get('type') || hash.get('type') || '',
  }
}

function _cleanAuthRedirectUrl() {
  try {
    const url = new URL(window.location.href)
    ;['error', 'error_code', 'error_description', 'code', 'type'].forEach(k => url.searchParams.delete(k))
    const hash = new URLSearchParams((url.hash || '').replace(/^#/, ''))
    const authHashKeys = ['access_token', 'refresh_token', 'expires_at', 'expires_in', 'token_type', 'type', 'error', 'error_code', 'error_description']
    const hasAuthHash = authHashKeys.some(k => hash.has(k))
    if (hasAuthHash) url.hash = ''
    history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
  } catch (_) { /* ignore */ }
}

function _syncPasswordRecoveryUi() {
  const helperEl = document.getElementById('set-pw-helper')
  const currentFieldEl = document.getElementById('set-pw-current-field')
  const currentPwEl = document.getElementById('set-pw-current')
  const currentLabelEl = document.getElementById('set-pw-current-label')
  const recovery = !!window.__passwordRecoveryMode

  if (helperEl) {
    helperEl.textContent = recovery
      ? 'Obnova hesla přes e-mailový odkaz: vyplňte nové heslo a potvrzení, pak klikněte na „Uložit změny“. Současné heslo není potřeba.'
      : 'Nastavte nebo změňte heslo pro přihlášení e-mailem a heslem. Pokud to bude Supabase vyžadovat, vyplňte i současné heslo. Heslo se uloží spolu s tlačítkem „Uložit změny“ níže.'
  }
  if (currentFieldEl) currentFieldEl.style.display = recovery ? 'none' : ''
  if (currentPwEl) {
    currentPwEl.disabled = recovery
    if (recovery) currentPwEl.value = ''
  }
  if (currentLabelEl) {
    currentLabelEl.textContent = recovery ? 'Současné heslo (není potřeba)' : 'Současné heslo'
  }
}

function _enterPasswordRecoveryMode() {
  window.__passwordRecoveryMode = true
  _syncPasswordRecoveryUi()
  requestAnimationFrame(() => {
    window.nav?.('nastaveni')
    window.showToast?.(
      'Odkaz pro obnovu hesla je platný. V Nastavení vyplň nové heslo a klikni na „Uložit změny“.',
      'ok',
    )
    document.getElementById('set-pw1')?.focus()
  })
}

function _handleAuthRedirectFeedback() {
  const info = _readAuthRedirectState()
  if (!info.errorCode && !info.error && !info.type) return info

  if (info.errorCode === 'otp_expired') {
    requestAnimationFrame(() => {
      window.showToast?.('Odkaz pro obnovu hesla vypršel nebo už byl použit. Pošli si prosím nový.', 'error')
      window.openAuthPopup?.()
    })
    _cleanAuthRedirectUrl()
    return info
  }

  if (info.error || info.errorCode) {
    requestAnimationFrame(() => {
      const detail = decodeURIComponent(String(info.errorDescription || '').replace(/\+/g, ' '))
      window.showToast?.(
        detail || 'Přihlašovací nebo obnovovací odkaz je neplatný. Zkuste si vyžádat nový.',
        'error',
      )
      window.openAuthPopup?.()
    })
    _cleanAuthRedirectUrl()
  }

  return info
}

// ── Inicializace ──────────────────────────────────────────────
export async function initAuth() {
  const redirectInfo = _handleAuthRedirectFeedback()
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
      if (redirectInfo?.type === 'recovery') {
        _cleanAuthRedirectUrl()
        _enterPasswordRecoveryMode()
      }
    } else {
      renderAuthUI(null)
      renderProtectedSections(null)
      _syncPasswordRecoveryUi()
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
      case 'PASSWORD_RECOVERY':
        await onSessionChange(session)
        _cleanAuthRedirectUrl()
        _enterPasswordRecoveryMode()
        break
      case 'SIGNED_OUT':
        currentUser = null
        userBookings.clear()
        window.AppState.user = null
        window.AppState.role = 'uzivatel'
        window.__passwordRecoveryMode = false
        renderAuthUI(null)
        renderProtectedSections(null)
        _syncPasswordRecoveryUi()
        if (typeof window.refreshPublicData === 'function') {
          void window.refreshPublicData()
        } else {
          rerenderCalendar()
        }
        break
      case 'USER_UPDATED':
        await loadUserProfile(session.user.id)
        renderAuthUI(currentUser)
        renderProtectedSections(currentUser)
        _syncPasswordRecoveryUi()
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
      // Ghost merge musí proběhnout PŘED loadUserProfile (případně přepíše id existujícího ghost
      // záznamu na auth.user.id). Pro vracející se uživatele je celá funkce no-op díky localStorage flagu.
      await mergeGhostIfNeeded(session.user)
      // Profil, rezervace, permanentky a moje lekce jsou nezávislé — všechny paralelně.
      await Promise.all([
        loadUserProfile(session.user.id),
        loadUserBookings(session.user.id),
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
    if (typeof window.refreshPublicData === 'function') {
      await window.refreshPublicData()
    } else {
      rerenderCalendar()
    }
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
    .in('status', VISIBLE_USER_PARTICIPATION_STATUSES)

  if (error) { console.error('loadUserBookings:', error); return }
  userBookings = new Set(data.map(b => b.lesson_id))
}

export async function loadUserPasses(userId) {
  if (!userId) { userPasses = []; return }
  // Reconcile je idempotentní a slouží k údržbě — nesmí blokovat první render.
  // Spustíme ho fire-and-forget; pokud doběhne za chvíli, příští refresh už uvidí přepočítané zůstatky.
  const now = Date.now()
  if (now - _lastPassReconcileAt >= PASS_RECONCILE_COOLDOWN_MS) {
    _lastPassReconcileAt = now
    sb.rpc('reconcile_my_pass_balances')
      .then(({ error: recErr }) => {
        if (recErr) {
          console.warn('[Auth] reconcile_my_pass_balances:', recErr)
          _lastPassReconcileAt = 0
        }
      })
      .catch(e => {
        console.warn('[Auth] reconcile_my_pass_balances', e)
        _lastPassReconcileAt = 0
      })
  }
  const { data, error } = await sb
    .from('user_passes')
    .select(`
      id, entries_total, entries_remaining, cancellation_count, expires_at, status,
      pass:passes ( id, name, entries_total, price, validity_weeks, allowed_course_ids, color_code )
    `)
    .eq('user_id', userId)
    .in('status', ['active', 'depleted'])
    .order('expires_at', { ascending: true })

  if (error) { console.error('loadUserPasses:', error); userPasses = []; return }
  userPasses = data ?? []
}

export async function loadMyBookings(userId) {
  if (!userId) { myBookings = []; return }

  const { data, error } = await sb
    .from('bookings')
    .select(`
      id, status, payment_type, user_pass_id, lesson_id, created_at,
      user_pass:user_passes ( id, entries_total, cancellation_count ),
      lesson:lessons (
        id, start_time, end_time,
        course:courses ( id, title, color_code, is_workshop, cancellation_hours, owner:users ( name ) )
      )
    `)
    .eq('user_id', userId)
    .in('status', VISIBLE_USER_PARTICIPATION_STATUSES)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('loadMyBookings:', error)
    const fb = await sb
      .from('bookings')
      .select('id, status, payment_type, user_pass_id, lesson_id, created_at')
      .eq('user_id', userId)
      .in('status', VISIBLE_USER_PARTICIPATION_STATUSES)
      .order('created_at', { ascending: false })
    if (fb.error) {
      console.error('loadMyBookings fallback:', fb.error)
      myBookings = []
      return
    }
    myBookings = fb.data ?? []
    return
  }
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
  const ctx = _resolveBookingLessonContext(booking)
  const startTs = ctx?.startTime ? new Date(ctx.startTime).getTime() : NaN
  const cancellationHours = ctx?.cancellationHours
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
  _refreshUserOverviewUI()
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
// Inline onclick v auth popupu běží v globálním scope, proto musí být OAuth handler na window.
window.signInWithProvider = signInWithProvider

// ── Sign out ──────────────────────────────────────────────────
/**
 * Odhlášení s timeoutem. Pokud Supabase do SIGN_OUT_TIMEOUT_MS neodpoví
 * (např. visící síť, mrtvý token), provedeme lokální cleanup, ať UI nezamrzne.
 */
export async function signOut() {
  const previousUserId = currentUser?.id ?? null

  const result = await _withTimeout(
    sb.auth.signOut({ scope: 'local' }),
    SIGN_OUT_TIMEOUT_MS,
    'sign-out',
  )

  if (result.kind === 'err') {
    console.warn('[Auth] signOut() vrátil chybu:', result.error?.message ?? result.error)
  } else if (result.kind === 'timeout') {
    console.warn('[Auth] signOut() timeout, dělám lokální cleanup.')
  }

  // Lokální cleanup spustíme vždy. Pokud onAuthStateChange → SIGNED_OUT
  // přijde později, jen znovu projde stejnými řádky (idempotentní).
  if (currentUser?.id === previousUserId) {
    currentUser = null
    userBookings.clear()
    userPasses = []
    myBookings = []
    window.AppState.user = null
    window.AppState.role = 'uzivatel'
    window.__userRole = 'uzivatel'
    try { renderAuthUI(null) } catch (_) {}
    try { renderProtectedSections(null) } catch (_) {}
    try { rerenderCalendar() } catch (_) {}
  }

  if (result.kind === 'timeout') {
    window.showToast?.(
      'Server neodpověděl, ale byla jsi odhlášena lokálně. Zkus stránku obnovit.',
      'ok',
    )
  }
}

// aby fungovalo onclick="window.signOut?.()" v index.html
window.signOut = signOut

// ── Ghost → plný účet ─────────────────────────────────────────
/** Stav „ghost už byl vyřešen pro tento e-mail" cachujeme v localStorage, ať na každém loadu nepouštíme zbytečný SELECT. */
const _GHOST_FLAG_PREFIX = 'atelier:ghost_resolved:'
function _ghostResolvedKey(email) {
  return _GHOST_FLAG_PREFIX + String(email ?? '').trim().toLowerCase()
}
function _isGhostResolved(email) {
  try { return localStorage.getItem(_ghostResolvedKey(email)) === '1' }
  catch (_) { return false }
}
function _markGhostResolved(email) {
  try { localStorage.setItem(_ghostResolvedKey(email), '1') }
  catch (_) { /* localStorage zablokovaný — to nevadí, příště se provede znovu */ }
}

async function mergeGhostIfNeeded(authUser) {
  if (!authUser?.email) return
  // Returning user → přeskočit (95 % loadů). Flag se nastavuje jen po úspěšném průchodu.
  if (_isGhostResolved(authUser.email)) return

  const { error } = await sb.rpc('resolve_ghost_account')
  if (error) {
    console.warn('[Ghost merge] resolve_ghost_account selhala:', error.message)
    // Záměrně NEoznačujeme jako resolved — příště se pokusí znovu.
    return
  }
  _markGhostResolved(authUser.email)
}

// ── Návrat na rozpracovanou rezervaci po přihlášení ───────────
const BOOKING_RETURN_KEY = 'atelier_booking_return'
const LEGACY_PENDING_KEY = 'pending_booking'

/** Uloží kontext před auth (detail kurzu / kurzy + volitelný termín). */
export function saveBookingReturn({
  courseId,
  lessonId = null,
  lessonIds = null,
  paymentType = null,
  passId = null,
  buyPassTemplateId = null,
  preferredPayValue = null,
  openBooking = true,
  screen = null,
}) {
  if (!courseId) return
  const activeScreen = screen
    ?? (document.getElementById('screen-detail-kurzu')?.classList.contains('active')
      ? 'detail-kurzu'
      : 'kurzy')
  sessionStorage.setItem(
    BOOKING_RETURN_KEY,
    JSON.stringify({
      screen: activeScreen,
      courseId,
      lessonId: lessonId ?? null,
      lessonIds: lessonIds ?? null,
      paymentType: paymentType ?? null,
      passId: passId ?? null,
      buyPassTemplateId: buyPassTemplateId ?? null,
      preferredPayValue: preferredPayValue ?? null,
      openBooking: !!openBooking,
    }),
  )
}

function _readBookingReturn() {
  const raw = sessionStorage.getItem(BOOKING_RETURN_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed?.courseId) return parsed
    } catch (e) {
      console.warn('[Auth] atelier_booking_return: invalid JSON', e)
    }
  }
  const legacy = sessionStorage.getItem(LEGACY_PENDING_KEY)
  if (!legacy) return null
  try {
    const { course_id, lesson_id } = JSON.parse(legacy)
    if (!course_id) return null
    return { screen: 'kurzy', courseId: course_id, lessonId: lesson_id ?? null, openBooking: true }
  } catch {
    return null
  }
}

/** Po přihlášení obnoví detail/kurzy a případně otevře booking popup. Vrátí true pokud navigaci převzala. */
export async function resumeBookingAfterAuth() {
  if (!currentUser) return false
  const ret = _readBookingReturn()
  if (!ret?.courseId) return false

  sessionStorage.removeItem(BOOKING_RETURN_KEY)
  sessionStorage.removeItem(LEGACY_PENDING_KEY)

  window._detailCourseId = ret.courseId
  if (ret.screen === 'detail-kurzu') {
    window.nav?.('detail-kurzu')
  } else {
    window.nav?.('kurzy')
  }

  if (typeof window.refreshPublicData === 'function') {
    await window.refreshPublicData()
  }

  window._cardState ??= {}
  window._cardState[ret.courseId] = {
    lessonId: ret.lessonId ?? null,
    lessonIds: Array.isArray(ret.lessonIds) ? ret.lessonIds : [],
    paymentType: ret.paymentType ?? 'single',
    passId: ret.passId ?? null,
    buyPassTemplateId: ret.buyPassTemplateId ?? null,
  }

  if (ret.openBooking) {
    await new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    })
    await window.openBookingPopup?.(
      ret.courseId,
      ret.passId ?? null,
      ret.lessonId ?? null,
      ret.preferredPayValue ?? null,
      ret.lessonIds ?? null,
      { showResumeBanner: true },
    )
  }
  return true
}

function handlePendingBooking() {
  void resumeBookingAfterAuth()
}

window.__resumeBookingAfterAuth = resumeBookingAfterAuth

// ── Auth popup (Magic Link formulář) ─────────────────────────
window.openAuthPopup = (opts = {}) => {
  let overlay = document.getElementById('auth-overlay')
  if (!overlay) {
    buildAuthPopup()
    overlay = document.getElementById('auth-overlay')
  }
  if (overlay) overlay.style.display = 'flex'
}

window.closeAuthPopup = () => {
  const overlay = document.getElementById('auth-overlay')
  if (overlay) overlay.style.display = 'none'
}

// ── Přihlášení heslem ─────────────────────────────────────────
window.submitPasswordLogin = async () => {
  const email  = document.getElementById('auth-login-email-input')?.value.trim()
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

  if (btn) { btn.disabled = false; btn.textContent = 'Přihlásit' }
  if (error) {
    if (errEl) { errEl.textContent = _authErr(error.message); errEl.style.display = 'block' }
  } else {
    window.closeAuthPopup?.()
  }
}

// ── Magic link ────────────────────────────────────────────────
window.submitForgotPassword = async () => {
  const input = document.getElementById('auth-login-email-input')
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

  if (btn) { btn.disabled = false; btn.textContent = 'Poslat přihlašovací odkaz' }
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
  if (pass.length < 8) {
    if (errEl) { errEl.textContent = 'Heslo musí mít alespoň 8 znaků.'; errEl.style.display = 'block' }
    return
  }
  if (pass !== pass2) {
    if (errEl) { errEl.textContent = 'Hesla se neshodují.'; errEl.style.display = 'block' }
    return
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Registruji…' }

  const { data, error } = await sb.auth.signUp({ email, password: pass })

  if (btn) { btn.disabled = false; btn.textContent = 'Registrovat se' }
  if (error) {
    if (errEl) { errEl.textContent = _authErr(error.message); errEl.style.display = 'block' }
  } else if (data?.session) {
    window.closeAuthPopup?.()
    void resumeBookingAfterAuth()
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
  if (m.includes('password should be at least') || m.includes('weak password'))
    return 'Heslo je příliš slabé. Použij alespoň 8 znaků.'
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

const _INP  = 'width:100%;padding:8px 10px;border:0.5px solid rgba(0,0,0,.18);border-radius:8px;font-size:14px;margin-bottom:8px;box-sizing:border-box;'
const _BTN  = 'width:100%;padding:10px;border-radius:var(--btn-radius);border:none;background:#2854B9;color:#fff;font-size:14px;font-weight:500;cursor:pointer;'
const _ERR  = 'display:none;font-size:13px;color:#791F1F;background:#FCEBEB;border-radius:6px;padding:8px 10px;margin-bottom:8px;'
const _OK   = 'display:none;font-size:13px;color:#085041;background:#E1F5EE;border-radius:6px;padding:8px 10px;margin-bottom:8px;'
const _LBL  = 'font-size:13px;color:#6b6b6b;display:block;margin-bottom:4px;'
const _DIV  = 'display:flex;align-items:center;gap:8px;margin:10px 0;'
const _AUTH_CARD = 'border:0.5px solid rgba(0,0,0,.12);border-radius:12px;padding:12px;background:#fff;'
const _AUTH_H = 'font-size:14px;font-weight:700;color:#111;margin-bottom:3px;'
const _AUTH_P = 'font-size:12px;color:#6b6b6b;line-height:1.45;margin-bottom:10px;'

function buildAuthPopup() {
  if (document.getElementById('auth-overlay')) return

  document.body.insertAdjacentHTML('beforeend', `
    <div id="auth-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.38);
      display:none;align-items:center;justify-content:center;z-index:200;padding:16px;"
      onclick="if(event.target===this)closeAuthPopup()">
      <div style="background:#fff;border-radius:12px;border:0.5px solid rgba(0,0,0,.18);
        width:100%;max-width:380px;overflow:hidden;" onclick="event.stopPropagation()">

        <!-- Taby -->
        <div style="display:flex;border-bottom:0.5px solid rgba(0,0,0,.08);">
          <button id="auth-tab-login" onclick="authSwitchTab('login')"
            style="flex:1;padding:11px;font-size:13px;font-weight:500;border:none;background:transparent;
              cursor:pointer;color:#2854B9;border-bottom:2px solid #2854B9;">
            Přihlásit se
          </button>
          <button id="auth-tab-register" onclick="authSwitchTab('register')"
            style="flex:1;padding:11px;font-size:13px;font-weight:500;border:none;background:transparent;
              cursor:pointer;color:#6b6b6b;border-bottom:2px solid transparent;">
            Registrace
          </button>
        </div>

        <div style="padding:16px;">

          <!-- Google (sdílené) -->
          <button onclick="signInWithProvider('google')"
            style="width:100%;padding:9px 12px;border-radius:var(--btn-radius);border:0.5px solid rgba(0,0,0,.18);
              background:transparent;display:flex;align-items:center;gap:8px;font-size:14px;
              font-weight:500;color:#1a1a1a;cursor:pointer;margin-bottom:2px;">
            ${_GOOGLE_SVG} Pokračovat přes Google
          </button>

          <div style="${_DIV}">
            <div style="flex:1;height:0.5px;background:rgba(0,0,0,.08);"></div>
            <span style="font-size:12px;color:#9b9b9b;">nebo</span>
            <div style="flex:1;height:0.5px;background:rgba(0,0,0,.08);"></div>
          </div>

          <!-- ── Formulář: přihlášení ── -->
          <div id="auth-form-login">
            <div id="auth-error" style="${_ERR}"></div>
            <div id="auth-sent" style="${_OK}">✓ Přihlašovací odkaz odeslán. Zkontroluj schránku.</div>

            <div style="${_AUTH_CARD};margin-bottom:10px;">
              <div style="${_AUTH_H}">Jednoduše bez hesla</div>
              <div style="${_AUTH_P}">Bez nutnosti registrace ti pošleme odkaz na e-mail.</div>
              <label style="${_LBL}">E-mail</label>
              <input id="auth-email-input" type="email" placeholder="jmeno@email.cz"
                onkeydown="if(event.key==='Enter')submitMagicLink()"
                style="${_INP}" />
              <button id="auth-magic-btn" onclick="submitMagicLink()" style="${_BTN}">
                Poslat přihlašovací odkaz
              </button>
            </div>

            <div style="${_DIV}">
              <div style="flex:1;height:0.5px;background:rgba(0,0,0,.08);"></div>
              <span style="font-size:12px;color:#9b9b9b;">nebo</span>
              <div style="flex:1;height:0.5px;background:rgba(0,0,0,.08);"></div>
            </div>

            <div style="${_AUTH_CARD}">
              <div style="${_AUTH_H}margin-bottom:10px;">Registrovaný uživatel</div>
              <label style="${_LBL}">E-mail</label>
              <input id="auth-login-email-input" type="email" placeholder="jmeno@email.cz"
                onkeydown="if(event.key==='Enter')submitPasswordLogin()"
                style="${_INP}" />
              <label style="${_LBL}">Heslo</label>
              <input id="auth-pass-input" type="password" placeholder="········"
                onkeydown="if(event.key==='Enter')submitPasswordLogin()"
                style="${_INP}" />
              <button id="auth-submit-btn" onclick="submitPasswordLogin()" style="${_BTN}">
                Přihlásit
              </button>
              <div style="text-align:center;margin-top:10px;">
                <button type="button" id="auth-forgot-link" onclick="submitForgotPassword()"
                  style="background:none;border:none;color:#2854B9;font-size:13px;cursor:pointer;padding:0;">
                  Zapomenuté heslo?
                </button>
              </div>
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
              background:transparent;font-size:13px;color:#1a1a1a;cursor:pointer;">
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
    av.style.display = ''
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
    av.style.display = 'none'
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
    document.getElementById('av-menu')?.classList.remove('on')
    if (document.getElementById('screen-nastenka')?.classList.contains('active')) {
      window.nav?.('kalendar')
    }
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
    _syncPasswordRecoveryUi()
    return
  }

  if (nameEl) nameEl.value = user.name ?? ''
  if (emailEl) emailEl.value = user.email ?? ''
  if (remEl) remEl.value = user.reminder_hours != null ? String(user.reminder_hours) : ''
  _renderAvatarColorSettings(user)
  _syncPasswordRecoveryUi()
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
  let passwordPayload = null

  if (btn) { btn.disabled = true; btn.textContent = 'Ukládám…' }
  try {
    passwordPayload = _buildPasswordChangePayload()

    const profileQuery = sb
      .from('users')
      .update({ name, reminder_hours, avatar_color })
      .eq('id', currentUser.id)
      .select('id, email, name, role, is_ghost, reminder_hours, avatar_color')
      .single()

    const profileResult = await _withTimeout(profileQuery, PROFILE_UPDATE_TIMEOUT_MS, 'profile-update')

    if (profileResult.kind === 'timeout') {
      window.showToast?.(
        'Uložení nastavení trvá příliš dlouho. Server pravděpodobně neodpověděl — zkus to znovu nebo obnov stránku.',
        'error',
      )
      return
    }
    if (profileResult.kind === 'err') throw profileResult.error
    const { data, error } = profileResult.value
    if (error) throw error

    currentUser = { ...currentUser, ...data }
    renderAuthUI(currentUser)
    renderProtectedSections(currentUser)
    renderSettings(currentUser)

    const passwordResult = await _savePasswordSettingsIfNeeded(passwordPayload)
    if (passwordResult.status === 'saved') {
      if (window.__passwordRecoveryMode && passwordPayload) {
        window.__passwordRecoveryMode = false
        _syncPasswordRecoveryUi()
      }
      window.showToast?.('Změny profilu i hesla byly uloženy.', 'ok')
    } else if (passwordResult.status === 'timeout') {
      window.showToast?.(
        'Profil byl uložen. U hesla se potvrzení opozdilo, ale změna se mohla uložit. Ověř ho prosím novým přihlášením v anonymním okně.',
        'ok',
      )
    } else {
      window.showToast?.('Změny byly uloženy.', 'ok')
    }
  } catch (err) {
    console.error('saveSettings:', err)
    const passwordErr = _mapPasswordChangeError(err)
    window.showToast?.('Nepodařilo se uložit změny: ' + passwordErr, 'error')
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

  try {
    const { data, error } = await sb.functions.invoke('delete-account', {
      body: { reason: 'user_initiated' },
    })

    if (error) {
      let msg = t(_uiLocale(), 'pages.deleteAccountFailToast')
      try {
        const body = await error.context?.json?.()
        if (body?.error && typeof body.error === 'string') msg = body.error
      } catch (_) { /* ponechat výchozí msg */ }
      console.error('confirmDeleteAccount:', error)
      window.showToast?.(msg, 'error')
      if (btn) { btn.disabled = false; btn.textContent = 'Pokračovat →' }
      return
    }

    if (data?.error) {
      window.showToast?.(String(data.error), 'error')
      if (btn) { btn.disabled = false; btn.textContent = 'Pokračovat →' }
      return
    }

    window.closeDeleteAccountModal?.()
    window.showToast?.(t(_uiLocale(), 'pages.deleteAccountSuccessToast'), 'ok')

    try { await signOut() } catch (_) {}

    try {
      window.nav?.('nastenka')
    } catch (navErr) {
      console.warn('confirmDeleteAccount nav:', navErr)
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Pokračovat →' }
  } catch (e) {
    console.error('confirmDeleteAccount:', e)
    window.showToast?.(
      t(_uiLocale(), 'pages.deleteAccountFailToast')
        + (e?.message ? ` (${e.message})` : ''),
      'error',
    )
    if (btn) { btn.disabled = false; btn.textContent = 'Pokračovat →' }
  }
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

function _uiLocale() {
  return typeof window !== 'undefined' && window.__uiLang === 'en' ? 'en' : 'cs'
}

function _navT(path) {
  return t(_uiLocale(), path)
}

function _sidebarActiveId(screenId, role) {
  if (screenId === 'detail-kurzu') {
    return role === 'admin' || role === 'lektor' ? 'admin-kurzy' : 'kurzy'
  }
  if (screenId === 'sprava') return 'admin-dashboard'
  if (screenId === 'nastenka' && role === 'admin') return 'admin-dashboard'
  return screenId
}

const _SIDEBAR_CFG = {
  guest: [
    { id: 'kalendar',  key: 'nav.calendar' },
    { id: 'kurzy',     key: 'nav.courses' },
    { id: 'manual',    key: 'nav.manual' },
  ],
  uzivatel: [
    { id: 'nastenka',  key: 'nav.overview' },
    { id: 'kalendar',  key: 'nav.calendar' },
    { id: 'kurzy',     key: 'nav.courses' },
    { id: 'permanentky', key: 'nav.passes' },
    { id: 'manual',    key: 'nav.manual' },
  ],
  lektor: [
    { id: 'nastenka',          key: 'nav.overview' },
    { id: 'kalendar',          key: 'nav.calendar' },
    { section: 'nav.sectionManagement' },
    { id: 'moje-lekce',        key: 'nav.myLessons' },
    { id: 'admin-kurzy',        key: 'nav.courses' },
    { id: 'admin-permanentky',  key: 'nav.passes' },
    { id: 'lektor-historie',   key: 'nav.history' },
    { id: 'manual',            key: 'nav.manual' },
  ],
  admin: [
    { id: 'admin-dashboard', key: 'nav.overview' },
    { id: 'kalendar',        key: 'nav.calendar' },
    { section: 'nav.sectionManagement' },
    { id: 'moje-lekce',     key: 'nav.myLessons' },
    { id: 'admin-kurzy',        key: 'nav.courses' },
    { id: 'admin-permanentky',  key: 'nav.passes' },
    { id: 'admin-zakaznici',    key: 'nav.customers' },
    { id: 'admin-platby',       key: 'nav.payments' },
    { id: 'manual',          key: 'nav.manual' },
  ],
}

const _BOTTOM_NAV = {
  guest: [
    { id: 'kalendar',  key: 'nav.calendar',  icon: _SVG.cal  },
    { id: 'kurzy',     key: 'nav.courses',   icon: _SVG.book },
    { id: 'manual',    key: 'nav.manual',    icon: _SVG.clip },
  ],
  uzivatel: [
    { id: 'nastenka',  key: 'nav.overview',  icon: _SVG.home },
    { id: 'kalendar',  key: 'nav.calendar',  icon: _SVG.cal  },
    { id: 'kurzy',     key: 'nav.courses',     icon: _SVG.book },
    { id: 'manual',    key: 'nav.manual',    icon: _SVG.clip },
  ],
  lektor: [
    { id: 'nastenka',     key: 'nav.overview',   icon: _SVG.home },
    { id: 'kalendar',     key: 'nav.calendar',   icon: _SVG.cal  },
    { id: 'moje-lekce',   key: 'nav.myLessons', icon: _SVG.clip },
    { id: 'admin-kurzy',  key: 'nav.courses',      icon: _SVG.book },
    { id: 'lektor-historie', key: 'nav.history', icon: _SVG.clip },
  ],
  admin: [
    { id: 'admin-dashboard', key: 'nav.overview',  icon: _SVG.home },
    { id: 'kalendar',       key: 'nav.calendar', icon: _SVG.cal  },
    { id: 'admin-kurzy',    key: 'nav.courses',    icon: _SVG.book },
  ],
}

export function renderNavigation(user) {
  const role = user ? (user.role ?? 'uzivatel') : 'guest'
  window.__userRole = role
  document.documentElement.dataset.userRole = role

  const rawActiveId = document.querySelector('.screen.active')?.id?.replace('screen-', '')
  const activeScreenId = (!user && rawActiveId === 'nastenka')
    ? 'kalendar'
    : (rawActiveId ?? (user ? 'nastenka' : 'kalendar'))
  const activeId = _sidebarActiveId(activeScreenId, role)

  // Sidebar
  const sidebar = document.getElementById('sidebar')
  if (sidebar) {
    const items = _SIDEBAR_CFG[role] ?? _SIDEBAR_CFG.uzivatel
    /** `--sep` jen když už nad sekcí jsou odkazy (ne první „prázdný“ section bez položek nad). */
    let hasNavLinksAbove = false
    sidebar.innerHTML = items.map(item => {
      if (item.section) {
        const sepCls = hasNavLinksAbove ? ' side-section-label--sep' : ''
        return `<div class="side-section-label${sepCls}">${_navT(item.section)}</div>`
      }
      hasNavLinksAbove = true
      return `<button class="side-link${activeId === item.id ? ' active' : ''}" data-nav-id="${item.id}" onclick="nav('${item.id}', this)">${_navT(item.key)}</button>`
    }).join('')
  }

  // Bottom nav
  const bnav = document.getElementById('bottom-nav')
  if (bnav) {
    const items = _BOTTOM_NAV[role] ?? _BOTTOM_NAV.uzivatel
    bnav.innerHTML = items.map(item =>
      `<button${activeId === item.id ? ' class="active"' : ''} data-nav-id="${item.id}" onclick="nav('${item.id}', this)">
        ${item.icon}
        ${_navT(item.key)}
      </button>`
    ).join('')
  }

  window.syncActiveNavigation?.(activeScreenId)
}

function pickPassTheme(hex) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(hex || '').trim()) ? String(hex).trim() : '#C4806E'
}

/** Bezpečná barva kurzu pro inline styly (rámečky, tečky). */
function _overviewCourseHex(hex) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(hex || '').trim()) ? String(hex).trim() : '#2854B9'
}

function passCardSurface(hex) {
  const h = pickPassTheme(hex)
  return `background:${h}18;border:1px solid ${h}44;`
}

/** Kurzy na aktivní permanentce (stejné pilulky jako katalog / admin). */
function overviewPassCourseTagsHtml(allowedIds, colorHex) {
  const ph = pickPassTheme(colorHex)
  const locale = _uiLocale()
  const hdr = t(locale, 'nav.courses')
  const pill = txt =>
    `<span class="pass-shop-tag" style="background:${ph}22;color:${ph};">${escapeHtml(txt)}</span>`
  const courses = window.AppState?.courses ?? []
  const ids = Array.isArray(allowedIds) ? allowedIds : []
  let inner
  if (!ids.length) {
    inner = pill(t(locale, 'catalog.validAllCourses'))
  } else {
    const labels = ids
      .map(id => {
        const c = courses.find(x => String(x.id) === String(id))
        return c ? locJson(c.title) : ''
      })
      .filter(Boolean)
    inner = labels.length
      ? labels.map(l => pill(l)).join('')
      : pill(t(locale, 'catalog.selectedCoursesDetail'))
  }
  return `
    <div class="pass-shop-scope-heading">${hdr}</div>
    <div class="pass-shop-course-tags">${inner}</div>`
}

function _overviewLocale() {
  return window.__uiLang === 'en' ? 'en' : 'cs'
}

/** Časová hranice lekce pro filtr „nadcházející“ — i když embed lesson v SELECT selže. */
function _bookingLessonBoundary(booking) {
  const lesson = booking?.lesson
  if (lesson?.end_time || lesson?.start_time) {
    return lesson.end_time ?? lesson.start_time
  }
  const lid = booking?.lesson_id
  if (!lid) return null
  const fromState = (window.AppState?.upcomingLessons ?? []).find(l => {
    const id = String(l.lesson_id ?? l.id)
    return id === String(lid)
  })
  return fromState?.end_time ?? fromState?.start_time ?? null
}

/** Termín + kurz pro přehled / storno — embed z DB nebo AppState. */
function _resolveBookingLessonContext(booking) {
  const lesson = booking?.lesson
  const course = lesson?.course
  if (lesson?.start_time && course) {
    return {
      startTime: lesson.start_time,
      cancellationHours: Number(course.cancellation_hours),
      courseId: course.id,
    }
  }
  const lid = booking?.lesson_id
  if (!lid) return null
  const fromState = (window.AppState?.upcomingLessons ?? []).find(l => {
    const id = String(l.lesson_id ?? l.id)
    return id === String(lid)
  })
  const c = fromState
    ? (window.AppState?.courses ?? []).find(x => x.id === fromState.course_id)
    : null
  if (!fromState?.start_time || !c) return null
  return {
    startTime: fromState.start_time,
    cancellationHours: Number(c.cancellation_hours),
    courseId: c.id,
  }
}

function _bookingLessonDisplay(booking) {
  const lesson = booking?.lesson
  const course = lesson?.course
  if (course?.title) {
    return {
      courseId: course.id,
      title: locJson(course.title),
      color: _overviewCourseHex(course.color_code),
      owner: course.owner?.name ?? '—',
      when: lesson?.start_time ? fmtBookingWhen(lesson.start_time) : '',
    }
  }
  const lid = booking?.lesson_id
  const fromState = (window.AppState?.upcomingLessons ?? []).find(l => {
    const id = String(l.lesson_id ?? l.id)
    return id === String(lid)
  })
  const c = fromState
    ? (window.AppState?.courses ?? []).find(x => x.id === fromState.course_id)
    : null
  return {
    courseId: fromState?.course_id ?? c?.id ?? '',
    title: c ? locJson(c.title) : t(_overviewLocale(), 'dashboard.lessonFallback'),
    color: _overviewCourseHex(c?.color_code),
    owner: Array.isArray(c?.owner) ? c.owner[0]?.name : (c?.owner?.name ?? '—'),
    when: fromState?.start_time ? fmtBookingWhen(fromState.start_time) : '',
  }
}

// ── Chráněné sekce: profil / přehled uživatele ─────────────────
export function buildUserGreetingHtml(user) {
  if (!user) return ''
  const locale = _overviewLocale()
  const first = (user.name || '').split(' ')[0]
  const helloName = first || user.name || t(locale, 'dashboard.userYou')
  return `
    <div class="profile-head">
      <div class="profile-head-text">
        <div class="hello">${escapeHtml(t(locale, 'dashboard.hello', { name: helloName }))}</div>
        <div class="subtle">${escapeHtml(user.email || '')}</div>
      </div>
    </div>`
}

export function buildUserOverviewHtml(user) {
  const locale = _overviewLocale()
  if (!user) {
    return `
      <div class="card">
        <div class="card-title">${escapeHtml(t(locale, 'dashboard.guestTitle'))}</div>
        <div class="card-meta">${escapeHtml(t(locale, 'dashboard.guestMeta'))}</div>
      </div>`
  }

  const passHtml = (userPasses ?? [])
      .filter(up => up.status !== 'depleted')
      .map(up => {
        const p = up.pass
        const name = locJson(p?.name) || t(locale, 'dashboard.passFallback')
        const total = Number(up.entries_total ?? p?.entries_total ?? 0) || 0
        const remaining = Number(up.entries_remaining ?? 0) || 0
        const used = Math.max(0, total - remaining)
        const pct = total ? Math.round((used / total) * 100) : 0
        const ph = pickPassTheme(p?.color_code)
        const exp = up.expires_at ? fmtDate(up.expires_at) : ''
        const cancellationCount = Number(up.cancellation_count ?? 0)
        const cancellationLimit = passCancellationLimit(total)
        const cancellationHtml = cancellationCount > 0 && cancellationLimit > 0
          ? `<div class="pass-meta" style="margin-top:4px;">${escapeHtml(t(locale, 'dashboard.passCancellations', {
            used: cancellationCount,
            limit: cancellationLimit,
          }))}</div>`
          : ''
        return `
          <div class="pass-item" style="${passCardSurface(ph)}">
            <div class="pass-top">
              <div>
                <div class="pass-name">${escapeHtml(name)}</div>
                <div class="pass-meta">${escapeHtml(t(locale, 'dashboard.passMeta', {
                  remaining,
                  total,
                  date: exp,
                  entriesWordFrom: entriesWordFrom(locale, total),
                }))}</div>
                ${cancellationHtml}
              </div>
              <div class="pass-count" style="color:${ph};">${remaining}</div>
            </div>
            ${overviewPassCourseTagsHtml(p?.allowed_course_ids, p?.color_code)}
            <div class="bar"><i style="width:${pct}%;background:${ph};"></i></div>
          </div>
        `
      })
      .join('')

  const nowMs = Date.now()
  const upcomingBookings = (myBookings ?? []).filter(b => {
    const boundary = _bookingLessonBoundary(b)
    return boundary ? new Date(boundary).getTime() >= nowMs : false
  })

  const bookingsHtml = upcomingBookings.map(b => {
    const disp = _bookingLessonDisplay(b)
    const color = disp.color
    const title = disp.title
    const owner = disp.owner
    const when = disp.when
    const statusKey = b.status === PARTICIPATION_STATUS.PENDING_PAYMENT
      ? 'dashboard.bookingPendingPayment'
      : 'dashboard.bookingConfirmed'
    return `
      <div class="booking-item" style="border:1px solid ${color};">
        <div class="bk-left">
          <span class="dot" style="background:${color}"></span>
          <div style="min-width:0">
            <div class="bk-title">
              <a href="javascript:void(0)" onclick="window.openDetail?.('${disp.courseId ?? ''}')"
                style="color:inherit;text-decoration:none;">
                ${escapeHtml(title || t(locale, 'dashboard.lessonFallback'))}
              </a>
            </div>
            <div class="bk-sub">${escapeHtml(when)} · ${escapeHtml(owner)}</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
          <span class="pill ok">${escapeHtml(t(locale, statusKey))}</span>
          ${canUserCancelBooking(b)
            ? `<button class="btn-small danger" onclick="window.cancelMyBooking?.('${b.id}')">${escapeHtml(t(locale, 'dashboard.unenroll'))}</button>`
            : ''}
        </div>
      </div>
    `
  }).join('')

  const first = (user.name || '').split(' ')[0]
  const helloName = first || user.name || t(locale, 'dashboard.userYou')

  return `
    <div class="profile-head">
      <div class="profile-head-text">
        <div class="hello">${escapeHtml(t(locale, 'dashboard.hello', { name: helloName }))}</div>
        <div class="subtle">${escapeHtml(user.email || '')}</div>
      </div>
      <img class="profile-head-art" src="./assets/atelier-overview-clouds.png" alt="" loading="lazy" aria-hidden="true" />
    </div>

    <div class="section-h">${escapeHtml(t(locale, 'dashboard.sectionPasses'))}</div>
    ${passHtml ? `<div class="nastenka-cards-2col">${passHtml}</div>` : `<div class="empty">${escapeHtml(t(locale, 'dashboard.emptyPasses'))}</div>`}
    ${passHtml ? `
      <div class="card-meta" style="margin-top:10px;">
        ${escapeHtml(t(locale, 'dashboard.refundNote'))}
      </div>
    ` : ''}

    <div class="section-h">${escapeHtml(t(locale, 'dashboard.sectionBookings'))}</div>
    ${bookingsHtml ? `<div class="nastenka-cards-2col">${bookingsHtml}</div>` : `<div class="empty">${escapeHtml(t(locale, 'dashboard.emptyBookings'))}</div>`}
  `
}

function _isAdminOnDashboard() {
  const role = window.__userRole ?? currentUser?.role ?? 'uzivatel'
  return role === 'admin' && document.getElementById('screen-admin-dashboard')?.classList.contains('active')
}

function _isLektorOnOverview() {
  const role = window.__userRole ?? currentUser?.role ?? 'uzivatel'
  return role === 'lektor' && document.getElementById('screen-nastenka')?.classList.contains('active')
}

function renderProtectedSections(user) {
  const main = document.getElementById('nastenka-content')
  if (!main) return
  const role = window.__userRole ?? user?.role ?? 'uzivatel'
  if (role === 'lektor') {
    if (typeof window.renderLektorDashboard === 'function') {
      void window.renderLektorDashboard()
    } else {
      main.innerHTML = `<div class="empty" style="padding:40px;">${escapeHtml(t(_overviewLocale(), 'admin.loading.overview'))}</div>`
    }
    return
  }
  main.innerHTML = buildUserOverviewHtml(user)
}

function _refreshUserOverviewUI() {
  if (_isAdminOnDashboard()) {
    void window.__refreshAdminScreen?.('admin-dashboard')
    return
  }
  if (_isLektorOnOverview()) {
    void window.__refreshAdminScreen?.('nastenka')
    return
  }
  renderProtectedSections(currentUser)
}


window.refreshMyAuthUI = async () => {
  if (!currentUser) return
  await refreshUserBookings()
  _refreshUserOverviewUI()
}

// aby profil šel vykreslit i po přepnutí sekce (nav() maže obsah)
window.renderProfile = () => _refreshUserOverviewUI()

window.cancelMyBooking = async (bookingId) => {
  if (!currentUser || !bookingId) return
  const locale = _overviewLocale()
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
        : (data.error || t(locale, 'booking.toast.cancelFailedShort'))
      throw new Error(msg)
    }
    window.showToast?.(t(locale, 'booking.toast.cancelled'), 'ok')
    await refreshMyAuthUI()
  } catch (err) {
    console.error('cancelMyBooking:', err)
    window.showToast?.(t(locale, 'booking.toast.cancelFailPrefix') + (err.message ?? err), 'error')
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
  const l = window.__uiLang === 'en' ? 'en' : 'cs'
  return obj[l] ?? obj.cs ?? obj.en ?? ''
}

function _overviewDateLocaleTag() {
  return window.__uiLang === 'en' ? 'en-GB' : 'cs-CZ'
}

function fmtDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(_overviewDateLocaleTag(), { day: 'numeric', month: 'numeric', year: 'numeric' })
}

function fmtBookingWhen(iso) {
  const d = new Date(iso)
  const tag = _overviewDateLocaleTag()
  const day = d.toLocaleDateString(tag, { weekday: 'short', day: 'numeric', month: 'numeric' })
  const time = d.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' })
  return `${day} · ${time}`
}

// ── Spuštění ─────────────────────────────────────────────────
initAuth()
