-- ============================================================
-- ATELIER — Databázové schéma (finální)
-- Supabase / PostgreSQL
-- Spustit v: Supabase dashboard → SQL editor
-- ============================================================

create extension if not exists "uuid-ossp";

-- ── USERS ────────────────────────────────────────────────────
create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null unique,
  name          text,
  avatar_url    text,
  avatar_color  text default '#2854B9',
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
create table public.courses (
  id                uuid primary key default uuid_generate_v4(),
  owner_id          uuid not null references public.users(id) on delete restrict,
  title             jsonb not null,
  description_short jsonb,
  description_long  jsonb,
  images            text[],
  color_code        text not null default '#2854B9',  -- brand modrá
  is_active         boolean not null default true,
  cancellation_hours int not null default 24
                      check (cancellation_hours in (6,24,48)),
  capacity_default  int not null default 12,
  price_single      numeric(10,2) not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── LESSONS ──────────────────────────────────────────────────
create table public.lessons (
  id           uuid primary key default uuid_generate_v4(),
  course_id    uuid not null references public.courses(id) on delete cascade,
  start_time   timestamptz not null,
  end_time     timestamptz not null,
  capacity     int not null,
  price_single numeric(10,2) not null,  -- fixovaná cena v čase vytvoření
  status       text not null default 'active'
                 check (status in ('active','cancelled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint lesson_time_valid check (end_time > start_time)
);

create index idx_lessons_course_id  on public.lessons(course_id);
create index idx_lessons_start_time on public.lessons(start_time);

-- ── PASSES — definice produktů permanentek ───────────────────
-- Každý řádek = jeden produkt nabízený lektorem.
-- allowed_course_ids: kurzy, na které permanentka platí.
create table public.passes (
  id                 uuid primary key default uuid_generate_v4(),
  owner_id           uuid not null references public.users(id) on delete restrict,
  name               jsonb not null,
  entries_total      int not null check (entries_total > 0),
  price              numeric(10,2) not null,
  validity_weeks     int not null,
  allowed_course_ids uuid[] not null,
  color_code         text not null default '#0D9488',
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index idx_passes_owner_id on public.passes(owner_id);

-- ── USER_PASSES — zakoupené permanentky ──────────────────────
-- Každý řádek = jedna zakoupená permanentka zákazníka.
create table public.user_passes (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references public.users(id) on delete cascade,
  pass_id           uuid not null references public.passes(id) on delete restrict,
  entries_total     int not null,
  entries_remaining int not null,
  cancellation_count int not null default 0,
  price_paid        numeric(10,2) not null,  -- fixovaná cena při nákupu
  expires_at        timestamptz not null,
  status            text not null default 'active'
                      check (status in ('active','expired','depleted')),
  stripe_payment_id text,
  refund_status     text not null default 'not_required'
                      check (refund_status in ('not_required','pending','completed')),
  refund_note       text,
  refunded_at       timestamptz,
  refund_amount     numeric(10,2),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint entries_valid check (
    entries_remaining >= 0 and entries_remaining <= entries_total
  ),
  constraint user_passes_cancellation_count_valid check (cancellation_count >= 0)
);

create index idx_user_passes_user_id on public.user_passes(user_id);
create index idx_user_passes_status  on public.user_passes(status);
create index idx_user_passes_expires on public.user_passes(expires_at);

-- ── BOOKINGS — rezervace ─────────────────────────────────────
create table public.bookings (
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
  refund_status     text not null default 'not_required'
                      check (refund_status in ('not_required','pending','completed')),
  refund_note       text,
  refunded_at       timestamptz,
  refund_amount     numeric(10,2),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint unique_active_booking unique (user_id, lesson_id)
);

create index idx_bookings_user_id          on public.bookings(user_id);
create index idx_bookings_lesson_id        on public.bookings(lesson_id);
create index idx_bookings_status           on public.bookings(status);
create index idx_bookings_stripe_payment   on public.bookings(stripe_payment_id);

-- ── GDPR DELETION LOG ────────────────────────────────────────
create table public.gdpr_deletion_log (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  reason       text,
  ip_hash      text
);

-- ── VIEW: obsazenost lekcí ───────────────────────────────────
create view public.lesson_availability as
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

-- ── TRIGGER: updated_at ──────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

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

-- ── TRIGGER: validace allowed_course_ids ─────────────────────
create or replace function public.validate_pass_courses()
returns trigger language plpgsql as $$
declare invalid_count int;
begin
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

-- ── TRIGGER: kapacita lekce ──────────────────────────────────
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

create trigger trg_check_lesson_capacity
  before insert on public.bookings
  for each row execute function public.check_lesson_capacity();

-- ── TRIGGER: dekrementace vstupů při rezervaci ───────────────
create or replace function public.decrement_pass_on_booking()
returns trigger language plpgsql as $$
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

create trigger trg_decrement_pass
  after insert on public.bookings
  for each row execute function public.decrement_pass_on_booking();

-- ── TRIGGER: vrácení vstupu při včasném stornování ───────────
create or replace function public.allowed_pass_cancellations(p_entries_total int)
returns int language sql immutable as $$
  select case when coalesce(p_entries_total, 0) <= 5 then 1 else 2 end;
$$;

create or replace function public.restore_pass_on_cancel()
returns trigger language plpgsql as $$
declare
  lesson_start  timestamptz;
  cancel_hours  int;
  hours_before  numeric;
  v_actor_role  text;
  v_entries_total int;
  v_cancellation_count int;
  v_cancel_limit int;
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
      select u.role
      into v_actor_role
      from public.users u
      where u.id = auth.uid();

      if coalesce(v_actor_role, '') = 'admin' then
        update public.user_passes
        set entries_remaining = entries_remaining + 1,
            status = case when status = 'depleted' then 'active' else status end
        where id = old.user_pass_id;
      elsif new.cancellation_type = 'early' then
        select up.entries_total, coalesce(up.cancellation_count, 0)
        into v_entries_total, v_cancellation_count
        from public.user_passes up
        where up.id = old.user_pass_id
        for update;

        v_cancel_limit := public.allowed_pass_cancellations(v_entries_total);

        if v_cancellation_count < v_cancel_limit then
          update public.user_passes
          set entries_remaining = entries_remaining + 1,
              cancellation_count = coalesce(cancellation_count, 0) + 1,
              status = case when status = 'depleted' then 'active' else status end
          where id = old.user_pass_id;
        end if;
      end if;
    end if;

    new.cancelled_at := now();
  end if;
  return new;
end; $$;

create trigger trg_restore_pass_on_cancel
  before update on public.bookings
  for each row execute function public.restore_pass_on_cancel();

create or replace function public.can_self_cancel_booking(p_lesson_id uuid, p_user_pass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lessons l
    join public.courses c on c.id = l.course_id
    join public.user_passes up on up.id = p_user_pass_id
    where l.id = p_lesson_id
      and l.start_time > now() + make_interval(hours => c.cancellation_hours)
      and coalesce(up.cancellation_count, 0) < public.allowed_pass_cancellations(up.entries_total)
  );
$$;

create or replace function public.cancel_my_pass_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_booking_user_id uuid;
  v_lesson_id uuid;
  v_user_pass_id uuid;
  v_payment_type text;
  v_status text;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select b.user_id, b.lesson_id, b.user_pass_id, b.payment_type, b.status
  into v_booking_user_id, v_lesson_id, v_user_pass_id, v_payment_type, v_status
  from public.bookings b
  where b.id = p_booking_id
  for update of b;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'booking_not_found');
  end if;

  if v_booking_user_id is distinct from v_user_id then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_status is distinct from 'booked' then
    return jsonb_build_object('ok', false, 'error', 'not_active_booking');
  end if;

  if v_payment_type is distinct from 'pass' or v_user_pass_id is null then
    return jsonb_build_object('ok', false, 'error', 'single_entry_cannot_cancel');
  end if;

  if not public.can_self_cancel_booking(v_lesson_id, v_user_pass_id) then
    return jsonb_build_object('ok', false, 'error', 'cancel_not_allowed');
  end if;

  update public.bookings
  set status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, now())
  where id = p_booking_id
    and status = 'booked';

  return jsonb_build_object('ok', true);
end;
$$;

-- ── FUNKCE: expirace permanentek (volat cron jobem) ──────────
create or replace function public.expire_passes()
returns void language plpgsql as $$
begin
  update public.user_passes
  set status = 'expired'
  where status = 'active' and expires_at < now();
end; $$;

-- ── FUNKCE: GDPR anonymizace účtu ────────────────────────────
-- Volána výhradně z Edge Function delete-account (service_role).
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

  -- Storno budoucích rezervací (GDPR = vždy early)
  update public.bookings b
  set status = 'cancelled', cancelled_at = v_now, cancellation_type = 'early'
  from public.lessons l
  where b.lesson_id = l.id
    and b.user_id   = p_user_id
    and b.status    = 'booked'
    and l.start_time > v_now;
  get diagnostics v_cancelled = row_count;

  -- Zneplatnění aktivních permanentek
  update public.user_passes
  set status = 'expired', entries_remaining = 0, updated_at = v_now
  where user_id = p_user_id and status = 'active';

  -- Anonymizace profilu
  v_anon_email := 'deleted_' || left(p_user_id::text, 8) || '@deleted.invalid';
  update public.users
  set email      = v_anon_email,
      name       = 'Smazaný uživatel',
      avatar_url = null,
      is_ghost   = false,
      updated_at = v_now
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

-- Pouze service_role smí funkci volat
revoke execute on function public.anonymize_user_account from public, anon, authenticated;

-- ── GRANTS pro veřejný přístup k view ───────────────────────
grant select on public.lesson_availability to anon, authenticated;
