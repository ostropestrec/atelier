**Technická dokumentace: Rezervační systém Ateliér**

**1. Základní filozofie systému**

- **Single Source of Truth:** Databáze v Supabase a stav plateb ve Stripe.
- **Bezpečnost:** Veškeré citlivé operace (platby, smazání účtu) probíhá přes Edge Functions.
- **Uživatelský komfort:** Přihlašování přes Magic Link (bez hesel), interaktivní kalendář, polling po platbě.

**2. Databázové schéma (Supabase)**

- **Courses:** Definice kurzů (název, popis, barva). **Důležité:** Barva (color_code) se propisuje do kalendáře i do e-mailových šablon.
- **Lessons:** Jednotlivé lekce v kalendáři.
- **Bookings:** Rezervace propojené s user_id a stripe_payment_id (kvůli idempotenci).
- **User_Passes:** Permanentky uživatelů.

**3. Platební flow (Stripe)**

- **Webhooky:** Jádro logiky. Stripe může poslat webhook vícekrát, proto každý handler začíná **kontrolou idempotence** (hledá existující záznam se stejným stripe_payment_id).
- **Success Page & Polling:** Po platbě se uživatel vrací na success.html. Tato stránka obsahuje skript, který až 8x (v intervalu 1,5 s) kontroluje databázi, zda už webhook vytvořil rezervaci. Ukazuje spinner a progress bar.
- **Logika nákupu:** Pokud si uživatel koupí permanentku a rovnou se zapíše na lekci, systém vytvoří permanentku s počtem vstupů total - 1 a zároveň vytvoří první booking.

**4. GDPR a Smazání účtu**

- **Anonymizace:** Účet se fyzicky nemaže, ale data se anonymizují (e-mail se změní na fake adresu, jméno se vymaže).
- **Logika smazání:** 1. Budoucí rezervace se stornují (místa se uvolní). 2. Aktivní permanentky se zneplatní.
- **Text varování (Lidštější tón):** > *"Trvalé smazání. Aktivní permanentky zanikají bez nároku na automatickou refundaci. Pokud máte nevyčerpané vstupy a přejete si žádat o vrácení peněz, kontaktujte nás před potvrzením smazání na [info@atelier.cz](mailto:info@atelier.cz)."*

**5. E-mailový systém (Resend)**

- **Technologie:** Používáme Resend API (ne SMTP) pro vyšší spolehlivost a snadnější správu DNS (SPF/DKIM/DMARC).
- **Centrální funkce:** Jedna Edge Function send-email obsluhuje všechny šablony (potvrzení, storno, zrušení lekce).
- **Šablony:** Jednoduchý HTML layout. Barva hlavičky e-mailu se dynamicky mění podle color_code kurzu.

**6. Frontend a Design**

- **Barvy:** Globální prvky (odkazy, tlačítka) jsou v neutrálních barvách ateliéru. Barvy kurzů v kalendáři jsou dynamické z DB.
- **UI Komponenty:** - BookingPopup: Inteligentní okno, které pozná, zda má uživatel permanentku.
  - Dashboard: Přehled rezervací a zbývajících vstupů.

