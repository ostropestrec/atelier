-- ============================================================
-- ATELIER — Konsolidovaný DB skript (v3, refaktorovaný)
-- ============================================================
-- Spustit v: Supabase dashboard → SQL Editor (vlož celý → Run).
-- Vše v jedné transakci → při chybě nic neuloží.
-- Idempotentní: bezpečně spustitelný i na poškozené DB.
--
-- Změny oproti předchozí verzi (vyřešení Unhealthy stavu):
--   • Sjednocené triggery — bookings drží lock na user_passes JEN 1×
--   • Admin RLS = jediná FOR ALL policy na tabulku (ne 5 separátních)
--   • Policies volají (select is_admin()) → InitPlan caching
--   • Odstraněné duplicity (restore_pass_on_cancel, cancel_my_pass_booking)
--   • Roztroušené ALTER migrace přesunuty do jednoho bloku (sekce 3a)
-- ============================================================

begin;

-- ============================================================
-- SEKCE 0 — Rozšíření
-- ============================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- SEKCE 1 — CLEANUP: stará/konfliktní rozhraní
-- ============================================================
-- Politiky (drop nezávisle na pořadí; CREATE bude níže)
do $cleanup$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'users','courses','lessons','passes','user_passes',
        'bookings','gdpr_deletion_log','email_notification_queue'
      )
  loop
    execute format('drop policy if exists %I on %I.%I',
                   pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end
$cleanup$;

-- Triggery a stará trigger funkce (rebuilt níže)
drop trigger if exists on_auth_user_created                   on auth.users;
drop trigger if exists trg_users_updated                      on public.users;
drop trigger if exists trg_courses_updated                    on public.courses;
drop trigger if exists trg_lessons_updated                    on public.lessons;
drop trigger if exists trg_passes_updated                     on public.passes;
drop trigger if exists trg_user_passes_updated                on public.user_passes;
drop trigger if exists trg_bookings_updated                   on public.bookings;
drop trigger if exists trg_validate_pass_courses              on public.passes;
drop trigger if exists trg_check_lesson_capacity              on public.bookings;
drop trigger if exists trg_check_pass_balance_before_booking  on public.bookings;
drop trigger if exists trg_decrement_pass                     on public.bookings;
drop trigger if exists trg_restore_pass_on_cancel             on public.bookings;
drop trigger if exists trg_lessons_notify_reschedule          on public.lessons;

-- Funkce (CASCADE odpojí triggery; vše obnovíme níže)
drop function if exists public.handle_new_user()                       cascade;
drop function if exists public.set_updated_at()                        cascade;
drop function if exists public.validate_pass_courses()                 cascade;
drop function if exists public.check_lesson_capacity()                 cascade;
drop function if exists public.check_pass_balance_before_booking()     cascade;
drop function if exists public.decrement_pass_on_booking()             cascade;
drop function if exists public.restore_pass_on_cancel()                cascade;
drop function if exists public.trg_lessons_notify_reschedule()         cascade;
drop function if exists public.cancel_my_pass_booking(uuid)            cascade;
drop function if exists public.admin_cancel_lesson(uuid)               cascade;
drop function if exists public.admin_cancel_customer_booking(uuid, boolean) cascade;
drop function if exists public.reconcile_my_pass_balances()            cascade;
drop function if exists public.enqueue_min_capacity_warnings()         cascade;
drop function if exists public.request_account_deletion(text, text)    cascade;
drop function if exists public.anonymize_user_account(uuid, text, text) cascade;
drop function if exists public.expire_passes()                         cascade;
drop function if exists public._course_title_plain(jsonb)              cascade;

-- ============================================================
-- SEKCE 2 — Helper funkce (musí být PŘED RLS / tabulkami)
-- ============================================================
-- Pozn.: STABLE + SECURITY DEFINER → bezpečné v RLS bez rekurze.
-- Vždy volat z policy přes (select is_admin()) — InitPlan caching.

create or replace function public.current_user_id()
returns uuid
language sql stable security definer
set search_path = public
as $$ select auth.uid() $$;

create or replace function public.current_user_role()
returns text
language sql stable security definer
set search_path = public
as $$ select role from public.users where id = auth.uid() $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_lektor()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role in ('lektor','admin')
  );
$$;

-- Limit storen na permanentkách: ≤5 vstupů → 1 storno, ≥6 → 2 storna
create or replace function public.allowed_pass_cancellations(p_entries_total int)
returns int
language sql immutable
as $$
  select case when coalesce(p_entries_total, 0) <= 5 then 1 else 2 end;
$$;

create or replace function public.can_self_cancel_booking(
  p_lesson_id     uuid,
  p_user_pass_id  uuid
)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lessons l
    join public.courses c     on c.id  = l.course_id
    join public.user_passes up on up.id = p_user_pass_id
    where l.id = p_lesson_id
      and l.start_time > now() + make_interval(hours => c.cancellation_hours)
      and coalesce(up.cancellation_count, 0)
            < public.allowed_pass_cancellations(up.entries_total)
  );
$$;

-- Lokalizovaný název kurzu (cs → en → raw)
create or replace function public._course_title_plain(p_title jsonb)
returns text language sql immutable as $$
  select coalesce(
    nullif(trim(p_title ->> 'cs'), ''),
    nullif(trim(p_title ->> 'en'), ''),
    left(p_title::text, 200)
  );
$$;

-- ============================================================
-- SEKCE 3 — Tabulky (čisté schéma, bez roztroušených migrací)
-- ============================================================

