// @ts-nocheck -- Referencni Supabase Edge Function pro Deno runtime.
// supabase/functions/delete-account/index.ts
// Edge Function — volaná z frontendu přes sb.functions.invoke()
// Běží se service_role klíčem → může volat auth.admin API.
// Deploy: supabase functions deploy delete-account

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req: Request) => {
  // ─── CORS ─────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() })
  }

  try {
    // ─── Ověření JWT volajícího uživatele ─────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return err(401, 'Chybí Authorization header.')
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return err(401, 'Chybí přihlašovací token.')

    // Service-role klient overi JWT token a nasledne provede privilegovane kroky.
    const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: { user }, error: userErr } = await sbAdmin.auth.getUser(token)
    if (userErr || !user) return err(401, 'Neplatný token.')

    // ─── Tělo požadavku ────────────────────────────────────
    const body   = await req.json().catch(() => ({}))
    const reason = body.reason ?? null

    // Hashování IP pro audit log (SHA-256, ne uložení raw IP)
    const ip     = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
    const ipHash = ip ? await sha256(ip) : null

    // ─── 1. Anonymizace dat v DB (SQL funkce) ──────────────
    const { data: result, error: rpcErr } = await sbAdmin.rpc(
      'anonymize_user_account',
      { p_user_id: user.id, p_reason: reason, p_ip_hash: ipHash }
    )

    if (rpcErr) return err(500, rpcErr.message)
    if (result?.error) return err(422, result.error)

    // ─── 2. Smazání z Supabase Auth ────────────────────────
    // Musí proběhnout PO anonymizaci DB — zachová referenční integritu.
    const { error: deleteErr } = await sbAdmin.auth.admin.deleteUser(user.id)
    if (deleteErr) {
      // Neblokující — data jsou anonymizována, auth smazání lze opakovat.
      console.error('auth.admin.deleteUser failed:', deleteErr.message)
    }

    // ─── 3. Odpověď ────────────────────────────────────────
    return new Response(
      JSON.stringify({
        ok: true,
        future_bookings_cancelled: result.future_bookings_cancelled,
      }),
      { status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
    )

  } catch (e) {
    console.error('delete-account error:', e)
    return err(500, 'Interní chyba serveru.')
  }
})

// ─── Helpers ─────────────────────────────────────────────────
function err(status: number, message: string) {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
  )
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

async function sha256(text: string): Promise<string> {
  const buf    = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
