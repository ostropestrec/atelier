-- ============================================================
-- ATELIER — deaktivace lekce s e-mailovou notifikací účastníkům
-- ============================================================
-- Doplní RPC public.admin_cancel_lesson(p_lesson_id), kterou volá
-- admin/staff UI. Funkce:
-- 1) ověří admina nebo lektora vlastnícího kurz,
-- 2) zařadí e-mail aktivním účastníkům do email_notification_queue,
-- 3) zruší aktivní přihlášky a deaktivuje lekci.
-- ============================================================

begin;

create extension if not exists pgcrypto;

create table if not exists public.email_notification_queue (
  id           uuid primary key default gen_random_uuid(),
  to_email     text not null,
  subject      text not null,
  body_plain   text not null,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);

create or replace function public.admin_cancel_lesson(p_lesson_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_course_title text;
  v_lesson_start timestamptz;
  v_owner_id uuid;
  v_allowed boolean := false;
  v_cancelled integer := 0;
  v_queued integer := 0;
  v_subject text;
  v_body text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_lesson_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_lesson');
  end if;

  select
    coalesce(c.title ->> 'cs', c.title ->> 'en', 'Lekce'),
    l.start_time,
    c.owner_id
  into v_course_title, v_lesson_start, v_owner_id
  from public.lessons l
  join public.courses c on c.id = l.course_id
  where l.id = p_lesson_id
  for update of l;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'lesson_not_found');
  end if;

  v_allowed := public.is_admin() or (public.is_lektor() and v_owner_id = v_uid);
  if not v_allowed then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_subject := concat('Zrušení lekce: ', v_course_title);
  v_body := concat(
    'Dobrý den,', E'\n\n',
    'omlouváme se, lekce ', v_course_title,
    case
      when v_lesson_start is not null
        then concat(' v termínu ', to_char(v_lesson_start at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI'))
      else ''
    end,
    ' byla zrušena.', E'\n\n',
    'Děkujeme za pochopení.', E'\n',
    'Ateliér'
  );

  insert into public.email_notification_queue (to_email, subject, body_plain)
  select distinct on (u.email)
    u.email,
    v_subject,
    v_body
  from public.bookings b
  join public.users u on u.id = b.user_id
  where b.lesson_id = p_lesson_id
    and b.status in ('pending_payment', 'booked')
    and u.email is not null
    and trim(u.email) <> ''
    and u.email not like 'deleted\_%@%'
  order by u.email;

  get diagnostics v_queued = row_count;

  update public.bookings
  set
    status = 'cancelled',
    cancelled_at = now()
  where lesson_id = p_lesson_id
    and status in ('pending_payment', 'booked');

  get diagnostics v_cancelled = row_count;

  update public.lessons
  set status = 'cancelled'
  where id = p_lesson_id;

  return jsonb_build_object(
    'ok', true,
    'cancelled_bookings', v_cancelled,
    'queued', v_queued,
    'recipients', v_queued
  );
end;
$$;

revoke all on function public.admin_cancel_lesson(uuid) from public;
grant execute on function public.admin_cancel_lesson(uuid) to authenticated;

commit;

