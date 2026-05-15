# Architektonická a technická dokumentace — Ateliér (Architecture Design Document)

**Verze dokumentu:** 2.0  
**Účel:** Hluboký technický průvodce systémem pro architektonické diskuse, technické pohovory a code review.  
**Jazyk:** čeština (formální styl).

---

## 1. Úvod a architektonická filozofie (Separation of Concerns)

### 1.1 Cíl systému

Aplikace **Ateliér** propojuje veřejnou vrstvu (nabídka kurzů, kalendář, rezervace, permanentky) se správní vrstvou (správa obsahu, účastníci, platby). Architektura je navržena tak, aby **hranice odpovědností** byly jasné: frontend orchestruje UX a validaci na úrovni formuláře; **autoritativní business pravidla a ochrana dat** patří do databáze a (v produkční větvi) do serverových endpointů.

### 1.2 Proč Vanilla JavaScript SPA

| Kriterium | Zdůvodnění |
|-----------|------------|
| **Rychlost startu** | Žádný velký runtime framework — DOM manipulace a ES moduly přímo v prohlížeči. |
| **Nulový „bundle bloat“** | Oproti ekosystému s těžkým bundlerem a závislostmi na virtual DOM zůstává přenos malý a přehledný. |
| **Kontrola nad DOM** | Kalendář, modální okna a admin tabulky vyžadují přesné chování; přímá práce s DOM snižuje magickou vrstvu, kterou by bylo nutné debugovat „napříč abstrakcí“. |
| **Evoluční cesta** | Stejné modulové rozhraní umožňuje později vložit tenčí reaktivní vrstvu (viz sekce 4) bez totální přepsání backend kontraktu. |

**Trade-off:** bez frameworku neroste „zdarma“ disciplína stavu — proto explicitní moduly a roadmapa doménového a platebního modelu (sekce 5–6).

### 1.3 Tok dat (konceptuální diagram)

Následující diagram zachycuje **logický** tok, nikoli fyzické síťové detaily (TLS, CDN).

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          PROHLÍŽEČ (klient)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐                │
│ │atelier-data  │  │atelier_auth  │  │atelier-admin     │                │
│ │kalendář,     │  │session, RBAC │  │(lazy) staff UI   │                │
│ │rezervace,    │  │navigace      │  │                  │                │
│ │katalog       │  │              │  │                  │                │
│ └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘                │
│        │                 │                   │                         │
│        └────────────────┬┴───────────────────┘                         │
│                         │                                              │
│              ┌──────────▼──────────┐    ┌──────────────────┐            │
│              │ translations.js    │    │ index.html + CSS │            │
│              │ t(locale, path, p) │    │ (layout, data-i18n)           │
│              └──────────┬─────────┘    └──────────────────┘            │
└─────────────────────────┼──────────────────────────────────────────────┘
                          │
                          │  HTTPS / Supabase JS klient (RLS-aware)
                          │
┌─────────────────────────▼──────────────────────────────────────────────┐
│                    SUPABASE API LAYER                                    │
│   Auth (JWT)  ·  PostgREST  ·  Realtime (dle nasazení)                  │
└─────────────────────────┬──────────────────────────────────────────────┘
                          │
┌─────────────────────────▼──────────────────────────────────────────────┐
│                    PostgreSQL                                           │
│   Row Level Security · triggery · views · (budoucí ENUM / webhook log)   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Klíčové:** Frontend **nikdy** není jedinou linií obrany — každý `select`/`insert`/`update` prochází politikami RLS vázanými na `auth.uid()` (viz sekce 4).

---

## 2. Modulární struktura frontendu

### 2.1 Přehled modulů a odpovědností

| Modul | Odpovědnost | Poznámka |
|--------|---------------|----------|
| **`atelier-data.js`** | Jádro doménových dat: načítání kurzů a lekcí, render kalendáře, rezervační logika, obnova veřejných dat, `setLang` a statická i18n synchronizace. | Klíčová integrace s Supabase klientem a uživatelským stavem z auth modulu. |
| **`atelier_auth.js`** | Autentizace (Supabase Auth), profil uživatele, **role-based navigace** (sidebar / bottom nav), nástěnka uživatele, sdílené utility pro zápis do UI. | „RBAC v UI“ — co uživatel *vidí*, odvozeno od `users.role`. |
| **`atelier-admin.js`** | Admin a lektorské obrazovky: kurzy, zákazníci, platby, permanentky, akce na lekcích. | **Lazy import** z inicializačního řetězce — nezatěžuje běžného návštěvníka. |
| **`translations.js`** | Izolovaný **i18n engine**: strom překladů `UI_TRANSLATIONS`, exportovaná funkce `t(locale, path, params)`, náhradní locale. | Bez závislosti na DOM — čistá knihovna. |
| **`atelier-supabase.js`** | Konfigurace a export klienta `sb`. | Jeden vstupní bod pro URL a klíč. |
| **`atelier-sanitize.js`** | Sanitizace HTML pro bezpečné vykreslení bohatého textu. | Obrana proti XSS u obsahu z editoru. |

