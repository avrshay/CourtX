-- CourtX MVP schema (Supabase / Postgres)
-- Tables requested: profiles, raw_logs, alerts

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    full_name text,
    team_name text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.raw_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    session_id uuid not null,
    storage_path text not null,
    raw_text text not null default '',
    status text not null default 'uploaded',
    created_at timestamptz not null default now()
);

create index if not exists idx_raw_logs_user_id on public.raw_logs (user_id);
create index if not exists idx_raw_logs_session_id on public.raw_logs (session_id);

create table if not exists public.alerts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    session_id uuid not null,
    title text not null,
    message text not null,
    severity text not null default 'medium',
    created_at timestamptz not null default now(),
    constraint alerts_severity_check check (severity in ('low', 'medium', 'high'))
);

create index if not exists idx_alerts_user_id on public.alerts (user_id);
create index if not exists idx_alerts_session_id on public.alerts (session_id);

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.raw_logs enable row level security;
alter table public.alerts enable row level security;

-- Policies: each coach can read/write only their own records
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "raw_logs_select_own" on public.raw_logs;
create policy "raw_logs_select_own"
on public.raw_logs for select
using (auth.uid() = user_id);

drop policy if exists "raw_logs_insert_own" on public.raw_logs;
create policy "raw_logs_insert_own"
on public.raw_logs for insert
with check (auth.uid() = user_id);

drop policy if exists "alerts_select_own" on public.alerts;
create policy "alerts_select_own"
on public.alerts for select
using (auth.uid() = user_id);

drop policy if exists "alerts_insert_own" on public.alerts;
create policy "alerts_insert_own"
on public.alerts for insert
with check (auth.uid() = user_id);
