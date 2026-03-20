# Can this run on Vercel?

**Short answer:** the app is built as a **traditional Express server** (API + static files). That maps cleanly to **Render / Railway / Fly.io** (always-on Node). **Vercel** is built for **static sites + short-lived serverless functions**, so a **direct “upload the whole repo”** deploy is **not a good fit** without meaningful changes.

## Why the full stack is awkward on Vercel

| This project | Typical Vercel model |
|--------------|----------------------|
| Single long-running `node server/index.js` | Stateless functions per request |
| `app.listen(PORT)` | No persistent process; you export a handler |
| Internal HTTP to `http://127.0.0.1:${PORT}/api/...` (export / master flows) | No reliable “same machine” loopback between invocations |
| Zip streaming, multer uploads, long Confluence/Jira calls | **Execution time limits** (e.g. 10s Hobby, up to 60s+ on Pro depending on plan) |
| Same-origin `/api` from the SPA | Works only if API and UI share one deployment pattern |

So: **possible in theory** (e.g. wrap Express as one serverless function), but you’d be fighting timeouts, cold starts, and you’d still need to **remove or refactor** the `127.0.0.1` self-calls. Not recommended unless you invest in a dedicated refactor.

## Practical option: Vercel for the UI, API elsewhere

If you want **your domain on Vercel** but minimal risk:

1. Host the **API** where Node is meant to run long-lived (e.g. **Render** — see [RENDER.md](./RENDER.md)).
2. Deploy **only the React build** to Vercel (static output from `client/build`).
3. Add a **configurable API base URL** in the client (e.g. `REACT_APP_API_URL=https://your-api.onrender.com`) and prefix all `/api` requests with that origin. Today the app uses **relative** `/api/...` paths, so this is a **small code change** in `client/src/api.js` (and any raw `fetch('/api/...')` calls).
4. Enable **CORS** on Express for your Vercel origin (`https://your-app.vercel.app`) and allow needed headers (e.g. `X-Atlassian-*`).

That gives you “shared on Vercel” for the **frontend** while the **backend** stays on a Node-friendly host.

## Recommendation

- **Easiest shared URL for the whole app:** one **Render Web Service** (or similar) — [RENDER.md](./RENDER.md).
- **Vercel account:** use it for the **static UI + env pointing at your API**, after the client supports an API base URL and CORS is set on the server — *not* documented as implemented yet; say the word if you want that wired in the repo.

## Summary

| Approach | Fit |
|----------|-----|
| Entire app on Vercel as-is | **Poor** — wrong execution model + internal loopback + timeouts |
| UI on Vercel, API on Render/Railway | **Good** — needs API base URL + CORS |
| Entire app on Render | **Good** — matches current design |
