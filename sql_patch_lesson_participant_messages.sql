-- ============================================================
-- ATELIER — hromadná zpráva účastníkům lekce
-- ============================================================
-- Co řeší:
-- 1) minimální e-mailovou frontu public.email_notification_queue
-- 2) RPC public.enqueue_lesson_participant_message(...)
-- 3) bezpečné oprávnění: admin nebo lektor vlastnící kurz lekce
--
-- Odesílání řeší existující Edge Function:
-- supabase/functions/process-email-queue/index.ts
-- ============================================================

begin;

create table if not exists public.email_notification_queue (
  id           uuid primary key default gen_random_uuid(),
  to_email     text not null,
  subject      text not null,
  body_plain   text not null,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.email_notification_queue
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists to_email text,
  add column if not exists subject text,
  add column if not exists body_plain text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists processed_at timestamptz;

alter table public.email_notification_queue
  alter column id set default gen_random_uuid(),
  alter column created_at set default now();

create index if not exists idx_email_notification_queue_pending
  on public.email_notification_queue(created_at)
  where processed_at is null;

create or replace function public.enqueue_lesson_participant_message(
  p_lesson_id uuid,
  p_subject text,
  p_body_plain text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_subject text := nullif(trim(coalesce(p_subject, '')), '');
  v_body text := nullif(trim(coalesce(p_body_plain, '')), '');
  v_course_title text;
  v_lesson_start timestamptz;
  v_owner_id uuid;
  v_allowed boolean := false;
  v_queued integer := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_lesson_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_lesson');
  end if;

  if v_subject is null or char_length(v_subject) > 160 then
    return jsonb_build_object('ok', false, 'error', 'invalid_subject');
  end if;

  if v_body is null or char_length(v_body) > 5000 then
    return jsonb_build_object('ok', false, 'error', 'invalid_body');
  end if;

  select
    coalesce(c.title ->> 'cs', c.title ->> 'en', ''),
    l.start_time,
    c.owner_id
  into v_course_title, v_lesson_start, v_owner_id
  from public.lessons l
  join public.courses c on c.id = l.course_id
  where l.id = p_lesson_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'lesson_not_found');
  end if;

  v_allowed := public.is_admin() or (public.is_lektor() and v_owner_id = v_uid);
  if not v_allowed then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  insert into public.email_notification_queue (to_email, subject, body_plain)
  select distinct on (u.email)
    u.email,
    v_subject,
    concat(
      v_body,
      E'\n\n---\n',
      'Lekce / Lesson: ', coalesce(v_course_title, 'Lekce'),
      case
        when v_lesson_start is not null
          then concat(E'\nTermín / Date and time: ', to_char(v_lesson_start at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI'))
        else ''
      end
    )
  from public.bookings b
  join public.users u on u.id = b.user_id
  where b.lesson_id = p_lesson_id
    and b.status in ('pending_payment', 'booked')
    and u.email is not null
    and trim(u.email) <> ''
    and u.email not like 'deleted\_%@%'
  order by u.email;

  get diagnostics v_queued = row_count;

  return jsonb_build_object(
    'ok', true,
    'queued', v_queued,
    'recipients', v_queued
  );
end;
$$;

revoke all on function public.enqueue_lesson_participant_message(uuid, text, text) from public;
grant execute on function public.enqueue_lesson_participant_message(uuid, text, text) to authenticated;

commit;

