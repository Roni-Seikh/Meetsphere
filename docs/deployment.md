# Free deployment guide

> Prices/limits below were checked on 25 Oct 2026 and **change often**: re-verify each provider's pricing page before relying on them. No deployment has been performed by the author of this document.

## Components
| Part | Suggested free host | Notes |
|---|---|---|
| Frontend (static) | Vercel, Netlify or Cloudflare Pages (any free plan) | SPA rewrite files are included (`vercel.json`, `public/_redirects`). Build: `npm run build`, output `dist`, root dir `client` |
| Server (Express + Socket.IO) | Render free web service | `render.yaml` provided. Sleeps after 15 min with no HTTP/WebSocket traffic, ~1 min cold start, 750 free hours/month, may restart any time, ephemeral disk |
| Database + Auth | Supabase free | 500 MB DB, 50k MAU, 5 GB egress, 2 active projects, **pauses after ~7 days inactivity** (restore in dashboard). Don't use Render's free Postgres (expires after 30 days) |
| STUN | Google public STUN (default) | free, no account |
| TURN (optional) | Metered Open Relay / free trial tier, or self-host coturn on any free VM | Free allowances are small (hundreds of MB to ~20 GB/month depending on plan/terms) and relayed video is ~1-2 GB per hour per stream, so treat TURN as limited |

## Steps
1. **Push to GitHub** (private or public; secrets are git-ignored).
2. **Supabase:** run the migration (docs/setup-windows.md §2).
3. **Render:** New → Blueprint → pick the repo, or New Web Service with root `server`, build `npm install --include=dev && npm run build`, start `npm start`, health check `/health`. Enter env vars in the dashboard: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLIENT_ORIGIN` (your frontend URL, no trailing slash; comma-separate multiple), optional `TURN_*`. Check `https://<service>.onrender.com/health`.
4. **Frontend host:** import repo, root `client`, build `npm run build`, output `dist`; env: `VITE_API_URL=https://<service>.onrender.com`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
5. Update `CLIENT_ORIGIN` on Render to the final frontend URL; redeploy.
6. In Supabase **Authentication → URL configuration** set Site URL to the frontend URL.
7. Test from two devices over HTTPS (HTTPS is provided automatically; camera/mic need it).

## Operational realities
- **Sleep:** open the site ~1 min before a demo or hit `/health`. Active WebSocket traffic keeps Render awake during a call. A restart drops in-memory rooms; clients reconnect and re-join automatically, meeting data stays in Postgres.
- **Supabase pause:** log in weekly or before demos; free projects idle for a week get paused.
- **TURN cost:** relay traffic is metered both directions. Share credentials only via server env. If a provider starts billing, delete the TURN credential and clear `TURN_*`; the app falls back to STUN-only.
- **Avoid surprise charges:** don't add a card unless needed; use free plan types only; set budget alerts if a provider offers them; to shut down: delete the Render service, pause/delete the Supabase project, remove frontend project.
- **Scaling:** one instance only (room state is in memory). Multiple instances would need the Socket.IO Redis adapter and shared state.
