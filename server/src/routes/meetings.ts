import bcrypt from 'bcryptjs';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AppError } from '../errors.js';
import type { MeetingRecord, MeetingStore } from '../store/types.js';
import { MEETING_CODE_RE, type AuthUser } from '../types.js';

export interface MeetingsHub {
  endMeeting(meetingId: string, actorId: string | null): Promise<void>;
}

const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120),
  scheduledFor: z.string().datetime({ offset: true }).nullish(),
  password: z.string().min(4, 'Password must be at least 4 characters').max(64).nullish(),
  maxParticipants: z.number().int().min(2).max(8).default(4),
  accessMode: z.enum(['open', 'waiting_room']).default('open'),
});

function toApi(m: MeetingRecord, userId: string, hostName?: string) {
  return {
    id: m.id,
    code: m.code,
    title: m.title,
    status: m.status,
    scheduledFor: m.scheduled_for,
    startedAt: m.started_at,
    endedAt: m.ended_at,
    createdAt: m.created_at,
    maxParticipants: m.max_participants,
    hasPassword: m.password_hash !== null,
    accessMode: m.access_mode === 'waiting_room' ? 'waiting_room' : 'open',
    isHost: m.host_id === userId,
    hostName: hostName ?? null,
  };
}

function user(req: Request): AuthUser {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  return req.user;
}

function codeParam(req: Request): string {
  const code = String(req.params.code ?? '').toLowerCase();
  if (!MEETING_CODE_RE.test(code)) throw new AppError(404, 'NOT_FOUND', 'Meeting not found.');
  return code;
}

export function meetingsRouter(store: MeetingStore, hub: MeetingsHub): Router {
  const router = Router();

  const createLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? 'anon',
    validate: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many meetings created. Try again later.' } },
  });

  router.get('/', async (req, res) => {
    const u = user(req);
    const meetings = await store.listMeetingsForUser(u.id);
    const hosts = await store.getProfiles([...new Set(meetings.map((m) => m.host_id))]);
    const names = new Map(hosts.map((h) => [h.id, h.display_name]));
    res.json({ meetings: meetings.map((m) => toApi(m, u.id, names.get(m.host_id))) });
  });

  router.post('/', createLimiter, async (req, res) => {
    const u = user(req);
    const input = createSchema.parse(req.body);
    const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : null;
    const meeting = await store.createMeeting({
      hostId: u.id,
      title: input.title,
      scheduledFor: input.scheduledFor ?? null,
      passwordHash,
      maxParticipants: input.maxParticipants,
      accessMode: input.accessMode,
    });
    await store.addEvent(meeting.id, u.id, 'created');
    res.status(201).json({ meeting: toApi(meeting, u.id, u.name) });
  });

  // Lobby info. Never returns the password hash; only whether a password is required.
  router.get('/:code', async (req, res) => {
    const u = user(req);
    const meeting = await store.getMeetingByCode(codeParam(req));
    if (!meeting) throw new AppError(404, 'NOT_FOUND', 'Meeting not found.');
    const host = await store.getProfile(meeting.host_id);
    res.json({ meeting: toApi(meeting, u.id, host?.display_name) });
  });

  // Chat history is limited to the host and people who actually took part.
  router.get('/:code/messages', async (req, res) => {
    const u = user(req);
    const meeting = await store.getMeetingByCode(codeParam(req));
    if (!meeting) throw new AppError(404, 'NOT_FOUND', 'Meeting not found.');
    if (!(await store.hasParticipated(meeting.id, u.id))) {
      throw new AppError(403, 'FORBIDDEN', 'You did not take part in this meeting.');
    }
    const messages = await store.listMessages(meeting.id, 200);
    res.json({
      messages: messages.map((m) => ({
        id: m.id,
        senderId: m.sender_id,
        senderName: m.sender_name,
        body: m.body,
        createdAt: m.created_at,
      })),
    });
  });

  // Host closes the meeting for everybody.
  router.post('/:code/end', async (req, res) => {
    const u = user(req);
    const meeting = await store.getMeetingByCode(codeParam(req));
    if (!meeting) throw new AppError(404, 'NOT_FOUND', 'Meeting not found.');
    if (meeting.host_id !== u.id) throw new AppError(403, 'FORBIDDEN', 'Only the host can end this meeting.');
    if (meeting.status === 'ended') throw new AppError(409, 'MEETING_ENDED', 'This meeting has already ended.');
    await hub.endMeeting(meeting.id, u.id);
    res.json({ ok: true });
  });

  return router;
}
