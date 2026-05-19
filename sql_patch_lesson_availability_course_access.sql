-- ============================================================
-- ATELIER — lesson_availability respektuje uzavřené kurzy
-- ============================================================
-- View lesson_availability čte z lessons; bez filtru mohou projít lekce
-- kurzů, které uživatel v courses nevidí (duchové v kalendáři).
--
-- Spusťte po sql_patch_course_access_whitelist.sql
-- Pak: notify pgrst, 'reload schema';
-- ============================================================

begin;

create or replace view public.lesson_availability
with (security_invoker = true)
as
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
where l.status = 'active'
  and public.can_access_course(l.course_id)
group by l.id;

commit;

-- notify pgrst, 'reload schema';
