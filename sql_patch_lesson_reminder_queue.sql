-- ============================================================
-- ATELIER — připomínky nadcházejících lekcí přes e-mailovou frontu
-- ============================================================
-- Co řeší:
-- 1) doplní event_key do public.email_notification_queue,
--    aby se stejná připomínka nezařadila dvakrát,
-- 2) vytvoří RPC public.enqueue_lesson_reminders(),
-- 3) nastaví pg_cron job, který připomínky pravidelně zařazuje.
--
-- Samotné odeslání dál řeší existující Edge Function
-- process-email-queue a její cron.
-- ============================================================

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create table if not exists public.email_notification_queue (
  id           uuid primary key default gen_random_uuid(),
  to_email     text not null,
  subject      text not null,
  body_plain   text not null,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.email_notification_queue
  add column if not exists event_key text;

create index if not exists idx_email_notification_queue_pending
  on public.email_notification_queue(created_at)
  where processed_at is null;

create unique index if not exists email_notification_queue_event_key_unique
  on public.email_notification_queue(event_key)
  where event_key is not null;

create or replace function public.enqueue_lesson_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidates integer := 0;
  v_queued integer := 0;
begin
  with eligible as (
    select distinct on (b.id)
      b.id as booking_id,
      u.email,
      coalesce(nullif(trim(u.name), ''), 'there') as user_name,
      coalesce(c.title ->> 'cs', c.title ->> 'en', 'Lekce') as course_title,
      l.start_time,
      l.end_time
    from public.bookings b
    join public.users u on u.id = b.user_id
    join public.lessons l on l.id = b.lesson_id
    join public.courses c on c.id = l.course_id
    where b.status = 'booked'
      and l.status = 'active'
      and l.start_time > now()
      and coalesce(u.reminder_hours, 0) > 0
      and l.start_time <= now() + make_interval(hours => u.reminder_hours)
      and u.email is not null
      and trim(u.email) <> ''
      and u.email not like 'deleted\_%@%'
    order by b.id, l.start_time
  ),
  inserted as (
    insert into public.email_notification_queue (to_email, subject, body_plain, event_key)
    select
      e.email,
      concat('Připomínka lekce / Lesson reminder: ', e.course_title),
      concat(
        'Dobrý den,', E'\n\n',
        'připomínáme vaši nadcházející lekci.', E'\n\n',
        'Lekce: ', e.course_title, E'\n',
        'Termín: ',
        to_char(e.start_time at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI'),
        case
          when e.end_time is not null
            then concat('–', to_char(e.end_time at time zone 'Europe/Prague', 'HH24:MI'))
          else ''
        end,
        E'\n\n',
        'Pokud se nemůžete zúčastnit, zkontrolujte prosím storno podmínky přímo v aplikaci.', E'\n\n',
        'Děkujeme a těšíme se na vás.', E'\n',
        'Ateliér',
        E'\n\n---\n\n',
        'Hello,', E'\n\n',
        'this is a reminder for your upcoming lesson.', E'\n\n',
        'Lesson: ', e.course_title, E'\n',
        'Date and time: ',
        to_char(e.start_time at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI'),
        case
          when e.end_time is not null
            then concat('–', to_char(e.end_time at time zone 'Europe/Prague', 'HH24:MI'))
          else ''
        end,
        E'\n\n',
        'If you cannot attend, please check the cancellation conditions directly in the app.', E'\n\n',
        'Thank you, we look forward to seeing you.', E'\n',
        'Atelier'
      ),
      concat('lesson_reminder:', e.booking_id)
    from eligible e
    on conflict do nothing
    returning 1
  )
  select
    (select count(*) from eligible),
    (select count(*) from inserted)
  into v_candidates, v_queued;

  return jsonb_build_object(
    'ok', true,
    'candidates', v_candidates,
    'queued', v_queued,
    'recipients', v_queued
  );
end;
$$;

revoke all on function public.enqueue_lesson_reminders() from public;
grant execute on function public.enqueue_lesson_reminders() to service_role;

select cron.schedule(
  'atelier-enqueue-lesson-reminders',
  '*/10 * * * *',
  $$select public.enqueue_lesson_reminders();$$
)
where not exists (
  select 1
  from cron.job
  where jobname = 'atelier-enqueue-lesson-reminders'
);

commit;
