-- ============================================================
-- ATELIER — Finální SQL pro Supabase SQL Editor
-- Pořadí: Extensions → Tabulky → Indexy → View → Funkce →
--         Triggery → RLS → Granty → Auth trigger
--
-- Jak spustit: Supabase dashboard → SQL Editor → vložit celý
-- soubor → Run (F5). Lze spustit opakovaně (idempotentní).
-- ============================================================

-- ── 0. Rozšíření ─────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Migrace: přidání sloupce role pokud chybí ─────────────────
alter table public.users
  add column if not exists role text not null default 'uzivatel'
    check (role in ('admin','lektor','uzivatel'));

-- ── Migrace: rozvrhové sloupce na kurzech ─────────────────────
alter table public.courses
  add column if not exists schedule_days         int[]  default '{}',
  add column if not exists schedule_time_start   time,
  add column if not exists schedule_time_end     time;

-- ── Migrace: příznak workshopu ────────────────────────────────
alter table public.courses
  add column if not exists is_workshop boolean not null default false;

-- ── Migrace: chybějící sloupce users ─────────────────────────
alter table public.users
  add column if not exists is_ghost       boolean not null default false,
  add column if not exists reminder_hours int              default 24;

-- ── Migrace: chybějící sloupce courses ───────────────────────
alter table public.courses
  add column if not exists description_short  jsonb,
  add column if not exists description_long   jsonb,
  add column if not exists images             text[],
  add column if not exists cancellation_hours int not null default 24;

-- ============================================================
-- TABULKY
-- ============================================================

-- ── USERS ────────────────────────────────────────────────────
create table if not exists public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null unique,
  name          text,
  avatar_url    text,
  role          text not null default 'uzivatel'
                  check (role in ('admin','lektor','uzivatel')),
  is_ghost      boolean not null default false,
  created_via   text default 'magic_link'
                  check (created_via in ('magic_link','google','apple','ghost')),
  language_pref text not null default 'cs'
                  check (language_pref in ('cs','en')),
  reminder_hours int default 24,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── COURSES ──────────────────────────────────────────────────
