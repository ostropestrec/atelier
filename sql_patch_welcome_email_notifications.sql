-- ============================================================
-- ATELIER — uvítací e-mail po vytvoření účtu
-- ============================================================
-- Co řeší:
-- 1) po vložení nového profilu do public.users zařadí uvítací e-mail,
-- 2) funguje pro magic link i Google/Apple přihlášení,
-- 3) e-mail je dvojjazyčný: česky + anglicky v jednom těle,
-- 4) event_key brání duplicitnímu zařazení stejného uvítání.
--
-- Samotné odeslání dál řeší existující Edge Function
-- process-email-queue a její cron.
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

alter table public.email_notification_queue
  add column if not exists event_key text;

create index if not exists idx_email_notification_queue_pending
  on public.email_notification_queue(created_at)
  where processed_at is null;

create unique index if not exists email_notification_queue_event_key_unique
  on public.email_notification_queue(event_key)
  where event_key is not null;

create or replace function public.enqueue_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := coalesce(nullif(trim(new.name), ''), 'there');
begin
  if new.email is null
     or trim(new.email) = ''
     or new.email like 'deleted\_%@%' then
    return new;
  end if;

  insert into public.email_notification_queue (to_email, subject, body_plain, event_key)
  values (
    new.email,
    'Vítejte v Ateliéru / Welcome to Atelier',
    concat(
      'Dobrý den, ', v_name, ',', E'\n\n',
      'vítejte v aplikaci Ateliéru jatakidu&friends.', E'\n\n',
      'Ve svém účtu najdete přehled přihlášených lekcí, aktivní permanentky, nastavení e-mailových připomínek a uživatelský manuál.', E'\n\n',
      'Při přihlášení přes e-mailový odkaz není potřeba vytvářet heslo. Stačí otevřít odkaz, který vám pošleme do schránky.', E'\n\n',
      'Těšíme se na vás.', E'\n',
      'Ateliér jatakidu&friends',
      E'\n\n---\n\n',
      'Hello ', v_name, ',', E'\n\n',
      'welcome to the Atelier jatakidu&friends app.', E'\n\n',
      'In your account, you can find your booked lessons, active passes, email reminder settings, and the user guide.', E'\n\n',
      'When signing in via an email link, you do not need to create a password. Just open the link we send to your inbox.', E'\n\n',
      'We look forward to seeing you.', E'\n',
      'Atelier jatakidu&friends'
    ),
    concat('welcome:', new.id)
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_users_enqueue_welcome_email on public.users;
create trigger trg_users_enqueue_welcome_email
  after insert on public.users
  for each row execute function public.enqueue_welcome_email();

commit;
