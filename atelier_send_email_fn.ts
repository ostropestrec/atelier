// ============================================================
// supabase/functions/send-email/index.ts
// Centrální e-mailová Edge Function — 4 šablony.
// Deploy: supabase functions deploy send-email
// ============================================================

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!
const FROM       = Deno.env.get('EMAIL_FROM') ?? 'Ateliér <info@atelier.cz>'
const APP_URL    = Deno.env.get('APP_URL')    ?? 'https://atelier.cz'

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// ── Typy ─────────────────────────────────────────────────────
type Template = 'booking_confirmation' | 'booking_cancelled' | 'lesson_cancelled' | 'lesson_reminder'

interface Payload {
  template:    Template
  user_id?:    string
  lesson_id:   string
  booking_id?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return corsOk()

  let payload: Payload
  try { payload = await req.json() }
  catch { return errRes(400, 'Neplatné JSON tělo.') }

  const { template, user_id, lesson_id, booking_id } = payload
  if (!template || !lesson_id) return errRes(400, 'Chybí template nebo lesson_id.')

  // ── Načtení lekce + kurzu + lektora ──────────────────────
  const { data: lesson, error: lErr } = await sb
    .from('lessons')
    .select(`
      id, start_time, end_time, status,
      course:courses (
        title, color_code, cancellation_hours,
        owner:users!owner_id ( name, email )
      )
    `)
    .eq('id', lesson_id)
    .single()

  if (lErr || !lesson) return errRes(404, 'Lekce nenalezena.')

  const course   = flat(lesson.course)
  const owner    = flat(course?.owner)
  const title    = course?.title?.cs  ?? 'Lekce'
  const color    = course?.color_code ?? '#2854B9'
  const start    = new Date(lesson.start_time)
  const end      = new Date(lesson.end_time)
  const dateStr  = fmtDate(start)
  const timeStr  = `${fmtTime(start)}–${fmtTime(end)}`

  // ── 1. Potvrzení rezervace ────────────────────────────────
  if (template === 'booking_confirmation') {
    if (!user_id) return errRes(400, 'Chybí user_id.')
    const user = await getUser(user_id)
    if (!user) return errRes(404, 'Uživatel nenalezen.')

    await send({
      to:      user.email,
      subject: `✓ Rezervace potvrzena — ${title}`,
      html:    tplConfirm({ name: user.name, title, dateStr, timeStr, color,
                            manageUrl: `${APP_URL}/rezervace?booking=${booking_id ?? ''}` }),
    })
    return okRes({ sent: 1 })
  }

  // ── 2. Storno zákazníkem ──────────────────────────────────
  if (template === 'booking_cancelled') {
    if (!user_id) return errRes(400, 'Chybí user_id.')
    const user = await getUser(user_id)
    if (!user) return errRes(404, 'Uživatel nenalezen.')

    await send({
      to:      user.email,
      subject: `Storno potvrzeno — ${title}`,
      html:    tplCancelled({ name: user.name, title, dateStr, timeStr, color }),
    })
    return okRes({ sent: 1 })
  }

  // ── 3. Zrušení lekce lektorem → všem účastníkům ──────────
  if (template === 'lesson_cancelled') {
    const { data: bookings } = await sb
      .from('bookings')
      .select('user_id, user:users!user_id ( name, email )')
      .eq('lesson_id', lesson_id)
      .eq('status', 'booked')

    if (!bookings?.length) return okRes({ sent: 0 })

    const results = await Promise.allSettled(
      bookings.map(b => {
        const u = flat(b.user)
        return send({
          to:      u.email,
          subject: `Lekce zrušena — ${title} (${dateStr})`,
          html:    tplLessonCancelled({ name: u.name, title, dateStr, timeStr,
                                        color, ownerName: owner?.name ?? '' }),
        })
      })
    )
    const sent = results.filter(r => r.status === 'fulfilled').length
    return okRes({ sent, total: bookings.length })
  }

  // ── 4. Připomínka lekce (voláno cron jobem) ───────────────
  if (template === 'lesson_reminder') {
    if (!user_id) return errRes(400, 'Chybí user_id.')
    const user = await getUser(user_id)
    if (!user) return errRes(404, 'Uživatel nenalezen.')

    await send({
      to:      user.email,
      subject: `Připomínka: ${title} — ${dateStr} v ${fmtTime(start)}`,
      html:    tplReminder({ name: user.name, title, dateStr, timeStr, color }),
    })
    return okRes({ sent: 1 })
  }

  return errRes(400, `Neznámá šablona: ${template}`)
})

