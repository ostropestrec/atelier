-- ============================================================
-- ATELIER — Row Level Security (RLS) v2
-- ============================================================
-- Filozofie přístupu:
--   anon        = nepřihlášený návštěvník webu
--   authenticated = přihlášený uživatel (magic link / OAuth / ghost)
--   service_role  = backend (Edge Functions) — obchází RLS
-- ============================================================

-- Pomocné funkce (SECURITY DEFINER zabraňuje rekurzi v RLS)
create or replace function public.current_user_id()
returns uuid language sql stable security definer as $$
  select auth.uid();
$$;

create or replace function public.current_user_role()
returns text language sql stable security definer as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_lektor()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role in ('lektor', 'admin')
  );
$$;

-- ============================================================
-- Zapnutí RLS
-- ============================================================
alter table public.users       enable row level security;
alter table public.courses     enable row level security;
alter table public.lessons     enable row level security;
alter table public.passes      enable row level security;
alter table public.user_passes enable row level security;
alter table public.bookings    enable row level security;

-- ============================================================
-- GRANT: co smí role číst na úrovni PostgreSQL privilegií
-- RLS pak dále omezuje, co konkrétně vidí.
-- ============================================================
grant usage on schema public to anon, authenticated;
grant select on public.courses, public.lessons, public.passes to anon, authenticated;
grant select, insert, update on public.bookings    to authenticated;
grant select, insert, update on public.user_passes to authenticated;
grant select, update         on public.users       to authenticated;
grant select on public.lesson_availability         to anon, authenticated;

-- ============================================================
-- DROP POLICY IF EXISTS — aby šel soubor spouštět opakovaně
-- ============================================================
drop policy if exists "courses: veřejné čtení" on public.courses;
drop policy if exists "courses: admin vidí vše" on public.courses;
drop policy if exists "courses: lektor vidí vlastní neaktivní" on public.courses;
drop policy if exists "courses: lektor vytváří" on public.courses;
drop policy if exists "courses: lektor edituje vlastní" on public.courses;
drop policy if exists "courses: admin maže" on public.courses;

drop policy if exists "lessons: veřejné čtení aktivních" on public.lessons;
drop policy if exists "lessons: lektor/admin vidí i zrušené" on public.lessons;
drop policy if exists "lessons: lektor vytváří pro své kurzy" on public.lessons;
drop policy if exists "lessons: lektor edituje vlastní" on public.lessons;

drop policy if exists "passes: veřejné čtení aktivních" on public.passes;
drop policy if exists "passes: lektor CRUD vlastní" on public.passes;
drop policy if exists "passes: admin CRUD vše" on public.passes;

drop policy if exists "users: číst vlastní" on public.users;
drop policy if exists "users: admin vidí vše" on public.users;
drop policy if exists "users: lektor vidí své zákazníky" on public.users;
drop policy if exists "users: editovat vlastní" on public.users;
drop policy if exists "users: vytvořit vlastní profil" on public.users;

drop policy if exists "user_passes: číst vlastní" on public.user_passes;
drop policy if exists "user_passes: lektor vidí pro své kurzy" on public.user_passes;
drop policy if exists "user_passes: admin vidí vše" on public.user_passes;
drop policy if exists "user_passes: admin vytvoří" on public.user_passes;
drop policy if exists "user_passes: admin upravuje" on public.user_passes;

drop policy if exists "bookings: číst vlastní" on public.bookings;
drop policy if exists "bookings: lektor vidí na svých lekcích" on public.bookings;
drop policy if exists "bookings: admin vidí vše" on public.bookings;
drop policy if exists "bookings: vytvořit vlastní" on public.bookings;
drop policy if exists "bookings: zákazník storní vlastní" on public.bookings;
drop policy if exists "bookings: lektor edituje na svých lekcích" on public.bookings;
drop policy if exists "bookings: admin edituje vše" on public.bookings;

-- ============================================================
-- 1. COURSES — veřejná nabídka
-- READ:   kdokoliv (anon i authenticated)
-- WRITE:  jen lektor-vlastník nebo admin
-- ============================================================

-- Anonymní i přihlášení vidí všechny aktivní kurzy
create policy "courses: veřejné čtení"
  on public.courses for select
  to anon, authenticated
  using (is_active = true);

-- Admin vidí i neaktivní
create policy "courses: admin vidí vše"
  on public.courses for select
  to authenticated
  using (public.is_admin());

