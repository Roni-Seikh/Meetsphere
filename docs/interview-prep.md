# Interview preparation

Understand it, don't memorise it. Open each file mentioned and trace the code while you read. Be honest about what you wrote yourself versus what you studied or generated with AI assistance, and be ready to change something live in the code.

## 60-second introduction
"MeetSphere is a browser-based video-conferencing app I built with React, TypeScript, Node, Socket.IO and Supabase. Users sign in, create a meeting, and share a link. Audio and video go directly between browsers using WebRTC, while my Node server handles signalling, meaning it relays the offers, answers and ICE candidates, and enforces who may join. It also does real-time chat saved to Postgres, screen sharing, and host controls like removing people. The hardest part was making connection setup reliable: avoiding offer collisions, queueing early ICE candidates, and cleaning up when tabs refresh or sockets drop. It has automated tests for the server rules and the peer-connection logic. It's built for small meetings; I know a mesh doesn't scale, and I can explain how an SFU would replace it."

## 5-minute demo script
1. (30 s) Landing → register/sign in. Mention Supabase Auth + JWT.
2. (45 s) Create meeting with a password; show invite link and code.
3. (60 s) Lobby preview, join as host. Open incognito as guest; wrong password first, then correct.
4. (60 s) Mute/camera toggles, indicators on the other side; chat both ways.
5. (45 s) Share screen, stop via the browser bar → camera returns.
6. (30 s) Host removes guest; guest cannot rejoin. Show history page.
7. (30 s) Open `chrome://webrtc-internals` or the code (`PeerManager.ts`) and explain glare handling; mention tests and limits (mesh, TURN).

## Hardest problem
Connection setup races. Both sides may start negotiating at once (e.g. when someone starts screen sharing), ICE candidates can arrive before the remote description, and refreshes create duplicate peers. Solutions: newcomer-initiates rule, perfect negotiation (polite/impolite by userId order), per-peer ICE queue, idempotent `ensurePeer`, server evicting duplicate sockets, and checking the socket id when handling disconnects. Tests: `PeerManager.test.ts`, `signalling.test.ts`.

## Design trade-offs
| Choice | Why | Cost |
|---|---|---|
| Mesh P2P | free, no media server | N-1 uploads each, ≤ 4 comfortable |
| Socket.IO | reconnects, acks, rooms built in | heavier than raw WS |
| In-memory rooms | simple, O(1) lookups | lost on restart, single instance |
| Service-role key + server checks | one place for rules | must never skip a check; RLS is backup |
| Modular monolith | simple to run/deploy on 8 GB laptop & free tiers | scaling later needs refactor |

## Questions and answers (tied to the code)

### Networking
1. **TCP vs UDP?** TCP is reliable and ordered (HTTP, WebSocket signalling). UDP is lossy but low-latency, so WebRTC media uses UDP (SRTP) because a late packet is useless in a live call. TURN can fall back to TCP/TLS 443 for strict firewalls.
2. **HTTP vs HTTPS?** HTTPS = HTTP over TLS: confidentiality, integrity, server authentication. Browsers require a secure context (HTTPS or localhost) for `getUserMedia`, which is why deployed demos need HTTPS.
3. **Why WebSockets for signalling?** Server must push events (`peer:joined`, SDP, ICE) instantly; polling would be slow and wasteful. Socket.IO adds reconnection, acks and rooms. See `signalling.ts`.
4. **What is NAT traversal / why needed?** Most devices have private IPs behind NAT; peers can't just connect to each other. ICE gathers candidate addresses and tests pairs.
5. **STUN vs TURN?** STUN tells a client its public address (cheap, free). TURN relays the media when direct paths fail (symmetric NAT, firewalls), costing bandwidth. Config: `buildIceServers` in `env.ts`.
6. **What is ICE?** Interactive Connectivity Establishment: collects host / server-reflexive / relay candidates, exchanges them via signalling, and picks the best working pair. Trickle ICE sends candidates as they're found (`signal:ice`).
7. **Latency, jitter, packet loss, bandwidth?** Latency = delay; jitter = variation in delay (handled by jitter buffer); loss hurts quality (concealment, FEC); bandwidth limits resolution. Mesh multiplies upload bandwidth.
8. **Is your signalling server in the media path?** No. It carries only SDP/ICE/chat. Media flows browser-to-browser or via TURN.
9. **Is the call end-to-end encrypted?** No claim. DTLS-SRTP encrypts hop-by-hop; because my server relays fingerprints, a malicious server could MITM in theory. See `security.md`.
10. **Why doesn't it work for everyone without TURN?** Roughly a small share of connections need relaying; without TURN those fail. The UI shows "Connection failed".

### Data structures & algorithms
11. **How is room state stored?** `Map<meetingId, Map<userId, Participant>>` in `RoomRegistry`. Lookup/insert/remove O(1); listing a room O(n), n ≤ 8.
12. **Why a Map of Maps rather than arrays?** Frequent lookup by userId (relay, duplicate detection); arrays would be O(n) each.
13. **Where do you use a queue?** Pending ICE candidates per peer (`pendingIce`, FIFO) flushed after `setRemoteDescription`.
14. **Where do you use a Set?** Deduplicating meeting IDs when listing a user's meetings (`listMeetingsForUser`), unique host IDs for profile lookup.
15. **Rate limiting algorithm?** Token bucket (`tokenBucket.ts`): capacity + refill rate; O(1) time/space per socket. Allows bursts but bounds sustained rate.
16. **How do you generate meeting codes safely?** `crypto.randomInt` over a reduced alphabet, 10 letters ≈ 23^10 possibilities; DB unique constraint + retry on collision. Not guessable sequentially, but not a secret, so auth + password still apply.
17. **Auth cache complexity?** Map with TTL and size cap; O(1) lookup; evicts oldest entry (insertion order).

