-- ============================================================
-- ATELIER — volná místa: správný počet + workshop jako jeden pool
-- ============================================================
-- 1) View bez security_invoker — plný počet rezervací (ne jen vlastní přes RLS).
-- 2) Workshop (is_workshop): jedna obsazenost pro celý kurz = počet DISTINCT
--    uživatelů s blokující rezervací na libovolném setkání; stejné available_spots
--    na všech termínech workshopu.
-- 3) Trigger kapacity u workshopu: nový účastník jen pokud je volné místo
--    v poolu; další řádek stejného uživatele (2. setkání) nezabírá další místo.
--
-- Spusťte po sql_patch_course_access_visible.sql
-- Pak: notify pgrst, 'reload schema';
-- ============================================================

begin;

-- ── Počet účastníků workshopu (jedno místo = jeden user bez ohledu na počet setkání) ──
create or replace function public.workshop_participant_count(p_course_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct b.user_id)::int
  from public.bookings b
  inner join public.lessons l on l.id = b.lesson_id and l.status = 'active'
  where l.course_id = p_course_id
    and b.status in ('pending_payment', 'booked');
$$;

revoke all on function public.workshop_participant_count(uuid) from public;
grant execute on function public.workshop_participant_count(uuid) to authenticated, service_role;

-- ── View lesson_availability ─────────────────────────────────
drop view if exists public.lesson_availability;

create view public.lesson_availability
as
with workshop_occupancy as (
  select
    l.course_id,
    count(distinct b.user_id)::int as participant_count
  from public.lessons l
  inner join public.courses c on c.id = l.course_id and c.is_workshop = true and c.is_active = true
  left join public.bookings b
    on b.lesson_id = l.id
   and b.status in ('pending_payment', 'booked')
  where l.status = 'active'
  group by l.course_id
),
per_lesson_bookings as (
  select
    l.id as lesson_id,
    count(b.id) filter (where b.status in ('pending_payment', 'booked'))::int as booked_count
  from public.lessons l
  left join public.bookings b on b.lesson_id = l.id
  where l.status = 'active'
  group by l.id
)
select
  l.id          as lesson_id,
  l.course_id,
  l.start_time,
  l.end_time,
  l.capacity,
  l.price_single,
  l.status,
  case
    when c.is_workshop then coalesce(wo.participant_count, 0)
    else coalesce(pl.booked_count, 0)
  end as booked_count,
  greatest(
    l.capacity - case
      when c.is_workshop then coalesce(wo.participant_count, 0)
      else coalesce(pl.booked_count, 0)
    end,
    0
  )::int as available_spots
from public.lessons l
inner join public.courses c on c.id = l.course_id and c.is_active = true
left join workshop_occupancy wo on wo.course_id = l.course_id and c.is_workshop
left join per_lesson_bookings pl on pl.lesson_id = l.id and not c.is_workshop
where l.status = 'active';

grant select on public.lesson_availability to anon, authenticated;

-- ── Kapacita při INSERT booking ───────────────────────────────
create or replace function public.check_lesson_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booked int;
  v_capacity int;
  v_is_workshop boolean;
  v_course_id uuid;
  v_user_already_in_workshop boolean;
begin
  if new.status not in ('pending_payment', 'booked') then
    return new;
  end if;

  select l.capacity, c.is_workshop, l.course_id
    into v_capacity, v_is_workshop, v_course_id
  from public.lessons l
  join public.courses c on c.id = l.course_id
  where l.id = new.lesson_id;

  if v_is_workshop then
    select exists (
      select 1
      from public.bookings b
      join public.lessons l on l.id = b.lesson_id and l.status = 'active'
      where l.course_id = v_course_id
        and b.user_id = new.user_id
        and b.status in ('pending_payment', 'booked')
    ) into v_user_already_in_workshop;

    if v_user_already_in_workshop then
      return new;
    end if;

    v_booked := public.workshop_participant_count(v_course_id);
  else
    select count(*)::int into v_booked
    from public.bookings
    where lesson_id = new.lesson_id
      and status in ('pending_payment', 'booked');
  end if;

  if v_booked >= v_capacity then
    raise exception 'Lekce je plně obsazena (kapacita: %).', v_capacity;
  end if;

  return new;
end;
$$;

commit;

-- notify pgrst, 'reload schema';
