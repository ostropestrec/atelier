// ============================================================
// supabase/functions/stripe-webhook/index.ts
// Stripe volá tento endpoint po úspěšné platbě.
// Vytvoří booking, odešle potvrzovací e-mail.
// ============================================================

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe           from 'https://esm.sh/stripe@13?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})
const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

serve(async (req) => {
  const body      = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''

  // ── 1. Ověření podpisu ────────────────────────────────────
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, signature, Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    )
  } catch {
    return new Response('Webhook signature invalid', { status: 400 })
  }

  if (event.type !== 'checkout.session.completed')
    return new Response('ok', { status: 200 })

  const session = event.data.object as Stripe.Checkout.Session
  const meta    = session.metadata ?? {}
  const { payment_type, user_id, lesson_id, pass_id,
          entries_total, validity_weeks, price_paid } = meta

  if (!user_id || !lesson_id || !payment_type) {
    console.error('Webhook: chybí metadata', meta)
    return new Response('ok', { status: 200 })
  }

  // ── 2. Idempotence — nebookovat dvakrát ──────────────────
  const { data: existing } = await sb
    .from('bookings')
    .select('id')
    .eq('user_id', user_id)
    .eq('lesson_id', lesson_id)
    .eq('status', 'booked')
    .maybeSingle()

  if (existing) return new Response('ok', { status: 200 })

  // ── 3a. Jednorázový vstup ─────────────────────────────────
  if (payment_type === 'single') {
    const { data: lesson } = await sb
      .from('lessons')
      .select('price_single')
      .eq('id', lesson_id)
      .single()

    await sb.from('bookings').insert({
      user_id,
      lesson_id,
      payment_type: 'single',
      price_paid:   lesson?.price_single ?? 0,
      status:       'booked',
      stripe_payment_id: session.id,
    })
  }

  // ── 3b. Permanentka ───────────────────────────────────────
  if (payment_type === 'pass_purchase' && pass_id) {
    const total   = parseInt(entries_total,  10)
    const weeks   = parseInt(validity_weeks, 10)
    const paid    = parseFloat(price_paid)
    const expires = new Date()
    expires.setDate(expires.getDate() + weeks * 7)

    const { data: userPass } = await sb
      .from('user_passes')
      .insert({
        user_id,
        pass_id,
        entries_total:     total,
        entries_remaining: total - 1,   // první vstup hned uplatněn
        price_paid:        paid,
        expires_at:        expires.toISOString(),
        status:            total - 1 > 0 ? 'active' : 'depleted',
        stripe_payment_id: session.id,
      })
      .select('id')
      .single()

    await sb.from('bookings').insert({
      user_id,
      lesson_id,
      user_pass_id:  userPass?.id,
      payment_type:  'pass',
      price_paid:    0,
      status:        'booked',
      stripe_payment_id: session.id,
    })
  }

  // ── 4. Spuštění e-mailové notifikace (viz email-sender) ──
  await sb.functions.invoke('send-email', {
    body: {
      template: 'booking_confirmation',
      user_id,
      lesson_id,
    }
  })

  return new Response('ok', { status: 200 })
})


// ============================================================
// Success page: /rezervace/success
// Načte booking z DB pomocí session_id a zobrazí potvrzení.
// Volá se jako React komponenta nebo plain HTML stránka.
// ============================================================

// success.tsx — React komponenta (Next.js / Vite)

import { useEffect, useState } from 'react'
import { useSearchParams }     from 'react-router-dom'   // nebo next/navigation
import { supabase }            from '@/lib/supabaseClient'

interface BookingDetail {
  id:         string
  lesson:     { start_time: string; end_time: string; price_single: number }
  course:     { title: { cs: string }; color_code: string; owner: { name: string } }
  payment_type: string
  user_pass?: { entries_remaining: number; entries_total: number }
}

