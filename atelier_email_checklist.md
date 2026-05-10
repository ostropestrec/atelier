# Co udělat, aby e-maily skutečně odcházely

## 1. Vytvoř účet na Resend

Jdi na [resend.com](https://resend.com) a zaregistruj se (je zdarma do 3 000 e-mailů/měsíc).

---

## 2. Ověř svoji doménu v Resend

Bez ověřené domény e-maily přijdou do spamu nebo vůbec neodejdou.

**Cesta:** Resend dashboard → **Domains** → **Add Domain** → zadej `atelier.cz`

Resend ti ukáže tři DNS záznamy, které musíš přidat u svého doménového registrátora (např. Wedos, Forpsi, Cloudflare):

| Typ   | Název                     | Hodnota                        |
|-------|---------------------------|--------------------------------|
| TXT   | `resend._domainkey.atelier.cz` | (dlouhý DKIM klíč od Resend) |
| TXT   | `atelier.cz`              | `v=spf1 include:resend.com ~all` |
| CNAME | `mail.atelier.cz`         | `feedback.resend.com`          |

> Po přidání záznamů klikni v Resend na **Verify** — ověření trvá 5–60 minut.

---

## 3. Vygeneruj API klíč

**Cesta:** Resend dashboard → **API Keys** → **Create API Key**

- Pojmenuj ho `atelier-production`
- Oprávnění: **Sending access**
- Zkopíruj hodnotu začínající `re_...` (zobrazí se jen jednou)

---

## 4. Vlož tajné klíče do Supabase

**Cesta:** [supabase.com](https://supabase.com) → tvůj projekt → **Settings** → **Edge Functions** → **Secrets**

Přidej tyto tři:

| Name            | Value                                      |
|-----------------|--------------------------------------------|
| `RESEND_API_KEY` | `re_xxxxxxxxxxxxxxxxxxxx` (z kroku 3)      |
| `EMAIL_FROM`    | `Ateliér <info@atelier.cz>`               |
| `APP_URL`       | `https://atelier.cz` (nebo tvoje doména)  |

> `SUPABASE_URL` a `SUPABASE_SERVICE_ROLE_KEY` jsou dostupné automaticky — nepřidávej je ručně.

---

## 5. Nasaď Edge Function

V terminálu ve složce projektu:

```bash
supabase functions deploy send-email
```

Ověř v Supabase dashboardu: **Edge Functions** → `send-email` → stav **Active**.

---

## 6. Otestuj odeslání

Zavolej funkci ručně přes curl (nebo Postman):

```bash
curl -X POST https://TVUJ_PROJEKT.supabase.co/functions/v1/send-email \
  -H "Authorization: Bearer TVUJ_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "template": "booking_confirmation",
    "user_id":  "UUID_existujiciho_uzivatele",
    "lesson_id": "UUID_existujici_lekce"
  }'
```

Zkontroluj:
- Resend dashboard → **Emails** → vidíš odeslaný e-mail se stavem `delivered`
- Dorazil e-mail do schránky (zkontroluj spam)

---

## 7. Doplň `success.html`

V souboru `success.html` nahraď dva řádky:

```js
const SUPABASE_URL  = 'https://TVUJ_PROJEKT.supabase.co'
const SUPABASE_ANON = 'TVUJ_ANON_KEY'
```

Obě hodnoty najdeš v Supabase dashboardu: **Settings** → **API**.

---

## Shrnutí — pořadí kroků

1. Zaregistrovat se na Resend
2. Přidat a ověřit doménu (DNS záznamy)
3. Vygenerovat API klíč
4. Přidat 3 Secrets do Supabase
5. Nasadit Edge Function (`supabase functions deploy send-email`)
6. Otestovat curl požadavkem
7. Doplnit URL a klíč do `success.html`

---

## Kdy se e-maily odesílají automaticky?

| Událost | Kdo spouští |
|---|---|
| Zákazník zaplatí | Stripe webhook → `stripe-webhook` funkce → zavolá `send-email` s šablonou `booking_confirmation` |
| Zákazník stornuje | Frontend → přímé volání `send-email` s šablonou `booking_cancelled` |
| Lektor zruší lekci | Admin panel → přímé volání `send-email` s šablonou `lesson_cancelled` |
| Připomínka | Supabase cron job (dodáme jako poslední krok) |