### OOP & design
18. **Where is encapsulation?** `PeerManager` hides the RTCPeerConnection map and negotiation details behind `connectTo / handleDescription / removePeer / replaceVideoTrack`. `RoomRegistry` hides room maps.
19. **Abstraction / dependency injection?** `MeetingStore` interface with Supabase and in-memory implementations; `createApp`/`createSignalling` receive store + authenticator as parameters, which is why the tests run without a database. `PeerManager` accepts an injectable `createPeerConnection` for tests.
20. **Which SOLID principles?** SRP (registry, join policy, routes, store each separate); DIP (depend on `MeetingStore`/`Authenticator` abstractions); OCP (swap store without touching routes); ISP (small `PeerManagerOptions` callbacks).
21. **Separation of concerns?** UI components / hooks (`useMeetingRoom`, `useLocalMedia`) / WebRTC class / API client in the client; routes / services / store / sockets in the server.
22. **Error handling approach?** `AppError` with status+code, central Express error handler, Zod errors → 400, ack objects `{ok:false,error}` for sockets, friendly media-error mapping on the client.

### DBMS
23. **Explain your schema/relationships.** `profiles` 1:1 with auth users; a profile hosts many meetings; `meeting_participants` is the join table (user × meeting × session); messages and events belong to meetings. See ER diagram.
24. **Which constraints matter most?** Unique `code`, CHECKs on status/length, FKs with cascade, and the partial unique index "one open session per user per meeting".
25. **Why those indexes?** History queries by `(host_id, created_at desc)`, chat loading by `(meeting_id, created_at)`, a partial index on non-ended meetings. They turn scans into index lookups.
26. **Transactions / ACID?** Each store call is one statement; multi-step flows (close old session then open new) aren't wrapped in a transaction: the partial unique index is the safety net. Be ready to say a Postgres function (RPC) could make it atomic.
27. **How is DB security enforced?** RLS policies + explicit GRANTs for anon/authenticated; server uses service-role key and checks permissions itself; bcrypt hashes for meeting passwords.

### Backend
28. **Authentication vs authorization here?** Authn = verifying the Supabase JWT (`requireAuth`, socket middleware). Authz = what that user may do: host-only endpoints, password/removed/capacity checks in `authorizeJoin`.
29. **Why not trust client roles?** A client could claim `role: host`. The role comes from `meetings.host_id` in the DB (tested: "client-supplied roles are ignored").
30. **Middleware in your Express app?** helmet, cors, json body limit, request logger, rate limiter, `requireAuth`, router, 404, error handler: order matters.
31. **Concurrency/race: two users join the last seat simultaneously?** Capacity check and registry insert happen synchronously with no `await` between them, and Node is single-threaded, so only one wins (`ROOM_FULL` for the other).
32. **Reconnection strategy?** Socket.IO reconnects with backoff; on `connect` the client re-emits `room:join`, rebuilds peer connections; server replaces any stale socket; empty rooms linger 2 min.
33. **Why a grace period before ending an empty meeting?** So a page refresh doesn't end the meeting (`scheduleEnd`, tested).
34. **How does graceful shutdown work?** On SIGTERM close Socket.IO (which closes HTTP), force exit after 10 s.

### Waiting room, reactions, quality
41. **How does the waiting room work?** `signalling.ts`: guests are stored in `RoomRegistry.waiting` instead of the room, so they can't send chat or signals; host gets `waiting:list`; `host:admit` records an admission and the client re-joins. Tests: "waiting room" block in `signalling.test.ts`.
42. **How do you stop a guest admitting themselves?** `host:admit` runs `hostContext()`, which checks the caller's role in the server-side registry, not anything the client sends.
43. **How are reactions kept safe?** Zod enum allow-list of six emoji, per-socket token bucket, and React renders them as text.
44. **How is network quality computed?** `PeerManager.measure()` reads `getStats()`: round-trip time from the nominated candidate pair and packet loss as the delta of lost vs received packets since the last sample; `classifyQuality()` maps that to good/fair/poor.

### Security
35. **How do you prevent XSS in chat?** React renders text nodes, escaped; test injects `<img onerror>` and asserts no element is created.
36. **CORS?** Allow-list from env for REST and sockets; not `*`.
37. **CSRF?** Tokens are sent in the `Authorization` header, not cookies, so a cross-site form can't ride the session.
38. **Secret management?** Service-role & TURN credentials only in server env; `.env` ignored by git; client has only the public anon key (safe by design when RLS is on).
39. **Brute-forcing meeting passwords?** Per-socket join limiter (5 burst, 5/min refill) plus bcrypt cost.
40. **Which part is untested?** Real browser media, because the build environment had no browser; I'd cover it with the Playwright fake-device test and manual checks.

## Likely follow-ups
- "How would you scale to 50 people?" → SFU (LiveKit/mediasoup), simulcast, Redis adapter, TURN cluster.
- "How would you add recording?" → client-side `MediaRecorder` with consent broadcast, or server-side via SFU egress.
- "What if the server restarts mid-call?" → sockets reconnect, rejoin, peers rebuilt; media of existing P2P links may even survive but state resyncs.
- "How do you know the call is working?" → `getStats()` / webrtc-internals; per-tile `connectionState`.
- "What would you do with another week?" → waiting room, TURN credentials via short-lived HMAC, Redis, e2e in CI.

## Honest ownership
Write down which modules you personally modified and can explain line-by-line. If asked, say the project was built with AI assistance, and show you can read, debug and extend it. Do not memorise answers: pick one flow (join → offer → ICE → track) and be able to draw it.
