// ============================================================
// atelier-gdpr.js
// Funkce deleteUserAccount + varovný dialog v UI profilu.
// Import: <script type="module" src="atelier-gdpr.js"></script>
// ============================================================

import { sb } from './atelier-supabase.js'
import { currentUser } from './atelier_auth.js'

// ─── 1. CORE FUNKCE ──────────────────────────────────────────
export async function deleteUserAccount({ reason = null } = {}) {
  if (!currentUser) {
    return { error: 'Nejsi přihlášen.' }
  }

  // Volání Edge Function (service_role logika probíhá na serveru)
  const { data, error } = await sb.functions.invoke('delete-account', {
    body: { reason },
  })

  if (error) {
    console.error('deleteUserAccount:', error)
    return { error: error.message ?? 'Smazání selhalo.' }
  }

  if (data?.error) {
    return { error: data.error }
  }

  // ─── Lokální cleanup ──────────────────────────────────────
  // Session zrušíme lokálně (auth záznam je smazán na serveru,
  // signOut() tedy může vrátit chybu — ignorujeme ji záměrně).
  try { await sb.auth.signOut() } catch (_) {}

  return {
    ok: true,
    cancelledBookings: data?.future_bookings_cancelled ?? 0,
  }
}

// ─── 2. VAROVNÝ DIALOG ───────────────────────────────────────
// Třístupňový dialog: Úvod → Potvrzení → Probíhá / Hotovo
// Vkládá se dynamicky do DOM, čistí se po sobě.