-- ── USERS ────────────────────────────────────────────────────
create table if not exists public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null unique,
  name            text,
  avatar_url      text,
  avatar_color    text default '#2854B9',
  role            text not null default 'uzivatel'
                    check (role in ('admin','lektor','uzivatel')),
  is_ghost        boolean not null default false,
  created_via     text default 'magic_link'
                    check (created_via in ('magic_link','google','apple','ghost')),
  language_pref   text not null default 'cs'
                    check (language_pref in ('cs','en')),
  reminder_hours  int default 24,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── COURSES ──────────────────────────────────────────────────
create table if not exists public.courses (
  id                 uuid primary key default uuid_generate_v4(),
  owner_id           uuid not null references public.users(id) on delete restrict,
  title              jsonb not null,
  description_short  jsonb,
  description_long   jsonb,
  images             text[],
  color_code         text not null default '#2854B9',
  is_active          boolean not null default true,
  is_workshop        boolean not null default false,
  cancellation_hours int  not null default 24
                       check (cancellation_hours in (6,24,48)),
  min_participants   int  not null default 1
                       check (min_participants >= 1),
  capacity_default   int  not null default 12,
  price_single       numeric(10,2) not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ── LESSONS ──────────────────────────────────────────────────
create table if not exists public.lessons (
  id                       uuid primary key default uuid_generate_v4(),
  course_id                uuid not null references public.courses(id) on delete cascade,
  start_time               timestamptz not null,
  end_time                 timestamptz not null,
  capacity                 int not null,
  price_single             numeric(10,2) not null,
  status                   text not null default 'active'
                             check (status in ('active','cancelled')),
  min_capacity_notified_at timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint lesson_time_valid check (end_time > start_time)
);

-- ── PASSES (definice produktů) ───────────────────────────────
create table if not exists public.passes (
  id                  uuid primary key default uuid_generate_v4(),
  owner_id            uuid not null references public.users(id) on delete restrict,
  name                jsonb not null,
  entries_total       int not null check (entries_total > 0),
  price               numeric(10,2) not null,
  validity_weeks      int not null,
  allowed_course_ids  uuid[] not null,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── USER_PASSES (zakoupené permanentky) ──────────────────────
create table if not exists public.user_passes (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references public.users(id) on delete cascade,
  pass_id             uuid not null references public.passes(id) on delete restrict,
  entries_total       int not null,
  entries_remaining   int not null,
  cancellation_count  int not null default 0
                        check (cancellation_count >= 0),
  price_paid          numeric(10,2) not null,
  expires_at          timestamptz not null,
  status              text not null default 'active'
                        check (status in ('active','expired','depleted')),
  stripe_payment_id   text,
  refund_status       text not null default 'not_required'
                        check (refund_status in ('not_required','pending','completed')),
  refund_note         text,
  refunded_at         timestamptz,
  refund_amount       numeric(10,2),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint entries_valid check (
    entries_remaining >= 0 and entries_remaining <= entries_total
  )
);

-- ── BOOKINGS ─────────────────────────────────────────────────
create table if not exists public.bookings (
  id                 uuid primary key default uuid_generate_v4(),
  user_id            uuid not null references public.users(id) on delete cascade,
  lesson_id          uuid not null references public.lessons(id) on delete cascade,
  user_pass_id       uuid references public.user_passes(id),
  payment_type       text not null check (payment_type in ('pass','single')),
  price_paid         numeric(10,2),
  status             text not null default 'booked'
                       check (status in ('booked','cancelled','missed','attended')),
  cancelled_at       timestamptz,
  cancellation_type  text check (cancellation_type in ('early','late')),
  stripe_payment_id  text,
  refund_status      text not null default 'not_required'
                       check (refund_status in ('not_required','pending','completed')),
  refund_note        text,
  refunded_at        timestamptz,
  refund_amount      numeric(10,2),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ── GDPR LOG ─────────────────────────────────────────────────
create table if not exists public.gdpr_deletion_log (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null,
  requested_at  timestamptz not null default now(),
  completed_at  timestamptz,
  reason        text,
  ip_hash       text
);

-- ── EMAIL QUEUE ──────────────────────────────────────────────
create table if not exists public.email_notification_queue (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null
                  check (kind in (
                    'min_capacity_below','lesson_cancelled','lesson_rescheduled',
                    'booking_cancelled_admin'
                  )),
  to_email      text not null,
  subject       text not null,
  body_plain    text not null,
  lesson_id     uuid references public.lessons(id) on delete set null,
  meta          jsonb not null default '{}'::jsonb,
  dedupe_key    text unique,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);

-- ============================================================
-- SEKCE 3a — Migrace existujících tabulek (ADD COLUMN IF NOT EXISTS)
-- ============================================================
-- Spustí se na DB, kde tabulky vznikly před přidáním nových sloupců.
-- Na čisté DB jsou všechny no-op.

alter table public.users
  add column if not exists avatar_color  text default '#2854B9';

alter table public.courses
  add column if not exists description_short  jsonb,
  add column if not exists description_long   jsonb,
  add column if not exists images             text[],
  add column if not exists is_workshop        boolean not null default false,
  add column if not exists min_participants   int     not null default 1,
  add column if not exists cancellation_hours int     not null default 24;

alter table public.lessons
  add column if not exists min_capacity_notified_at timestamptz;

alter table public.user_passes
  add column if not exists cancellation_count int not null default 0,
  add column if not exists refund_status      text not null default 'not_required',
  add column if not exists refund_note        text,
  add column if not exists refunded_at        timestamptz,
  add column if not exists refund_amount      numeric(10,2);

alter table public.bookings
  add column if not exists refund_status text not null default 'not_required',
  add column if not exists refund_note   text,
  add column if not exists refunded_at   timestamptz,
  add column if not exists refund_amount numeric(10,2);

-- Odstranění starého fixního unique (povolíme znovurezervaci po stornu)
alter table public.bookings drop constraint if exists unique_active_booking;

-- ============================================================
-- SEKCE 4 — Indexy
-- ============================================================
create index if not exists idx_lessons_course_id        on public.lessons(course_id);
create index if not exists idx_lessons_start_time       on public.lessons(start_time);
create index if not exists idx_passes_owner_id          on public.passes(owner_id);
create index if not exists idx_user_passes_user_id      on public.user_passes(user_id);
create index if not exists idx_user_passes_status       on public.user_passes(status);
create index if not exists idx_user_passes_expires      on public.user_passes(expires_at);
create index if not exists idx_bookings_user_id         on public.bookings(user_id);
create index if not exists idx_bookings_lesson_id       on public.bookings(lesson_id);
create index if not exists idx_bookings_status          on public.bookings(status);
create index if not exists idx_bookings_stripe_payment  on public.bookings(stripe_payment_id);

-- Jen JEDNA aktivní (booked) rezervace per (user, lesson); po cancelled lze znova
create unique index if not exists bookings_unique_user_lesson_booked
  on public.bookings (user_id, lesson_id)
  where (status = 'booked');

create index if not exists idx_email_notification_queue_pending
  on public.email_notification_queue (created_at asc)
  where processed_at is null;

-- ============================================================
-- SEKCE 5 — Views
-- ============================================================

-- Obsazenost lekcí (čte ji i anon)
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

-- ============================================================
-- SEKCE 6 — Trigger funkce + binding
-- ============================================================

-- ── 6a. updated_at ────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger trg_users_updated        before update on public.users
  for each row execute function public.set_updated_at();
create trigger trg_courses_updated      before update on public.courses
  for each row execute function public.set_updated_at();
create trigger trg_lessons_updated      before update on public.lessons
  for each row execute function public.set_updated_at();
create trigger trg_passes_updated       before update on public.passes
  for each row execute function public.set_updated_at();
create trigger trg_user_passes_updated  before update on public.user_passes
  for each row execute function public.set_updated_at();
create trigger trg_bookings_updated     before update on public.bookings
  for each row execute function public.set_updated_at();

-- ── 6b. Validace permanentek (lektor jen své kurzy) ──────────
create or replace function public.validate_pass_courses()
returns trigger language plpgsql
security definer set search_path = public
as $$
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

create trigger trg_validate_pass_courses
  before insert or update on public.passes
  for each row execute function public.validate_pass_courses();

-- ── 6c. Bookings: validace + dekrementace v JEDNOM kroku ─────
-- Konsoliduje 3 původní triggery (capacity, balance, decrement) do 2.
-- BEFORE INSERT: lehká validace bez locku (kapacita).
-- AFTER INSERT: jediný atomický UPDATE na user_passes (lock + check).
create or replace function public.check_lesson_capacity()
returns trigger language plpgsql
security definer set search_path = public
as $$
declare booked_count int; max_capacity int;
begin
  if new.status <> 'booked' then return new; end if;
  select count(*) into booked_count
    from public.bookings
    where lesson_id = new.lesson_id and status = 'booked';
  select capacity into max_capacity
    from public.lessons where id = new.lesson_id;
  if booked_count >= max_capacity then
    raise exception 'Lekce je plně obsazena (kapacita: %).', max_capacity;
  end if;
  return new;
end; $$;

create trigger trg_check_lesson_capacity
  before insert on public.bookings
  for each row execute function public.check_lesson_capacity();

-- Atomicky: validuj vlastníka + expirace + zbývající vstupy a dekrementuj.
-- Jedno SELECT FOR UPDATE + jedno UPDATE → minimální zámek.
create or replace function public.decrement_pass_on_booking()
returns trigger language plpgsql
security definer set search_path = public
as $$
declare
  v_owner       uuid;
  v_status      text;
  v_remaining   int;
  v_expires_at  timestamptz;
begin
  if new.payment_type <> 'pass' or new.user_pass_id is null then
    return new;
  end if;

  select user_id, status, entries_remaining, expires_at
    into v_owner, v_status, v_remaining, v_expires_at
  from public.user_passes
  where id = new.user_pass_id
  for update;

  if not found then
    raise exception 'Permanentka neexistuje.';
  end if;
  if v_owner is distinct from new.user_id then
    raise exception 'Permanentka nepatří uživateli této rezervace.';
  end if;
  if v_expires_at is not null and v_expires_at < now() then
    raise exception 'Permanentka už vypršela.';
  end if;
  if v_status <> 'active' or v_remaining < 1 then
    raise exception 'Na permanentce nezbývají žádné vstupy.';
  end if;

  update public.user_passes
  set
    entries_remaining = v_remaining - 1,
    status = case when v_remaining - 1 <= 0 then 'depleted' else 'active' end
  where id = new.user_pass_id;

  return new;
end; $$;

create trigger trg_decrement_pass
  after insert on public.bookings
  for each row execute function public.decrement_pass_on_booking();

-- ── 6d. Storno rezervace: typ + vrácení vstupu + refund flag ─
-- early/late se počítá pro přehled; vstup vrátíme dle role + limitu storen.
create or replace function public.restore_pass_on_cancel()
returns trigger language plpgsql
security definer set search_path = public
as $$
declare
  v_start         timestamptz;
  v_cancel_hours  int;
  v_hours_before  numeric;
  v_role          text;
  v_total         int;
  v_used          int;
  v_limit         int;
begin
  if not (new.status = 'cancelled' and old.status = 'booked') then
    return new;
  end if;

  select l.start_time, c.cancellation_hours
    into v_start, v_cancel_hours
  from public.lessons l
  join public.courses c on c.id = l.course_id
  where l.id = new.lesson_id;

  v_hours_before := extract(epoch from (v_start - now())) / 3600;
  new.cancellation_type :=
    case when v_hours_before >= v_cancel_hours then 'early' else 'late' end;
  new.cancelled_at := coalesce(new.cancelled_at, now());

  -- Vrácení vstupu na permanentku
  if old.user_pass_id is not null then
    select role into v_role from public.users where id = auth.uid();

    if coalesce(v_role,'') = 'admin' then
      -- Admin: vždy vrátit vstup (bez započtení do limitu)
      update public.user_passes
      set entries_remaining = entries_remaining + 1,
          status = case when status = 'depleted' then 'active' else status end
      where id = old.user_pass_id;

    elsif new.cancellation_type = 'early' then
      -- Uživatel: jen pokud nevyčerpal limit storen
      select entries_total, coalesce(cancellation_count,0)
        into v_total, v_used
      from public.user_passes
      where id = old.user_pass_id
      for update;

      v_limit := public.allowed_pass_cancellations(v_total);

      if v_used < v_limit then
        update public.user_passes
        set entries_remaining = entries_remaining + 1,
            cancellation_count = coalesce(cancellation_count,0) + 1,
            status = case when status = 'depleted' then 'active' else status end
        where id = old.user_pass_id;
      end if;
    end if;
  end if;

  -- Refund flag pro single platby
  if coalesce(new.payment_type, old.payment_type) = 'single'
     and coalesce(new.price_paid, old.price_paid, 0) > 0 then
    new.refund_status := 'pending';
    new.refunded_at   := null;
    new.refund_amount := coalesce(
      new.refund_amount, old.refund_amount,
      new.price_paid,    old.price_paid
    );
  else
    new.refund_status := coalesce(new.refund_status, old.refund_status, 'not_required');
  end if;

  return new;
end; $$;

create trigger trg_restore_pass_on_cancel
  before update on public.bookings
  for each row execute function public.restore_pass_on_cancel();

-- ── 6e. Notifikace přesunu lekce → email_notification_queue ──
create or replace function public.trg_lessons_notify_reschedule()
returns trigger language plpgsql
security definer set search_path = public
as $$
declare v_title text;
begin
  if tg_op <> 'UPDATE' then return new; end if;
  if new.status <> 'active' or old.status <> 'active' then return new; end if;
  if new.start_time is not distinct from old.start_time
     and new.end_time is not distinct from old.end_time then
    return new;
  end if;

  select public._course_title_plain(c.title) into v_title
  from public.courses c where c.id = new.course_id;

  insert into public.email_notification_queue
    (kind, to_email, subject, body_plain, lesson_id, meta, dedupe_key)
  select
    'lesson_rescheduled',
    u.email,
    case when coalesce(u.language_pref,'cs') = 'en' then
      'Lesson time updated — ' || left(coalesce(v_title,'Lesson'), 100)
    else
      'Změna času lekce — ' || left(coalesce(v_title,'Lekce'), 100)
    end,
    case when coalesce(u.language_pref,'cs') = 'en' then
      format(e'Hello,\n%s was rescheduled:\nPreviously: %s – %s\nNew time: %s – %s (Europe/Prague)\n',
        coalesce(v_title,'Your lesson'),
        to_char(old.start_time at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI'),
        to_char(old.end_time   at time zone 'Europe/Prague', 'HH24:MI'),
        to_char(new.start_time at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI'),
        to_char(new.end_time   at time zone 'Europe/Prague', 'HH24:MI'))
    else
      format(e'Dobrý den,\npřesunuli jsme čas Vaší lekce „%s".\nDříve: %s – %s\nNově: %s – %s (čas Europa/Praha)\n',
        coalesce(v_title,'lekce'),
        to_char(old.start_time at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI'),
        to_char(old.end_time   at time zone 'Europe/Prague', 'HH24:MI'),
        to_char(new.start_time at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI'),
        to_char(new.end_time   at time zone 'Europe/Prague', 'HH24:MI'))
    end,
    new.id,
    jsonb_build_object('user_id', u.id),
    'lr:' || b.id::text || ':' || floor(extract(epoch from new.start_time))::text
  from public.bookings b
  join public.users u on u.id = b.user_id
  where b.lesson_id = new.id and b.status = 'booked'
  on conflict (dedupe_key) do nothing;

  return new;
end; $$;

create trigger trg_lessons_notify_reschedule
  after update of start_time, end_time, status on public.lessons
  for each row execute function public.trg_lessons_notify_reschedule();

-- ── 6f. Auth trigger: profil po registraci ────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql
security definer set search_path = public
as $$
declare v_name text; v_via text;
begin
  v_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1),
    'Nový uživatel'
  );
  v_via := case coalesce(new.raw_app_meta_data->>'provider','email')
    when 'email'  then 'magic_link'
    when 'google' then 'google'
    when 'apple'  then 'apple'
    else               'magic_link'
  end;

  insert into public.users (id, email, name, role, is_ghost, created_via)
  values (new.id, new.email, v_name, 'uzivatel', false, v_via)
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- SEKCE 7 — RPC funkce (volá frontend)
-- ============================================================

-- ── 7a. Storno vlastní pass rezervace ────────────────────────
create or replace function public.cancel_my_pass_booking(p_booking_id uuid)
returns jsonb language plpgsql
security definer set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_owner        uuid;
  v_lesson_id    uuid;
  v_user_pass_id uuid;
  v_payment_type text;
  v_status       text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select user_id, lesson_id, user_pass_id, payment_type, status
    into v_owner, v_lesson_id, v_user_pass_id, v_payment_type, v_status
  from public.bookings
  where id = p_booking_id
  for update;

  if not found              then return jsonb_build_object('ok',false,'error','booking_not_found'); end if;
  if v_owner <> v_uid       then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  if v_status <> 'booked'   then return jsonb_build_object('ok',false,'error','not_active_booking'); end if;
  if v_payment_type <> 'pass' or v_user_pass_id is null then
    return jsonb_build_object('ok',false,'error','single_entry_cannot_cancel');
  end if;
  if not public.can_self_cancel_booking(v_lesson_id, v_user_pass_id) then
    return jsonb_build_object('ok',false,'error','cancel_not_allowed');
  end if;

  update public.bookings
    set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now())
  where id = p_booking_id and status = 'booked';

  return jsonb_build_object('ok', true);
end; $$;

revoke all on function public.cancel_my_pass_booking(uuid) from public;
grant execute on function public.cancel_my_pass_booking(uuid) to authenticated;

-- ── 7b. Reconcile permanentky (samoléčení) ───────────────────
create or replace function public.reconcile_my_pass_balances()
returns void language plpgsql
security definer set search_path = public
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
    select up2.id,
           greatest(0, least(
             up2.entries_total,
             up2.entries_total - coalesce(bc.c, 0)
           )) as nr
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
end; $$;

revoke all on function public.reconcile_my_pass_balances() from public;
grant execute on function public.reconcile_my_pass_balances() to authenticated;

-- ── 7c. Expirace permanentek (cron) ──────────────────────────
create or replace function public.expire_passes()
returns void language plpgsql
security definer set search_path = public
as $$
begin
  update public.user_passes
  set status = 'expired'
  where status = 'active' and expires_at < now();
end; $$;

revoke all on function public.expire_passes() from public;
grant execute on function public.expire_passes() to service_role;

-- ============================================================
-- SEKCE 8 — Admin/Lektor RPC funkce
-- ============================================================

-- ── 8a. Zrušit celou lekci (admin/lektor) ────────────────────
create or replace function public.admin_cancel_lesson(p_lesson_id uuid)
returns jsonb language plpgsql
security definer set search_path = public
as $$
declare
  v_title        text;
  v_start        timestamptz;
  v_has_single   boolean := false;
  v_has_pass     boolean := false;
  v_tail_cs      text := '';
  v_tail_en      text := '';
  v_n_emails     int := 0;
  v_n_bookings   int := 0;
begin
  if p_lesson_id is null then
    return jsonb_build_object('ok',false,'error','missing_lesson_id');
  end if;

  if not exists (
    select 1 from public.lessons l
    join public.courses c on c.id = l.course_id
    where l.id = p_lesson_id
      and (public.is_admin() or c.owner_id = auth.uid())
  ) then
    raise exception 'Nemáte oprávnění zrušit tuto lekci.';
  end if;

  select public._course_title_plain(c.title), l.start_time
    into v_title, v_start
  from public.lessons l
  join public.courses c on c.id = l.course_id
  where l.id = p_lesson_id;

  select
    exists (select 1 from public.bookings
            where lesson_id = p_lesson_id and status = 'booked' and payment_type = 'single'),
    exists (select 1 from public.bookings
            where lesson_id = p_lesson_id and status = 'booked' and payment_type = 'pass')
  into v_has_single, v_has_pass;

  if v_has_single then
    v_tail_cs := v_tail_cs || e'\nPokud jste platili jednorázově, domluvte prosím vrácení poplatku přímo s ateliérem.';
    v_tail_en := v_tail_en || e'\nIf you paid for a single entry, contact the studio for refund details.';
  end if;
  if v_has_pass then
    v_tail_cs := v_tail_cs || e'\nPři rezervaci permanentkou se vstup automaticky vrátil na zůstatek.';
    v_tail_en := v_tail_en || e'\nIf you booked with a pass, the entry was restored to your balance.';
  end if;

  insert into public.email_notification_queue
    (kind, to_email, subject, body_plain, lesson_id, meta, dedupe_key)
  select
    'lesson_cancelled',
    u.email,
    case when coalesce(u.language_pref,'cs') = 'en' then
      'Lesson cancelled — ' || left(coalesce(v_title,'Lesson'), 100)
    else
      'Zrušení lekce — '    || left(coalesce(v_title,'Lekce'),  100)
    end,
    case when coalesce(u.language_pref,'cs') = 'en' then
      format(e'Hello,\nyour lesson "%s" on %s was cancelled.%s\n',
        coalesce(v_title,'lesson'),
        to_char(v_start at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI'),
        v_tail_en)
    else
      format(e'Dobrý den,\nlekce „%s" dne %s byla organizátorem zrušena.%s\n',
        coalesce(v_title,'lekce'),
        to_char(v_start at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI'),
        v_tail_cs)
    end,
    p_lesson_id,
    jsonb_build_object('user_id', u.id),
    'lc:' || b.id::text
  from public.bookings b
  join public.users u on u.id = b.user_id
  where b.lesson_id = p_lesson_id and b.status = 'booked'
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n_emails = row_count;

  update public.bookings
    set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now())
  where lesson_id = p_lesson_id and status = 'booked';
  get diagnostics v_n_bookings = row_count;

  update public.lessons
    set status = 'cancelled'
  where id = p_lesson_id and status <> 'cancelled';

  return jsonb_build_object(
    'ok', true,
    'queued_emails', v_n_emails,
    'bookings_cancelled', v_n_bookings
  );
end; $$;

revoke all on function public.admin_cancel_lesson(uuid) from public;
grant execute on function public.admin_cancel_lesson(uuid) to authenticated;

-- ── 8b. Storno jedné rezervace adminem (s/bez vrácení vstupu) ─
create or replace function public.admin_cancel_customer_booking(
  p_booking_id  uuid,
  p_refund_pass boolean default true
)
returns jsonb language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id       uuid;
  v_lesson_id     uuid;
  v_user_pass_id  uuid;
  v_payment_type  text;
  v_status        text;
  v_start         timestamptz;
  v_title         text;
  v_email         text;
  v_lang          text;
  v_note_cs       text := '';
  v_note_en       text := '';
begin
  if p_booking_id is null then
    return jsonb_build_object('ok',false,'error','missing_booking_id');
  end if;
  if not public.is_admin() then
    raise exception 'Pouze administrátor může zrušit rezervaci zákazníka.';
  end if;

  select b.user_id, b.lesson_id, b.user_pass_id, b.payment_type, b.status,
         l.start_time, public._course_title_plain(c.title)
    into v_user_id, v_lesson_id, v_user_pass_id, v_payment_type, v_status, v_start, v_title
  from public.bookings b
  join public.lessons l on l.id = b.lesson_id
  join public.courses c on c.id = l.course_id
  where b.id = p_booking_id
  for update of b;

  if not found            then return jsonb_build_object('ok',false,'error','booking_not_found'); end if;
  if v_status <> 'booked' then return jsonb_build_object('ok',false,'error','not_active_booking'); end if;

  select email, coalesce(nullif(trim(language_pref),''), 'cs')
    into v_email, v_lang
  from public.users where id = v_user_id;

  if v_payment_type = 'pass' and v_user_pass_id is not null then
    if p_refund_pass then
      v_note_cs := E'\n\nVstup na permanentku byl vrácen na váš zůstatek.';
      v_note_en := E'\n\nYour pass entry has been restored to your balance.';
    else
      v_note_cs := E'\n\nVstup na permanentku jsme nevraceli (storno z administrace).';
      v_note_en := E'\n\nYour pass entry was not refunded (cancellation by the studio).';
    end if;
  end if;

  if v_email is not null and length(trim(v_email)) > 0 then
    insert into public.email_notification_queue
      (kind, to_email, subject, body_plain, lesson_id, meta, dedupe_key)
    values (
      'booking_cancelled_admin', v_email,
      case when v_lang = 'en' then 'Booking removed — '          || left(coalesce(v_title,'Lesson'), 100)
                              else 'Zrušení Vaší přihlášky — '    || left(coalesce(v_title,'Lekce'),  100) end,
      case when v_lang = 'en' then
        format(e'Hello,\n\nYour booking for "%s" on %s was cancelled by the studio.%s\n\nWe apologize for any inconvenience.\n',
          coalesce(v_title,'lesson'),
          to_char(v_start at time zone 'Europe/Prague','DD.MM.YYYY HH24:MI'),
          v_note_en)
      else
        format(e'Dobrý den,\n\nVaše přihláška na lekci „%s" dne %s byla zrušena z naší strany (administrace).%s\n\nOmlouváme se za případnou nepříjemnost.\n',
          coalesce(v_title,'lekce'),
          to_char(v_start at time zone 'Europe/Prague','DD.MM.YYYY HH24:MI'),
          v_note_cs)
      end,
      v_lesson_id,
      jsonb_build_object('user_id', v_user_id, 'booking_id', p_booking_id),
      'bca:' || p_booking_id::text
    )
    on conflict (dedupe_key) do nothing;
  end if;

  update public.bookings
    set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now())
  where id = p_booking_id;

  -- Pokud admin NECHCE vrátit vstup, odečteme ho zpět (trigger ho vrátil automaticky)
  if v_payment_type = 'pass' and v_user_pass_id is not null and not p_refund_pass then
    update public.user_passes
    set entries_remaining = greatest(0, entries_remaining - 1),
        status = case
          when expires_at < now() then 'expired'
          when greatest(0, entries_remaining - 1) <= 0 then 'depleted'
          else 'active'
        end,
        updated_at = now()
    where id = v_user_pass_id;
  end if;

  return jsonb_build_object('ok', true);
end; $$;

revoke all on function public.admin_cancel_customer_booking(uuid, boolean) from public;
grant execute on function public.admin_cancel_customer_booking(uuid, boolean) to authenticated;

-- ── 8c. Cron: upozornění lektorovi na nízkou účast 24 h předem ─
create or replace function public.enqueue_min_capacity_warnings()
returns integer language plpgsql
security definer set search_path = public
as $$
declare r record; n int := 0; v_rows int;
begin
  for r in
    select
      l.id as lesson_id, l.start_time, c.min_participants, c.capacity_default,
      public._course_title_plain(c.title) as course_title,
      own.email as owner_email,
      coalesce(own.language_pref,'cs') as owner_lang,
      (select count(*)::int from public.bookings b
         where b.lesson_id = l.id and b.status = 'booked') as booked
    from public.lessons l
    join public.courses c    on c.id = l.course_id
    join public.users own    on own.id = c.owner_id
    where l.status = 'active'
      and l.min_capacity_notified_at is null
      and l.start_time >= (now() + interval '23 hours')
      and l.start_time <= (now() + interval '25 hours')
  loop
    if r.booked >= r.min_participants then continue; end if;

    insert into public.email_notification_queue
      (kind, to_email, subject, body_plain, lesson_id, meta, dedupe_key)
    values (
      'min_capacity_below', r.owner_email,
      case when r.owner_lang = 'en' then 'Low attendance — '         || left(coalesce(r.course_title,'Lesson'),100)
                                    else 'Nízká naplněnost lekce — ' || left(coalesce(r.course_title,'Lekce'), 100) end,
      case when r.owner_lang = 'en' then
        format(e'Hello,\nlesson "%s" on %s has only %s participant(s) (minimum %s, capacity %s).\n',
          coalesce(r.course_title,'lesson'),
          to_char(r.start_time at time zone 'Europe/Prague','DD.MM.YYYY HH24:MI'),
          r.booked, r.min_participants, r.capacity_default)
      else
        format(e'Dobrý den,\nlekce „%s" dne %s má zatím pouze %s přihlášených (minimum je %s, kapacita %s).\n',
          coalesce(r.course_title,'lekce'),
          to_char(r.start_time at time zone 'Europe/Prague','DD.MM.YYYY HH24:MI'),
          r.booked, r.min_participants, r.capacity_default)
      end,
      r.lesson_id,
      jsonb_build_object('booked', r.booked, 'min_participants', r.min_participants),
      'mincap:' || r.lesson_id::text
    )
    on conflict (dedupe_key) do nothing;

    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      update public.lessons set min_capacity_notified_at = now() where id = r.lesson_id;
      n := n + v_rows;
    end if;
  end loop;
  return n;
end; $$;

revoke all on function public.enqueue_min_capacity_warnings() from public;
grant execute on function public.enqueue_min_capacity_warnings() to service_role;

-- ============================================================
-- SEKCE 9 — GDPR funkce
-- ============================================================

create or replace function public.anonymize_user_account(
  p_user_id uuid,
  p_reason  text default null,
  p_ip_hash text default null
)
returns jsonb language plpgsql
security definer set search_path = public
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
    set status = 'cancelled',
        cancelled_at = v_now,
        cancellation_type = 'early'
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
    set email = v_anon_email,
        name  = 'Smazaný uživatel',
        avatar_url = null,
        is_ghost   = false,
        updated_at = v_now
  where id = p_user_id;

  update public.gdpr_deletion_log set completed_at = v_now where id = v_log_id;

  return jsonb_build_object(
    'ok', true,
    'anon_email', v_anon_email,
    'future_bookings_cancelled', v_cancelled,
    'log_id', v_log_id
  );
exception when others then
  return jsonb_build_object('error', sqlerrm, 'detail', sqlstate);
end; $$;

revoke execute on function public.anonymize_user_account(uuid, text, text)
  from public, anon, authenticated;

-- Frontend volá tuto, ne anonymize_user_account přímo
create or replace function public.request_account_deletion(
  p_reason  text default null,
  p_ip_hash text default null
)
returns jsonb language plpgsql
security definer set search_path = public
as $$
begin
  return public.anonymize_user_account(auth.uid(), p_reason, p_ip_hash);
end; $$;

grant execute on function public.request_account_deletion(text, text) to authenticated;

-- ============================================================
-- SEKCE 10 — RLS: zapnutí + granty
-- ============================================================
alter table public.users                    enable row level security;
alter table public.courses                  enable row level security;
alter table public.lessons                  enable row level security;
alter table public.passes                   enable row level security;
alter table public.user_passes              enable row level security;
alter table public.bookings                 enable row level security;
alter table public.gdpr_deletion_log        enable row level security;
alter table public.email_notification_queue enable row level security;

-- Granty (RLS pak dále omezí, co konkrétně role uvidí)
grant usage on schema public to anon, authenticated;

grant select on public.courses, public.lessons, public.passes to anon, authenticated;
grant select on public.lesson_availability                    to anon, authenticated;
grant insert, update, delete on public.courses                to authenticated;
grant insert, update, delete on public.lessons                to authenticated;
grant insert, update, delete on public.passes                 to authenticated;
grant select, insert, update on public.bookings               to authenticated;
grant select, insert, update on public.user_passes            to authenticated;
grant select, update, insert on public.users                  to authenticated;

-- Anon vidí jen základní sloupce users (jméno lektora v JOIN)
revoke select on public.users from anon;
grant  select (id, name, role) on public.users to anon;

grant select, insert, update, delete on public.email_notification_queue to service_role;

-- ============================================================
-- SEKCE 11 — RLS POLICIES
-- ============================================================
-- Vzor pro admin: jediná FOR ALL policy s (select is_admin()).
-- Postgres vyhodnocuje policy jako OR → admin projde okamžitě
-- bez dalších kontrol. (select …) trik povoluje InitPlan caching:
-- is_admin() se zavolá MAX 1× per dotaz, ne per řádek.

-- ── COURSES ──────────────────────────────────────────────────
create policy "courses_admin_all"
  on public.courses for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "courses_public_read"
  on public.courses for select to anon, authenticated
  using (is_active = true);

create policy "courses_lektor_read_own_inactive"
  on public.courses for select to authenticated
  using ((select public.is_lektor()) and owner_id = (select auth.uid()));

create policy "courses_lektor_insert"
  on public.courses for insert to authenticated
  with check ((select public.is_lektor()) and owner_id = (select auth.uid()));

create policy "courses_lektor_update_own"
  on public.courses for update to authenticated
  using ((select public.is_lektor()) and owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ── LESSONS ──────────────────────────────────────────────────
create policy "lessons_admin_all"
  on public.lessons for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "lessons_public_read_active"
  on public.lessons for select to anon, authenticated
  using (status = 'active');

create policy "lessons_lektor_read_own"
  on public.lessons for select to authenticated
  using (
    (select public.is_lektor())
    and exists (
      select 1 from public.courses c
      where c.id = public.lessons.course_id and c.owner_id = (select auth.uid())
    )
  );

create policy "lessons_lektor_insert"
  on public.lessons for insert to authenticated
  with check (
    (select public.is_lektor())
    and exists (
      select 1 from public.courses c
      where c.id = course_id and c.owner_id = (select auth.uid())
    )
  );

create policy "lessons_lektor_update_own"
  on public.lessons for update to authenticated
  using (
    (select public.is_lektor())
    and exists (
      select 1 from public.courses c
      where c.id = public.lessons.course_id and c.owner_id = (select auth.uid())
    )
  );

-- ── PASSES ───────────────────────────────────────────────────
create policy "passes_admin_all"
  on public.passes for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "passes_public_read"
  on public.passes for select to anon, authenticated
  using (is_active = true);

create policy "passes_lektor_crud_own"
  on public.passes for all to authenticated
  using ((select public.is_lektor()) and owner_id = (select auth.uid()))
  with check ((select public.is_lektor()) and owner_id = (select auth.uid()));

-- ── USERS ────────────────────────────────────────────────────
create policy "users_admin_all"
  on public.users for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "users_read_own"
  on public.users for select to authenticated
  using (id = (select auth.uid()));

create policy "users_lektor_read_customers"
  on public.users for select to authenticated
  using (
    (select public.is_lektor())
    and exists (
      select 1
      from public.bookings b
      join public.lessons  l on l.id = b.lesson_id
      join public.courses  c on c.id = l.course_id
      where b.user_id  = public.users.id
        and c.owner_id = (select auth.uid())
    )
  );

-- Veřejně čitelná jména lektorů (potřeba pro JOIN owner:users v kurzech)
create policy "users_public_read_staff"
  on public.users for select to anon, authenticated
  using (role in ('lektor','admin'));

create policy "users_update_own"
  on public.users for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = (select public.current_user_role())
  );

create policy "users_insert_own"
  on public.users for insert to authenticated
  with check (id = (select auth.uid()));

-- ── USER_PASSES ──────────────────────────────────────────────
create policy "user_passes_admin_all"
  on public.user_passes for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "user_passes_read_own"
  on public.user_passes for select to authenticated
  using (user_id = (select auth.uid()));

create policy "user_passes_lektor_read"
  on public.user_passes for select to authenticated
  using (
    (select public.is_lektor())
    and exists (
      select 1 from public.passes p
      where p.id = public.user_passes.pass_id and p.owner_id = (select auth.uid())
    )
  );

create policy "user_passes_insert_own"
  on public.user_passes for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ── BOOKINGS ─────────────────────────────────────────────────
create policy "bookings_admin_all"
  on public.bookings for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "bookings_read_own"
  on public.bookings for select to authenticated
  using (user_id = (select auth.uid()));

create policy "bookings_lektor_read_own_lessons"
  on public.bookings for select to authenticated
  using (
    (select public.is_lektor())
    and exists (
      select 1
      from public.lessons l
      join public.courses c on c.id = l.course_id
      where l.id = public.bookings.lesson_id and c.owner_id = (select auth.uid())
    )
  );

create policy "bookings_insert_own"
  on public.bookings for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "bookings_self_cancel_pass"
  on public.bookings for update to authenticated
  using (
    user_id = (select auth.uid())
    and status = 'booked'
    and payment_type = 'pass'
    and public.can_self_cancel_booking(public.bookings.lesson_id, public.bookings.user_pass_id)
  )
  with check (
    status = 'cancelled'
    and user_id = (select auth.uid())
    and payment_type = 'pass'
  );

create policy "bookings_lektor_update_own_lessons"
  on public.bookings for update to authenticated
  using (
    (select public.is_lektor())
    and exists (
      select 1
      from public.lessons l
      join public.courses c on c.id = l.course_id
      where l.id = public.bookings.lesson_id and c.owner_id = (select auth.uid())
    )
  );

-- ── GDPR LOG: jen service_role (klient nikdy nevidí) ─────────
create policy "gdpr_log_no_client_access"
  on public.gdpr_deletion_log
  using (false);

-- ── EMAIL QUEUE: jen service_role ────────────────────────────
create policy "email_queue_no_client_access"
  on public.email_notification_queue
  using (false);

commit;

-- ============================================================
-- POZNÁMKY K NASAZENÍ
-- ============================================================
-- 1) Tento skript je BEZPEČNÝ pro opakované spuštění.
-- 2) Po prvním přihlášení přes Magic Link si v public.users
--    nastav role = 'admin' (nebo 'lektor') pro svůj e-mail:
--      update public.users set role = 'admin'
--      where email = 'tvuj@email.cz';
-- 3) Sample data: vlož kurz + lekci po nastavení role.
-- 4) Pro odesílání e-mailů spusť Edge Function
--    `process-email-queue` na cronu (každých 5 min, service_role).
-- 5) Storage bucket `course-images` (volitelný — pro fotky kurzů):
--    vytvoř v dashboardu jako public a v SQL Editoru:
--      insert into storage.buckets (id, name, public)
--        values ('course-images','course-images', true)
--      on conflict (id) do update set public = excluded.public;
-- ============================================================