### 2.2 Lazy-loading admin vrstvy

Personál (role `lektor` nebo `admin`) spouští kód `atelier-admin.js` až po rozhodnutí aplikace o roli a inicializačním toku. Tím se:

- sníží počáteční stahovaný JS pro anonymní a běžné uživatele,
- zachová jasnou **hranici mezi veřejnou a interní částí** kódu.

### 2.3 Konvence závislostí

Doporučený směr závislostí (zjednodušeně):  
`translations` ← žádný doménový import; `atelier-supabase` ← konfigurace; `atelier_auth` ↔ `atelier-data` (sdílený uživatel); `atelier-admin` → auth + data + překlady.

---

## 3. Bezpečnostní model (Zero Trust a Row Level Security)

### 3.1 Princip „never trust the client“

Frontend může skrýt tlačítka a routy, ale **útočník obchází UI**. Proto platí:

- **Identita** je vždy serverově ověřená JWT (Supabase Auth).
- **Autorizace k řádkům** se aplikuje v PostgreSQL přes **RLS** — dotaz bez oprávnění vrací prázdnou množinu nebo selže zápis.

Tím je splněn **Zero Trust** pohled na klientskou část: aplikace je tenká; databáze je autorita.

### 3.2 RLS v projektu Ateliér

V souboru `atelier_rls.sql` jsou definovány mimo jiné:

- pomocné funkce **`current_user_id()`**, **`current_user_role()`**, **`is_admin()`**, **`is_lektor()`** (typicky `SECURITY DEFINER`, aby se předešlo rekurzi politik),
- **politiky SELECT/INSERT/UPDATE/DELETE** na tabulkách `users`, `courses`, `lessons`, `passes`, `user_passes`, `bookings`.

### 3.3 Role a přístup k datům (zjednodušený model)

| Role | Typický přístup (intence politik) |
|------|-----------------------------------|
| **`uzivatel`** | Čtení veřejné nabídky; zápis a čtení **vlastních** rezervací a permanentek dle pravidel storna. |
| **`lektor`** | Správa **vlastních** kurzů, lekcí a katalogu permanentek; čtení účastníků na **svých** lekcích; rozšířené čtení uživatelů v kontextu svých zákazníků. |
| **`admin`** | Širší čtení a správa napříč systémem dle definovaných politik (včetně agregovaných přehledů). |

**Důležité:** V praxi nejde jen o `auth.uid() = user_id` na jedné tabulce — politiky používají **joiny na kurz** (`owner_id`), **existenční podmínky** na lekci a **funkce** jako `can_self_cancel_booking(...)` pro řízené storno.

### 3.4 Služební role a Edge Functions

Operace vyžadující **obcházení RLS** (např. systemové zápisy po webhooku) musí běžet pod **`service_role`** na důvěryhodné straně (Edge Function), nikoli v prohlížeči. Klientský anon/authenticated klíč RLS respektuje.

---

## 4. Řízení komplexity frontendu (mitigace „complexity drift“)

### 4.1 Omezení čistého Vanilla JS ve velkém projektu

Bez jednotného stavového runtime:

- roste riziko **roje globálních** `window.*` callbacků,
- duplicitní logika mezi modály a seznamy,
- obtížnější **regrese** při změnách doménových pravidel.

### 4.2 Přijatá strategie v Ateliéru

1. **Přísná modularita** — doménová logika v jednom modulu, admin v odděleném souboru s jasným exportem funkcí navázaných na `window` pouze tam, kde je nutný hook z HTML (`onclick` legacy).
2. **Roadmapa: odlehčený Event Bus** — např. minimální `emit`/`on` na úrovni jedné instance v `atelier-data.js` pro události „data obnovena“, „jazyk změněn“, aby se odstranily řetězce ad-hoc volání.
3. **Roadmapa: cílená migrace na tenký reaktivní micro-framework** (**Preact** nebo **Svelte**) pouze pro vybrané podstromy (kalendář, složité formuláře), při zachování stejného API Supabase — **state sanity** bez přepsání backendu.