-- Lektor vidí své neaktivní kurzy (pro správu)
create policy "courses: lektor vidí vlastní neaktivní"
  on public.courses for select
  to authenticated
  using (
    public.is_lektor()
    and owner_id = public.current_user_id()
  );

-- Lektor zakládá kurz jen pod svým owner_id
create policy "courses: lektor vytváří"
  on public.courses for insert
  to authenticated
  with check (
    public.is_lektor()
    and owner_id = public.current_user_id()
  );

-- Lektor edituje jen své kurzy; nesmí přepsat owner_id
create policy "courses: lektor edituje vlastní"
  on public.courses for update
  to authenticated
  using (
    public.is_lektor()
    and owner_id = public.current_user_id()
  )
  with check (
    owner_id = public.current_user_id()
  );

-- Mazat smí jen admin (lektor deaktivuje přes is_active = false)
create policy "courses: admin maže"
  on public.courses for delete
  to authenticated
  using (public.is_admin());

-- ============================================================
-- 2. LESSONS — veřejný kalendář
-- READ:   kdokoliv vidí aktivní lekce
-- WRITE:  jen lektor-vlastník kurzu nebo admin
-- ============================================================

create policy "lessons: veřejné čtení aktivních"
  on public.lessons for select
  to anon, authenticated
  using (status = 'active');

-- Lektor (a admin) vidí i zrušené lekce svých kurzů
create policy "lessons: lektor/admin vidí i zrušené"
  on public.lessons for select
  to authenticated
  using (
    public.is_lektor()
    and exists (
      select 1 from public.courses c
      where c.id = public.lessons.course_id
        and c.owner_id = public.current_user_id()
    )
  );

create policy "lessons: lektor vytváří pro své kurzy"
  on public.lessons for insert
  to authenticated
  with check (
    public.is_lektor()
    and exists (
      select 1 from public.courses c
      where c.id = course_id
        and c.owner_id = public.current_user_id()
    )
  );

create policy "lessons: lektor edituje vlastní"
  on public.lessons for update
  to authenticated
  using (
    public.is_lektor()
    and exists (
      select 1 from public.courses c
      where c.id = public.lessons.course_id
        and c.owner_id = public.current_user_id()
    )
  );

-- ============================================================
-- 3. PASSES — veřejná nabídka produktů
-- READ:   kdokoliv vidí aktivní pass produkty (nabídku lektora)
-- WRITE:  jen lektor-vlastník nebo admin
-- ============================================================

create policy "passes: veřejné čtení aktivních"
  on public.passes for select
  to anon, authenticated
  using (is_active = true);

-- Lektor spravuje jen své pass produkty
create policy "passes: lektor CRUD vlastní"
  on public.passes for all
  to authenticated
  using (
    public.is_lektor()
    and owner_id = public.current_user_id()
  )
  with check (
    public.is_lektor()
    and owner_id = public.current_user_id()
  );

create policy "passes: admin CRUD vše"
  on public.passes for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- 4. USERS — soukromé profily
-- READ:   vlastník, admin; lektor vidí zákazníky svých kurzů
-- WRITE:  jen vlastník (role se nemění přes RLS)
-- ============================================================

-- Vlastní profil
create policy "users: číst vlastní"
  on public.users for select
  to authenticated
  using (id = public.current_user_id());

-- Admin vidí vše
create policy "users: admin vidí vše"
  on public.users for select
  to authenticated
  using (public.is_admin());

-- Lektor vidí profily zákazníků přihlášených na jeho lekce
create policy "users: lektor vidí své zákazníky"
  on public.users for select
  to authenticated
  using (
    public.is_lektor()
    and exists (
      select 1
      from public.bookings b
      join public.lessons  l on l.id = b.lesson_id
      join public.courses  c on c.id = l.course_id
      where b.user_id    = public.users.id
        and c.owner_id   = public.current_user_id()
    )
  );

-- Vlastník edituje svůj profil; role nelze eskalovat přes RLS
create policy "users: editovat vlastní"
  on public.users for update
  to authenticated
  using (id = public.current_user_id())
  with check (
    id = public.current_user_id()
    and role = public.current_user_role()
  );

-- INSERT zajišťuje Supabase Auth trigger (handle_new_user),
-- ne přímý SQL INSERT od klienta.
create policy "users: vytvořit vlastní profil"
  on public.users for insert
  to authenticated
  with check (id = auth.uid());

