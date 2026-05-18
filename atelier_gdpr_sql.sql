-- ============================================================
-- GDPR: Právo být zapomenut — anonymizace účtu
-- Spouštěno jako SECURITY DEFINER funkce přes Edge Function
-- (nikoli přímo z klienta — service_role obchází RLS).
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ─── Audit log ───────────────────────────────────────────────
-- Uchováváme jen fakt, že ke smazání došlo — bez PII.
create table if not exists public.gdpr_deletion_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,          -- zachováno pro auditní stopu
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  reason       text,                   -- volitelný důvod (uživatelem zadaný)
  ip_hash      text                    -- hash IP pro anti-abuse, nikoli IP samotná
);

alter table public.gdpr_deletion_log
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists requested_at timestamptz default now(),
  add column if not exists completed_at timestamptz,
  add column if not exists reason text,
  add column if not exists ip_hash text;

alter table public.gdpr_deletion_log
  alter column id set default gen_random_uuid(),
  alter column requested_at set default now();

-- Pouze service_role (backend) smí do logu zapisovat
alter table public.gdpr_deletion_log enable row level security;

drop policy if exists "gdpr_log: jen service_role" on public.gdpr_deletion_log;
create policy "gdpr_log: jen service_role"
  on public.gdpr_deletion_log
  for all
  using (false)
  with check (false);   -- nikdo přes klienta nečte ani nepíše

-- ─── Hlavní anonymizační funkce ──────────────────────────────
create or replace function public.anonymize_user_account(
  p_user_id     uuid,
  p_reason      text  default null,
  p_ip_hash     text  default null
)
returns jsonb
language plpgsql
security definer   -- běží s právy vlastníka funkce (service_role)
set search_path = public
as $$
declare
  v_anon_email  text;
  v_now         timestamptz := now();
  v_future_bookings_count int;
  v_log_id      uuid;
begin
  -- 0. Ověření: uživatel existuje a není already anonymizován
  if not exists (
    select 1 from public.users
    where id = p_user_id
      and email not like 'deleted\_%'
  ) then
    return jsonb_build_object('error', 'Účet nenalezen nebo již anonymizován.');
  end if;

  -- 1. Zahájení audit logu
  insert into public.gdpr_deletion_log (user_id, reason, ip_hash)
  values (p_user_id, p_reason, p_ip_hash)
  returning id into v_log_id;

  -- 2. Storno budoucích rezervací
  --    Kapacita se uvolní automaticky přes trigger restore_pass_on_cancel.
  --    Pouze rezervace na lekce, které ještě nezačaly.
  update public.bookings b
  set    status = 'cancelled',
         cancelled_at = v_now,
         cancellation_type = 'early'   -- GDPR storno = vždy early (vstup se vrátí)
  from   public.lessons l
  where  b.lesson_id = l.id
    and  b.user_id   = p_user_id
    and  b.status in ('pending_payment', 'booked')
    and  l.start_time > v_now;

  get diagnostics v_future_bookings_count = row_count;

  -- 3. Zneplatnění aktivních permanentek
  update public.user_passes
  set    status            = 'expired',
         entries_remaining = 0,
         updated_at        = v_now
  where  user_id = p_user_id
    and  status  = 'active';

  -- 4. Anonymizace profilu
  --    Format: deleted_<prvních 8 znaků UUID>
  --    E-mail dostane neplatnou doménu → nikdy nedorazí žádný mail
  v_anon_email := 'deleted_' || left(p_user_id::text, 8) || '@deleted.invalid';

  update public.users
  set
    email         = v_anon_email,
    name          = 'Smazaný uživatel',
    avatar_url    = null,
    is_ghost      = false,
    -- Zachováme role pro historické výkazy, ale odstraníme PII
    updated_at    = v_now
  where id = p_user_id;

  -- 5. Smazání účtu v Supabase Auth
  --    Musí proběhnout přes admin API (service_role).
  --    Volá se z Edge Function po návratu této funkce.
  --    Zde jen označíme log jako dokončený.
  update public.gdpr_deletion_log
  set    completed_at = v_now
  where  id = v_log_id;

  return jsonb_build_object(
    'ok',                    true,
    'anon_email',            v_anon_email,
    'future_bookings_cancelled', v_future_bookings_count,
    'log_id',                v_log_id
  );

exception when others then
  -- Rollback proběhne automaticky (jsme v transakci)
  return jsonb_build_object(
    'error',   sqlerrm,
    'detail',  sqlstate
  );
end;
$$;

-- Pouze service_role smí funkci volat
revoke execute on function public.anonymize_user_account from public, anon, authenticated;
grant execute on function public.anonymize_user_account(uuid, text, text) to service_role;

-- ─── Helper view: přehled dat k anonymizaci (pro DPO) ────────
-- Data Protection Officer může zobrazit rozsah dat bez PII.
create or replace view public.gdpr_data_summary as
  select
    u.id,
    u.role,
    u.created_at,
    count(distinct b.id)  filter (where b.status in ('pending_payment', 'booked')) as active_bookings,
    count(distinct b.id)  filter (where b.status = 'cancelled')  as cancelled_bookings,
    count(distinct up.id) filter (where up.status = 'active')    as active_passes,
    count(distinct up.id)                                         as total_passes
  from public.users u
  left join public.bookings    b  on b.user_id  = u.id
  left join public.user_passes up on up.user_id = u.id
  group by u.id, u.role, u.created_at;

-- View je pouze pro service_role (žádný public grant)
revoke all on public.gdpr_data_summary from public, anon, authenticated;
grant select on public.gdpr_data_summary to service_role;

commit;
