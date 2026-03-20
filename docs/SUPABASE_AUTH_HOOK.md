# Supabase: block signups except `@toasttab.com`

This adds a **[Before User Created](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)** hook in Supabase so **new** Auth users are rejected unless their email domain is `toasttab.com`. It complements the Express check (`SUPABASE_JWT_SECRET` + email suffix) in this repo.

**What it does not do:** It does not remove users who already exist. Clean those up in **Authentication → Users** if needed.

## Step 1 — Run the SQL

1. Open [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql/new) for your project.
2. Paste and run the contents of:

   `supabase/migrations/20250320140000_toasttab_before_user_created.sql`

   (Same SQL is in the repo; copy the whole file.)

You should see **Success**. The function name is **`public.hook_toasttab_signup_only`**.

## Step 2 — Turn on the hook in the dashboard

1. Go to **Authentication** → **[Hooks](https://supabase.com/dashboard/project/_/auth/hooks)**.
2. Find **Before User Created** (or “Before user created”).
3. Enable it and set the hook type to **Postgres** / **Database function** (wording varies slightly by dashboard version).
4. Choose schema **`public`** and function **`hook_toasttab_signup_only`**.
5. Save.

## Step 3 — Smoke test

- Try signing up / magic link with a **non-Toast** email → should fail with a clear error (no new row in **Authentication → Users**).
- Try with **`you@toasttab.com`** → should succeed as before.

## Optional: Supabase CLI

If you use the [Supabase CLI](https://supabase.com/docs/guides/cli) linked to this project:

```bash
supabase db push
```

…will apply migrations (including this one) to the linked remote database. You still need **Step 2** in the dashboard unless your project configures the hook in `config.toml`.

## Changing the allowed domain later

Edit the `domain <> 'toasttab.com'` check in the migration (or in SQL Editor with a new `CREATE OR REPLACE FUNCTION`), run it again, and keep the hook pointing at the same function name.

## Email + password sign-up (app “Sign up” tab)

The client calls `supabase.auth.signUp` with `emailRedirectTo` set to the current origin (same idea as magic links). Configure the following in Supabase:

1. **Authentication → Providers → Email**  
   - Leave **Email** enabled.  
   - Turn **on** “Allow new users to sign up” (wording may be “Enable email signups” / “Confirm email” depending on dashboard version).  
   - If you use **Confirm email**: new users get a confirmation link before they can sign in with password. Add your URLs under **Authentication → URL Configuration → Redirect URLs** (e.g. `http://localhost:3000`, production origin, and wildcards if you use them) so confirmation and magic links return to the right host.

2. **Authentication → Providers → Email** (password policy)  
   - Set **minimum password length** to match what you expect (the app enforces at least 8 characters before calling the API; raise the Supabase minimum if you want stricter).

3. **Before User Created hook** (above) still runs for `signUp` — only `@toasttab.com` emails can create accounts.

4. Optional: disable **“Allow anonymous sign-ins”** and review **Rate limits** under Auth settings if you expose sign-up publicly.