-- ============================================================
-- 5. USER_PASSES — soukromé zakoupené permanentky
-- Anon NEMÁ přístup. Pouze authenticated.
-- ============================================================

create policy "user_passes: číst vlastní"
  on public.user_passes for select
  to authenticated
  using (user_id = public.current_user_id());

-- Lektor vidí permanentky svých zákazníků (pro správu docházky)
create policy "user_passes: lektor vidí pro své kurzy"
  on public.user_passes for select
  to authenticated
  using (
    public.is_lektor()
    and exists (
      select 1 from public.passes p
      where p.id       = public.user_passes.pass_id
        and p.owner_id = public.current_user_id()
    )
  );

-- Admin vidí vše
create policy "user_passes: admin vidí vše"
  on public.user_passes for select
  to authenticated
  using (public.is_admin());

-- INSERT: uživatel pro sebe (nákup z aplikace) nebo admin ručně pro zákazníka.
create policy "user_passes: admin vytvoří"
  on public.user_passes for insert
  to authenticated
  with check (public.is_admin());

-- UPDATE: admin může upravit zakoupenou permanentku zákazníka (správa vstupů / platnosti).
create policy "user_passes: admin upravuje"
  on public.user_passes for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- 6. BOOKINGS — soukromé rezervace
-- Anon NEMÁ přístup k žádné operaci.
-- INSERT: jen authenticated (po zadání e-mailu → ghost/real účet)
-- ============================================================

create policy "bookings: číst vlastní"
  on public.bookings for select
  to authenticated
  using (user_id = public.current_user_id());

-- Lektor vidí rezervace na svých lekcích (pro docházku)
create policy "bookings: lektor vidí na svých lekcích"
  on public.bookings for select
  to authenticated
  using (
    public.is_lektor()
    and exists (
      select 1
      from public.lessons l
      join public.courses c on c.id = l.course_id
      where l.id         = public.bookings.lesson_id
        and c.owner_id   = public.current_user_id()
    )
  );

create policy "bookings: admin vidí vše"
  on public.bookings for select
  to authenticated
  using (public.is_admin());

-- Zákazník vytváří rezervaci jen na sebe.
-- Předchází to INSERT pro anon — role anon nemá grant na bookings.
create policy "bookings: vytvořit vlastní"
  on public.bookings for insert
  to authenticated
  with check (user_id = public.current_user_id());

-- Zákazník smí jen stornat (status booked → cancelled).
-- Vše ostatní (attended, missed) mění lektor nebo backend.
create policy "bookings: zákazník storní vlastní"
  on public.bookings for update
  to authenticated
  using (
    user_id  = public.current_user_id()
    and status = 'booked'
    and payment_type = 'pass'
  )
  with check (
    status   = 'cancelled'
    and user_id   = public.current_user_id()
    and payment_type = 'pass'
    and lesson_id = lesson_id
  );

-- Lektor označuje docházku (attended / missed)
create policy "bookings: lektor edituje na svých lekcích"
  on public.bookings for update
  to authenticated
  using (
    public.is_lektor()
    and exists (
      select 1
      from public.lessons l
      join public.courses c on c.id = l.course_id
      where l.id       = public.bookings.lesson_id
        and c.owner_id = public.current_user_id()
    )
  );

-- Admin může upravovat rezervace (např. storno přihlášky zákazníka z lekce)
create policy "bookings: admin edituje vše"
  on public.bookings for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- GHOST ÚČET — Flow při rezervaci bez přihlášení
-- ============================================================
-- 1. Návštěvník vyplní e-mail v popup okně.
-- 2. Edge Function (service_role) zkontroluje, zda users.email existuje.
--    a) NE → vytvoří ghost účet (auth.admin.createUser + users INSERT).
--    b) ANO → odešle Magic Link na existující e-mail.
-- 3. Po vytvoření ghost účtu Edge Function vytvoří booking pod ghost user_id.
-- 4. Při prvním přihlášení přes Magic Link se ghost účet "promění" v plný
--    účet — žádná migrace dat není potřeba, user_id zůstává stejné.
--
-- Tato logika žije výhradně v Edge Functions (service_role).
-- RLS záměrně neumožňuje anon INSERT do bookings — je to správně.
-- ============================================================
