import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { AppError } from '../errors.js';
import type { Logger } from '../lib/logger.js';
import { TokenBucket } from '../lib/tokenBucket.js';
import { authorizeJoin } from '../services/joinPolicy.js';
import type { MeetingStore, MessageRecord } from '../store/types.js';
import { type Authenticator, type AuthUser, type IceServerConfig, MEETING_CODE_RE } from '../types.js';
import { RoomRegistry, toPublic, type PublicPeer } from './registry.js';

// ---------- Event contracts ----------
export interface ChatPayload {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface JoinOk {
  ok: true;
  self: PublicPeer;
  peers: PublicPeer[];
  iceServers: IceServerConfig[];
  messages: ChatPayload[];
  meeting: { id: string; code: string; title: string; startedAt: string | null; maxParticipants: number };
}
export interface JoinWaiting {
  ok: true;
  waiting: true;
  meeting: { code: string; title: string };
}
export interface JoinErr {
  ok: false;
  code: string;
  error: string;
}
export type JoinResult = JoinOk | JoinWaiting | JoinErr;

export const REACTIONS = ['👍', '👏', '🎉', '😂', '😮', '🙌'] as const;
type SimpleAck = (r: { ok: boolean; error?: string }) => void;

export interface ClientToServerEvents {
  'room:join': (payload: unknown, ack: (r: JoinResult) => void) => void;
  'room:leave': () => void;
  'signal:description': (payload: unknown) => void;
  'signal:ice': (payload: unknown) => void;
  'chat:send': (payload: unknown, ack?: SimpleAck) => void;
  'media:state': (payload: unknown) => void;
  'host:remove': (payload: unknown, ack?: SimpleAck) => void;
  'host:end': (ack?: SimpleAck) => void;
  'host:admit': (payload: unknown, ack?: SimpleAck) => void;
  'host:deny': (payload: unknown, ack?: SimpleAck) => void;
  'hand:set': (payload: unknown) => void;
  'reaction:send': (payload: unknown) => void;
}

export interface ServerToClientEvents {
  'peer:joined': (peer: PublicPeer) => void;
  'peer:left': (p: { userId: string }) => void;
  'signal:description': (p: { from: string; data: unknown }) => void;
  'signal:ice': (p: { from: string; data: unknown }) => void;
  'chat:message': (m: ChatPayload) => void;
  'media:state': (p: { userId: string; audio: boolean; video: boolean; screen: boolean }) => void;
  'room:ended': () => void;
  'room:removed': () => void;
  'room:replaced': () => void;
  'waiting:list': (list: { userId: string; name: string }[]) => void;
  'waiting:admitted': () => void;
  'waiting:denied': () => void;
  'hand:state': (p: { userId: string; raised: boolean }) => void;
  reaction: (p: { userId: string; name: string; emoji: string }) => void;
}

export interface SocketData {
  user: AuthUser;
  meetingId?: string;
  code?: string;
  waitingFor?: string;
  reactionLimiter: TokenBucket;
  chatLimiter: TokenBucket;
  signalLimiter: TokenBucket;
  joinLimiter: TokenBucket;
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

// ---------- Validation ----------
const joinSchema = z.object({
  code: z.string().regex(MEETING_CODE_RE),
  password: z.string().max(64).optional(),
  media: z.object({ audio: z.boolean(), video: z.boolean() }).optional(),
});
const descriptionSchema = z.object({
  to: z.string().min(1).max(64),
  data: z.object({
    type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
    sdp: z.string().max(60_000).optional(),
  }),
});
const iceSchema = z.object({
  to: z.string().min(1).max(64),
  data: z.object({
    candidate: z.string().max(2_000).optional(),
    sdpMid: z.string().max(64).nullish(),
    sdpMLineIndex: z.number().int().min(0).max(64).nullish(),
    usernameFragment: z.string().max(64).nullish(),
  }),
});
const chatSchema = z.object({ body: z.string().trim().min(1).max(2_000) });
const mediaSchema = z.object({ audio: z.boolean(), video: z.boolean(), screen: z.boolean() });
const removeSchema = z.object({ userId: z.string().min(1).max(64) });
const handSchema = z.object({ raised: z.boolean() });
const reactionSchema = z.object({ emoji: z.enum(REACTIONS) });

export interface SignallingDeps {
  store: MeetingStore;
  authenticate: Authenticator;
  origins: string[];
  iceServers: IceServerConfig[];
  logger: Logger;
  /** How long an empty room stays open before the meeting is marked ended (supports page refresh). */
  emptyRoomGraceMs?: number;
}

export interface Signalling {
  io: IO;
  registry: RoomRegistry;
  endMeeting(meetingId: string, actorId: string | null): Promise<void>;
  shutdown(): Promise<void>;
}

const roomName = (meetingId: string) => `room:${meetingId}`;
const toChat = (m: MessageRecord): ChatPayload => ({
  id: m.id,
  senderId: m.sender_id,
  senderName: m.sender_name,
  body: m.body,
  createdAt: m.created_at,
});

export function createSignalling(httpServer: HttpServer, deps: SignallingDeps): Signalling {
  const { store, authenticate, logger } = deps;
  const graceMs = deps.emptyRoomGraceMs ?? 120_000;
  const registry = new RoomRegistry();
  const endTimers = new Map<string, NodeJS.Timeout>();

  const io: IO = new Server(httpServer, {
    cors: { origin: deps.origins, credentials: true },
    maxHttpBufferSize: 100_000,
    pingInterval: 10_000,
    pingTimeout: 10_000,
  });

  // ---- Authentication: the user identity comes only from a verified token ----
  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      if (typeof token !== 'string' || token.length < 10 || token.length > 4_096) {
        return next(new Error('unauthorized'));
      }
      const user = await authenticate(token);
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      socket.data.chatLimiter = new TokenBucket(5, 1); // burst 5, then 1 msg/sec
      socket.data.signalLimiter = new TokenBucket(200, 100);
      socket.data.reactionLimiter = new TokenBucket(4, 1);
      socket.data.joinLimiter = new TokenBucket(5, 5 / 60); // brute-force guard for meeting passwords
      next();
    } catch (err) {
      logger.error({ err }, 'socket auth failure');
      next(new Error('unauthorized'));
    }
  });

  /** Tell every host currently in the room who is waiting at the door. */
  function sendWaitingList(meetingId: string): void {
    const list = registry.listWaiting(meetingId).map((w) => ({ userId: w.userId, name: w.name }));
    for (const p of registry.peers(meetingId)) {
      if (p.role === 'host') io.to(p.socketId).emit('waiting:list', list);
    }
  }

  /** Remove this socket from the waiting list (if it is waiting). */
  function leaveWaiting(socket: AppSocket): void {
    const meetingId = socket.data.waitingFor;
    if (!meetingId) return;
    socket.data.waitingFor = undefined;
    if (registry.removeWaiting(meetingId, socket.data.user.id, socket.id)) sendWaitingList(meetingId);
  }

  /** Everyone still waiting is told the meeting is over (host ended it or the room emptied). */
  function closeWaiting(meetingId: string): void {
    for (const w of registry.clearWaiting(meetingId)) {
      const s = io.sockets.sockets.get(w.socketId);
      if (s) {
        s.data.waitingFor = undefined;
        s.emit('room:ended');
      }
    }
  }

  function cancelEndTimer(meetingId: string): void {
    const t = endTimers.get(meetingId);
    if (t) clearTimeout(t);
    endTimers.delete(meetingId);
  }

  function scheduleEnd(meetingId: string): void {
    cancelEndTimer(meetingId);
    const t = setTimeout(() => {
      endTimers.delete(meetingId);
      if (registry.size(meetingId) === 0) {
        closeWaiting(meetingId);
        store
          .endMeeting(meetingId)
          .then(() => store.addEvent(meetingId, null, 'ended', { reason: 'empty' }))
          .catch((err) => logger.error({ err, meetingId }, 'failed to end empty meeting'));
      }
    }, graceMs);
    t.unref();
    endTimers.set(meetingId, t);
  }

  async function leaveRoom(socket: AppSocket): Promise<void> {
    const { meetingId, user } = socket.data;
    if (!meetingId) return;
    socket.data.meetingId = undefined;
    socket.data.code = undefined;
    void socket.leave(roomName(meetingId));
    const removed = registry.leave(meetingId, user.id, socket.id);
    if (!removed) return; // this socket was already replaced by a newer one
    socket.to(roomName(meetingId)).emit('peer:left', { userId: user.id });
    try {
      await store.closeSession(meetingId, user.id);
      await store.addEvent(meetingId, user.id, 'left');
    } catch (err) {
      logger.error({ err, meetingId }, 'failed to persist leave');
    }
    if (registry.size(meetingId) === 0) scheduleEnd(meetingId);
  }

  async function endMeeting(meetingId: string, actorId: string | null): Promise<void> {
    cancelEndTimer(meetingId);
    io.to(roomName(meetingId)).emit('room:ended');
    closeWaiting(meetingId);
    const members = registry.clear(meetingId);
    for (const m of members) {
      const s = io.sockets.sockets.get(m.socketId);
      if (s) {
        s.data.meetingId = undefined;
        s.data.code = undefined;
        void s.leave(roomName(meetingId));
      }
    }
    await store.endMeeting(meetingId);
    await store.closeAllSessions(meetingId);
    await store.addEvent(meetingId, actorId, 'ended', { reason: 'host' });
  }

  io.on('connection', (socket: AppSocket) => {
    const user = socket.data.user;

    socket.on('room:join', async (raw, ack) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      try {
        if (!socket.data.joinLimiter.take()) {
          throw new AppError(429, 'RATE_LIMITED', 'Too many join attempts. Please wait a minute.');
        }
        const parsed = joinSchema.safeParse(raw);
        if (!parsed.success) throw new AppError(400, 'BAD_REQUEST', 'Invalid join request.');
        const { code, password, media } = parsed.data;

        leaveWaiting(socket);
        if (socket.data.meetingId) await leaveRoom(socket);

        const meeting = await store.getMeetingByCode(code);
        if (!meeting) throw new AppError(404, 'NOT_FOUND', 'Meeting not found.');
        const role = await authorizeJoin(store, meeting, user, password);

        // Waiting room: guests (never the host) must be admitted by the host first.
        if (
          meeting.access_mode === 'waiting_room' &&
          role !== 'host' &&
          !registry.get(meeting.id, user.id) &&
          !registry.isAdmitted(meeting.id, user.id)
        ) {
          const replaced = registry.addWaiting(meeting.id, { userId: user.id, name: user.name, socketId: socket.id });
          if (replaced) {
            const old = io.sockets.sockets.get(replaced.socketId);
            if (old) old.data.waitingFor = undefined;
          }
          socket.data.waitingFor = meeting.id;
          sendWaitingList(meeting.id);
          return reply({ ok: true, waiting: true, meeting: { code: meeting.code, title: meeting.title } });
        }

        // Capacity check + registry insert are synchronous (no await in between) => no race.
        const already = registry.get(meeting.id, user.id);
        if (!already && registry.size(meeting.id) >= meeting.max_participants) {
          throw new AppError(409, 'ROOM_FULL', 'This meeting is full.');
        }
        const { evicted } = registry.join(meeting.id, {
          userId: user.id,
          name: user.name,
          role,
          socketId: socket.id,
          audio: media?.audio ?? true,
          video: media?.video ?? true,
          screen: false,
          hand: false,
          joinedAt: Date.now(),
        });

        if (evicted) {
          const old = io.sockets.sockets.get(evicted.socketId);
          if (old) {
            old.data.meetingId = undefined;
            old.data.code = undefined;
            void old.leave(roomName(meeting.id));
            old.emit('room:replaced');
          }
        }

        socket.data.meetingId = meeting.id;
        socket.data.code = meeting.code;
        await socket.join(roomName(meeting.id));
        cancelEndTimer(meeting.id);

        try {
          if (!evicted) await store.openSession(meeting.id, user.id, role);
          if (role === 'host' && meeting.status === 'scheduled') {
            await store.markLive(meeting.id);
            await store.addEvent(meeting.id, user.id, 'started');
          }
          if (!evicted) await store.addEvent(meeting.id, user.id, 'joined');
        } catch (err) {
          // Roll back in-memory membership so state never diverges from persistence.
          registry.leave(meeting.id, user.id, socket.id);
          socket.data.meetingId = undefined;
          void socket.leave(roomName(meeting.id));
          throw err;
        }

        const fresh = (await store.getMeetingByCode(code)) ?? meeting;
        const history = await store.listMessages(meeting.id, 50);
        const self = registry.get(meeting.id, user.id)!;
        const peers = registry.peers(meeting.id).filter((p) => p.userId !== user.id).map(toPublic);

        reply({
          ok: true,
          self: toPublic(self),
          peers,
          iceServers: deps.iceServers,
          messages: history.map(toChat),
          meeting: {
            id: fresh.id,
            code: fresh.code,
            title: fresh.title,
            startedAt: fresh.started_at,
            maxParticipants: fresh.max_participants,
          },
        });

        if (evicted) socket.to(roomName(meeting.id)).emit('peer:left', { userId: user.id });
        socket.to(roomName(meeting.id)).emit('peer:joined', toPublic(self));
        if (role === 'host') sendWaitingList(meeting.id);
      } catch (err) {
        if (err instanceof AppError) {
          reply({ ok: false, code: err.code, error: err.message });
        } else {
          logger.error({ err }, 'room:join failed');
          reply({ ok: false, code: 'INTERNAL', error: 'Could not join the meeting. Please try again.' });
        }
      }
    });

    socket.on('room:leave', () => {
      void leaveRoom(socket);
    });

    // ---- WebRTC signalling relay. The server only forwards; "from" is set by the server. ----
    function relay(event: 'signal:description' | 'signal:ice', raw: unknown): void {
      const meetingId = socket.data.meetingId;
      if (!meetingId || !socket.data.signalLimiter.take()) return;
      const parsed = (event === 'signal:description' ? descriptionSchema : iceSchema).safeParse(raw);
      if (!parsed.success) return;
      const sender = registry.get(meetingId, user.id);
      const target = registry.get(meetingId, parsed.data.to);
      if (!sender || sender.socketId !== socket.id || !target) return; // must share a room
      io.to(target.socketId).emit(event, { from: user.id, data: parsed.data.data });
    }
    socket.on('signal:description', (raw) => relay('signal:description', raw));
    socket.on('signal:ice', (raw) => relay('signal:ice', raw));

    // ---- Chat ----
    socket.on('chat:send', async (raw, ack) => {
      const reply: SimpleAck = typeof ack === 'function' ? ack : () => undefined;
      const meetingId = socket.data.meetingId;
      if (!meetingId || registry.get(meetingId, user.id)?.socketId !== socket.id) {
        return reply({ ok: false, error: 'You are not in this meeting.' });
      }
      if (!socket.data.chatLimiter.take()) return reply({ ok: false, error: 'You are sending messages too fast.' });
      const parsed = chatSchema.safeParse(raw);
      if (!parsed.success) return reply({ ok: false, error: 'Message must be 1-2000 characters.' });
      try {
        const rec = await store.addMessage({ meetingId, senderId: user.id, body: parsed.data.body });
        io.to(roomName(meetingId)).emit('chat:message', toChat({ ...rec, sender_name: user.name }));
        reply({ ok: true });
      } catch (err) {
        logger.error({ err, meetingId }, 'failed to save chat message');
        reply({ ok: false, error: 'Message could not be sent.' });
      }
    });

    // ---- Media indicators ----
    socket.on('media:state', (raw) => {
      const meetingId = socket.data.meetingId;
      const parsed = mediaSchema.safeParse(raw);
      if (!meetingId || !parsed.success) return;
      const me = registry.get(meetingId, user.id);
      if (!me || me.socketId !== socket.id) return;
      const wasSharing = me.screen;
      registry.updateMedia(meetingId, user.id, parsed.data);
      socket.to(roomName(meetingId)).emit('media:state', { userId: user.id, ...parsed.data });
      if (wasSharing !== parsed.data.screen) {
        void store
          .addEvent(meetingId, user.id, parsed.data.screen ? 'screen_share_started' : 'screen_share_stopped')
          .catch((err) => logger.error({ err }, 'failed to log screen share event'));
      }
    });

    // ---- Host-only controls (role comes from the server-side registry) ----
    socket.on('host:remove', async (raw, ack) => {
      const reply: SimpleAck = typeof ack === 'function' ? ack : () => undefined;
      const meetingId = socket.data.meetingId;
      const me = meetingId ? registry.get(meetingId, user.id) : undefined;
      if (!meetingId || !me || me.socketId !== socket.id || me.role !== 'host') {
        return reply({ ok: false, error: 'Only the host can remove participants.' });
      }
      const parsed = removeSchema.safeParse(raw);
      if (!parsed.success) return reply({ ok: false, error: 'Invalid request.' });
      const target = registry.get(meetingId, parsed.data.userId);
      if (!target || target.userId === user.id) return reply({ ok: false, error: 'Participant not found.' });
      registry.leave(meetingId, target.userId, target.socketId);
      const ts = io.sockets.sockets.get(target.socketId);
      if (ts) {
        ts.data.meetingId = undefined;
        ts.data.code = undefined;
        ts.emit('room:removed');
        void ts.leave(roomName(meetingId));
      }
      io.to(roomName(meetingId)).emit('peer:left', { userId: target.userId });
      try {
        await store.closeSession(meetingId, target.userId, user.id);
        await store.addEvent(meetingId, user.id, 'removed', { target: target.userId });
      } catch (err) {
        logger.error({ err, meetingId }, 'failed to persist removal');
      }
      reply({ ok: true });
    });

    socket.on('host:end', async (ack) => {
      const reply: SimpleAck = typeof ack === 'function' ? ack : () => undefined;
      const meetingId = socket.data.meetingId;
      const me = meetingId ? registry.get(meetingId, user.id) : undefined;
      if (!meetingId || !me || me.socketId !== socket.id || me.role !== 'host') {
        return reply({ ok: false, error: 'Only the host can end the meeting.' });
      }
      try {
        await endMeeting(meetingId, user.id);
        reply({ ok: true });
      } catch (err) {
        logger.error({ err, meetingId }, 'failed to end meeting');
        reply({ ok: false, error: 'Could not end the meeting.' });
      }
    });

    function hostContext(): { meetingId: string } | null {
      const meetingId = socket.data.meetingId;
      const me = meetingId ? registry.get(meetingId, user.id) : undefined;
      if (!meetingId || !me || me.socketId !== socket.id || me.role !== 'host') return null;
      return { meetingId };
    }

    socket.on('host:admit', (raw, ack) => {
      const reply: SimpleAck = typeof ack === 'function' ? ack : () => undefined;
      const ctx = hostContext();
      if (!ctx) return reply({ ok: false, error: 'Only the host can admit guests.' });
      const parsed = removeSchema.safeParse(raw);
      if (!parsed.success) return reply({ ok: false, error: 'Invalid request.' });
      const w = registry.getWaiting(ctx.meetingId, parsed.data.userId);
      if (!w) return reply({ ok: false, error: 'That person is no longer waiting.' });
      registry.removeWaiting(ctx.meetingId, w.userId);
      registry.admit(ctx.meetingId, w.userId);
      const ws = io.sockets.sockets.get(w.socketId);
      if (ws) {
        ws.data.waitingFor = undefined;
        ws.emit('waiting:admitted');
      }
      sendWaitingList(ctx.meetingId);
      reply({ ok: true });
    });

    socket.on('host:deny', (raw, ack) => {
      const reply: SimpleAck = typeof ack === 'function' ? ack : () => undefined;
      const ctx = hostContext();
      if (!ctx) return reply({ ok: false, error: 'Only the host can decline guests.' });
      const parsed = removeSchema.safeParse(raw);
      if (!parsed.success) return reply({ ok: false, error: 'Invalid request.' });
      const w = registry.getWaiting(ctx.meetingId, parsed.data.userId);
      if (!w) return reply({ ok: false, error: 'That person is no longer waiting.' });
      registry.removeWaiting(ctx.meetingId, w.userId);
      const ws = io.sockets.sockets.get(w.socketId);
      if (ws) {
        ws.data.waitingFor = undefined;
        ws.emit('waiting:denied');
      }
      sendWaitingList(ctx.meetingId);
      reply({ ok: true });
    });

    // ---- Raise hand / reactions ----
    socket.on('hand:set', (raw) => {
      const meetingId = socket.data.meetingId;
      const parsed = handSchema.safeParse(raw);
      if (!meetingId || !parsed.success) return;
      const me = registry.get(meetingId, user.id);
      if (!me || me.socketId !== socket.id) return;
      registry.updateMedia(meetingId, user.id, { hand: parsed.data.raised });
      socket.to(roomName(meetingId)).emit('hand:state', { userId: user.id, raised: parsed.data.raised });
    });

    socket.on('reaction:send', (raw) => {
      const meetingId = socket.data.meetingId;
      if (!meetingId || !socket.data.reactionLimiter.take()) return;
      const parsed = reactionSchema.safeParse(raw);
      if (!parsed.success) return;
      const me = registry.get(meetingId, user.id);
      if (!me || me.socketId !== socket.id) return;
      io.to(roomName(meetingId)).emit('reaction', { userId: user.id, name: user.name, emoji: parsed.data.emoji });
    });

    socket.on('disconnect', () => {
      leaveWaiting(socket);
      void leaveRoom(socket);
    });
  });

  return {
    io,
    registry,
    endMeeting,
    async shutdown() {
      for (const t of endTimers.values()) clearTimeout(t);
      endTimers.clear();
      await new Promise<void>((resolve) => {
        void io.close(() => resolve());
      });
    },
  };
}
