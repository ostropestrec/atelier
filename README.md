# Ateliér — rezervační a manažerský systém pro kreativní studio

**Ateliér** je webová aplikace pro provoz kreativního studia: propojuje **zákaznickou vrstvu** (kalendář, katalog kurzů, nákup permanentek, rezervace lekcí) s **interní správou** (dashboard, správa kurzů a termínů, zákazníci, platby, permanentky). Řeší typický problém malých a středních studií — **nahromaděné tabulky, manuální kapacity a roztříštěná komunikace** — a centralizuje rezervace, produkty (včetně vstupů z permanentek) a přehled pro tým v jednom místě.

---

## Hlavní funkce (Core Features)

### Flexibilní správa a rezervace z pohledu klienta i admina

- **Klient:** přehledná **nástěnka**, **interaktivní kalendář**, detail kurzů s bohatým obsahem, **nákup a správa permanentek**, rezervace na konkrétní termíny s ohledem na kapacitu a pravidla storna.
- **Admin / lektor:** role-based rozhraní — **správa kurzů a workshopů**, generování a úprava termínů, **účastníci lekcí**, storna a úpravy zákaznických dat; admin navíc přehledy jako **zákazníci** a **platby** (včetně refundací tam, kde to model umožňuje).
- **Jedna datová báze jako zdroj pravdy** — veřejný obsah i admin akce čtou a zapisují konzistentní stav (obsazenost, platby typu jednorázová vs. permanentka).

### Pokročilý i18n (čeština + britská angličtina)

- Centralizovaný překladový slovník ve **vanilla modulu** (`translations.js`) s jednotnou funkcí `t()` / rozšířeními podle kontextu.
- **Dynamický přepínač jazyka** na úrovni UI; volba se **persistuje v `localStorage`**, aby se uživateli neměnil jazyk při další návštěvě.
- Pro angličtinu je záměrně uvažována **britská konvence** (např. formát data/času `en-GB` tam, kde to dává smysl pro zobrazení), aby texty a formátování působily konzistentně v UK kontextu.
- Po přepnutí jazyka se obnovují statické štítky (`data-i18n`) i dynamicky generované části (např. nástěnka, admin sekce podle aktivní obrazovky).

### Bezpečnost dat na úrovni databáze (Supabase RLS)

- Citlivá data nejsou „chráněná jen frontendem“ — přístup k řádkům řeší **Row Level Security (RLS)** v **PostgreSQL** (Supabase).
- Uživatelské role (`uzivatel`, `lektor`, `admin`) a vlastnictví záznamů (např. `owner_id` u kurzů a permanentek) se promítají do politik tak, aby **klient viděl jen své rezervace a permanentky**, lektor primárně **vlastní obsah**, a admin měl širší oprávnění dle nastavených politik.
- Schéma a RLS jsou verzovány v SQL souborech v repozitáři (např. `atelier_schema.sql`, `atelier_rls.sql`, agregované migrace v `FINAL_supabase_sql.sql`) — reprodukovatelné nasazení a auditovatelný model.

---

## Technologický stack (Tech Stack)

| Vrstva | Technologie | Poznámka |
|--------|-------------|----------|
| **Frontend** | **Vanilla JavaScript** (ES moduly), HTML, CSS | Jedna „stránka“ s přepínáním sekcí — **SPA bez React/Vue**. Moduly: např. `atelier-data.js` (data, kalendář, rezervace), `atelier_auth.js` (auth, navigace, profil), `atelier-admin.js` (správa, lazy-load pro staff). |
| **Backend / DB** | **Supabase** (PostgreSQL, Auth, Realtime podle potřeby) | Autentizace, dotazy z klienta, serverová logika dle nasazených funkcí a migrací. |
| **Hosting** | **Vercel** (nebo ekvivalent pro statické nasazení) | Vhodné pro statický frontend s environment proměnnými pro Supabase klíče. |
| **Platby** | **Stripe** | Aktuálně směřování na **Payment Link** / externí dokončení platby mimo aplikaci; rozšíření viz sekce níže. |
| **Bezpečnost obsahu** | DOMPurify / sanitizace rich textu | Ochrana HTML popisů kurzů z editoru před vložením do DOM. |

