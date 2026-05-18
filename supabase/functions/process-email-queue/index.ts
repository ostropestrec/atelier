// @ts-nocheck -- Supabase Edge Function bezi v Deno runtime mimo Vite/TS projekt.
/**
 * Odesílá frontu public.email_notification_queue přes Resend.
 *
 * Deploy: Supabase CLI → funkce jako „process-email-queue“, zapnout JWT verify = off
 * pokud ji voláte jen z cronu se service_role.
 *
 * Env (Dashboard → Functions → Secrets):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — často automaticky
 *   RESEND_API_KEY
 *   EMAIL_FROM — např. "Ateliér <rezervace@vasedomena.cz>" (musí být ověřené v Resend)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BATCH = 25

async function sendResend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  text: string,
) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
    }),
  })
  if (!r.ok) {
    const err = await r.text()
    throw new Error(`Resend ${r.status}: ${err}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors() })
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const resend = Deno.env.get('RESEND_API_KEY')
    const from = Deno.env.get('EMAIL_FROM')

    if (!url || !key) {
      return json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500)
    }
    if (!resend || !from) {
      return json({ error: 'Missing RESEND_API_KEY or EMAIL_FROM' }, 500)
    }

    const sb = createClient(url, key)

    const { data: rows, error: selErr } = await sb
      .from('email_notification_queue')
      .select('id, to_email, subject, body_plain')
      .is('processed_at', null)
      .order('created_at', { ascending: true })
      .limit(BATCH)

    if (selErr) throw selErr

    let sent = 0
    const failures: { id: string; message: string }[] = []

    for (const row of rows ?? []) {
      try {
        await sendResend(resend, from, row.to_email, row.subject, row.body_plain)
        const { error: upErr } = await sb
          .from('email_notification_queue')
          .update({ processed_at: new Date().toISOString() })
          .eq('id', row.id)
        if (upErr) throw upErr
        sent++
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        failures.push({ id: row.id, message: msg })
      }
    }

    return json({ ok: true, pending: rows?.length ?? 0, sent, failures })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return json({ ok: false, error: msg }, 500)
  }
})

function cors(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(), 'Content-Type': 'application/json' },
  })
}
