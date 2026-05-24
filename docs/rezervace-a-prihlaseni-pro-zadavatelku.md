# Rezervace, přihlášení a zpětná vazba z testování

**Účel:** Sjednocení očekávání mezi zadavatelkou, testery a vývojem — co aplikace Ateliér dnes skutečně umí.  
**Stav kódu:** produkční větev v tomto repozitáři (bez ghost Edge Function).

---

## 1. Shrnutí pro zadavatelku

**Ano — i magic link znamená uživatelský účet.** Po kliknutí na přihlašovací odkaz je člověk v systému jako přihlášený uživatel (`authenticated`), ne jako anonymní návštěvník. Vznikne nebo se použije záznam v Supabase Auth (`auth.users`) a profil v `public.users`.

| Co chce uživatel udělat | Bez účtu (návštěvník) | Po přihlášení |
|-------------------------|------------------------|---------------|
| Prohlížet kurzy a kalendář | Ano | Ano |
| Otevřít rozbalený kurz / detail kurzu | Ano | Ano |
| Rezervovat místo / zaplatit | **Ne** | Ano |

**Rezervace místa vždy vyžaduje identitu** — e-mail přes magic link, heslo, registraci nebo OAuth (Google/Apple). Důvod: platby, storna, permanentky, e-maily a GDPR (vazba rezervace na konkrétní osobu).

---

## 2. Text ke sdílení se zadavatelkou (copy-paste)

> Aplikace umožňuje **prohlížet nabídku bez účtu**. Samotná **rezervace místa** ale vyžaduje identitu — e-mail přes magic link, heslo nebo registraci. Magic link není „bez účtu“: vytvoří nebo přihlásí uživatele v systému (kvůli platbám, stornům, permanentkám a GDPR).
>
> Plánovaná rezervace „jen na e-mail bez přihlášení“ (ghost účet přes server) **v této verzi aplikace není nasazená** — je jen v návrhu v SQL komentářích. Pokud to zadavatelka chce opravdu dodat, byla by to **samostatná feature** (Edge Function + úprava frontendu), ne drobná úprava textu.

---

## 3. Jak to funguje v aplikaci (technicky stručně)

### 3.1 Prohlížení bez přihlášení

Role `anon` v databázi smí číst aktivní kurzy a view `lesson_availability`. Návštěvník tedy vidí nabídku v **Kurzech** a **Kalendáři**.

### 3.2 Rezervace až po přihlášení

Frontend před otevřením rezervačního modalu kontroluje `currentUser`. Pokud chybí, zobrazí přihlašovací popup (`openAuthPopup`).

Databáze to stejně vynucuje: do tabulky `bookings` smí zapisovat jen role `authenticated`, ne `anon` (viz `atelier_rls.sql`).

### 3.3 Magic link

Při odeslání odkazu na e-mail aplikace volá Supabase `signInWithOtp` s `shouldCreateUser: true`:

- **Nový e-mail** → vytvoří se účet v Auth a po prvním přihlášení se doplní profil.
- **Existující e-mail** → uživatel se přihlásí k existujícímu účtu.

To je v praxi **„bez hesla“**, ne **„bez účtu“**.

### 3.4 Tok (přehled)

```
Návštěvník → prohlíží kurzy/kalendář
          → klikne Rezervovat / Pokračovat k rezervaci
          → přihlašovací okno (magic link / heslo / registrace)
          → přihlášený uživatel
          → rezervační modal → potvrzení / platba
```

---

## 4. „Rezervace bez přihlášení“ — návrh vs. realita

V souboru `atelier_rls.sql` je v komentářích popsán **ghost účet**:

1. Návštěvník zadá e-mail v popupu.
2. Edge Function (service role) vytvoří ghost účet a rezervaci, nebo pošle magic link.
3. Po prvním přihlášení se ghost „promění“ v plný účet (`is_ghost` v `atelier_auth.js`).

**V repozitáři tento flow není implementovaný:**

- Ve `supabase/functions/` nejsou funkce pro ghost rezervaci (jen e-mailová fronta a mazání účtu).
- Frontend nikde nevolá serverovou rezervaci bez session.
- `sessionStorage.pending_booking` se po přihlášení sice čte, ale **nikde se neukládá** — obnovení rezervace po loginu tedy v kódu není dokončené.

**Závěr:** Požadavek zadavatelky „jít bez přihlášení“ **nesplňuje současná aplikace**. Blízká alternativa v produktu: *„nemusím si pamatovat heslo — stačí e-mail (magic link).“*

---

## 5. Zpětná vazba testera: tlačítko registrace při rozkliknutí kurzu

**Připomínka:** Tester nemusí mít na mysli chybějící funkci — spíš **kde tlačítko vidí** a **jak je pojmenované**.

### Co už v aplikaci je

| Místo | Chování |
|-------|---------|
| **Rozbalená karta kurzu** (klik na řádek v Kurzech) | Vpravo u termínů je tlačítko **„Pokračovat k rezervaci“** (`buildCourseReserveButton`). |
| **Detail kurzu** (tlačítko Detail kurzu) | Dole na stránce **„Pokračovat k rezervaci“** — až pod popisem, permanentkami a termíny. |
| **Kalendář** (popup lekce) | Přímo **„Rezervovat“**. |

### Proč to může působit jako „registrace až později“

1. Text **„Pokračovat k rezervaci“** zní jako další krok, ne jako jednoznačné **Rezervovat**.
2. V **detailu** je hlavní akce až **pod přehrnutím stránky**.
3. Nepřihlášený po kliknutí skončí v **přihlašovacím okně** — tester to může popsat jako „až pak registrace“, i když tlačítko na rozbalení už viděl.

### Doporučení testerovi (bez změny kódu)

- Zkuste rozbalit kurz v seznamu **Kurzy** — rezervační tlačítko je v pravém sloupci vedle termínů.
- Po kliknutí je nutné **ověřit e-mail** (magic link) nebo se přihlásit heslem — bez toho systém rezervaci neuloží (záměr kvůli platbám a stornům).

### Možné budoucí UX úpravy (mimo tento dokument)

- Přejmenovat CTA na **„Rezervovat“** už v rozbalení a nahoře v detailu.
- Zvýraznit primární tlačítko v rozbalené kartě (např. pod názvem kurzu).
- Po přihlášení automaticky pokračovat v rozpracované rezervaci (dokončit ukládání `pending_booking`).

---

## 6. Co z toho nevyplývá pro vývoj v tomto kroku

- Žádná změna rezervační logiky, auth ani uživatelského manuálu v aplikaci — pouze tento dokument a odkaz v `DOCUMENTATION.md`.
- Ghost flow implementovat jen na explicitní požadavek zadavatelky po sjednocení očekávání.

---

*Související soubory: `atelier-data.js` (`openBookingPopup`, `buildCourseReserveButton`), `atelier_auth.js` (`signIn`, magic link), `atelier_rls.sql` (RLS bookings, komentář GHOST).*