export function openDeleteAccountDialog(lang = 'cs') {
  // Zabráníme duplicitnímu otevření
  if (document.getElementById('gdpr-overlay')) return

  const t = (cs, en) => lang === 'cs' ? cs : en

  const overlay = document.createElement('div')
  overlay.id = 'gdpr-overlay'
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.45);
    display:flex;align-items:center;justify-content:center;z-index:300;
    padding:16px;
  `

  overlay.innerHTML = `
    <div id="gdpr-box" style="
      background:#fff;border-radius:12px;
      border:0.5px solid rgba(0,0,0,0.18);
      width:100%;max-width:400px;overflow:hidden;
    ">

      <!-- KROK 1: Informace -->
      <div id="gdpr-step-1">
        <div style="padding:20px 20px 0;">
          <div style="
            width:44px;height:44px;border-radius:50%;background:#FCEBEB;
            display:flex;align-items:center;justify-content:center;margin-bottom:14px;
          ">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 3v8M10 15v.5" stroke="#791F1F" stroke-width="1.8"
                stroke-linecap="round"/>
              <circle cx="10" cy="10" r="8.5" stroke="#791F1F" stroke-width="1"/>
            </svg>
          </div>
          <div style="font-size:15px;font-weight:500;color:#1a1a1a;margin-bottom:6px;">
            ${t('Smazat účet', 'Delete account')}
          </div>
          <div style="font-size:12px;color:#6b6b6b;line-height:1.6;margin-bottom:14px;">
            ${t(
              'Tato akce je nevratná. Před pokračováním si přečti, co se stane:',
              'This action is irreversible. Read what will happen before continuing:'
            )}
          </div>

          <div style="
            background:#f5f5f3;border-radius:8px;
            padding:12px 14px;margin-bottom:16px;
          ">
            ${[
              [t('Budoucí rezervace', 'Future bookings'),
               t('Budou automaticky stornovány a vstupy vráceny.', 'Will be cancelled and entries returned.')],
              [t('Aktivní permanentky', 'Active passes'),
               t('Budou zneplatněny. Zbývající vstupy propadají.', 'Will be invalidated. Remaining entries are forfeited.')],
              [t('Osobní údaje', 'Personal data'),
               t('E-mail a jméno budou anonymizovány. Historie kurzů zůstane pro účetní záznamy.', 'Email and name will be anonymized. Course history is retained for accounting.')],
              [t('Přihlašování', 'Login'),
               t('Přístup do systému bude okamžitě zrušen.', 'Access will be immediately revoked.')],
            ].map(([label, desc]) => `
              <div style="display:flex;gap:10px;margin-bottom:10px;font-size:12px;">
                <div style="
                  width:16px;height:16px;border-radius:50%;background:#FCEBEB;
                  display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;
                ">
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M2 4h4M4 2v4" stroke="#791F1F" stroke-width="1.2"
                      stroke-linecap="round" style="transform:rotate(45deg);transform-origin:center"/>
                  </svg>
                </div>
                <div><strong style="color:#1a1a1a;">${label}:</strong>
                  <span style="color:#6b6b6b;"> ${desc}</span></div>
              </div>
            `).join('')}
          </div>

          <!-- Varování o permanentkách -->
          <div style="
            border:0.5px solid #F0C0BB;border-radius:8px;
            background:#FFF8F7;padding:12px 14px;margin-bottom:16px;
            display:flex;gap:10px;align-items:flex-start;
          ">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;margin-top:1px;">
              <path d="M8 2.5L14 13H2L8 2.5Z" stroke="#C0392B" stroke-width="1.2"
                stroke-linejoin="round"/>
              <path d="M8 6v3.5M8 11.5v.5" stroke="#C0392B" stroke-width="1.2"
                stroke-linecap="round"/>
            </svg>
            <div style="font-size:11px;color:#791F1F;line-height:1.6;">
              Smazáním účtu zanikají vaše aktivní permanentky <strong>bez nároku na automatickou refundaci</strong>.
              Pokud máte nevyčerpané vstupy a přejete si žádat o vrácení peněz,
              kontaktujte nás před smazáním na
              <a href="mailto:info@atelier.cz" style="color:#791F1F;font-weight:500;">info@atelier.cz</a>.
            </div>
          </div>

          <!-- Volitelný důvod -->
          <div style="margin-bottom:16px;">
            <label style="font-size:11px;color:#6b6b6b;display:block;margin-bottom:4px;">
              ${t('Důvod smazání (volitelné)', 'Reason for deletion (optional)')}
            </label>
            <select id="gdpr-reason" style="
              width:100%;padding:8px 10px;border:0.5px solid rgba(0,0,0,0.18);
              border-radius:8px;font-size:12px;color:#1a1a1a;background:#fff;
            ">
              <option value="">${t('Nevyplňovat', 'Prefer not to say')}</option>
              <option value="privacy">${t('Ochrana soukromí', 'Privacy concerns')}</option>
              <option value="no_longer_use">${t('Ateliér již nenavštěvuji', 'No longer attending')}</option>
              <option value="switching">${t('Přecházím jinam', 'Switching to another service')}</option>
              <option value="other">${t('Jiný důvod', 'Other reason')}</option>
            </select>
          </div>
        </div>

        <div style="
          padding:0 20px 18px;display:grid;
          grid-template-columns:1fr 1fr;gap:8px;
        ">
          <button onclick="closeGdprDialog()" style="
            padding:10px;border-radius:8px;
            border:0.5px solid rgba(0,0,0,0.18);
            background:transparent;color:#1a1a1a;
            font-size:12px;cursor:pointer;
          ">
            ${t('Zrušit', 'Cancel')}
          </button>
          <button onclick="gdprStep2()" style="
            padding:10px;border-radius:8px;border:none;
            background:#FCEBEB;color:#791F1F;
            font-size:12px;font-weight:500;cursor:pointer;
          ">
            ${t('Pokračovat →', 'Continue →')}
          </button>
        </div>
      </div>

      <!-- KROK 2: Finální potvrzení -->
      <div id="gdpr-step-2" style="display:none;">
        <div style="padding:20px 20px 0;">
          <div style="font-size:15px;font-weight:500;color:#791F1F;margin-bottom:8px;">
            ${t('Opravdu smazat účet?', 'Really delete account?')}
          </div>
          <div style="
            font-size:12px;color:#6b6b6b;line-height:1.6;
            background:#FCEBEB;border-radius:8px;padding:12px;margin-bottom:16px;
          ">
            ${t(
              'Tuto akci nelze vrátit zpět. Všechna tvoje data budou anonymizována a přístup do systému bude ukončen.',
              'This cannot be undone. All your data will be anonymized and your access will be terminated.'
            )}
          </div>

          <!-- Potvrzovací checkbox -->
          <label style="
            display:flex;align-items:flex-start;gap:10px;
            font-size:12px;color:#1a1a1a;margin-bottom:16px;cursor:pointer;
          ">
            <input type="checkbox" id="gdpr-confirm-check"
              onchange="document.getElementById('gdpr-delete-btn').disabled=!this.checked"
              style="margin-top:2px;accent-color:#791F1F;width:14px;height:14px;flex-shrink:0;" />
            ${t(
              'Rozumím, že tato akce je nevratná a souhlasím se smazáním svého účtu.',
              'I understand this action is irreversible and I agree to delete my account.'
            )}
          </label>
        </div>

        <div id="gdpr-error" style="
          display:none;margin:0 20px 12px;padding:10px 12px;
          background:#FCEBEB;border-radius:8px;
          font-size:12px;color:#791F1F;
        "></div>

        <div style="padding:0 20px 18px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <button onclick="gdprStep1()" style="
            padding:10px;border-radius:8px;
            border:0.5px solid rgba(0,0,0,0.18);
            background:transparent;color:#1a1a1a;font-size:12px;cursor:pointer;
          ">
            ← ${t('Zpět', 'Back')}
          </button>
          <button id="gdpr-delete-btn" disabled
            onclick="gdprExecute('${lang}')"
            style="
              padding:10px;border-radius:8px;border:none;
              background:#E24B4A;color:#fff;
              font-size:12px;font-weight:500;cursor:pointer;
              opacity:0.4;transition:opacity .15s;
            "
            onmouseenter="if(!this.disabled)this.style.background='#c03a39'"
            onmouseleave="this.style.background='#E24B4A'"
          >
            ${t('Smazat účet', 'Delete account')}
          </button>
        </div>
      </div>

      <!-- KROK 3: Probíhá / Hotovo -->
      <div id="gdpr-step-3" style="display:none;padding:32px 20px;text-align:center;">
        <div id="gdpr-progress-icon" style="
          width:48px;height:48px;border-radius:50%;background:#f5f5f3;
          display:flex;align-items:center;justify-content:center;margin:0 auto 14px;
        ">
          <div style="
            width:24px;height:24px;border-radius:50%;
            border:2px solid #f5f5f3;border-top-color:#534AB7;
            animation:spin .8s linear infinite;
          "></div>
        </div>
        <div id="gdpr-progress-title" style="
          font-size:14px;font-weight:500;color:#1a1a1a;margin-bottom:6px;
        ">
          ${t('Mažu účet…', 'Deleting account…')}
        </div>
        <div id="gdpr-progress-sub" style="font-size:12px;color:#6b6b6b;">
          ${t('Prosím čekej, nezavírej stránku.', 'Please wait, do not close this page.')}
        </div>
      </div>

    </div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  `

  document.body.appendChild(overlay)

  // Globální pomocné funkce pro inline onclick handlery
  window.closeGdprDialog = () => overlay.remove()

  window.gdprStep1 = () => {
    document.getElementById('gdpr-step-1').style.display = 'block'
    document.getElementById('gdpr-step-2').style.display = 'none'
  }

  window.gdprStep2 = () => {
    document.getElementById('gdpr-step-1').style.display = 'none'
    document.getElementById('gdpr-step-2').style.display = 'block'
  }

  // Synchronizace disabled stavu tlačítka po přepnutí kroku
  document.getElementById('gdpr-confirm-check')
    ?.addEventListener('change', e => {
      const btn = document.getElementById('gdpr-delete-btn')
      if (btn) btn.style.opacity = e.target.checked ? '1' : '0.4'
    })

  window.gdprExecute = async (lang) => {
    const t = (cs, en) => lang === 'cs' ? cs : en
    const reason = document.getElementById('gdpr-reason')?.value || null

    // Zobrazíme krok 3 (loading)
    document.getElementById('gdpr-step-2').style.display = 'none'
    document.getElementById('gdpr-step-3').style.display = 'block'

    const result = await deleteUserAccount({ reason })

    if (result.error) {
      // Chyba → vrátíme zpět na krok 2
      document.getElementById('gdpr-step-3').style.display = 'none'
      document.getElementById('gdpr-step-2').style.display = 'block'
      const errEl = document.getElementById('gdpr-error')
      if (errEl) { errEl.textContent = result.error; errEl.style.display = 'block' }
      return
    }

    // Úspěch → ikona ✓ + redirect
    const icon = document.getElementById('gdpr-progress-icon')
    if (icon) icon.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M5 11l4 4 8-8" stroke="#0F6E56" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `
    icon.style.background = '#E1F5EE'

    const title = document.getElementById('gdpr-progress-title')
    const sub   = document.getElementById('gdpr-progress-sub')
    if (title) title.textContent = t('Účet byl smazán', 'Account deleted')
    if (sub)   sub.textContent   = t(
      `Zrušili jsme ${result.cancelledBookings} rezervací. Přesměrovávám…`,
      `Cancelled ${result.cancelledBookings} bookings. Redirecting…`
    )

    // Redirect po 2 s
    setTimeout(() => {
      overlay.remove()
      window.location.href = '/'
    }, 2000)
  }
}

