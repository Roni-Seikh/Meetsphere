# Resume / portfolio entry

Fill in the links only after they really exist. Do not add numbers you haven't measured.

**MeetSphere: Real-time Video Conferencing Web App** · [GitHub link] · [Live demo link]
*React, TypeScript, Node.js, Express, Socket.IO, WebRTC, Supabase (PostgreSQL, Auth), Tailwind CSS, Vitest, Playwright*
- Built a peer-to-peer video meeting app with WebRTC audio/video, screen sharing and live chat; implemented Socket.IO signalling (offer/answer/ICE) with glare handling and ICE-candidate queuing.
- Designed server-side authorization (JWT verification, host-only controls, password-protected rooms, rate limiting, Zod validation) and a PostgreSQL schema with row-level security and migrations.
- Wrote automated tests for signalling, access control and peer-connection logic (Vitest, Supertest, Testing Library); deployed on free-tier hosting.  *(Keep only if you actually deployed.)*

## GitHub setup and commit plan
```powershell
git init
git add .gitignore README.md docs database ; git commit -m "docs: architecture and schema"
git add server ; git commit -m "feat(server): auth, meetings API, signalling, tests"
git add client ; git commit -m "feat(client): UI, WebRTC peer manager, tests"
git add render.yaml package.json ; git commit -m "chore: deployment config"
```
Before pushing run `git status` and confirm no `.env` file is staged.

## Screenshots / GIFs
Capture: landing, dashboard, create meeting, lobby, 2-person call, chat panel, participants panel (host), history. Use Win+Shift+S for screenshots and ScreenToGif (free) for a 10-second call demo. Never show real keys or private emails.

## Demo video outline (3 min)
Problem & stack (20 s) → live two-window call (90 s) → architecture diagram & signalling explanation (45 s) → tests & limitations (25 s).