Tím se přiznává technický dluh Vanilla části, ale i **plán** jeho řízení.

---

## 5. Navrhovaný stavový automat rezervací (State Machine Roadmap)

### 5.1 Současný stav (implementace v CHECK)

V `atelier_schema.sql` je sloupec `bookings.status` omezen např. na:

`booked` | `cancelled` | `missed` | `attended`

Tento model je dostatečný pro manuální a poloautomatické procesy; **neobsahuje** explicitní fázi „čeká se na platbu“.

### 5.2 Cílový model: Postgres ENUM a přechody

**Návrh:** zavést doménový typ a sloupec s jednoznačnými přechody (definice názvů ilustrativní — finální názvy sjednotit v migraci).

```sql
-- Konceptuální návrh (migrace v budoucím sprintu)
CREATE TYPE booking_lifecycle AS ENUM (
  'pending_payment',   -- záznam nebo intent vytvořen, platba ještě nepotvrzena webhookem
  'booked',             -- aktivní rezervace
  'attended',           -- dokončená docházka
  'no_show',            -- nedorazil / neúčast (ekvivalent dnešního missed)
  'cancelled'           -- storno; refundace řešena samostatnými sloupci / tabulkou
);
```

**Navrhované přechody (zjednodušeně):**

| Z | Událost | Do |
|---|---------|-----|
| `pending_payment` | Webhook / manuální potvrzení platby | `booked` |
| `pending_payment` | Vypršení / zrušení session | `cancelled` nebo smazání intentu |
| `booked` | Uzavření lekce pozitivně | `attended` |
| `booked` | Evidence neúčasti | `no_show` |
| `booked` | Storno v souladu s pravidly | `cancelled` |

**Storno a refundace:** sloupce `refund_status`, `refund_amount`, `cancellation_type` zůstávají ortogonální k hlavnímu životnímu cyklu — stav `cancelled` významově sdružuje **procesní ukončení** rezervace; ekonomický dopis řeší refundace (včetně stavu `pending`/`completed` u refund polí).

### 5.3 Ochrana proti dvojí rezervaci

V schématu je **unikátní omezení** na úrovni rezervace uživatele a lekce (`unique_active_booking` na `(user_id, lesson_id)` v aktuální definici) — při rozšíření o `pending_payment` bude nutné **sjednotit pravidlo**: buď částečně unikátní index s podmínkou (PostgreSQL partial unique index), nebo vyhrazená tabulka intentů; toto je předmět migrace společně s ENUM.

---

## 6. Robustní integrace plateb (Stripe a idempotence webhooků)

### 6.1 Přechodové rozhraní MVP

Aktuální MVP směřuje uživatele na **Stripe Payment Links** (`window.__externalStripePayments` v `index.html`). Aplikace **nezpracovává** PAN karty; dokončení platby probíhá na doméně Stripe.

### 6.2 Cílová produkční architektura

1. Klient iniciuje **Dynamic Checkout Session** (cena, měna, metadata s `user_id`, `lesson_id` / `pass_id`).
2. Edge Function vytvoří session **s tajným klíčem** Stripe (nikdy v prohlížeči).
3. Stripe po úspěchu emituje **webhook** (např. `checkout.session.completed`).
4. Handler v Edge Function:
   - ověří podpis webhooku Stripe,
   - provede **idempotentní** zápis (viz níže),
   - aktualizuje `bookings` / `user_passes`.

### 6.3 Idempotence: tabulka `processed_stripe_events`

Stripe **může stejnou událost doručit vícekrát** nebo může dojít k retry. Proto se zavádí kontrolní tabulka (návrh schématu):

```sql
-- Návrh (neprovedená migrace — dokumentační kontrakt)
CREATE TABLE public.processed_stripe_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,  -- např. evt_xxx z payloadu
  event_type      text NOT NULL,
  processed_at    timestamptz NOT NULL DEFAULT now(),
  payload_hash    text,                  -- volitelná deduplikace obsahu
  correlation_id  uuid                   -- vazba na interní transakci
);

CREATE INDEX idx_processed_stripe_events_type ON public.processed_stripe_events (event_type);
```

