# Deploy to Render (Web Service)

This app is **one** deployable unit: the **Express backend** serves the **React frontend** from `client/build` when `NODE_ENV=production`. You do **not** need a separate Static Site on Render unless you want to split them (not required).

## Architecture on Render

| Layer | What runs |
|--------|-----------|
| **Web Service** | `node server/index.js` — API under `/api/*`, SPA from `client/build` for everything else |
| **Frontend build** | Produced at deploy time with `npm run build` in `client/` |

Users open your Render URL in a browser. **Confluence / Jira / LaunchNotes credentials stay in each user’s browser** (localStorage). If you enable **Supabase app auth**, users must sign in with an allowed work email before the API accepts requests; the server still does not store per-user Atlassian tokens.

## Prerequisites

- GitHub/GitLab/Bitbucket repo containing this project (or the folder as the repo root).
- Render account: [render.com](https://render.com)

## 1. Create a Web Service

1. In Render: **New → Web Service** → connect the repository.
2. **Root directory** (if the app is not at repo root): e.g. `Tools/mickeysToolsandThings/confluence-release-manager-export` or your path.
3. **Runtime:** Node.
4. **Region:** choose closest to your team.

## 2. Build & start commands

**Build command** (installs server + client deps and builds the React app):

```bash
npm install && cd client && npm install && npm run build
```

**Start command:**

```bash
NODE_ENV=production node server/index.js
```

Render injects **`PORT`** automatically; the server already uses `process.env.PORT` (see `server/index.js`).

## 3. Instance type

- **Starter** (or Free) is enough for light internal use.
- Free tier services **sleep** after inactivity; first load after sleep can be slow.

## 4. Environment variables

Most configuration is entered in the app’s **Settings** modal and stored in the browser. Optional server `.env` covers Jira field IDs and similar.

### Public hosting / Supabase login (recommended)

Set these on the **same** Render Web Service (add under **Environment**). CRA reads `REACT_APP_*` at **build** time, so define them before the first deploy (or trigger a rebuild after adding them).

| Variable | Where | Purpose |
|----------|--------|---------|
| `SUPABASE_JWT_SECRET` | Server only | If set, every `/api/*` call must send a valid Supabase `Authorization: Bearer` token. From Supabase → **Project Settings → API → JWT Secret**. |
| `SUPABASE_URL` | Server | **Required** when `SUPABASE_JWT_SECRET` is set if your project uses **asymmetric** Auth JWTs (Supabase default): verification uses **JWKS**, not the legacy secret alone. Same URL as `REACT_APP_SUPABASE_URL`. |
| `SUPABASE_URL` | Server only | Same project URL as below; Express uses it with the user’s JWT to read/write `user_app_profile` (RLS). |
| `SUPABASE_ANON_KEY` | Server only | Same **anon public** key as below (not the service role). |
| `REACT_APP_SUPABASE_URL` | Build + browser | Your project URL (`https://<ref>.supabase.co`). |
| `REACT_APP_SUPABASE_ANON_KEY` | Build + browser | Supabase **anon public** key. |
| `ALLOWED_EMAIL_DOMAIN` | Server (optional) | Defaults to `@toasttab.com`; sign-in email must end with this suffix. |

In Supabase → **Authentication → URL configuration**, set **Site URL** to your Render app URL and add the same URL (and `http://localhost:3000` for local dev) under **Redirect URLs** so magic links work.

Apply the SQL migration **`supabase/migrations/20250320150000_user_app_profile.sql`** in the Supabase SQL Editor so the profile table and RLS exist. See [USER_PROFILE_SYNC.md](./USER_PROFILE_SYNC.md).

User Atlassian tokens are **not** placed in Render env vars; they are stored per user in **Postgres** (synced from the app) and still mirrored in the browser for the current session. Shared server secrets are only the Supabase/JWT values above.

### Performance (free tier & API load)

- **Cold start:** Free Web Services sleep after idle time; the **first** request after sleep can take on the order of **30–60+ seconds** while Render starts the dyno. The app cannot remove that; upgrading the plan or occasionally pinging the service reduces “random” slowness.
- **Warm requests:** Most remaining delay is **Confluence/Jira** round-trips. List views that enrich each row with Jira are inherently heavier than header stats.
- **Smaller payloads:** The UI loads dashboard totals via **`GET /api/pages/stats`** (counts only). **`gzip` compression** is enabled for JSON responses. **Auto-refresh** reloads the current view but does **not** re-hit the stats endpoint every tick (to avoid duplicating the full multi-status Confluence scan). Use **Refresh** or **⌘/Ctrl+R** to update header totals after big changes.

## 5. Health checks

- **Health check path:** `/`  
  (Returns `index.html`; Render considers the service up.)

## 6. After deploy

1. Open the service **URL** Render shows (e.g. `https://your-app.onrender.com`).
2. Complete **Settings** in the UI (email, API token, Confluence base URL, space key, etc.) — same as local.
3. If Confluence/Jira block requests, ensure your Atlassian products allow API access from your network (Render egress IPs are public; Atlassian Cloud usually allows this).

## 7. Custom domain (optional)

Render → **Settings → Custom Domains** → add your domain and follow DNS instructions.

## `render.yaml` (optional, Blueprint)

If you use [Render Blueprints](https://render.com/docs/blueprint-spec), you can add a `render.yaml` at the **repository root** (adjust `rootDir` if your app lives in a subfolder):

```yaml
services:
  - type: web
    name: confluence-release-manager
    runtime: node
    plan: starter
    rootDir: .   # or: path/to/confluence-release-manager-export
    buildCommand: npm install && cd client && npm install && npm run build
    startCommand: NODE_ENV=production node server/index.js
    healthCheckPath: /
```

## Troubleshooting

| Issue | What to check |
|--------|----------------|
| Blank page / 404 | Build failed or `client/build` missing — confirm **Build** logs show a successful `react-scripts build`. |
| API errors | Browser devtools → Network; confirm requests go to **same origin** (`/api/...`), not `localhost`. |
| Export zip / long requests | Render has request timeouts on lower tiers; very large exports may need a higher plan or run locally. |
| CORS | Usually unnecessary (same origin). If you ever split frontend and API to different origins, enable CORS on the server for that origin. |

## Local parity

Local dev uses two processes (`npm run dev`: client on 3000, server on 3001). On Render, **only the server process** runs, with `NODE_ENV=production` and the built static files — matching `npm run build` then `npm start` on your machine.