// ─── 3. TLAČÍTKO V UI PROFILU ────────────────────────────────
// Přidáme tlačítko do existující sekce nastavení / profilu.
// Volat po načtení DOM nebo po přihlášení uživatele.

export function injectDeleteButton(lang = 'cs') {
  // Hledáme kontejner — upravit selektor dle finálního HTML
  const target = document.getElementById('profile-danger-zone')
    ?? document.getElementById('nastenka-settings-block')
    ?? document.querySelector('.sidebar')  // fallback: přidáme do sidebaru

  if (!target) return

  if (document.getElementById('gdpr-delete-trigger')) return  // idempotentní

  const t = (cs, en) => lang === 'cs' ? cs : en

  const section = document.createElement('div')
  section.id    = 'gdpr-delete-trigger'
  section.style.cssText = `
    border-top:0.5px solid rgba(0,0,0,0.08);
    padding:16px 20px;margin-top:auto;
  `
  section.innerHTML = `
    <div style="
      font-size:10px;font-weight:500;letter-spacing:.08em;
      text-transform:uppercase;color:var(--section-heading-accent);margin-bottom:8px;
    ">
      ${t('Nebezpečná zóna', 'Danger zone')}
    </div>
    <button id="gdpr-open-btn" style="
      width:100%;padding:8px 12px;border-radius:8px;
      border:0.5px solid #E24B4A;background:transparent;
      color:#791F1F;font-size:12px;font-weight:500;
      cursor:pointer;text-align:left;
    ">
      ${t('Smazat můj účet', 'Delete my account')}
    </button>
    <div style="font-size:10px;color:#9b9b9b;margin-top:6px;line-height:1.5;">
      ${t(
        'Trvalé smazání — data budou anonymizována.',
        'Permanent deletion — data will be anonymized.'
      )}
    </div>
  `

  target.appendChild(section)

  document.getElementById('gdpr-open-btn')
    ?.addEventListener('click', () => openDeleteAccountDialog(lang))
}
