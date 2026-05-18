-- ============================================================
-- ATELIER — změna termínu lekce s e-mailovou notifikací
-- ============================================================
-- Doplní RPC public.admin_reschedule_lesson(...), kterou volá
-- admin/staff UI při změně data nebo času existující lekce.
-- Funkce:
-- 1) ověří admina nebo lektora vlastnícího kurz,
-- 2) aktualizuje termín a vybrané provozní hodnoty lekce,
-- 3) pokud se termín změnil, zařadí e-mail aktivním účastníkům.
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

create or replace function public.admin_reschedule_lesson(
  p_lesson_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_capacity integer default null,
  p_price_single numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_course_title text;
  v_owner_id uuid;
  v_old_start timestamptz;
  v_old_end timestamptz;
  v_changed boolean := false;
  v_allowed boolean := false;
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

  if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
    return jsonb_build_object('ok', false, 'error', 'invalid_time_range');
  end if;

  select
    coalesce(c.title ->> 'cs', c.title ->> 'en', 'Lekce'),
    c.owner_id,
    l.start_time,
    l.end_time
  into v_course_title, v_owner_id, v_old_start, v_old_end
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

  v_changed := (v_old_start is distinct from p_start_time)
    or (v_old_end is distinct from p_end_time);

  update public.lessons
  set
    start_time = p_start_time,
    end_time = p_end_time,
    capacity = coalesce(p_capacity, capacity),
    price_single = coalesce(p_price_single, price_single)
  where id = p_lesson_id;

  if v_changed then
    v_subject := concat('Změna termínu lekce / Lesson rescheduled: ', v_course_title);
    v_body := concat(
      'Dobrý den,', E'\n\n',
      'upozorňujeme na změnu termínu lekce ', v_course_title, '.', E'\n\n',
      'Původní termín: ',
      coalesce(to_char(v_old_start at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI'), '—'),
      case
        when v_old_end is not null
          then concat('–', to_char(v_old_end at time zone 'Europe/Prague', 'HH24:MI'))
        else ''
      end,
      E'\n',
      'Nový termín: ',
      to_char(p_start_time at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI'),
      '–',
      to_char(p_end_time at time zone 'Europe/Prague', 'HH24:MI'),
      E'\n\n',
      'Vaše přihlášení na lekci zůstává platné.', E'\n\n',
      'Děkujeme za pochopení.', E'\n',
      'Ateliér',
      E'\n\n---\n\n',
      'Hello,', E'\n\n',
      'we would like to let you know that the lesson ', v_course_title, ' has been rescheduled.', E'\n\n',
      'Original time: ',
      coalesce(to_char(v_old_start at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI'), '—'),
      case
        when v_old_end is not null
          then concat('–', to_char(v_old_end at time zone 'Europe/Prague', 'HH24:MI'))
        else ''
      end,
      E'\n',
      'New time: ',
      to_char(p_start_time at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI'),
      '–',
      to_char(p_end_time at time zone 'Europe/Prague', 'HH24:MI'),
      E'\n\n',
      'Your lesson booking remains valid.', E'\n\n',
      'Thank you for your understanding.', E'\n',
      'Atelier'
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
  end if;

  return jsonb_build_object(
    'ok', true,
    'changed', v_changed,
    'queued', v_queued,
    'recipients', v_queued
  );
end;
$$;

revoke all on function public.admin_reschedule_lesson(uuid, timestamptz, timestamptz, integer, numeric) from public;
grant execute on function public.admin_reschedule_lesson(uuid, timestamptz, timestamptz, integer, numeric) to authenticated;

commit;
