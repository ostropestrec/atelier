// ============================================================
// atelier-supabase.js — shared Supabase client (finální)
// Importujte z ostatních modulů: `import { sb } from './atelier-supabase.js'`
// ============================================================

// Záměrně verze @2.49.1 + ?bundle: nepřipnutý jsdelivr/+esm umí stáhnout spoustu dílčích souborů
// (@supabase/gotrue-js, …) a v Network pak vidíš 404 na jednotlivých chunk URL.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1?bundle'

// ── Konfigurace (pevně v souboru — tento projekt nepoužívá .env v repu) ──
const SUPABASE_URL_RAW = 'https://ijjjucxjmowesokbmjgd.supabase.co'
/** Jedna canonical base URL — bez koncového „/“, createClient neskladá „//auth“ ani dvojí segmenty. */
const SUPABASE_URL = String(SUPABASE_URL_RAW)
  .trim()
  .replace(/\/+$/, '')

const SUPABASE_ANON = 'sb_publishable_ptD30AGQ9-j7X-WdYiqCSw_ciZtgpQR'

if (typeof SUPABASE_URL !== 'string' || !SUPABASE_URL.trim().startsWith('http')) {
  console.error('[Supabase] KRITICKÁ CHYBA: SUPABASE_URL je prázdná nebo neplatná — zkontroluj atelier-supabase.js')
}
if (typeof SUPABASE_ANON !== 'string' || SUPABASE_ANON.trim().length < 32) {
  console.error(
    '[Supabase] KRITICKÁ CHYBA: SUPABASE_ANON je prázdný nebo příliš krátký — klient se nemůže autentizovat k API',
  )
}

// Minimální klient — žádný třetí argument (auth/storage volby by na localhostu mohly matovat při diagnostice).
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON)

/** Volá se před prvním síťovým dotazem z atelier-data.js — ověření, že nejedeme s prázdnou konfigurací. */
export function logSupabaseClientDebug() {
  const u = String(SUPABASE_URL ?? '').trim()
  const k = String(SUPABASE_ANON ?? '').trim()
  const rest = `${u.replace(/\/$/, '')}/rest/v1/`
  console.log('[Debug] Supabase klient před prvním fetch:', {
    createClient: typeof createClient === 'function',
    supabaseUrl: u || '(PRÁZDNÁ)',
    urlLooksLikeProject:
      /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(u) && u.length > 20,
    anonKeyChars: k.length,
    anonKeyPrefix: k ? `${k.slice(0, 16)}…` : '(CHYBÍ)',
    restV1: rest,
    note: 'Proměnné jsou jen v atelier-supabase.js — žádný .env / config.js v tomto buildu.',
  })
}

