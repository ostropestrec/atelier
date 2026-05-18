// @ts-nocheck -- Supabase Edge Function bezi v Deno runtime mimo Vite/TS projekt.
// Edge Function: delete-account
// Volana z frontendu pres sb.functions.invoke('delete-account').
// Citlive kroky bezi az tady na backendu pres service_role.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() })
  }

  if (req.method !== 'POST') {
    return err(405, 'Method not allowed.')
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceKey) {
      return err(500, 'Serverova konfigurace pro smazani uctu neni kompletni.')
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return err(401, 'Chybi Authorization header.')
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return err(401, 'Chybi prihlasovaci token.')

    const sbAdmin = createClient(supabaseUrl, serviceKey)
    const { data: { user }, error: userErr } = await sbAdmin.auth.getUser(token)
    if (userErr || !user) return err(401, 'Neplatny token.')

    const body = await req.json().catch(() => ({}))
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : null

    // Audit uklada pouze hash IP, ne raw IP adresu.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
    const ipHash = ip ? await sha256(ip) : null

    const { data: result, error: rpcErr } = await sbAdmin.rpc(
      'anonymize_user_account',
      { p_user_id: user.id, p_reason: reason, p_ip_hash: ipHash },
    )

    if (rpcErr) return err(500, rpcErr.message)
    if (result?.error) return err(422, result.error)

    const { error: deleteErr } = await sbAdmin.auth.admin.deleteUser(user.id)
    if (deleteErr) {
      console.error('auth.admin.deleteUser failed:', deleteErr.message)
    }

    return json({
      ok: true,
      future_bookings_cancelled: result.future_bookings_cancelled,
      auth_deleted: !deleteErr,
    })
  } catch (e) {
    console.error('delete-account error:', e)
    return err(500, 'Interni chyba serveru.')
  }
})

function err(status: number, message: string) {
  return json({ error: message }, status)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

async function sha256(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
