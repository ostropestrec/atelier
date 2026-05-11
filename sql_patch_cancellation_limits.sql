-- ============================================================
-- ATELIER — malý patch pro limity storen na permanentkách
-- ============================================================
-- Co řeší:
-- 1) user_passes.cancellation_count
-- 2) limit storen podle velikosti permanentky
--    - do 5 vstupů: 1 storno
--    - nad 5 vstupů: 2 storna
-- 3) vrácení vstupu jen pokud je storno včas a není vyčerpán limit
-- 4) RPC pro self-storno z permanentky
-- 5) zpřísnění RLS politiky pro self-storno
--
-- Patch je idempotentní a lze ho spustit samostatně.
-- ============================================================

begin;

-- ── 1. user_passes: cancellation_count ───────────────────────
alter table public.user_passes add column if not exists cancellation_count int;
alter table public.user_passes alter column cancellation_count set default 0;

update public.user_passes
set cancellation_count = 0
where cancellation_count is null;

alter table public.user_passes drop constraint if exists user_passes_cancellation_count_valid;
alter table public.user_passes
  add constraint user_passes_cancellation_count_valid
  check (cancellation_count >= 0);

alter table public.user_passes alter column cancellation_count set not null;

-- ── 2. Helpery pro limity storen ─────────────────────────────
create or replace function public.allowed_pass_cancellations(p_entries_total int)
returns int language sql immutable as $$
  select case when coalesce(p_entries_total, 0) <= 5 then 1 else 2 end;
$$;

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

-- ── 3. Trigger: vrácení vstupu při stornu ────────────────────
create or replace function public.restore_pass_on_cancel()
returns trigger language plpgsql
security definer
set search_path = public
as $$
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

    if coalesce(new.payment_type, old.payment_type) = 'single'
       and coalesce(new.price_paid, old.price_paid, 0) > 0 then
      new.refund_status := 'pending';
      new.refunded_at := null;
      new.refund_amount := coalesce(new.refund_amount, old.refund_amount, new.price_paid, old.price_paid);
    else
      new.refund_status := coalesce(new.refund_status, old.refund_status, 'not_required');
    end if;

    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;
  return new;
end; $$;

drop trigger if exists trg_restore_pass_on_cancel on public.bookings;
create trigger trg_restore_pass_on_cancel
  before update on public.bookings
  for each row execute function public.restore_pass_on_cancel();

-- ── 4. RPC: self-storno rezervace z permanentky ──────────────
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

revoke all on function public.cancel_my_pass_booking(uuid) from public;
grant execute on function public.cancel_my_pass_booking(uuid) to authenticated;

-- ── 5. RLS: self-storno jen v okně a jen pokud zbývá quota ───
drop policy if exists "bookings: zákazník storní vlastní" on public.bookings;

create policy "bookings: zákazník storní vlastní"
  on public.bookings for update to authenticated
  using (
    user_id = public.current_user_id()
    and status = 'booked'
    and payment_type = 'pass'
    and public.can_self_cancel_booking(public.bookings.lesson_id, public.bookings.user_pass_id)
  )
  with check (
    status = 'cancelled'
    and user_id = public.current_user_id()
    and payment_type = 'pass'
    and public.can_self_cancel_booking(public.bookings.lesson_id, public.bookings.user_pass_id)
  );

commit;