**Algoritmus handleru (koncept):**

```text
BEGIN;
  SELECT 1 FROM processed_stripe_events WHERE stripe_event_id = :evt_id FOR UPDATE;
  -- pokud řádek existuje → COMMIT a return 200 (idempotentní no-op)
  -- jinak:
  --   1) zápis doménových tabulek v transakci
  --   2) INSERT INTO processed_stripe_events (...)
COMMIT;
```

Tím se **eliminuje dvojí připsání permanentky nebo dvojí rezervace** z jedné Stripe události. Doplňkově lze ukládat `stripe_payment_id` na `bookings` / `user_passes` pro křížovou kontrolu s fakturací.

---

## 7. Lokalizační cyklus (i18n lifecycle)

### 7.1 Funkce `t()` a parametry `{{param}}`

Implementace v `translations.js` používá **regex nahrazení** placeholderů ve tvaru `{{param}}`:

```javascript
// Zjednodušený výňatek konceptu (viz repository)
return raw.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
  const v = params[key]
  return v !== undefined && v !== null ? String(v) : `{{${key}}}`
})
```

Cesty klíčů jsou tečková notace (`booking.btn.confirmAndPay`), objekty překladů jsou vnořené.

### 7.2 Perzistence a změna jazyka

- Uživatelská volba se persistuje v **`localStorage`** (`UI_LANG_STORAGE_KEY` — viz `translations.js` / inicializace v `atelier-data.js`).
- Globálně se propaguje `window.__uiLang` pro moduly, které neimportují přímo data vrstvu.

### 7.3 Synchronizace s `document.documentElement.lang`

Při startu a při změně jazyka se volá synchronizace typu:

- `document.documentElement.lang = lang === 'en' ? 'en-GB' : 'cs'`

**Účel:** sjednocení s **britským** locale pro přístupnost (`lang` atribut), konzistentní chování vestavěných prvků (datum, číslování) vedle vlastního formátování v kódu (`en-GB` u datumů kde je to aplikováno).

### 7.4 Mitigace probliknutí textu (FOUC i18n)

- Statické texty v `index.html` používají konvenci **`data-i18n`** (a související atributy), které se po načtení přepíší v `refreshStaticI18n()` z `atelier-data.js`.
- Po přepnutí jazyka se mimo jiné volá **`renderNavigation`** a **překreslení aktivní obrazovky** (např. nástěnka, admin sekce), aby dynamicky generovaný obsah nezůstal v předchozím jazyce.

Úplné vyloučení jednotlivého probliknutí u prvního paintu by vyžadovalo inline skript v `<head>` nebo SSR — v aktuálním statickém nasazení je **minimalizace** dosažena rychlým během inicializace a jednotným zdrojem pravdy pro klíče.

---

## 8. Ochrana osobních údajů a GDPR (právo na výmaz / „delete account“)

### 8.1 Architektonický princip

Zpracování osobních údajů vychází z požadavku **oddělit klientské rozhraní od privilegovaných operací**. Smazání nebo anonymizace účtu **nesmí** běžet pouze jako „důvěřivý“ dotaz z prohlížeče s uživatelským JWT u tabulek chráněných RLS — útočník by neměl být schopen obejít záměr politik. Proto je kritická část toku vždy na **serveru** (Supabase **Edge Function** s ověřeným JWT + **`service_role`** pro volání `SECURITY DEFINER` funkcí a Auth Admin API).

### 8.2 Tok dat (přehled)

| Krok | Vrstva | Popis |
|------|--------|--------|
| 1 | **Frontend** (`atelier_auth.js` — `confirmDeleteAccount`; volitelně rozšířený dialog v `atelier_gdpr_js.js`) | Po potvrzení v modálu se volá `sb.functions.invoke('delete-account', { body: { reason } })`. |
| 2 | **Edge Function** (`atelier_gdpr_edge.ts` / nasazená funkce `delete-account`) | Ověří hlavičku **Authorization** s JWT (`getUser()`), vybere důvod žádosti, volitelně zahashuje IP pro audit (`ip_hash`, nikoli raw IP). |
| 3 | **PostgreSQL** | Pomocí klienta se **`service_role`** zavolá RPC **`anonymize_user_account`** (definice v `atelier_gdpr_sql.sql`). |
| 4 | **Supabase Auth** | Po úspěšné anonymizaci řádků v DB funkce Edge spustí **`auth.admin.deleteUser`** (vyžaduje servisní klíč). |