-- title, description_short, description_long jsou JSONB:
-- {"cs": "Točení na kruhu", "en": "Wheel Throwing"}
create table if not exists public.courses (
  id                uuid primary key default uuid_generate_v4(),
  owner_id          uuid not null references public.users(id) on delete restrict,
  title             jsonb not null,
  description_short jsonb,
  description_long  jsonb,
  images            text[],
  color_code        text not null default '#2854B9',
  is_active         boolean not null default true,
  is_workshop       boolean not null default false,
  cancellation_hours int not null default 24
                      check (cancellation_hours in (6,24,48)),
  capacity_default  int not null default 12,
  price_single      numeric(10,2) not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── LESSONS ──────────────────────────────────────────────────
create table if not exists public.lessons (
  id           uuid primary key default uuid_generate_v4(),
  course_id    uuid not null references public.courses(id) on delete cascade,
  start_time   timestamptz not null,
  end_time     timestamptz not null,
  capacity     int not null,
  price_single numeric(10,2) not null,
  status       text not null default 'active'
                 check (status in ('active','cancelled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint lesson_time_valid check (end_time > start_time)
);

create index if not exists idx_lessons_course_id  on public.lessons(course_id);
create index if not exists idx_lessons_start_time on public.lessons(start_time);

-- ── PASSES — definice produktů permanentek ───────────────────
create table if not exists public.passes (
  id                 uuid primary key default uuid_generate_v4(),
  owner_id           uuid not null references public.users(id) on delete restrict,
  name               jsonb not null,
  entries_total      int not null check (entries_total > 0),
  price              numeric(10,2) not null,
  validity_weeks     int not null,
  allowed_course_ids uuid[] not null,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_passes_owner_id on public.passes(owner_id);

-- ── USER_PASSES — zakoupené permanentky ──────────────────────
create table if not exists public.user_passes (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references public.users(id) on delete cascade,
  pass_id           uuid not null references public.passes(id) on delete restrict,
  entries_total     int not null,
  entries_remaining int not null,
  price_paid        numeric(10,2) not null,
  expires_at        timestamptz not null,
  status            text not null default 'active'
                      check (status in ('active','expired','depleted')),
  stripe_payment_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint entries_valid check (
    entries_remaining >= 0 and entries_remaining <= entries_total
  )
);

create index if not exists idx_user_passes_user_id on public.user_passes(user_id);
create index if not exists idx_user_passes_status  on public.user_passes(status);
create index if not exists idx_user_passes_expires on public.user_passes(expires_at);

-- ── BOOKINGS — rezervace ─────────────────────────────────────
create table if not exists public.bookings (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references public.users(id) on delete cascade,
  lesson_id         uuid not null references public.lessons(id) on delete cascade,
  user_pass_id      uuid references public.user_passes(id),
  payment_type      text not null check (payment_type in ('pass','single')),
  price_paid        numeric(10,2),
  status            text not null default 'booked'
                      check (status in ('booked','cancelled','missed','attended')),
  cancelled_at      timestamptz,
  cancellation_type text check (cancellation_type in ('early','late')),
  stripe_payment_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_bookings_user_id        on public.bookings(user_id);
create index if not exists idx_bookings_lesson_id      on public.bookings(lesson_id);
create index if not exists idx_bookings_status         on public.bookings(status);
create index if not exists idx_bookings_stripe_payment on public.bookings(stripe_payment_id);

-- Jen jedna aktivní rezervace na uživatele a lekci (po zrušení lze znovu rezervovat)
alter table public.bookings drop constraint if exists unique_active_booking;
drop index if exists public.bookings_unique_user_lesson_booked;
create unique index if not exists bookings_unique_user_lesson_booked
  on public.bookings (user_id, lesson_id)
  where (status = 'booked');

-- ── GDPR DELETION LOG ────────────────────────────────────────
create table if not exists public.gdpr_deletion_log (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  reason       text,
  ip_hash      text
);

-- ============================================================
-- VIEWS
-- ============================================================

-- Obsazenost lekcí (čtou ji klienti i admin)
create or replace view public.lesson_availability as
  select
    l.id            as lesson_id,
    l.course_id,
    l.start_time,
    l.end_time,
    l.capacity,
    l.price_single,
    l.status,
    count(b.id) filter (where b.status = 'booked') as booked_count,
    l.capacity - count(b.id) filter (where b.status = 'booked') as available_spots
  from public.lessons l
  left join public.bookings b on b.lesson_id = l.id
  group by l.id;

-- GDPR přehled pro DPO (pouze service_role)
create or replace view public.gdpr_data_summary as
  select
    u.id,
    u.role,
    u.created_at,
    count(distinct b.id)  filter (where b.status = 'booked')    as active_bookings,
    count(distinct b.id)  filter (where b.status = 'cancelled')  as cancelled_bookings,
    count(distinct up.id) filter (where up.status = 'active')    as active_passes,
    count(distinct up.id)                                         as total_passes
  from public.users u
  left join public.bookings    b  on b.user_id  = u.id
  left join public.user_passes up on up.user_id = u.id
  group by u.id, u.role, u.created_at;

-- ============================================================
-- FUNKCE A TRIGGERY
-- ============================================================

-- ── updated_at trigger funkce ─────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_users_updated      on public.users;
drop trigger if exists trg_courses_updated    on public.courses;
drop trigger if exists trg_lessons_updated    on public.lessons;
drop trigger if exists trg_passes_updated     on public.passes;
drop trigger if exists trg_user_passes_updated on public.user_passes;
drop trigger if exists trg_bookings_updated   on public.bookings;

create trigger trg_users_updated
  before update on public.users
  for each row execute function public.set_updated_at();
create trigger trg_courses_updated
  before update on public.courses
  for each row execute function public.set_updated_at();
create trigger trg_lessons_updated
  before update on public.lessons
  for each row execute function public.set_updated_at();
create trigger trg_passes_updated
  before update on public.passes
  for each row execute function public.set_updated_at();
create trigger trg_user_passes_updated
  before update on public.user_passes
  for each row execute function public.set_updated_at();
create trigger trg_bookings_updated
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- ── Validace: permanentka nesmí mít kurzy jiného lektora ─────
-- Admin toto omezení nemá — může vytvářet permanentky pro libovolné kurzy.
create or replace function public.validate_pass_courses()
returns trigger language plpgsql as $$
declare invalid_count int;
begin
  if public.is_admin() then return new; end if;
  select count(*) into invalid_count
  from unnest(new.allowed_course_ids) as cid
  left join public.courses c on c.id = cid and c.owner_id = new.owner_id
  where c.id is null;
  if invalid_count > 0 then
    raise exception 'Permanentka obsahuje kurzy jiného lektora.';
  end if;
  return new;
end; $$;

drop trigger if exists trg_validate_pass_courses on public.passes;
create trigger trg_validate_pass_courses
  before insert or update on public.passes
  for each row execute function public.validate_pass_courses();

-- ── Kapacita lekce ───────────────────────────────────────────
create or replace function public.check_lesson_capacity()
returns trigger language plpgsql as $$
declare booked_count int; max_capacity int;
begin
  if new.status = 'booked' then
    select count(*) into booked_count
    from public.bookings where lesson_id = new.lesson_id and status = 'booked';
    select capacity into max_capacity
    from public.lessons where id = new.lesson_id;
    if booked_count >= max_capacity then
      raise exception 'Lekce je plně obsazena (kapacita: %).', max_capacity;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_check_lesson_capacity on public.bookings;
create trigger trg_check_lesson_capacity
  before insert on public.bookings
  for each row execute function public.check_lesson_capacity();

-- ── Dekrementace vstupů při rezervaci ────────────────────────
create or replace function public.decrement_pass_on_booking()
returns trigger language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_type = 'pass' and new.user_pass_id is not null then
    update public.user_passes
    set entries_remaining = entries_remaining - 1,
        status = case when entries_remaining - 1 <= 0 then 'depleted' else status end
    where id = new.user_pass_id and entries_remaining > 0;
    if not found then
      raise exception 'Permanentka nemá žádné zbývající vstupy.';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_decrement_pass on public.bookings;
create trigger trg_decrement_pass
  after insert on public.bookings
  for each row execute function public.decrement_pass_on_booking();

-- ── Vrácení vstupu při stornu (permanentka) ───────────────────
-- Typ storna (early/late) se stále počítá pro přehled; vstup na permanentku
-- se vrátí vždy, aby odpovídal rozhraní aplikace po každém zrušení rezervace.
create or replace function public.restore_pass_on_cancel()
returns trigger language plpgsql
security definer
set search_path = public
as $$
declare
  lesson_start  timestamptz;
  cancel_hours  int;
  hours_before  numeric;
begin
  if new.status = 'cancelled' and old.status = 'booked' then
    select l.start_time, c.cancellation_hours
    into lesson_start, cancel_hours
    from public.lessons l
    join public.courses c on c.id = l.course_id
    where l.id = new.lesson_id;

    hours_before := extract(epoch from (lesson_start - now())) / 3600;

    if hours_before >= cancel_hours then
      new.cancellation_type := 'early';
    else
      new.cancellation_type := 'late';
    end if;

    if old.user_pass_id is not null then
      update public.user_passes
      set entries_remaining = entries_remaining + 1,
          status = case when status = 'depleted' then 'active' else status end
      where id = old.user_pass_id;
    end if;

    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;
  return new;
end; $$;

drop trigger if exists trg_restore_pass_on_cancel on public.bookings;
create trigger trg_restore_pass_on_cancel
  before update on public.bookings
  for each row execute function public.restore_pass_on_cancel();

-- ── Expirace permanentek (volat cron jobem) ──────────────────
create or replace function public.expire_passes()
returns void language plpgsql as $$
begin
  update public.user_passes
  set status = 'expired'
  where status = 'active' and expires_at < now();
end; $$;

-- ── Soulad zbývajících vstupů s aktivními rezervacemi ───────────
-- Platí: entries_remaining = entries_total − počet řádků bookings
-- se status = 'booked' a payment_type = 'pass' pro danou permanentku.
-- Opraví staré nesrovnalosti (např. po stornu mimo lhůtu bez vrácení vstupu).
create or replace function public.reconcile_my_pass_balances()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.user_passes up
  set
    entries_remaining = x.nr,
    status = case
      when up.expires_at < now() then 'expired'
      when x.nr <= 0 then 'depleted'
      else 'active'
    end,
    updated_at = now()
  from (
    select
      up2.id,
      greatest(
        0,
        least(
          up2.entries_total,
          up2.entries_total - coalesce(bc.c, 0)
        )
      ) as nr
    from public.user_passes up2
    left join lateral (
      select count(*)::int as c
      from public.bookings b
      where b.user_pass_id = up2.id
        and b.status = 'booked'
        and b.payment_type = 'pass'
    ) bc on true
    where up2.user_id = auth.uid()
  ) x
  where up.id = x.id;
end;
$$;

revoke all on function public.reconcile_my_pass_balances() from public;
grant execute on function public.reconcile_my_pass_balances() to authenticated;

-- ── GDPR anonymizace účtu ─────────────────────────────────────
create or replace function public.anonymize_user_account(
  p_user_id  uuid,
  p_reason   text default null,
  p_ip_hash  text default null
)
returns jsonb language plpgsql
security definer
set search_path = public
as $$
declare
  v_anon_email text;
  v_now        timestamptz := now();
  v_cancelled  int;
  v_log_id     uuid;
begin
  if not exists (
    select 1 from public.users
    where id = p_user_id and email not like 'deleted\_%'
  ) then
    return jsonb_build_object('error','Účet nenalezen nebo již anonymizován.');
  end if;

  insert into public.gdpr_deletion_log(user_id, reason, ip_hash)
  values (p_user_id, p_reason, p_ip_hash)
  returning id into v_log_id;

  update public.bookings b
  set status = 'cancelled', cancelled_at = v_now, cancellation_type = 'early'
  from public.lessons l
  where b.lesson_id = l.id
    and b.user_id   = p_user_id
    and b.status    = 'booked'
    and l.start_time > v_now;
  get diagnostics v_cancelled = row_count;

  update public.user_passes
  set status = 'expired', entries_remaining = 0, updated_at = v_now
  where user_id = p_user_id and status = 'active';

  v_anon_email := 'deleted_' || left(p_user_id::text, 8) || '@deleted.invalid';
  update public.users
  set email = v_anon_email, name = 'Smazaný uživatel',
      avatar_url = null, is_ghost = false, updated_at = v_now
  where id = p_user_id;

  update public.gdpr_deletion_log set completed_at = v_now where id = v_log_id;

  return jsonb_build_object(
    'ok',                        true,
    'anon_email',                v_anon_email,
    'future_bookings_cancelled', v_cancelled,
    'log_id',                    v_log_id
  );
exception when others then
  return jsonb_build_object('error', sqlerrm, 'detail', sqlstate);
end; $$;

revoke execute on function public.anonymize_user_account from public, anon, authenticated;

-- ── GDPR: bezpečná verze pro frontend (bez service_role) ──────
-- Uživatel nevolá user_id přímo, bere se z auth.uid().
create or replace function public.request_account_deletion(
  p_reason  text default null,
  p_ip_hash text default null
)
returns jsonb language plpgsql
security definer
set search_path = public
as $$
begin
  return public.anonymize_user_account(auth.uid(), p_reason, p_ip_hash);
end; $$;

grant execute on function public.request_account_deletion(text, text) to authenticated;

-- ── Auth trigger: automaticky vytvoří profil po registraci ───
-- Toto je bezpečnější než čistě klientská logika v auth.js.
create or replace function public.handle_new_user()
returns trigger language plpgsql
security definer set search_path = public
as $$
declare
  v_name       text;
  v_via        text;
begin
  v_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1),
    'Nový uživatel'
  );
  v_via := case coalesce(new.raw_app_meta_data->>'provider', 'email')
    when 'email'  then 'magic_link'
    when 'google' then 'google'
    when 'apple'  then 'apple'
    else               'magic_link'
  end;

  insert into public.users (id, email, name, role, is_ghost, created_via)
  values (new.id, new.email, v_name, 'uzivatel', false, v_via)
  on conflict (id) do nothing;   -- ghost účet už může existovat

  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- RLS — Row Level Security
-- ============================================================

-- Pomocné funkce (SECURITY DEFINER brání rekurzi)
create or replace function public.current_user_id()
returns uuid language sql stable security definer as $$
  select auth.uid();
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

-- Zapnutí RLS
alter table public.users           enable row level security;
alter table public.courses         enable row level security;
alter table public.lessons         enable row level security;
alter table public.passes          enable row level security;
alter table public.user_passes     enable row level security;
alter table public.bookings        enable row level security;
alter table public.gdpr_deletion_log enable row level security;

-- ── Granty (PostgreSQL privilegia, RLS pak dále omezuje) ─────
grant usage on schema public to anon, authenticated;
grant select on public.courses, public.lessons, public.passes to anon, authenticated;
-- Lektoři a admini potřebují INSERT/UPDATE/DELETE na kurzech, lekcích a permanentkách:
grant insert, update, delete on public.courses to authenticated;
grant insert, update, delete on public.lessons to authenticated;
grant insert, update, delete on public.passes  to authenticated;
grant select, insert, update on public.bookings    to authenticated;
grant select, insert, update on public.user_passes to authenticated;
grant select, update, insert on public.users       to authenticated;
grant select on public.lesson_availability         to anon, authenticated;

-- ── 1. COURSES ───────────────────────────────────────────────
drop policy if exists "courses: veřejné čtení"                on public.courses;
drop policy if exists "courses: admin vidí vše"               on public.courses;
drop policy if exists "courses: lektor vidí vlastní neaktivní" on public.courses;
drop policy if exists "courses: lektor vytváří"               on public.courses;
drop policy if exists "courses: lektor edituje vlastní"       on public.courses;
drop policy if exists "courses: admin maže"                   on public.courses;
drop policy if exists "courses: admin edituje vše"            on public.courses;

create policy "courses: veřejné čtení"
  on public.courses for select to anon, authenticated
  using (is_active = true);

create policy "courses: admin vidí vše"
  on public.courses for select to authenticated
  using (public.is_admin());

create policy "courses: lektor vidí vlastní neaktivní"
  on public.courses for select to authenticated
  using (public.is_lektor() and owner_id = public.current_user_id());

create policy "courses: lektor vytváří"
  on public.courses for insert to authenticated
  with check (public.is_lektor() and owner_id = public.current_user_id());

create policy "courses: lektor edituje vlastní"
  on public.courses for update to authenticated
  using (public.is_lektor() and owner_id = public.current_user_id())
  with check (owner_id = public.current_user_id());

create policy "courses: admin maže"
  on public.courses for delete to authenticated
  using (public.is_admin());

create policy "courses: admin edituje vše"
  on public.courses for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── 2. LESSONS ───────────────────────────────────────────────
drop policy if exists "lessons: veřejné čtení aktivních"       on public.lessons;
drop policy if exists "lessons: lektor/admin vidí i zrušené"   on public.lessons;
drop policy if exists "lessons: lektor vytváří pro své kurzy"  on public.lessons;
drop policy if exists "lessons: lektor edituje vlastní"        on public.lessons;
drop policy if exists "lessons: admin edituje vše"             on public.lessons;

create policy "lessons: veřejné čtení aktivních"
  on public.lessons for select to anon, authenticated
  using (status = 'active');

create policy "lessons: lektor/admin vidí i zrušené"
  on public.lessons for select to authenticated
  using (
    public.is_lektor()
    and exists (
      select 1 from public.courses c
      where c.id = public.lessons.course_id and c.owner_id = public.current_user_id()
    )
  );

create policy "lessons: lektor vytváří pro své kurzy"
  on public.lessons for insert to authenticated
  with check (
    public.is_lektor()
    and exists (
      select 1 from public.courses c
      where c.id = course_id and c.owner_id = public.current_user_id()
    )
  );

create policy "lessons: lektor edituje vlastní"
  on public.lessons for update to authenticated
  using (
    public.is_lektor()
    and exists (
      select 1 from public.courses c
      where c.id = public.lessons.course_id and c.owner_id = public.current_user_id()
    )
  );

create policy "lessons: admin edituje vše"
  on public.lessons for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── 3. PASSES ────────────────────────────────────────────────
drop policy if exists "passes: veřejné čtení aktivních" on public.passes;
drop policy if exists "passes: lektor CRUD vlastní"     on public.passes;
drop policy if exists "passes: admin CRUD vše"          on public.passes;

create policy "passes: veřejné čtení aktivních"
  on public.passes for select to anon, authenticated
  using (is_active = true);

create policy "passes: lektor CRUD vlastní"
  on public.passes for all to authenticated
  using (public.is_lektor() and owner_id = public.current_user_id())
  with check (public.is_lektor() and owner_id = public.current_user_id());

create policy "passes: admin CRUD vše"
  on public.passes for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── 4. USERS ─────────────────────────────────────────────────
drop policy if exists "users: číst vlastní"              on public.users;
drop policy if exists "users: admin vidí vše"            on public.users;
drop policy if exists "users: lektor vidí své zákazníky" on public.users;
drop policy if exists "users: čtení jmen lektorů"        on public.users;
drop policy if exists "users: editovat vlastní"          on public.users;
drop policy if exists "users: vytvořit vlastní profil"   on public.users;

create policy "users: číst vlastní"
  on public.users for select to authenticated
  using (id = public.current_user_id());

create policy "users: admin vidí vše"
  on public.users for select to authenticated
  using (public.is_admin());

create policy "users: lektor vidí své zákazníky"
  on public.users for select to authenticated
  using (
    public.is_lektor()
    and exists (
      select 1
      from public.bookings b
      join public.lessons  l on l.id = b.lesson_id
      join public.courses  c on c.id = l.course_id
      where b.user_id = public.users.id and c.owner_id = public.current_user_id()
    )
  );

-- Veřejně viditelná jména lektorů a adminů — nutné pro JOIN
-- `owner:users!owner_id(id,name)` v seznamu kurzů.
-- Sloupcové granty níže omezují anon na pouhé id+name+role,
-- takže e‑mail / avatar zůstávají skryté.
create policy "users: čtení jmen lektorů"
  on public.users for select to anon, authenticated
  using (role in ('lektor', 'admin'));

create policy "users: editovat vlastní"
  on public.users for update to authenticated
  using (id = public.current_user_id())
  with check (
    id = public.current_user_id()
    and role = (select role from public.users where id = public.current_user_id())
  );

-- INSERT zajišťuje primárně handle_new_user trigger,
-- ale záložní klientská cesta (auth.js createUserProfile) je povolena také.
create policy "users: vytvořit vlastní profil"
  on public.users for insert to authenticated
  with check (id = auth.uid());

-- Anon (nepřihlášený návštěvník) smí číst jen ne‑citlivé sloupce.
-- Email / avatar / language_pref / reminder_hours zůstávají skryté.
revoke select on public.users from anon;
grant  select (id, name, role) on public.users to anon;

-- ── 5. USER_PASSES ───────────────────────────────────────────
drop policy if exists "user_passes: číst vlastní"              on public.user_passes;
drop policy if exists "user_passes: lektor vidí pro své kurzy" on public.user_passes;
drop policy if exists "user_passes: admin vidí vše"            on public.user_passes;
drop policy if exists "user_passes: uživatel vytvoří vlastní"  on public.user_passes;

create policy "user_passes: číst vlastní"
  on public.user_passes for select to authenticated
  using (user_id = public.current_user_id());

create policy "user_passes: lektor vidí pro své kurzy"
  on public.user_passes for select to authenticated
  using (
    public.is_lektor()
    and exists (
      select 1 from public.passes p
      where p.id = public.user_passes.pass_id and p.owner_id = public.current_user_id()
    )
  );

create policy "user_passes: admin vidí vše"
  on public.user_passes for select to authenticated
  using (public.is_admin());

-- Uživatel může koupit permanentku (INSERT) jen pro sebe
create policy "user_passes: uživatel vytvoří vlastní"
  on public.user_passes for insert to authenticated
  with check (user_id = public.current_user_id());

-- ── 6. BOOKINGS ──────────────────────────────────────────────
drop policy if exists "bookings: číst vlastní"               on public.bookings;
drop policy if exists "bookings: lektor vidí na svých lekcích" on public.bookings;
drop policy if exists "bookings: admin vidí vše"             on public.bookings;
drop policy if exists "bookings: vytvořit vlastní"           on public.bookings;
drop policy if exists "bookings: zákazník storní vlastní"    on public.bookings;
drop policy if exists "bookings: lektor edituje na svých lekcích" on public.bookings;
drop policy if exists "bookings: admin edituje vše"          on public.bookings;

create policy "bookings: číst vlastní"
  on public.bookings for select to authenticated
  using (user_id = public.current_user_id());

create policy "bookings: lektor vidí na svých lekcích"
  on public.bookings for select to authenticated
  using (
    public.is_lektor()
    and exists (
      select 1
      from public.lessons l
      join public.courses c on c.id = l.course_id
      where l.id = public.bookings.lesson_id and c.owner_id = public.current_user_id()
    )
  );

create policy "bookings: admin vidí vše"
  on public.bookings for select to authenticated
  using (public.is_admin());

create policy "bookings: vytvořit vlastní"
  on public.bookings for insert to authenticated
  with check (user_id = public.current_user_id());

create policy "bookings: zákazník storní vlastní"
  on public.bookings for update to authenticated
  using (user_id = public.current_user_id() and status = 'booked')
  with check (status = 'cancelled' and user_id = public.current_user_id());

create policy "bookings: lektor edituje na svých lekcích"
  on public.bookings for update to authenticated
  using (
    public.is_lektor()
    and exists (
      select 1
      from public.lessons l
      join public.courses c on c.id = l.course_id
      where l.id = public.bookings.lesson_id and c.owner_id = public.current_user_id()
    )
  );

create policy "bookings: admin edituje vše"
  on public.bookings for update to authenticated
  using (public.is_admin());

-- ── 7. GDPR LOG — nikdo přes klienta nečte ani nepíše ────────
drop policy if exists "gdpr_log: jen service_role" on public.gdpr_deletion_log;
create policy "gdpr_log: jen service_role"
  on public.gdpr_deletion_log
  using (false);

-- ============================================================
-- UKÁZKOVÁ DATA (volitelné — smaž pokud nechceš)
-- ============================================================
-- POZOR: Nejdřív musíš mít v databázi uživatele s rolí 'lektor'.
-- Po prvním přihlášení přes Magic Link si v tabulce users
-- nastav role = 'lektor' a pak vlož kurz + lekce.
--
-- Příklad (nahraď UUID svého uživatele):
--
-- update public.users set role = 'lektor' where email = 'tvuj@email.cz';
--
-- insert into public.courses (owner_id, title, description_short, color_code, price_single)
-- values (
--   (select id from public.users where email = 'tvuj@email.cz'),
--   '{"cs": "Točení na kruhu", "en": "Wheel Throwing"}',
--   '{"cs": "Kurz pro začátečníky i pokročilé."}',
--   '#2854B9',
--   450
-- );
--
-- insert into public.lessons (course_id, start_time, end_time, capacity, price_single)
-- values (
--   (select id from public.courses limit 1),
--   now() + interval '2 days',
--   now() + interval '2 days 1.5 hours',
--   12,
--   450
-- );

-- ============================================================
-- SUPABASE STORAGE — bucket `course-images` (kurzové fotky)
-- ============================================================
-- Aplikace (atelier-admin.js) nahrává soubory přes JS SDK a do sloupce
-- public.courses.images ukládá pouze veřejné URL.
--
-- 1) V Supabase Dashboard → Storage → vytvoř bucket **course-images**
--    (veřejný / public bucket, pokud chceš přímé URL bez signed URL).
--
-- 2) V SQL Editor spusť politiky pro storage.objects (název bucketu musí sedět):

-- insert into storage.buckets (id, name, public)
--   values ('course-images', 'course-images', true)
-- on conflict (id) do update set public = excluded.public;

-- drop policy if exists "course-images: veřejné čtení" on storage.objects;
-- create policy "course-images: veřejné čtení"
--   on storage.objects for select to public
--   using (bucket_id = 'course-images');

-- drop policy if exists "course-images: nahrát (přihlášený lektor/admin)" on storage.objects;
-- create policy "course-images: nahrát (přihlášený lektor/admin)"
--   on storage.objects for insert to authenticated
--   with check (
--     bucket_id = 'course-images'
--     and public.is_lektor()
--   );

-- drop policy if exists "course-images: mazat vlastní prefix" on storage.objects;
-- create policy "course-images: mazat vlastní prefix"
--   on storage.objects for delete to authenticated
--   using (
--     bucket_id = 'course-images'
--     and public.is_lektor()
--   );
--
-- Uprav mazací politiku podle potřeby (např. jen admin). Řádky výše jsou
-- záměrně zakomentované, aby se při opakovaném spuštění celého souboru nic nerozbilo
-- bez existujícího bucketu — odkomentuj po vytvoření bucketu.

-- ============================================================
