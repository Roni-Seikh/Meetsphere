# MeetSphere – Architecture (v0.1, planning)

## 1. Responsibilities
- **Client (React + Vite + TS):** UI, Supabase Auth login (gets a JWT), capture media (getUserMedia / getDisplayMedia), own the RTCPeerConnections, render streams.
- **Server (Express + Socket.IO + TS):** verifies the Supabase JWT, REST API for meetings, authoritative room/participant state, relays signalling messages, persists chat/history, enforces roles. **Never carries media.**
- **Supabase:** Postgres + Auth. RLS is defence-in-depth; the server (service-role key) is the primary authorization layer.
- **Media path:** browser <-> browser (WebRTC, DTLS-SRTP encrypted), via STUN, or TURN relay when NAT blocks direct paths.

## 2. Auth & authorization
1. Client signs in with Supabase Auth -> access token (JWT).
2. REST: `Authorization: Bearer <jwt>`; Socket.IO: token in `handshake.auth`. Server verifies with `supabase.auth.getUser(token)`.
3. Server derives `userId` from the verified token only. Role (`host`/`participant`) is read from the DB, never from the client.

## 3. Room lifecycle
`scheduled -> live (first host join) -> ended (host closes / all leave timeout)`.
Join: REST `POST /meetings/:code/join` (checks access mode, password, capacity) -> socket `room:join`.

## 4. Signalling protocol (Socket.IO events)
Client -> Server: `room:join {code}`, `room:leave`, `signal:offer {to, sdp}`, `signal:answer {to, sdp}`, `signal:ice {to, candidate}`, `chat:send {body}`, `media:state {audio, video, screen}`, `host:remove {userId}`, `host:end`.
Server -> Client: `room:joined {self, peers[], iceServers}`, `peer:joined {peer}`, `peer:left {userId}`, `signal:*` (relayed with `from` set by server), `chat:message`, `media:state`, `room:removed`, `room:ended`, `error`.

**Glare avoidance (deterministic):** the *newcomer* receives `peers[]` and initiates offers to each existing peer; existing peers only answer. For reconnect/renegotiation collisions use the "polite peer" rule (polite = lexicographically smaller userId).
**ICE:** candidates arriving before `setRemoteDescription` are queued per peer and flushed after.
**Duplicates:** server keys sockets by `userId`; a second join from the same user evicts the old socket.

## 5. Media management
`PeerManager` (one class, map `userId -> RTCPeerConnection`) owns create/close; screen share uses `RTCRtpSender.replaceTrack` (no renegotiation); camera restored on `ended` event. Leaving stops all tracks and closes all peers.

## 6. Mesh limits
Each participant uploads N-1 streams. Default cap 4 (max 8). Media layer is isolated behind `PeerManager` so an SFU (e.g. LiveKit self-hosted) can replace it later.

## 7. Free-tier facts (checked Oct 2026)
- **Supabase Free:** 500 MB DB, 50k MAU, 5 GB egress, 2 active projects; **auto-pauses after 7 days idle** (manual restore). New explicit-grants requirement for Data API (applies to existing projects from Oct 30, 2026) – our migration includes grants.
- **Render Free web service:** spins down after 15 min without HTTP/WebSocket traffic, ~1 min cold start, 750 instance-hours/month, restarts any time (in-memory room state is lost -> clients must rejoin). Free Render Postgres expires after 30 days (we do not use it).
- **TURN:** Metered Open Relay advertises a free 20 GB/month relay tier, but terms change; verify before relying on it. A 500 MB trial is listed on Metered's paid-service page. Treat TURN as optional config. Roughly a minority of connections need it, so without TURN some network pairs will fail.
- Verify everything again before deploying.

## 8. Security notes
WebRTC media is encrypted in transit (DTLS-SRTP) but the server/TURN are not E2EE-verified endpoints; MeetSphere does **not** claim end-to-end encryption.
