-- Cross-user audit trail (who did what). Writers only insert their own row; readers see all rows (authenticated).
-- Used by Express with the end-user JWT. Apply in Supabase SQL Editor.

create table if not exists public.app_audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade,
  user_email text not null,
  category text not null,
  description text not null,
  details jsonb
);

create index if not exists app_audit_log_created_at_idx on public.app_audit_log (created_at desc);

alter table public.app_audit_log enable row level security;

create policy "app_audit_log_insert_own"
  on public.app_audit_log
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- Any signed-in user can read the full log (internal team tool).
create policy "app_audit_log_select_authenticated"
  on public.app_audit_log
  for select
  to authenticated
  using (true);

grant insert, select on table public.app_audit_log to authenticated;

comment on table public.app_audit_log is 'User actions for troubleshooting / compliance; populated from the app via Express.';
