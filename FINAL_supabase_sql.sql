-- ============================================================
-- Ceramics Studio / Supabase bootstrap (LEAN edition)
-- ------------------------------------------------------------
-- Goals:
--   * fast storage layer only (no business logic in triggers)
--   * single atomic RPC for self-service cancel
--   * every FK indexed, RLS uses (select ...) for InitPlan caching
--   * column-level UPDATE grant on users prevents role escalation
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- 1. TABLES
-- ============================================================

create table if not exists public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null unique,
  name            text,
  avatar_url      text,
  avatar_color    text not null default '#2854B9',
  role            text not null default 'uzivatel'
                    check (role in ('admin', 'lektor', 'uzivatel')),
  is_ghost        boolean not null default false,
  created_via     text not null default 'magic_link'
                    check (created_via in ('magic_link', 'google', 'apple', 'ghost')),
  language_pref   text not null default 'cs'
                    check (language_pref in ('cs', 'en')),
  reminder_hours  integer not null default 24
                    check (reminder_hours between 0 and 168),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.courses (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references public.users(id) on delete restrict,
  title                jsonb not null,
  description_short    jsonb,
  description_long     jsonb,
  images               text[],
  color_code           text not null default '#2854B9',
  is_active            boolean not null default true,
  is_workshop          boolean not null default false,
  cancellation_hours   integer not null default 24
                         check (cancellation_hours in (6, 24, 48)),
  min_participants     integer not null default 1
                         check (min_participants >= 1),
  capacity_default     integer not null default 12
                         check (capacity_default >= 1),
  price_single         numeric(10,2) not null check (price_single >= 0),
  schedule_days        integer[] not null default '{}'::integer[],
  schedule_time_start  time,
  schedule_time_end    time,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint courses_min_participants_valid
    check (min_participants <= capacity_default)
);

-- Idempotent top-up for projects created before these columns existed.
alter table public.courses
  add column if not exists schedule_days       integer[] not null default '{}'::integer[],
  add column if not exists schedule_time_start time,
  add column if not exists schedule_time_end   time;

