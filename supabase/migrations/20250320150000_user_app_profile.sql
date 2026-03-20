-- Per-user settings (Confluence, Jira prefs, templates, audit prefs) stored in Postgres.
-- Accessed from Express using the end-user's Supabase JWT so RLS applies (auth.uid() = user_id).
-- Run in SQL Editor or via supabase db push.

create table if not exists public.user_app_profile (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.set_user_app_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_app_profile_updated_at on public.user_app_profile;
create trigger trg_user_app_profile_updated_at
before update on public.user_app_profile
for each row
execute procedure public.set_user_app_profile_updated_at();

alter table public.user_app_profile enable row level security;

create policy "user_app_profile_select_own"
  on public.user_app_profile
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_app_profile_insert_own"
  on public.user_app_profile
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "user_app_profile_update_own"
  on public.user_app_profile
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "user_app_profile_delete_own"
  on public.user_app_profile
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on table public.user_app_profile to authenticated;

comment on table public.user_app_profile is 'App settings per auth user; payload shaped by release manager client.';