// ── Resend API ────────────────────────────────────────────────
async function send({ to, subject, html }: { to: string; subject: string; html: string }) {
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Resend: ${res.status} ${txt}`)
  }
  return res.json()
}

async function getUser(id: string) {
  const { data } = await sb.from('users').select('name, email').eq('id', id).single()
  return data
}

// ── Helpers ───────────────────────────────────────────────────
const flat   = <T>(v: T | T[]): T => Array.isArray(v) ? v[0] : v
const fmtDate = (d: Date) => d.toLocaleDateString('cs-CZ', { weekday:'short', day:'numeric', month:'long', year:'numeric' })
const fmtTime = (d: Date) => d.toLocaleTimeString('cs-CZ', { hour:'2-digit', minute:'2-digit' })

const corsOk  = () => new Response('ok', { headers: { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, content-type' }})
const okRes   = (d: object) => new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type':'application/json' }})
const errRes  = (s: number, m: string) => new Response(JSON.stringify({ error: m }), { status: s })

// ============================================================
// HTML ŠABLONY
// Inline styly — nutné pro Outlook, Gmail, Apple Mail.
// ============================================================

function base(accentColor: string, body: string) {
  return `<!DOCTYPE html>
<html lang="cs">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f3;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
      <tr><td style="background:${accentColor};border-radius:12px 12px 0 0;padding:18px 28px;">
        <span style="font-size:15px;font-weight:500;letter-spacing:.06em;color:#fff;">ATELIER</span>
      </td></tr>
      <tr><td style="background:#fff;padding:28px;border-radius:0 0 12px 12px;border:0.5px solid rgba(0,0,0,.08);">
        ${body}
      </td></tr>
      <tr><td style="padding:16px 0;text-align:center;">
        <span style="font-size:11px;color:#9b9b9b;">
          Atelier &nbsp;·&nbsp;
          <a href="${APP_URL}" style="color:#9b9b9b;text-decoration:none;">atelier.cz</a>
          &nbsp;·&nbsp;
          <a href="${APP_URL}/odhlasit-notifikace" style="color:#9b9b9b;text-decoration:none;">Odhlásit notifikace</a>
        </span>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

function infoTable(rows: [string, string][]) {
  return `<table cellpadding="0" cellspacing="0" style="width:100%;background:#F8F8F8;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
    ${rows.map(([l, v]) => `
    <tr>
      <td style="padding:4px 0;font-size:12px;color:#6b6b6b;width:110px;">${l}</td>
      <td style="padding:4px 0;font-size:12px;font-weight:500;color:#1a1a1a;">${v}</td>
    </tr>`).join('')}
  </table>`
}

function btn(href: string, label: string, color: string) {
  return `<a href="${href}" style="display:inline-block;padding:12px 24px;background:${color};color:#fff;border-radius:8px;font-size:13px;font-weight:500;text-decoration:none;">${label}</a>`
}

// 1. Potvrzení rezervace
function tplConfirm({ name, title, dateStr, timeStr, color, manageUrl }: Record<string, string>) {
  return base(color, `
    <p style="font-size:22px;font-weight:500;color:#1a1a1a;margin:0 0 6px;">Rezervace potvrzena ✓</p>
    <p style="font-size:14px;color:#6b6b6b;margin:0 0 24px;">Ahoj ${name}, tvoje místo je rezervováno.</p>
    ${infoTable([['Kurz', title], ['Datum', dateStr], ['Čas', timeStr]])}
    <p style="font-size:12px;color:#6b6b6b;line-height:1.7;margin:0 0 20px;">
      Pokud se nemůžeš zúčastnit, storno proveď nejpozději 24 hodin předem.
      Pozdní storno nebo absence znamená propadnutí vstupu.
    </p>
    ${btn(manageUrl, 'Spravovat rezervaci', color)}
  `)
}

// 2. Storno zákazníkem
function tplCancelled({ name, title, dateStr, timeStr, color }: Record<string, string>) {
  return base(color, `
    <p style="font-size:22px;font-weight:500;color:#1a1a1a;margin:0 0 6px;">Storno potvrzeno</p>
    <p style="font-size:14px;color:#6b6b6b;margin:0 0 24px;">Ahoj ${name}, tvoje rezervace byla zrušena.</p>
    ${infoTable([['Kurz', title], ['Datum', dateStr], ['Čas', timeStr]])}
    <p style="font-size:12px;color:#6b6b6b;line-height:1.7;margin:0 0 20px;">
      Vstup byl vrácen do tvé peněženky a můžeš ho použít na jiný termín.
    </p>
    ${btn(`${APP_URL}/kurzy`, 'Vybrat jiný termín', color)}
  `)
}

// 3. Zrušení lekce lektorem
function tplLessonCancelled({ name, title, dateStr, timeStr, ownerName }: Record<string, string>) {
  return base('#791F1F', `
    <p style="font-size:22px;font-weight:500;color:#1a1a1a;margin:0 0 6px;">Lekce byla zrušena</p>
    <p style="font-size:14px;color:#6b6b6b;margin:0 0 24px;">Ahoj ${name}, bohužel musíme zrušit následující lekci.</p>
    ${infoTable([['Kurz', title], ['Datum', dateStr], ['Čas', timeStr], ['Lektor', ownerName]])}
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#FFF8F7;border:0.5px solid #F0C0BB;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
      <tr><td style="font-size:12px;color:#791F1F;line-height:1.7;">
        Vstup byl automaticky vrácen do tvé peněženky.
        Pokud jsi platila jednorázově, refundaci provedeme do 5–10 pracovních dní.
      </td></tr>
    </table>
    ${btn(`${APP_URL}/kurzy`, 'Vybrat náhradní termín', '#2854B9')}
  `)
}

// 4. Připomínka lekce
function tplReminder({ name, title, dateStr, timeStr, color }: Record<string, string>) {
  return base(color, `
    <p style="font-size:22px;font-weight:500;color:#1a1a1a;margin:0 0 6px;">Připomínka lekce 🕐</p>
    <p style="font-size:14px;color:#6b6b6b;margin:0 0 24px;">Ahoj ${name}, připomínáme nadcházející lekci.</p>
    ${infoTable([['Kurz', title], ['Datum', dateStr], ['Čas', timeStr]])}
    <p style="font-size:12px;color:#6b6b6b;line-height:1.7;margin:0 0 20px;">
      Pokud se nemůžeš zúčastnit, zruš rezervaci včas — nejpozději 24 hodin předem.
    </p>
    ${btn(APP_URL, 'Otevřít můj profil', color)}
  `)
}
