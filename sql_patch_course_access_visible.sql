-- ============================================================
-- ATELIER — uzavřené kurzy: viditelné, rezervace jen pro whitelist
-- ============================================================
-- Spusťte po sql_patch_course_access_whitelist.sql
-- Nahrazuje skrývání v katalogu/kalendáři: kurzy a lekce vidí všichni,
-- přihlášení (bookings) stále kontroluje can_access_course().
--
-- Pak: notify pgrst, 'reload schema';
-- ============================================================

begin;

-- can_access_course = právo rezervovat / být na whitelistu (+ staff)

drop policy if exists "courses_public_read" on public.courses;

create policy "courses_public_read"
  on public.courses for select to anon, authenticated
  using (is_active = true);

drop policy if exists "lessons_public_read" on public.lessons;

create policy "lessons_public_read"
  on public.lessons for select to anon, authenticated
  using (
    status = 'active'
    and exists (
      select 1 from public.courses c
      where c.id = public.lessons.course_id
        and c.is_active = true
    )
  );

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
inner join public.courses c on c.id = l.course_id and c.is_active = true
where l.status = 'active'
group by l.id;

commit;

-- notify pgrst, 'reload schema';
