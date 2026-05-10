// ============================================================
// supabase/functions/send-email/index.ts
// Centrální e-mailová Edge Function.
// Používá Resend (resend.com) — jednoduchá API, CZ doručitelnost.
// Deploy: supabase functions deploy send-email
//
// Env proměnné (Supabase Secrets):
//   RESEND_API_KEY   → z resend.com/api-keys
//   EMAIL_FROM       → "Ateliér <info@atelier.cz>"
//   APP_URL          → "https://atelier.cz"
// ============================================================

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!
const FROM       = Deno.env.get('EMAIL_FROM') ?? 'Ateliér <info@atelier.cz>'
const APP_URL    = Deno.env.get('APP_URL')    ?? 'https://atelier.cz'

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ── Typy šablon ───────────────────────────────────────────────
type Template =
  | 'booking_confirmation'   // potvrzení rezervace
  | 'booking_cancelled'      // storno zákazníkem
  | 'lesson_cancelled'       // lekce zrušena lektorem → všem účastníkům
  | 'lesson_reminder'        // připomínka X hodin před lekcí

interface Payload {
  template:   Template
  user_id?:   string
  lesson_id:  string
  booking_id?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return cors('ok')

  const payload: Payload = await req.json()
  const { template, user_id, lesson_id, booking_id } = payload

  // ── Načtení dat ──────────────────────────────────────────
  const { data: lesson } = await sb
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

  if (!lesson) return err(404, 'Lekce nenalezena.')

  const course  = Array.isArray(lesson.course)  ? lesson.course[0]  : lesson.course
  const owner   = Array.isArray(course?.owner)  ? course.owner[0]   : course?.owner
  const title   = course?.title?.cs ?? 'Lekce'
  const color   = course?.color_code ?? '#2854B9'
  const start   = new Date(lesson.start_time)
  const dateStr = fmtDate(start)
  const timeStr = `${fmtTime(start)}–${fmtTime(new Date(lesson.end_time))}`

  // ── Dispatch ─────────────────────────────────────────────
  if (template === 'booking_confirmation' && user_id) {
    const user = await getUser(user_id)
    if (!user) return err(404, 'Uživatel nenalezen.')

    const manageUrl = `${APP_URL}/rezervace?booking=${booking_id ?? ''}`

    await sendEmail({
      to:      user.email,
      subject: `✓ Rezervace potvrzena — ${title}`,
      html:    bookingConfirmationHtml({ name: user.name, title, dateStr, timeStr, color, manageUrl }),
    })
  }

  if (template === 'booking_cancelled' && user_id) {
    const user = await getUser(user_id)
    if (!user) return err(404, 'Uživatel nenalezen.')

    await sendEmail({
      to:      user.email,
      subject: `Storno rezervace — ${title}`,
      html:    bookingCancelledHtml({ name: user.name, title, dateStr, timeStr, color }),
    })
  }

  if (template === 'lesson_cancelled') {
    // Načteme všechny přihlášené zákazníky
    const { data: bookings } = await sb
      .from('bookings')
      .select('user_id, user:users!user_id ( name, email )')
      .eq('lesson_id', lesson_id)
      .eq('status', 'booked')

    if (!bookings?.length) return ok({ sent: 0 })

    const results = await Promise.allSettled(
      bookings.map(b => {
        const u = Array.isArray(b.user) ? b.user[0] : b.user
        return sendEmail({
          to:      u.email,
          subject: `Lekce zrušena — ${title} (${dateStr})`,
          html:    lessonCancelledHtml({ name: u.name, title, dateStr, timeStr, color, ownerName: owner?.name ?? '' }),
        })
      })
    )

    return ok({ sent: results.filter(r => r.status === 'fulfilled').length })
  }

  if (template === 'lesson_reminder' && user_id) {
    const user = await getUser(user_id)
    if (!user) return err(404, 'Uživatel nenalezen.')

    await sendEmail({
      to:      user.email,
      subject: `Připomínka: ${title} zítra v ${fmtTime(start)}`,
      html:    lessonReminderHtml({ name: user.name, title, dateStr, timeStr, color }),
    })
  }

  return ok({ ok: true })
})

// ── Resend API call ───────────────────────────────────────────
async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Resend error: ${txt}`)
  }
  return res.json()
}

async function getUser(id: string) {
  const { data } = await sb.from('users').select('name, email').eq('id', id).single()
  return data
}

// ── Helpers ───────────────────────────────────────────────────
const fmtDate = (d: Date) =>
  d.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

const fmtTime = (d: Date) =>
  d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })

const cors = (body: string) => new Response(body, {
  headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' }
})
const ok  = (data: object) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
const err = (status: number, msg: string) => new Response(JSON.stringify({ error: msg }), { status })

// ============================================================
// E-MAILOVÉ ŠABLONY
// Minimalistický HTML e-mail kompatibilní s Gmail, Outlook, Apple Mail.
// Inline styly jsou nutností pro e-mailové klienty.
// ============================================================

function base(color: string, content: string) {
  return `<!DOCTYPE html>
