-- Admins (bootstrap: insert your user_id from auth.users into app_admins).
-- Per-user feature flags (missing row = use app default in server code, usually "allowed").

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.user_permission_grants (
  user_id uuid not null references auth.users (id) on delete cascade,
  permission_key text not null,
  allowed boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, permission_key)
);

alter table public.app_admins enable row level security;
alter table public.user_permission_grants enable row level security;

drop policy if exists app_admins_select_self on public.app_admins;
create policy app_admins_select_self
  on public.app_admins
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_grants_select_self on public.user_permission_grants;
create policy user_grants_select_self
  on public.user_permission_grants
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on table public.app_admins to authenticated;
grant select on table public.user_permission_grants to authenticated;

comment on table public.app_admins is 'App admins; managed via Express + service role. First admin: insert own auth.users.id in SQL Editor.';
comment on table public.user_permission_grants is 'Optional overrides for export / ai / launchnotes; writes via service role only.';
