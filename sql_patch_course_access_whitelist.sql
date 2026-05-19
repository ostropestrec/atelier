-- ============================================================
-- ATELIER — uzavřené kurzy (whitelist uživatelů)
-- ============================================================
-- 1) courses.is_restricted — kurz vidí jen vybraní uživatelé + staff
-- 2) course_allowed_users — vazba kurz ↔ uživatel
-- 3) can_access_course() — helper pro RLS
-- 4) úprava politik courses, lessons, bookings + RLS na grant tabulce
--
-- Po spuštění: notify pgrst, 'reload schema';
-- ============================================================

begin;

-- ── Schema ───────────────────────────────────────────────────

alter table public.courses
  add column if not exists is_restricted boolean not null default false;

create table if not exists public.course_allowed_users (
  course_id   uuid not null references public.courses(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references public.users(id) on delete set null,
  primary key (course_id, user_id)
);

create index if not exists idx_course_allowed_users_user_id
  on public.course_allowed_users(user_id);

-- ── Helper ───────────────────────────────────────────────────

create or replace function public.can_access_course(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.courses c
    where c.id = p_course_id
      and c.is_active = true
      and (
        not c.is_restricted
        or public.is_admin()
        or (
          public.is_lektor()
          and c.owner_id = (select auth.uid())
        )
        or exists (
          select 1
          from public.course_allowed_users cau
          where cau.course_id = c.id
            and cau.user_id = (select auth.uid())
        )
      )
  );
$$;

-- Staff (admin + lektor) may read customer rows for invite picker.
drop policy if exists "users_staff_read_customers" on public.users;

create policy "users_staff_read_customers"
  on public.users for select to authenticated
  using (
    role = 'uzivatel'
    and (select public.is_lektor())
    and email not like 'deleted\_%@%'
  );

-- ── course_allowed_users RLS ─────────────────────────────────

alter table public.course_allowed_users enable row level security;

drop policy if exists "course_allowed_users_admin_all" on public.course_allowed_users;
drop policy if exists "course_allowed_users_lektor_own_course" on public.course_allowed_users;
drop policy if exists "course_allowed_users_read_own" on public.course_allowed_users;

create policy "course_allowed_users_admin_all"
  on public.course_allowed_users for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "course_allowed_users_lektor_own_course"
  on public.course_allowed_users for all to authenticated
  using (
    (select public.is_lektor())
    and exists (
      select 1 from public.courses c
      where c.id = public.course_allowed_users.course_id
        and c.owner_id = (select auth.uid())
    )
  )
  with check (
    (select public.is_lektor())
    and exists (
      select 1 from public.courses c
      where c.id = public.course_allowed_users.course_id
        and c.owner_id = (select auth.uid())
    )
  );

create policy "course_allowed_users_read_own"
  on public.course_allowed_users for select to authenticated
  using (user_id = (select auth.uid()));

-- ── courses / lessons / bookings ─────────────────────────────

drop policy if exists "courses_public_read" on public.courses;

create policy "courses_public_read"
  on public.courses for select to anon, authenticated
  using (
    is_active = true
    and public.can_access_course(id)
  );

drop policy if exists "lessons_public_read" on public.lessons;

create policy "lessons_public_read"
  on public.lessons for select to anon, authenticated
  using (
    status = 'active'
    and public.can_access_course(course_id)
  );

drop policy if exists "bookings_insert_own" on public.bookings;

create policy "bookings_insert_own"
  on public.bookings for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.lessons l
      where l.id = public.bookings.lesson_id
        and public.can_access_course(l.course_id)
    )
  );

commit;

-- notify pgrst, 'reload schema';

-- Doplňte také sql_patch_lesson_availability_course_access.sql
-- (odstraní „duchy“ v kalendáři u uzavřených kurzů).
