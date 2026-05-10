# Stripe klíče — kde je najít a kam vložit

## Co budeš potřebovat (3 klíče)

| Proměnná | K čemu slouží |
|---|---|
| `STRIPE_SECRET_KEY` | Vytváří Checkout Sessions |
| `STRIPE_WEBHOOK_SECRET` | Ověřuje, že webhook přišel skutečně od Stripe |
| `STRIPE_PUBLISHABLE_KEY` | Volitelný — jen pokud buduješ vlastní platební formulář (Stripe Elements). Pro Checkout nepotřebuješ. |

---

## 1. `STRIPE_SECRET_KEY`

**Cesta v dashboardu:**
Developers → API keys → Secret key

**Postup:**
1. Přihlas se na [dashboard.stripe.com](https://dashboard.stripe.com)
2. V levém menu klikni na **Developers** (dole)
3. Záložka **API keys**
4. Sloupec **Secret key** → klikni na **Reveal test key**
5. Zkopíruj hodnotu začínající `sk_test_...`

> ⚠️ Až budeš připravena jít do produkce, přepni toggle **Test mode → Live mode**
> (vpravo nahoře) a zopakuj — dostaneš klíč `sk_live_...`

---

## 2. `STRIPE_WEBHOOK_SECRET`

Tento klíč **neexistuje předem** — vygeneruje se až po vytvoření endpointu.

**Postup:**
1. Developers → **Webhooks** → **Add endpoint**
2. Do pole **Endpoint URL** vlož:
   ```
   https://TVUJ_PROJEKT.supabase.co/functions/v1/stripe-webhook
   ```
3. Klikni na **Select events** a zaškrtni:
   - `checkout.session.completed`
4. Klikni **Add endpoint**
5. Na stránce nového endpointu najdeš sekci **Signing secret** → klikni **Reveal**
6. Zkopíruj hodnotu začínající `whsec_...`

> 💡 Pro lokální vývoj použij Stripe CLI:
> ```bash
> stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook
> ```
> CLI ti vypíše dočasný `whsec_...` klíč platný po dobu běhu příkazu.

---

## 3. Vložení do Supabase

**Cesta:** [supabase.com/dashboard](https://supabase.com/dashboard) → tvůj projekt → **Settings** → **Edge Functions** → **Secrets**

Klikni **Add new secret** a přidej postupně:

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` (nebo `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |

> Tyto dvě jsou jedinou nutností. `SUPABASE_URL`, `SUPABASE_ANON_KEY`
> a `SUPABASE_SERVICE_ROLE_KEY` jsou v Edge Functions dostupné automaticky
> — Supabase je injektuje samo, nemusíš je přidávat ručně.

---

## Ověření, že vše funguje

### Test platby
Stripe testovací karta (funguje vždy, nevyžaduje skutečné peníze):
```
Číslo karty:  4242 4242 4242 4242
Datum:        libovolné budoucí (např. 12/26)
CVC:          libovolné 3 číslice
PSČ:          libovolné
```

### Ověření webhook doručení
Developers → Webhooks → klikni na svůj endpoint → záložka **Events**
Uvidíš historii událostí a jejich HTTP status. Zelená `200` = Edge Function přijala a zpracovala správně.

---

## Pořadí kroků (doporučené)

1. Vytvoř API klíče (testovací)
2. Vlož `STRIPE_SECRET_KEY` do Supabase Secrets
3. Nasaď Edge Functions: `supabase functions deploy create-checkout` a `supabase functions deploy stripe-webhook`
4. Vytvoř Webhook endpoint v Stripe dashboardu s URL nasazené funkce
5. Vlož `STRIPE_WEBHOOK_SECRET` do Supabase Secrets
6. Otestuj celý flow testovací kartou
7. Před spuštěním: přepni na Live mode a zopakuj kroky 1, 4, 5 s live klíči
