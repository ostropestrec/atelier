-- ============================================================
-- ATELIER — bezpečnostní záplaty
-- 1) resolve_ghost_account() — správné sloučení ghost účtu
--    (nahrazuje přímý UPDATE id z klienta, který selhal kvůli
--     column-level grantu i absenci ON UPDATE CASCADE)
-- 2) RLS pro email_notification_queue
-- ============================================================
-- Spustit: jednou v Supabase SQL Editoru (idempotentní)
-- ============================================================

begin;

-- ── 1) Ghost merge — SECURITY DEFINER funkce ─────────────────
-- Logika:
--   • Najde ghost řádek v public.users (is_ghost=true, stejný email)
--   • Přesune bookings / user_passes / payments na auth.uid()
--   • Smaže ghost řádek (handle_new_user trigger už vytvořil nový
--     řádek pro auth uživatele přes on_auth_user_created)
--   • Vrátí TRUE pokud merge proběhl, FALSE pokud ghost neexistoval

create or replace function public.resolve_ghost_account()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ghost_id   uuid;
  v_auth_id    uuid := auth.uid();
  v_auth_email text;
begin
  if v_auth_id is null then
    return false;
  end if;

  select email into v_auth_email
  from auth.users
  where id = v_auth_id;

  if v_auth_email is null then
    return false;
  end if;

  select id into v_ghost_id
  from public.users
  where email = v_auth_email
    and is_ghost = true
    and id <> v_auth_id
  limit 1;

  if v_ghost_id is null then
    return false;
  end if;

  -- Přesunutí dat na skutečný účet
  update public.bookings    set user_id = v_auth_id where user_id = v_ghost_id;
  update public.user_passes set user_id = v_auth_id where user_id = v_ghost_id;
  update public.payments    set user_id = v_auth_id where user_id = v_ghost_id;

  -- Smazání ghost řádku (auth účet má vlastní řádek z handle_new_user triggeru)
  delete from public.users where id = v_ghost_id;

  return true;
end;
$$;

revoke all on function public.resolve_ghost_account() from public;
grant execute on function public.resolve_ghost_account() to authenticated;


-- ── 2) RLS pro email_notification_queue ──────────────────────
-- Tabulka obsahuje e-maily a obsah připomínek všech uživatelů.
-- Přímý přístup z klienta je zakázán — čte/zapisuje pouze
-- service_role (Edge Function process-email-queue) a DB funkce
-- (enqueue_lesson_reminders je SECURITY DEFINER, nepotřebuje politiku).

alter table public.email_notification_queue
  enable row level security;

-- Žádná SELECT/INSERT/UPDATE/DELETE politika pro authenticated/anon
-- → klient nemůže tabulku číst ani psát.
-- service_role RLS obchází automaticky (Supabase default).

commit;