export default function SuccessPage() {
  const [params]  = useSearchParams()
  const sessionId = params.get('session_id')
  const [booking, setBooking] = useState<BookingDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) { setError('Chybí session_id.'); setLoading(false); return }
    fetchBooking()
  }, [sessionId])

  async function fetchBooking() {
    // Polling — webhook může dorazit o pár sekund později než redirect
    let attempts = 0
    const MAX    = 8

    while (attempts < MAX) {
      const { data, error: dbErr } = await supabase
        .from('bookings')
        .select(`
          id, payment_type,
          lesson:lessons (
            start_time, end_time, price_single,
            course:courses ( title, color_code, owner:users!owner_id(name) )
          ),
          user_pass:user_passes ( entries_remaining, entries_total )
        `)
        .eq('stripe_payment_id', sessionId)
        .eq('status', 'booked')
        .maybeSingle()

      if (dbErr) { setError(dbErr.message); setLoading(false); return }

      if (data) {
        // Flatten nested join
        const lesson  = Array.isArray(data.lesson)  ? data.lesson[0]  : data.lesson
        const course  = Array.isArray(lesson?.course) ? lesson.course[0] : lesson?.course
        setBooking({ ...data, lesson, course } as BookingDetail)
        setLoading(false)
        return
      }

      // Čekáme 1.5 s a zkusíme znovu
      await new Promise(r => setTimeout(r, 1500))
      attempts++
    }

    setError('Rezervaci se nepodařilo načíst. Zkontroluj e-mail nebo kontaktuj ateliér.')
    setLoading(false)
  }

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat('cs-CZ', {
      weekday: 'short', day: 'numeric', month: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso))

  const fmtPrice = (n: number) =>
    new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }).format(n)

  // ── Stavy ─────────────────────────────────────────────────
  if (loading) return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.spinner} />
        <p style={s.sub}>Potvrzujeme tvoji rezervaci…</p>
      </div>
    </div>
  )

  if (error || !booking) return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={{ ...s.icon, background: '#FCEBEB' }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M11 7v6M11 15v.5" stroke="#791F1F" strokeWidth="1.8" strokeLinecap="round"/>
            <circle cx="11" cy="11" r="9" stroke="#791F1F" strokeWidth="1.2"/>
          </svg>
        </div>
        <h2 style={s.title}>Něco se pokazilo</h2>
        <p style={s.sub}>{error}</p>
        <a href="/" style={s.btn}>Zpět na hlavní stránku</a>
      </div>
    </div>
  )

  const color = booking.course?.color_code ?? '#2854B9'

  return (
    <div style={s.wrap}>
      <div style={{ ...s.card, borderTop: `4px solid ${color}` }}>

        {/* Ikona úspěchu */}
        <div style={{ ...s.icon, background: '#E1F5EE' }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M5 11l4 4 8-8" stroke="#0F6E56" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        <h2 style={s.title}>
          {booking.payment_type === 'pass' ? 'Permanentka zakoupena' : 'Rezervace potvrzena'}
        </h2>
        <p style={s.sub}>Potvrzení jsme ti odeslali na e-mail. Těšíme se na tebe!</p>

        {/* Detail */}
        <div style={s.infoBox}>
          <Row label="Kurz"    value={booking.course?.title?.cs ?? '—'} />
          <Row label="Termín"  value={fmtDate(booking.lesson?.start_time)} />
          <Row label="Lektorka" value={booking.course?.owner?.name ?? '—'} />
          {booking.payment_type === 'single' && (
            <Row label="Zaplaceno" value={fmtPrice(booking.lesson?.price_single ?? 0)} />
          )}
          {booking.user_pass && (
            <Row
              label="Zbývá vstupů"
              value={`${booking.user_pass.entries_remaining} / ${booking.user_pass.entries_total}`}
              color={color}
            />
          )}
        </div>

        {/* Progress bar permanentky */}
        {booking.user_pass && (
          <div style={{ ...s.barWrap, marginBottom: 16 }}>
            <div style={{
              ...s.barFill,
              width: `${(booking.user_pass.entries_remaining / booking.user_pass.entries_total) * 100}%`,
              background: color,
            }} />
          </div>
        )}

        <a href="/" style={{ ...s.btn, background: color }}>
          Přejít na nástěnku
        </a>
        <a href="/kurzy" style={s.btnGhost}>
          Prohlédnout další kurzy
        </a>
      </div>
    </div>
  )
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
      <span style={{ color: '#6b6b6b' }}>{label}</span>
      <span style={{ fontWeight: 500, color: color ?? '#1a1a1a' }}>{value}</span>
    </div>
  )
}

// ── Inline styly ──────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  wrap:    { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f3', padding: 24 },
  card:    { background: '#fff', borderRadius: 12, border: '0.5px solid rgba(0,0,0,.1)', width: '100%', maxWidth: 380, padding: 28, textAlign: 'center' },
  icon:    { width: 52, height: 52, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' },
  title:   { fontSize: 18, fontWeight: 500, color: '#1a1a1a', marginBottom: 6 },
  sub:     { fontSize: 13, color: '#6b6b6b', lineHeight: 1.6, marginBottom: 16 },
  infoBox: { background: '#F8F8F8', borderRadius: 8, padding: '10px 14px', marginBottom: 12, textAlign: 'left' },
  barWrap: { height: 5, background: '#F8F8F8', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3, transition: 'width .4s' },
  btn:     { display: 'block', padding: '11px 0', borderRadius: 8, textDecoration: 'none', color: '#fff', fontSize: 13, fontWeight: 500, marginBottom: 8 },
  btnGhost:{ display: 'block', padding: '10px 0', borderRadius: 8, textDecoration: 'none', color: '#1a1a1a', fontSize: 13, border: '0.5px solid rgba(0,0,0,.18)', marginTop: 4 },
  spinner: { width: 32, height: 32, borderRadius: '50%', border: '2px solid #F8F8F8', borderTopColor: '#2854B9', animation: 'spin .8s linear infinite', margin: '0 auto 16px' },
}
