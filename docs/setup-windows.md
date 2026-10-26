# Windows 11 setup (PowerShell)

## 0. Version notes
- Node 24 / npm 11 work: nothing here uses native modules (bcryptjs is pure JS). Server needs Node ≥ 20.
- Python is **not** needed.
- Use **Chrome or Edge** for testing. Camera access works on `http://localhost` but not on plain `http://` LAN addresses.

## 1. Check tools
```powershell
node -v      # expect v24.x
npm -v       # expect 11.x
git --version
```
If `node` is not found, install the LTS/current build from nodejs.org and reopen PowerShell.

## 2. Supabase project (free, no card)
1. Sign up at supabase.com → **New project** (pick a region near you, save the DB password somewhere private).
2. **SQL Editor → New query** → paste the whole of `database/migrations/0001_init.sql` → **Run**. Expect "Success. No rows returned".
3. **Authentication → Providers → Email**: for quick local testing, turn **off** "Confirm email" (otherwise new users must click a mail link first).
4. **Project Settings → API** → note: Project URL, `anon` (publishable) key, `service_role` (secret) key.

> Never paste the service-role key into chat, the client `.env`, or GitHub.

## 3. Install
```powershell
cd path\to\meetsphere
npm run install:all
```
Success: two "added N packages" messages and no `ERR!`.

## 4. Environment files
```powershell
Copy-Item server\.env.example server\.env
Copy-Item client\.env.example client\.env
notepad server\.env     # fill SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
notepad client\.env     # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
```

## 5. Run
Terminal 1:
```powershell
npm run dev:server
```
Expect a log line "MeetSphere server listening". Check `http://localhost:4000/health` → `{"status":"ok",...}`.

Terminal 2:
```powershell
npm run dev:client
```
Open http://localhost:5173.

## 6. Test with two sessions
1. Window 1 (normal): register user A, **New meeting**, **Start now**, **Start meeting**, allow camera.
2. Window 2 (**Incognito/another browser**): register user B, paste the invite link, **Join now**.
3. Both tiles should show video. Try mute, camera off, chat, screen share, remove, end meeting.
Two tabs of the same browser profile share one login, and the second tab will *replace* the first by design, so use incognito or a second browser.

Different networks: deploy (see deployment.md) and join from a phone on mobile data. If it stays on "Connecting…" you need TURN.

## 7. Troubleshooting
| Symptom | Fix |
|---|---|
| Page says "Setup needed" | `client\.env` missing/misnamed; restart `npm run dev:client` after editing |
| Server exits: "Invalid environment configuration" | fill the listed variables in `server\.env` |
| Sign-up works but sign-in says "Email not confirmed" | disable email confirmation (step 2.3) or click the mail link |
| API calls fail with CORS error | `CLIENT_ORIGIN` in `server\.env` must exactly equal the browser origin (e.g. `http://localhost:5173`) |
| "Cannot reach the MeetSphere server" | server not running or wrong `VITE_API_URL` |
| Camera blocked | click the lock icon in the address bar → allow → Retry |
| `relation "public.meetings" does not exist` | migration not run (step 2.2) |
| Supabase "permission denied for table" | re-run the GRANT section of the migration |
| Video stuck on "Connecting…" across networks | TURN needed (deployment.md) |
| `EADDRINUSE :4000` | `netstat -ano | findstr :4000` then `taskkill /PID <pid> /F` |
