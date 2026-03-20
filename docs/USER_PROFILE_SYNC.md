# User settings sync (`user_app_profile`)

When Supabase login is enabled **and** the server has `SUPABASE_JWT_SECRET`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY`, the app:

1. **After sign-in** — `GET /api/me/profile` loads your saved row (if any) into `localStorage` so the existing UI keeps working.
2. **On Save in Settings** — `PUT /api/me/profile` upserts a JSON payload: Confluence settings, Jira field prefs, quick-comment templates, and activity-log category prefs.

Express talks to Postgres with the **same** `Authorization: Bearer <user access token>` the browser sent, so **Row Level Security** uses `auth.uid()` and users cannot read each other’s rows.

## One-time database setup

Run these in the Supabase **SQL Editor** (or `supabase db push`):

| Migration | Purpose |
|-----------|---------|
| `supabase/migrations/20250320150000_user_app_profile.sql` | Per-user settings (`user_app_profile`) |
| `supabase/migrations/20250320160000_app_audit_log.sql` | Team audit log (`app_audit_log`) — **Troubleshooting → Team audit log** |

## Team audit log (`app_audit_log`)

Each `logActivity(...)` call still writes to **local** Activity Log, and (when the same Supabase env is enabled) **POST `/api/audit-log`** records **who** (Supabase email) did **what**. Any signed-in user can **read** all rows (internal tool). Entries respect Activity Log category toggles in Settings (if a category is off, nothing is sent locally or to the server).

## Environment (server)

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | Anon key (same value as `REACT_APP_SUPABASE_ANON_KEY`) |
| `SUPABASE_JWT_SECRET` | Required so `/api/*` is authenticated |

If any of these are missing, profile and audit API routes return `404` (`cloudProfile: false` / `auditLog: false`) and the app keeps local-only activity logging.

## References

- [Before User Created hook](./SUPABASE_AUTH_HOOK.md) (domain allowlist)
- [Supabase RLS](https://supabase.com/docs/guides/auth/row-level-security)