create table if not exists public.lessons (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses(id) on delete cascade,
  start_time   timestamptz not null,
  end_time     timestamptz not null,
  capacity     integer not null check (capacity >= 1),
  price_single numeric(10,2) not null check (price_single >= 0),
  status       text not null default 'active'
                 check (status in ('active', 'cancelled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint lessons_time_valid check (end_time > start_time)
);

create table if not exists public.passes (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.users(id) on delete restrict,
  name               jsonb not null,
  entries_total      integer not null check (entries_total > 0),
  price              numeric(10,2) not null check (price >= 0),
  validity_weeks     integer not null check (validity_weeks > 0),
  allowed_course_ids uuid[] not null,
  color_code         text not null default '#0D9488', -- barva karty permanentky (vlastní paleta)
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint passes_allowed_courses_nonempty
    check (coalesce(array_length(allowed_course_ids, 1), 0) > 0)
);

-- Existující DB: doplnění barev permanentek (bez zásahu do kurzů)
alter table public.passes add column if not exists color_code text not null default '#0D9488';

create table if not exists public.user_passes (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users(id) on delete cascade,
  pass_id            uuid not null references public.passes(id) on delete restrict,
  entries_total      integer not null check (entries_total > 0),
  entries_remaining  integer not null,
  cancellation_count integer not null default 0
                       check (cancellation_count >= 0),
  price_paid         numeric(10,2) not null check (price_paid >= 0),
  expires_at         timestamptz not null,
  status             text not null default 'active'
                       check (status in ('active', 'expired', 'depleted')),
  stripe_payment_id  text,
  refund_status      text not null default 'not_required'
                       check (refund_status in ('not_required', 'pending', 'completed')),
  refund_note        text,
  refunded_at        timestamptz,
  refund_amount      numeric(10,2)
                       check (refund_amount is null or refund_amount >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint user_passes_entries_valid
    check (entries_remaining >= 0 and entries_remaining <= entries_total)
);

create table if not exists public.bookings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  lesson_id         uuid not null references public.lessons(id) on delete cascade,
  user_pass_id      uuid references public.user_passes(id) on delete set null,
  payment_type      text not null check (payment_type in ('pass', 'single')),
  price_paid        numeric(10,2)
                      check (price_paid is null or price_paid >= 0),
  status            text not null default 'booked'
                      check (status in ('booked', 'cancelled', 'missed', 'attended')),
  cancelled_at      timestamptz,
  stripe_payment_id text,
  refund_status     text not null default 'not_required'
                      check (refund_status in ('not_required', 'pending', 'completed')),
  refund_note       text,
  refunded_at       timestamptz,
  refund_amount     numeric(10,2)
                      check (refund_amount is null or refund_amount >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint bookings_payment_source_valid check (
    (payment_type = 'pass' and user_pass_id is not null)
    or
    (payment_type = 'single' and user_pass_id is null)
  )
);

create table if not exists public.payments (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  booking_id        uuid references public.bookings(id) on delete set null,
  user_pass_id      uuid references public.user_passes(id) on delete set null,
  payment_type      text not null check (payment_type in ('pass', 'single')),
  provider          text not null default 'stripe'
                      check (provider in ('stripe', 'manual', 'cash', 'bank_transfer')),
  stripe_payment_id text,
  amount            numeric(10,2) not null check (amount >= 0),
  currency          text not null default 'CZK' check (char_length(currency) = 3),
  status            text not null default 'pending'
                      check (status in ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  refund_status     text not null default 'not_required'
                      check (refund_status in ('not_required', 'pending', 'completed')),
  refund_note       text,
  refund_amount     numeric(10,2)
                      check (refund_amount is null or refund_amount >= 0),
  paid_at           timestamptz,
  refunded_at       timestamptz,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ============================================================
-- 2. INDEXES (every FK + hot lookups)
-- ============================================================

create index if not exists idx_courses_owner_id            on public.courses(owner_id);
create index if not exists idx_lessons_course_id           on public.lessons(course_id);
create index if not exists idx_lessons_start_time          on public.lessons(start_time);
create index if not exists idx_passes_owner_id             on public.passes(owner_id);
create index if not exists idx_user_passes_user_id         on public.user_passes(user_id);
create index if not exists idx_user_passes_pass_id         on public.user_passes(pass_id);
create index if not exists idx_user_passes_status          on public.user_passes(status);
create index if not exists idx_user_passes_expires_at      on public.user_passes(expires_at);
create index if not exists idx_bookings_user_id            on public.bookings(user_id);
create index if not exists idx_bookings_lesson_id          on public.bookings(lesson_id);
create index if not exists idx_bookings_user_pass_id       on public.bookings(user_pass_id);
create index if not exists idx_bookings_status             on public.bookings(status);
create index if not exists idx_payments_user_id            on public.payments(user_id);
create index if not exists idx_payments_booking_id         on public.payments(booking_id);
create index if not exists idx_payments_user_pass_id       on public.payments(user_pass_id);
create index if not exists idx_payments_status             on public.payments(status);

create unique index if not exists idx_payments_stripe_unique
  on public.payments(stripe_payment_id)
  where stripe_payment_id is not null;

create unique index if not exists bookings_unique_user_lesson_booked
  on public.bookings(user_id, lesson_id)
  where status = 'booked';

-- ============================================================
-- 3. VIEW — live capacity (frontend reads this, never bookings count)
-- ============================================================

create or replace view public.lesson_availability as
select
  l.id          as lesson_id,
  l.course_id,
  l.start_time,
  l.end_time,
  l.capacity,
  l.price_single,
  l.status,
  count(b.id) filter (where b.status = 'booked')::int as booked_count,
  greatest(l.capacity - count(b.id) filter (where b.status = 'booked'), 0)::int as available_spots
from public.lessons l
left join public.bookings b on b.lesson_id = l.id
group by l.id;

-- ============================================================
-- 4. HELPER FUNCTIONS (used by RLS + RPCs — kept stable + cheap)
-- ============================================================

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
  )
$$;

create or replace function public.is_lektor()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin', 'lektor')
  )
$$;

create or replace function public.check_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.is_admin() $$;

create or replace function public.allowed_pass_cancellations(p_entries_total integer)
returns integer language sql immutable
as $$ select case when coalesce(p_entries_total, 0) <= 5 then 1 else 2 end $$;

create or replace function public.can_self_cancel_booking(
  p_lesson_id    uuid,
  p_user_pass_id uuid
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.lessons     l
    join public.courses     c  on c.id  = l.course_id
    join public.user_passes up on up.id = p_user_pass_id
    where l.id = p_lesson_id
      and up.status = 'active'
      and l.start_time > now() + make_interval(hours => c.cancellation_hours)
      and coalesce(up.cancellation_count, 0) < public.allowed_pass_cancellations(up.entries_total)
  )
$$;

-- ============================================================
-- 5. ESSENTIAL TRIGGERS (updated_at + auth bootstrap ONLY)
-- ============================================================
-- No business-logic triggers: no cascade writes, no recursion risk.
-- Capacity/decrement/restore lives in RPCs or in the frontend.

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.users (id, email, name, avatar_url, created_via)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1),
      'Novy uzivatel'
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    ),
    case coalesce(new.raw_app_meta_data ->> 'provider', 'email')
      when 'google' then 'google'
      when 'apple'  then 'apple'
      else 'magic_link'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_users_updated        on public.users;
drop trigger if exists trg_courses_updated      on public.courses;
drop trigger if exists trg_lessons_updated      on public.lessons;
drop trigger if exists trg_passes_updated       on public.passes;
drop trigger if exists trg_user_passes_updated  on public.user_passes;
drop trigger if exists trg_bookings_updated     on public.bookings;
drop trigger if exists trg_payments_updated     on public.payments;
drop trigger if exists on_auth_user_created     on auth.users;

create trigger trg_users_updated       before update on public.users       for each row execute function public.set_updated_at();
create trigger trg_courses_updated     before update on public.courses     for each row execute function public.set_updated_at();
create trigger trg_lessons_updated     before update on public.lessons     for each row execute function public.set_updated_at();
create trigger trg_passes_updated      before update on public.passes      for each row execute function public.set_updated_at();
create trigger trg_user_passes_updated before update on public.user_passes for each row execute function public.set_updated_at();
create trigger trg_bookings_updated    before update on public.bookings    for each row execute function public.set_updated_at();
create trigger trg_payments_updated    before update on public.payments    for each row execute function public.set_updated_at();

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- 6. RPC FUNCTIONS (atomic business operations — no triggers needed)
-- ============================================================

-- Self-service cancel of a pass-paid booking.
-- Single transaction: validate -> mark cancelled -> return entry + bump count.
create or replace function public.cancel_my_pass_booking(p_booking_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_user_id      uuid;
  v_lesson_id    uuid;
  v_user_pass_id uuid;
  v_payment_type text;
  v_status       text;
  v_start_time   timestamptz;
  v_cancel_hours integer;
  v_pass_total   integer;
  v_pass_count   integer;
  v_limit        integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select user_id, lesson_id, user_pass_id, payment_type, status
    into v_user_id, v_lesson_id, v_user_pass_id, v_payment_type, v_status
  from public.bookings
  where id = p_booking_id
  for update;

  if not found                                                  then return jsonb_build_object('ok', false, 'error', 'booking_not_found'); end if;
  if v_user_id <> v_uid                                         then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if v_status <> 'booked'                                       then return jsonb_build_object('ok', false, 'error', 'not_active_booking'); end if;
  if v_payment_type <> 'pass' or v_user_pass_id is null         then return jsonb_build_object('ok', false, 'error', 'single_entry_cannot_cancel'); end if;

  select l.start_time, c.cancellation_hours
    into v_start_time, v_cancel_hours
  from public.lessons l
  join public.courses c on c.id = l.course_id
  where l.id = v_lesson_id;

  if extract(epoch from (v_start_time - now())) / 3600.0 < v_cancel_hours then
    return jsonb_build_object('ok', false, 'error', 'cancel_window_closed');
  end if;

  select entries_total, coalesce(cancellation_count, 0)
    into v_pass_total, v_pass_count
  from public.user_passes
  where id = v_user_pass_id
  for update;

  v_limit := public.allowed_pass_cancellations(v_pass_total);
  if v_pass_count >= v_limit then
    return jsonb_build_object('ok', false, 'error', 'cancel_limit_reached');
  end if;

  update public.bookings
     set status = 'cancelled',
         cancelled_at = now()
   where id = p_booking_id;

  update public.user_passes
     set entries_remaining  = least(entries_total, entries_remaining + 1),
         cancellation_count = cancellation_count + 1,
         status = case
           when expires_at < now()                                    then 'expired'
           when least(entries_total, entries_remaining + 1) <= 0      then 'depleted'
           else 'active'
         end
   where id = v_user_pass_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- Recompute caller's user_passes balances from actual bookings.
-- Safety net the frontend can call after any booking mutation.
create or replace function public.reconcile_my_pass_balances()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.user_passes up
     set entries_remaining = x.new_remaining,
         status = case
           when up.expires_at < now() then 'expired'
           when x.new_remaining <= 0  then 'depleted'
           else 'active'
         end
    from (
      select
        up2.id,
        greatest(0, least(
          up2.entries_total,
          up2.entries_total - coalesce(bc.booked_count, 0)
        )) as new_remaining
      from public.user_passes up2
      left join lateral (
        select count(*)::int as booked_count
        from public.bookings b
        where b.user_pass_id = up2.id
          and b.status       = 'booked'
          and b.payment_type = 'pass'
      ) bc on true
      where up2.user_id = auth.uid()
    ) x
   where up.id = x.id;
end;
$$;

-- Mark expired passes (used by scheduled job; service_role only).
create or replace function public.expire_passes()
returns void
language sql security definer set search_path = public
as $$
  update public.user_passes
     set status = 'expired'
   where status = 'active'
     and expires_at < now();
$$;

-- ============================================================
-- 7. GRANTS
-- ============================================================

grant usage on schema public to anon, authenticated;

grant select on public.courses, public.lessons, public.passes to anon, authenticated;
grant select on public.lesson_availability                    to anon, authenticated;

grant select, insert        on public.users       to authenticated;
grant update (name, avatar_url, avatar_color, language_pref, reminder_hours)
                             on public.users       to authenticated;
grant select, insert, update, delete on public.courses     to authenticated;
grant select, insert, update, delete on public.lessons     to authenticated;
grant select, insert, update, delete on public.passes      to authenticated;
grant select, insert, update, delete on public.user_passes to authenticated;
grant select, insert, update, delete on public.bookings    to authenticated;
grant select, insert, update, delete on public.payments    to authenticated;

revoke select on public.users from anon;
grant  select (id, name, role, avatar_url, avatar_color) on public.users to anon;

revoke all on function public.check_admin()                   from public;
revoke all on function public.cancel_my_pass_booking(uuid)    from public;
revoke all on function public.reconcile_my_pass_balances()    from public;
revoke all on function public.expire_passes()                 from public;

grant execute on function public.check_admin()                to authenticated;
grant execute on function public.cancel_my_pass_booking(uuid) to authenticated;
grant execute on function public.reconcile_my_pass_balances() to authenticated;
grant execute on function public.expire_passes()              to service_role;

-- ============================================================
-- 8. RLS POLICIES
-- Pattern: (select public.is_admin()) → InitPlan cached once per query.
-- ============================================================

alter table public.users       enable row level security;
alter table public.courses     enable row level security;
alter table public.lessons     enable row level security;
alter table public.passes      enable row level security;
alter table public.user_passes enable row level security;
alter table public.bookings    enable row level security;
alter table public.payments    enable row level security;

-- USERS ------------------------------------------------------
drop policy if exists "users_admin_all"          on public.users;
drop policy if exists "users_read_own"           on public.users;
drop policy if exists "users_insert_own"         on public.users;
drop policy if exists "users_update_own"         on public.users;
drop policy if exists "users_public_read_staff"  on public.users;
drop policy if exists "users_lektor_read_related" on public.users;

create policy "users_admin_all"
  on public.users for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "users_read_own"
  on public.users for select to authenticated
  using (id = (select auth.uid()));

create policy "users_insert_own"
  on public.users for insert to authenticated
  with check (id = (select auth.uid()));

-- Role escalation is blocked by the column-level GRANT above,
-- so the UPDATE policy stays minimal.
create policy "users_update_own"
  on public.users for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "users_public_read_staff"
  on public.users for select to anon, authenticated
  using (role in ('admin', 'lektor'));

create policy "users_lektor_read_related"
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

-- COURSES ----------------------------------------------------
drop policy if exists "courses_admin_all"       on public.courses;
drop policy if exists "courses_public_read"     on public.courses;
drop policy if exists "courses_lektor_crud_own" on public.courses;

create policy "courses_admin_all"
  on public.courses for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "courses_public_read"
  on public.courses for select to anon, authenticated
  using (is_active = true);

create policy "courses_lektor_crud_own"
  on public.courses for all to authenticated
  using       ((select public.is_lektor()) and owner_id = (select auth.uid()))
  with check  ((select public.is_lektor()) and owner_id = (select auth.uid()));

-- LESSONS ----------------------------------------------------
drop policy if exists "lessons_admin_all"         on public.lessons;
drop policy if exists "lessons_public_read"       on public.lessons;
drop policy if exists "lessons_lektor_crud_own"   on public.lessons;

create policy "lessons_admin_all"
  on public.lessons for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "lessons_public_read"
  on public.lessons for select to anon, authenticated
  using (status = 'active');

create policy "lessons_lektor_crud_own"
  on public.lessons for all to authenticated
  using (
    (select public.is_lektor())
    and exists (
      select 1 from public.courses c
      where c.id = public.lessons.course_id
        and c.owner_id = (select auth.uid())
    )
  )
  with check (
    (select public.is_lektor())
    and exists (
      select 1 from public.courses c
      where c.id = course_id
        and c.owner_id = (select auth.uid())
    )
  );

-- PASSES -----------------------------------------------------
drop policy if exists "passes_admin_all"       on public.passes;
drop policy if exists "passes_public_read"     on public.passes;
drop policy if exists "passes_lektor_crud_own" on public.passes;

create policy "passes_admin_all"
  on public.passes for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "passes_public_read"
  on public.passes for select to anon, authenticated
  using (is_active = true);

create policy "passes_lektor_crud_own"
  on public.passes for all to authenticated
  using       ((select public.is_lektor()) and owner_id = (select auth.uid()))
  with check  ((select public.is_lektor()) and owner_id = (select auth.uid()));

-- USER_PASSES ------------------------------------------------
drop policy if exists "user_passes_admin_all"   on public.user_passes;
drop policy if exists "user_passes_read_own"    on public.user_passes;
drop policy if exists "user_passes_insert_own"  on public.user_passes;
drop policy if exists "user_passes_lektor_read" on public.user_passes;

create policy "user_passes_admin_all"
  on public.user_passes for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "user_passes_read_own"
  on public.user_passes for select to authenticated
  using (user_id = (select auth.uid()));

create policy "user_passes_insert_own"
  on public.user_passes for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "user_passes_lektor_read"
  on public.user_passes for select to authenticated
  using (
    (select public.is_lektor())
    and exists (
      select 1 from public.passes p
      where p.id       = public.user_passes.pass_id
        and p.owner_id = (select auth.uid())
    )
  );

-- BOOKINGS ---------------------------------------------------
drop policy if exists "bookings_admin_all"            on public.bookings;
drop policy if exists "bookings_read_own"             on public.bookings;
drop policy if exists "bookings_insert_own"           on public.bookings;
drop policy if exists "bookings_self_cancel_pass"     on public.bookings;
drop policy if exists "bookings_lektor_read_related"  on public.bookings;
drop policy if exists "bookings_lektor_update_related" on public.bookings;

create policy "bookings_admin_all"
  on public.bookings for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "bookings_read_own"
  on public.bookings for select to authenticated
  using (user_id = (select auth.uid()));

create policy "bookings_insert_own"
  on public.bookings for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Self-cancel of a pass booking (fallback path; preferred is the RPC).
create policy "bookings_self_cancel_pass"
  on public.bookings for update to authenticated
  using (
    user_id      = (select auth.uid())
    and status   = 'booked'
    and payment_type = 'pass'
    and public.can_self_cancel_booking(public.bookings.lesson_id, public.bookings.user_pass_id)
  )
  with check (
    user_id          = (select auth.uid())
    and payment_type = 'pass'
    and status       = 'cancelled'
  );

create policy "bookings_lektor_read_related"
  on public.bookings for select to authenticated
  using (
    (select public.is_lektor())
    and exists (
      select 1
      from public.lessons l
      join public.courses c on c.id = l.course_id
      where l.id       = public.bookings.lesson_id
        and c.owner_id = (select auth.uid())
    )
  );

create policy "bookings_lektor_update_related"
  on public.bookings for update to authenticated
  using (
    (select public.is_lektor())
    and exists (
      select 1
      from public.lessons l
      join public.courses c on c.id = l.course_id
      where l.id       = public.bookings.lesson_id
        and c.owner_id = (select auth.uid())
    )
  )
  with check (
    (select public.is_lektor())
    and exists (
      select 1
      from public.lessons l
      join public.courses c on c.id = l.course_id
      where l.id       = lesson_id
        and c.owner_id = (select auth.uid())
    )
  );

-- PAYMENTS ---------------------------------------------------
drop policy if exists "payments_admin_all"          on public.payments;
drop policy if exists "payments_read_own"           on public.payments;
drop policy if exists "payments_lektor_read_related" on public.payments;

create policy "payments_admin_all"
  on public.payments for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "payments_read_own"
  on public.payments for select to authenticated
  using (user_id = (select auth.uid()));

create policy "payments_lektor_read_related"
  on public.payments for select to authenticated
  using (
    (select public.is_lektor())
    and (
      exists (
        select 1
        from public.bookings b
        join public.lessons  l on l.id = b.lesson_id
        join public.courses  c on c.id = l.course_id
        where b.id       = public.payments.booking_id
          and c.owner_id = (select auth.uid())
      )
      or exists (
        select 1
        from public.user_passes up
        join public.passes      p on p.id = up.pass_id
        where up.id      = public.payments.user_pass_id
          and p.owner_id = (select auth.uid())
      )
    )
  );

-- ============================================================
-- 9. STORAGE (bucket + RLS policies for course photos)
-- ------------------------------------------------------------
-- Idempotent. Public bucket, lektor/admin can write, anyone can read.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('course-images', 'course-images', true)
on conflict (id) do update set public = true;

drop policy if exists "course_images_public_read"    on storage.objects;
drop policy if exists "course_images_lektor_insert"  on storage.objects;
drop policy if exists "course_images_lektor_update"  on storage.objects;
drop policy if exists "course_images_lektor_delete"  on storage.objects;

create policy "course_images_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'course-images');

create policy "course_images_lektor_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-images'
    and (select public.is_lektor())
  );

create policy "course_images_lektor_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'course-images'
    and (select public.is_lektor())
  )
  with check (
    bucket_id = 'course-images'
    and (select public.is_lektor())
  );

create policy "course_images_lektor_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-images'
    and (select public.is_lektor())
  );

commit;