**Proč bez těžkých frameworků?** Projekt je záměrně postaven na **minimální závislosti a maximální transparentnost kódu**: rychlé načtení, přímá kontrola nad datovými toky, snadné ladění a nízká provozní složitost. To neznamená „jednoduchou hračku“ — architektura je **modulární**, s jasným rozdělením odpovědností mezi auth, data a admin vrstvou.

---

## Architektura plateb (Stripe a webhooky — WIP / roadmap)

**Současný stav (MVP):** Po výběru platby aplikace uživatele navede na **statické Stripe Payment Links** (konfigurovatelné mapování v `window.__externalStripePayments` v `index.html`). Samotné zpracování karty probíhá **vždy na straně Stripe**; aplikace neukládá platební údaje. Po odeslání uživatele na Stripe jsou aktivace permanentky nebo rezervace závislé na **operativním/doplňkovém procesu** (např. manuální potvrzení nebo dílčí automatizace dle aktuálního nasazení).

**Směr vývoje (roadmap):** Cílový tok je **plně automatizovaný**:

1. Klient dokončí platbu přes **dynamický Stripe Checkout** (session vytvořená na serveru).
2. **Supabase Edge Functions** vystaví bezpečné endpointy pro vytvoření checkout session a pro **Stripe webhooks**.
3. Webhook po `checkout.session.completed` (a příbuzných událostech) **atomicky zapíše** `user_passes` / `bookings` (s idempotentní kontrolou podle Stripe ID, aby dvojnásobný webhook nevytvořil duplicity).
4. Frontend může zobrazit stav „Čekáme na platbu“ / polling nebo realtime aktualizaci podle toho, jak bude nasazená produkční větev.

Tím se MVP oddělí od **produkčně škálovatelné** varianty s minimem ruční práce pro provoz studia.

---

## Struktura databáze (přehled entit)

Hlavní tabulky ve **PostgreSQL** (veřejný schéma `public`), v logické návaznosti:

| Entita | Účel (zkráceně) |
|--------|------------------|
| **`users`** | Profil aplikace navázaný na `auth.users` — role, jazyk, připomínky, metadata. |
| **`courses`** | Definice kurzů — lokalizované názvy/popisy (`jsonb` pro `cs` / `en`), cena, kapacita, barva, pravidla storna. |
| **`lessons`** | Konkrétní termíny (začátek/konec, kapacita, cena v čase vzniku, stav). |
| **`passes`** | Katalog permanentek — počet vstupů, platnost, cena, vazba na povolené kurzy. |
| **`user_passes`** | Zakoupené permanentky uživatele — zbývající vstupy, expirace, vazba na platbu (`stripe_payment_id` atd.). |
| **`bookings`** | Rezervace uživatele na lekci — typ platby (`pass` / `single`), stav, storno, refundace. |

Doplňkově existují např. **view** pro obsazenost lekcí, **triggery** na kapacity a validace business pravidel, a tabulky související s **GDPR** — detailně v `atelier_schema.sql` a souvisejících migracích.

---

## AI-assisted development

Projekt byl vyvíjen **efektivně s asistencí AI nástrojů (Cursor)** — ne jako „black box generátor“, ale jako **akcelerátor**: rychlé iterace, refaktoring a doplnění repetitive částí (i18n, formuláře, migrace). **Autorka zůstala v roli architekta a produktové logiky:** definovala datový model, role uživatelů, UX tok rezervací a plateb, prováděla **code review** rozhodnutí asistenta a řídila **integritu datových toků** mezi klientem, Supabase a (budoucími) edge funkcemi. Výsledkem je repozitář, který lze obhájit v diskusi s engineering leadem — s jasným rozdělením modulů, SQL artefakty pro DB a čitelnou evolucí od MVP k plné automatizaci plateb.

---

*Tento README slouží jako úvodní „vizitka“ projektu. Doplňující technické poznámky najdete v souboru `DOCUMENTATION.md` a v SQL skriptech v kořeni repozitáře.*