<html lang="cs">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f3;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <!-- Header -->
        <tr><td style="background:${color};border-radius:12px 12px 0 0;padding:20px 28px;">
          <span style="font-size:16px;font-weight:500;letter-spacing:.06em;color:#fff;">ATELIER</span>
        </td></tr>
        <!-- Body -->
        <tr><td style="background:#fff;padding:28px;border-radius:0 0 12px 12px;border:0.5px solid rgba(0,0,0,.08);">
          ${content}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 0;text-align:center;font-size:11px;color:#9b9b9b;">
          Atelier · <a href="${APP_URL}" style="color:#9b9b9b;">atelier.cz</a> · 
          <a href="${APP_URL}/odhlasit-notifikace" style="color:#9b9b9b;">Odhlásit notifikace</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function infoRow(label: string, value: string) {
  return `<tr>
    <td style="padding:5px 0;font-size:12px;color:#6b6b6b;width:120px;">${label}</td>
    <td style="padding:5px 0;font-size:12px;font-weight:500;color:#1a1a1a;">${value}</td>
  </tr>`
}

// 1. Potvrzení rezervace ────────────────────────────────────
function bookingConfirmationHtml({ name, title, dateStr, timeStr, color, manageUrl }: {
  name: string; title: string; dateStr: string; timeStr: string; color: string; manageUrl: string
}) {
  return base(color, `
    <p style="font-size:22px;font-weight:500;color:#1a1a1a;margin:0 0 6px;">Rezervace potvrzena ✓</p>
    <p style="font-size:14px;color:#6b6b6b;margin:0 0 24px;">Ahoj ${name}, tvoje místo je rezervováno.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#F8F8F8;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
      ${infoRow('Kurz',    title)}
      ${infoRow('Datum',   dateStr)}
      ${infoRow('Čas',     timeStr)}
    </table>
    <p style="font-size:13px;color:#6b6b6b;line-height:1.6;margin:0 0 20px;">
      Pokud se nemůžeš zúčastnit, storno proveď nejpozději 24 hodin před lekcí. Pozdní storno nebo absence znamená propadnutí vstupu.
    </p>
    <a href="${manageUrl}" style="display:inline-block;padding:12px 24px;background:${color};color:#fff;border-radius:8px;font-size:13px;font-weight:500;text-decoration:none;">
      Spravovat rezervaci
    </a>
  `)
}

// 2. Storno zákazníkem ─────────────────────────────────────
function bookingCancelledHtml({ name, title, dateStr, timeStr, color }: {
  name: string; title: string; dateStr: string; timeStr: string; color: string
}) {
  return base(color, `
    <p style="font-size:22px;font-weight:500;color:#1a1a1a;margin:0 0 6px;">Storno potvrzeno</p>
    <p style="font-size:14px;color:#6b6b6b;margin:0 0 24px;">Ahoj ${name}, tvoje rezervace byla zrušena.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#F8F8F8;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
      ${infoRow('Kurz',  title)}
      ${infoRow('Datum', dateStr)}
      ${infoRow('Čas',   timeStr)}
    </table>
    <p style="font-size:13px;color:#6b6b6b;line-height:1.6;margin:0 0 20px;">
      Vstup byl vrácen do tvé peněženky a můžeš ho použít na jiný termín.
    </p>
    <a href="${APP_URL}/kurzy" style="display:inline-block;padding:12px 24px;background:${color};color:#fff;border-radius:8px;font-size:13px;font-weight:500;text-decoration:none;">
      Vybrat jiný termín
    </a>
  `)
}

// 3. Zrušení lekce lektorem ────────────────────────────────
function lessonCancelledHtml({ name, title, dateStr, timeStr, color, ownerName }: {
  name: string; title: string; dateStr: string; timeStr: string; color: string; ownerName: string
}) {
  return base('#791F1F', `
    <p style="font-size:22px;font-weight:500;color:#1a1a1a;margin:0 0 6px;">Lekce byla zrušena</p>
    <p style="font-size:14px;color:#6b6b6b;margin:0 0 24px;">Ahoj ${name}, bohužel musíme zrušit následující lekci.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#F8F8F8;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
      ${infoRow('Kurz',    title)}
      ${infoRow('Datum',   dateStr)}
      ${infoRow('Čas',     timeStr)}
      ${infoRow('Lektor',  ownerName)}
    </table>
    <div style="background:#FFF8F7;border:0.5px solid #F0C0BB;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
      <p style="font-size:12px;color:#791F1F;margin:0;line-height:1.6;">
        Vstup byl automaticky vrácen do tvé peněženky. Pokud jsi platila jednorázově, refundaci provedem do 5–10 pracovních dní.
      </p>
    </div>
    <a href="${APP_URL}/kurzy" style="display:inline-block;padding:12px 24px;background:${color};color:#fff;border-radius:8px;font-size:13px;font-weight:500;text-decoration:none;">
      Vybrat náhradní termín
    </a>
  `)
}

// 4. Připomínka lekce ──────────────────────────────────────
function lessonReminderHtml({ name, title, dateStr, timeStr, color }: {
  name: string; title: string; dateStr: string; timeStr: string; color: string
}) {
  return base(color, `
    <p style="font-size:22px;font-weight:500;color:#1a1a1a;margin:0 0 6px;">Připomínka lekce 🕐</p>
    <p style="font-size:14px;color:#6b6b6b;margin:0 0 24px;">Ahoj ${name}, připomínáme nadcházející lekci.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#F8F8F8;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
      ${infoRow('Kurz',  title)}
      ${infoRow('Datum', dateStr)}
      ${infoRow('Čas',   timeStr)}
    </table>
    <p style="font-size:13px;color:#6b6b6b;line-height:1.6;margin:0 0 20px;">
      Pokud se nemůžeš zúčastnit, zruš rezervaci včas (nejpozději 24h předem).
    </p>
    <a href="${APP_URL}" style="display:inline-block;padding:12px 24px;background:${color};color:#fff;border-radius:8px;font-size:13px;font-weight:500;text-decoration:none;">
      Otevřít můj profil
    </a>
  `)
}
