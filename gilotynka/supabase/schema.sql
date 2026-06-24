-- ════════════════════════════════════════════════════════════════
--  GILOTYNKA 🪓 — schemat bazy (Supabase / Postgres)
--  Uruchom CAŁOŚĆ w panelu Supabase → SQL Editor → New query → Run.
--  Tworzy: tabele, role (nadzorca/wykonawca), RLS, funkcje, codzienny reset.
-- ════════════════════════════════════════════════════════════════

-- ── Rozszerzenia ──────────────────────────────────────────────
create extension if not exists pgcrypto;     -- gen_random_uuid()
-- pg_cron włącz raz w: Database → Extensions → "pg_cron" (Enable).
-- Jeśli nie chcesz crona, sekcja "CODZIENNY RESET" niżej jest opcjonalna.

-- ════════════════════════════════════════════════════════════════
--  PROFILE UŻYTKOWNIKÓW (1 wiersz na konto, trzyma rolę)
-- ════════════════════════════════════════════════════════════════
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role         text not null default 'worker'
               check (role in ('supervisor','worker')),
  created_at   timestamptz not null default now()
);

-- Nowe konto → automatycznie zakłada profil (domyślnie 'worker').
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)),
    'worker'
  )
  on conflict (id) do nothing;
  return new;
end$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Pomocnik: rola zalogowanego użytkownika.
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ════════════════════════════════════════════════════════════════
--  ZADANIA
-- ════════════════════════════════════════════════════════════════
create table if not exists public.tasks (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  type           text not null default 'once' check (type in ('once','dc','cyc')),
  priority       text not null default '1',     -- '1'..'4' albo 'dc'
  note           text not null default '',
  status         text not null default 'oczekiwanie'
                 check (status in ('oczekiwanie','w_realizacji','ukonczone','nie_potrzeby')),
  created_by     uuid references public.profiles(id) on delete set null,
  completed_by   uuid references public.profiles(id) on delete set null,
  completed_date date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists tasks_status_idx on public.tasks(status);
create index if not exists tasks_created_by_idx on public.tasks(created_by);

-- updated_at auto-bump
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end$$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

-- ════════════════════════════════════════════════════════════════
--  RLS (Row Level Security)
--   • każdy zalogowany WIDZI wszystkie zadania i profile,
--   • tylko NADZORCA tworzy / edytuje / usuwa zadania,
--   • WYKONAWCA zmienia status przez funkcję set_task_status() (niżej).
-- ════════════════════════════════════════════════════════════════
alter table public.profiles enable row level security;
alter table public.tasks    enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_admin on public.profiles;
create policy profiles_admin on public.profiles
  for all to authenticated
  using (public.my_role() = 'supervisor')
  with check (public.my_role() = 'supervisor');

-- tasks
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated using (true);

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated with check (public.my_role() = 'supervisor');

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (public.my_role() = 'supervisor')
  with check (public.my_role() = 'supervisor');

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated using (public.my_role() = 'supervisor');

-- ════════════════════════════════════════════════════════════════
--  ZMIANA STATUSU — dla obu ról (wykonawca i nadzorca)
--   Wykonawca nie może edytować treści, ale może oznaczać postęp.
--   security definer => omija RLS, ale rusza TYLKO kolumny statusu.
-- ════════════════════════════════════════════════════════════════
create or replace function public.set_task_status(p_id uuid, p_status text)
returns public.tasks language plpgsql security definer set search_path = public as $$
declare r public.tasks;
begin
  if auth.uid() is null then
    raise exception 'Brak autoryzacji';
  end if;
  if p_status not in ('oczekiwanie','w_realizacji','ukonczone','nie_potrzeby') then
    raise exception 'Niedozwolony status: %', p_status;
  end if;

  update public.tasks set
    status         = p_status,
    completed_date = case when p_status = 'ukonczone' then current_date else null end,
    completed_by   = case when p_status = 'ukonczone' then auth.uid() else null end
  where id = p_id
  returning * into r;

  return r;
end$$;

grant execute on function public.set_task_status(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════
--  CODZIENNY RESET (zamiast resetu w przeglądarce)
--   • codzienne (dc): ukonczone/nie_potrzeby → w_realizacji
--   • cykliczne (cyc): ukonczone → oczekiwanie
-- ════════════════════════════════════════════════════════════════
create or replace function public.daily_reset()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.tasks
    set status='w_realizacji', completed_date=null, completed_by=null
    where type='dc' and status in ('ukonczone','nie_potrzeby');
  update public.tasks
    set status='oczekiwanie', completed_date=null, completed_by=null
    where type='cyc' and status='ukonczone';
end$$;

-- Harmonogram (wymaga włączonego pg_cron). UWAGA: cron działa w UTC.
-- Północ w Polsce = 22:00 UTC (lato) / 23:00 UTC (zima). Bierzemy 23:00 UTC.
-- Jeśli pg_cron nie jest włączony, pomiń te dwie linie — reset zrobisz ręcznie
-- przyciskiem, albo wywołując select public.daily_reset();
do $$
begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule('gilotynka-daily-reset')
      where exists (select 1 from cron.job where jobname='gilotynka-daily-reset');
    perform cron.schedule('gilotynka-daily-reset', '0 23 * * *',
                          $cron$select public.daily_reset()$cron$);
  end if;
end$$;

-- ════════════════════════════════════════════════════════════════
--  REALTIME — synchronizacja na żywo między urządzeniami
-- ════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end$$;

-- ════════════════════════════════════════════════════════════════
--  PO ZAŁOŻENIU KONT: ustaw nadzorców (reszta zostaje 'worker').
--  Najpierw każdy nadzorca i wykonawca muszą się zarejestrować (Auth),
--  potem podmień adresy e-mail poniżej i uruchom:
-- ════════════════════════════════════════════════════════════════
-- update public.profiles set role='supervisor'
--   where id in (select id from auth.users where email in
--     ('nadzorca1@example.com','nadzorca2@example.com'));
--
-- update public.profiles set role='worker'
--   where id = (select id from auth.users where email='wykonawca@example.com');
