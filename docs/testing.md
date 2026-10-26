# Testing

## Automated (what exists and was run in the authoring environment)
```powershell
npm run typecheck   # strict TS, server + client
npm test            # server: 57 tests · client: 31 tests
npm run build
```
**Server (Vitest + Supertest + real Socket.IO clients over an in-memory store):** token rejection, validation errors, password hash never leaked, host-only end/remove, non-participants cannot read chat history, role spoofing ignored, passwords, capacity, removed users cannot rejoin, relay isolation between rooms, `from` spoofing ignored, chat validation/rate-limit/persistence/history, duplicate tab replacement, stale socket cannot remove a newer session, empty-room grace period, refresh keeps meeting alive, media-state broadcast, waiting room (host sees list, admit/decline, guests cannot self-admit or chat while waiting, disconnect cleans the list, password still enforced, meeting end notifies waiters), hand raising, reactions (allow-list and rate limit).

**Client (Vitest + Testing Library):** PeerManager (single connection per peer, ICE queueing, answer generation, polite/impolite glare handling, cleanup), chat XSS safety and error display, every control-bar button, host-only controls, media-error mapping.

## Playwright (client/e2e)
```powershell
cd client
npx playwright install chromium
npm run dev                                 # (or let Playwright start it)
npx playwright test e2e/smoke.spec.ts       # no backend needed
```
`call.spec.ts` runs a real two-user call with Chromium's fake camera/mic. Needs a real Supabase project (email confirmation off), two existing accounts, and the server running:
```powershell
$env:E2E_USER1_EMAIL="a@example.com"; $env:E2E_USER1_PASSWORD="..."
$env:E2E_USER2_EMAIL="b@example.com"; $env:E2E_USER2_PASSWORD="..."
npx playwright test e2e/call.spec.ts
```
> **Status:** the Playwright specs were written but **not executed** in the build environment (browser download was blocked). Run them locally and fix any selector drift.

## Manual checklist (needs real devices/browsers)
| # | Check | Pass criteria |
|---|---|---|
| 1 | Register + sign in | lands on dashboard, name shown |
| 2 | Create meeting | code `abc-defg-hij`, invite link copies |
| 3 | Second user joins (incognito) | both see each other, video moving |
| 4 | Real audio | speak, other side hears; no echo of own voice |
| 5 | Mute/unmute both sides | icon changes on the other side |
| 6 | Camera off/on both sides | avatar shows, video resumes |
| 7 | Chat both ways | instant, timestamps, history on rejoin |
| 8 | Screen share + stop via browser bar | other side sees screen; camera returns |
| 9 | Non-host cannot see host controls | no remove/end buttons |
| 10 | Leave | other side's participant count drops immediately |
| 11 | Deny camera | friendly message; can still join and watch |
| 12 | Kill server briefly / toggle Wi-Fi | "reconnecting" banner, auto-rejoin, no duplicate tile |
| 13 | Wrong meeting password | rejected with message |
| 14 | Host removes guest | guest sees "removed"; cannot rejoin |
| 15 | Phone on mobile data (HTTPS deploy) | connects; if not, configure TURN |
| 16 | `npm run build` | succeeds |
| 17 | Waiting room: create a meeting with it enabled, join as guest | guest sees "Waiting for the host"; host sees banner + Admit/Decline; admit lets guest in |
| 18 | Raise hand / reactions | hand badge on tile and in list; emoji appears for everyone for ~3.5 s |
| 19 | Quality bars | appear on remote tiles after ~4 s; throttle network in DevTools to see them drop |

Browser console tip: `chrome://webrtc-internals` shows ICE candidate pairs and whether `relay` (TURN) was used.
