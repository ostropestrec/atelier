-- ============================================================
-- ATELIER — patch pro stavový model potvrzené účasti
-- ============================================================
-- Co řeší:
-- 1) bookings.status rozšiřuje o:
--    - pending_payment  = čeká na platbu, místo je dočasně blokované
--    - payment_expired  = platba vypršela, místo je uvolněné
-- 2) bookings.payment_expires_at pro dočasnou blokaci místa
-- 3) partial unique index pro blokující účasti:
--    - pending_payment + booked blokují duplicitní účast na stejné lekci
-- 4) lesson_availability počítá obsazenost z blokujících stavů
--
-- `booked` necháváme jako historický DB název, ale v UI znamená
-- "potvrzená účast", ne nezávaznou rezervaci.
-- `attended` / `missed` zůstávají kvůli kompatibilitě historických dat,
-- aplikace je ale dál aktivně nepoužívá.
-- ============================================================

begin;

alter table public.bookings
  add column if not exists payment_expires_at timestamptz;

alter table public.bookings
  drop constraint if exists bookings_status_check;

alter table public.bookings
  add constraint bookings_status_check
  check (status in (
    'pending_payment',
    'booked',
    'cancelled',
    'payment_expired',
    'attended',
    'missed'
  ));

drop index if exists public.bookings_unique_user_lesson_booked;
alter table public.bookings drop constraint if exists unique_active_booking;

create unique index if not exists bookings_unique_user_lesson_blocking
  on public.bookings(user_id, lesson_id)
  where status in ('pending_payment', 'booked');

create or replace view public.lesson_availability as
select
  l.id          as lesson_id,
  l.course_id,
  l.start_time,
  l.end_time,
  l.capacity,
  l.price_single,
  l.status,
  count(b.id) filter (where b.status in ('pending_payment', 'booked'))::int as booked_count,
  greatest(l.capacity - count(b.id) filter (where b.status in ('pending_payment', 'booked')), 0)::int as available_spots
from public.lessons l
left join public.bookings b on b.lesson_id = l.id
group by l.id;

-- Volitelné pro budoucí scheduled job / manuální údržbu.
-- Neprovádí automatické cron plánování, jen poskytuje bezpečnou operaci.
create or replace function public.expire_pending_payment_bookings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.bookings
     set status = 'payment_expired',
         updated_at = now()
   where status = 'pending_payment'
     and payment_expires_at is not null
     and payment_expires_at < now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_pending_payment_bookings() from public;
grant execute on function public.expire_pending_payment_bookings() to service_role;

commit;

