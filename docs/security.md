# Security

| Area | What is implemented | Where |
|---|---|---|
| Authentication | Supabase Auth; server verifies the JWT with `auth.getUser(token)` for every REST call and socket handshake (30 s cache) | `middleware/auth.ts`, `signalling.ts` |
| Authorization | Identity and role come only from the verified token + DB (`host_id`). Client-sent role/userId/from are ignored. Host-only socket events check the server-side registry | `joinPolicy.ts`, `signalling.ts` |
| Meeting access | Code is not the only gate: auth required, optional bcrypt password, capacity, removed users blocked, ended meetings closed | `joinPolicy.ts` |
| Input validation | Zod on all REST bodies and socket payloads; size limits (20 kb JSON, 100 kb socket buffer, SDP ≤ 60 kB) | `routes/`, `signalling.ts` |
| Rate limiting | express-rate-limit (600/15 min API, 30 meetings/hour/user); token buckets for chat, signalling, joins (password brute-force) | `app.ts`, `tokenBucket.ts` |
| Headers / CORS | Helmet defaults, `x-powered-by` off, CORS allow-list from `CLIENT_ORIGIN`, same list for Socket.IO | `app.ts` |
| XSS | React escapes output; chat rendered as text (tested). No `dangerouslySetInnerHTML` | `ChatPanel.tsx` |
| CSRF | API uses `Authorization: Bearer` headers (no cookies), so classic CSRF does not apply | – |
| Secrets | Service-role key + TURN credentials only in server env; `.env*` git-ignored; client uses only the public anon key. TURN credentials reach the browser only via the authenticated join ack | `.gitignore`, `env.ts` |
| Logging | Pino with redaction; request log has method/path/status only; chat bodies and tokens never logged | `logger.ts`, `app.ts` |
| Errors | Central handler, no stack traces to clients | `middleware/error.ts` |
| DB | RLS + explicit grants, constraints, partial unique index | `0001_init.sql` |
| Shutdown | SIGTERM/SIGINT graceful close with 10 s force timeout | `index.ts` |

## WebRTC encryption ≠ end-to-end encryption
WebRTC media is encrypted hop-to-hop with DTLS-SRTP, which protects it from network eavesdroppers. Peers authenticate each other through SDP fingerprints that **the signalling server relays**, so a malicious server could in theory swap fingerprints and sit in the middle. True E2EE needs out-of-band key verification or insertable-streams with user-managed keys. MeetSphere does **not** claim E2EE; the UI says "Encrypted in transit".

## Known gaps / next steps
- Token cache means a revoked session can work for ≤ 30 s.
- Rate limits are per-process (fine for one free instance, not for horizontal scale: use Redis).
- No email-verification enforcement, MFA, or abuse reporting.
- Mesh exposes participants' IP addresses to each other (inherent to P2P WebRTC; a TURN-only/SFU design hides them).
