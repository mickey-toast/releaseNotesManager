-- Before User Created hook: only allow new auth.users with @toasttab.com.
-- After applying: Supabase Dashboard → Authentication → Hooks → Before User Created
-- → Hook type: Postgres → choose public.hook_toasttab_signup_only
-- Docs: https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook

create or replace function public.hook_toasttab_signup_only(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  email text;
  domain text;
begin
  email := lower(trim(coalesce(event->'user'->>'email', '')));

  if email = '' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'message', 'An email address is required.',
        'http_code', 400
      )
    );
  end if;

  domain := split_part(email, '@', 2);

  if domain <> 'toasttab.com' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'message', 'Only @toasttab.com email addresses can sign up.',
        'http_code', 403
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

grant usage on schema public to supabase_auth_admin;

grant execute on function public.hook_toasttab_signup_only(jsonb) to supabase_auth_admin;

revoke execute on function public.hook_toasttab_signup_only(jsonb) from authenticated, anon, public;