Klientsky následuje **`signOut()`** pro vyčištění lokální session (může vrátit chybu, pokud už Auth záznam neexistuje — očekávaně se ignoruje).

### 8.3 Obsah serverové funkce `anonymize_user_account` (logika)

Funkce je označena **`security definer`** a **není** vystavena rolím `anon` / `authenticated` (`revoke execute` v migraci). Typický průběh:

1. **Validace** — uživatel existuje a e-mail ještě není ve formátu anonymizovaného účtu.
2. **Auditní záznam** — vložení řádku do **`gdpr_deletion_log`** (`user_id`, `reason`, `ip_hash`, časová razítka). Tabulka má RLS politiku, která **zakazuje** přístup běžným klientům (`using (false)`), zápis probíhá z privilegovaného kontextu.
3. **Storno budoucích rezervací** — rezervace ve stavu `booked` na lekce s `start_time > now()` se nastaví na **`cancelled`** s typem vhodným pro vrácení kapacity (GDPR tok v SQL používá styl `early` pro vrácení vstupu dle stávajících triggerů).
4. **Zneplatnění permanentek** — aktivní `user_passes` se nastaví na **`expired`** a zbývající vstupy na 0.
5. **Anonymizace profilu** — e‑mail do formátu `deleted_&lt;prefix&gt;@deleted.invalid`, jméno nahrazeno neutrálním textem, odstranění avataru; **role může zůstat** kvůli historickým výkazům (PII je odstraněno).
6. **Dokončení logu** — doplnění `completed_at`.

**Důsledek pro provozovatele:** fyzické mazání řádků v `public.users` je svázáno s **Referenční integritou** — proto se často volí **anonymizace** + následné smazání v **Auth**; historie rezervací může zůstat jako neosobní záznamy pro účetnictví (uživatel je v UI informován o zachování „historie kurzů“ v agregované podobě).

### 8.4 Pohled pro DPO / audit

Soubor `atelier_gdpr_sql.sql` obsahuje pomocný pohled **`gdpr_data_summary`** (počty rezervací a permanentek bez šíření PII v samotné definici — výstup je určen pro omezený servisní přístup). Veřejné `grant` na tento pohled by měl zůstat uzavřený — dokumentační kontrakt počítá s přístupem přes **`service_role`** nebo SQL konzoli.

### 8.5 Bezpečnostní kontrolní seznam (pro code review)

- Edge Function vždy **validuje JWT** volajícího a operuje jen nad **jeho** `user.id` (nikoli nad `user_id` z těla požadavku od klienta).
- Anon klíč v Edge slouží k ověření identity; **zápis** do databáze přes **`service_role`** klienta.
- Citlivé klíče (`SUPABASE_SERVICE_ROLE_KEY`) **nikdy** v bundlu frontendu.
- Audit: `ip_hash` místo surové IP, log **bez** volného textu PII.

---

## 9. Související artefakty v repozitáři

| Soubor | Obsah |
|--------|--------|
| `atelier_schema.sql` | Databázové schéma, triggery, view. |
| `atelier_rls.sql` | Row Level Security politiky a pomocné funkce. |
| `atelier_gdpr_sql.sql` | GDPR: `gdpr_deletion_log`, RPC `anonymize_user_account`, pohled `gdpr_data_summary`. |
| `atelier_gdpr_js.js` | Volitelný vícekrokový dialog; stejné volání Edge jako v `atelier_auth.js`. |
| `atelier_gdpr_edge.ts` | Šablona / reference Edge Function `delete-account` (Deno). |
| `FINAL_supabase_sql.sql` | Agregované migrace / finální stav pro nasazení. |
| `README.md` | Produktový a architektonický úvod pro externí čtenáře. |

---

## 10. Závěr

Dokument definuje **architektonické rozhodnutí** (Vanilla SPA, modulární řez, RLS jako autorita), **bezpečnostní model** vhodný pro diskusi s security-conscious týmem, **roadmapu** pro platby a životní cyklus rezervace, **lokalizační kontrakt** včetně omezení statického nasazení a **model GDPR výmazu** založený na Edge Functions a `SECURITY DEFINER` RPC. Slouží jako referenční základ pro iteraci kódu a pro rozšíření o plně automatizované Stripe webhooky bez ztráty idempotence.

---

*Konec dokumentu DOCUMENTATION.md*
