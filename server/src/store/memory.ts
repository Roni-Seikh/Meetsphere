import { randomUUID } from 'node:crypto';
import { generateMeetingCode } from '../lib/codes.js';
import type {
  EventType,
  MeetingRecord,
  MeetingStore,
  MessageRecord,
  NewMeeting,
  ProfileRecord,
  Role,
} from './types.js';

interface Session {
  meetingId: string;
  userId: string;
  role: Role;
  joinedAt: string;
  leftAt: string | null;
  removedBy: string | null;
}

/** In-memory store used by automated tests (no database required). */
export class MemoryStore implements MeetingStore {
  meetings = new Map<string, MeetingRecord>();
  profiles = new Map<string, ProfileRecord>();
  sessions: Session[] = [];
  messages: MessageRecord[] = [];
  events: { meetingId: string; actorId: string | null; type: EventType }[] = [];

  addProfile(id: string, displayName: string): void {
    this.profiles.set(id, { id, display_name: displayName });
  }

  async createMeeting(input: NewMeeting): Promise<MeetingRecord> {
    const m: MeetingRecord = {
      id: randomUUID(),
      code: generateMeetingCode(),
      host_id: input.hostId,
      title: input.title,
      status: 'scheduled',
      scheduled_for: input.scheduledFor,
      access_mode: input.accessMode,
      password_hash: input.passwordHash,
      max_participants: input.maxParticipants,
      started_at: null,
      ended_at: null,
      created_at: new Date().toISOString(),
    };
    this.meetings.set(m.id, m);
    return m;
  }

  async getMeetingByCode(code: string): Promise<MeetingRecord | null> {
    return [...this.meetings.values()].find((m) => m.code === code) ?? null;
  }

  async listMeetingsForUser(userId: string): Promise<MeetingRecord[]> {
    const ids = new Set(this.sessions.filter((s) => s.userId === userId).map((s) => s.meetingId));
    return [...this.meetings.values()]
      .filter((m) => m.host_id === userId || ids.has(m.id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async getProfile(id: string): Promise<ProfileRecord | null> {
    return this.profiles.get(id) ?? null;
  }

  async getProfiles(ids: string[]): Promise<ProfileRecord[]> {
    return ids.map((i) => this.profiles.get(i)).filter((p): p is ProfileRecord => !!p);
  }

  async updateDisplayName(id: string, name: string): Promise<ProfileRecord> {
    const p = { id, display_name: name };
    this.profiles.set(id, p);
    return p;
  }

  async markLive(meetingId: string): Promise<void> {
    const m = this.meetings.get(meetingId);
    if (m && m.status === 'scheduled') {
      m.status = 'live';
      m.started_at = new Date().toISOString();
    }
  }

  async endMeeting(meetingId: string): Promise<void> {
    const m = this.meetings.get(meetingId);
    if (m && m.status !== 'ended') {
      m.status = 'ended';
      m.ended_at = new Date().toISOString();
    }
  }

  async openSession(meetingId: string, userId: string, role: Role): Promise<void> {
    await this.closeSession(meetingId, userId);
    this.sessions.push({ meetingId, userId, role, joinedAt: new Date().toISOString(), leftAt: null, removedBy: null });
  }

  async closeSession(meetingId: string, userId: string, removedBy?: string): Promise<void> {
    for (const s of this.sessions) {
      if (s.meetingId === meetingId && s.userId === userId && s.leftAt === null) {
        s.leftAt = new Date().toISOString();
        if (removedBy) s.removedBy = removedBy;
      }
    }
  }

  async closeAllSessions(meetingId: string): Promise<void> {
    for (const s of this.sessions) {
      if (s.meetingId === meetingId && s.leftAt === null) s.leftAt = new Date().toISOString();
    }
  }

  async wasRemoved(meetingId: string, userId: string): Promise<boolean> {
    return this.sessions.some((s) => s.meetingId === meetingId && s.userId === userId && s.removedBy !== null);
  }

  async hasParticipated(meetingId: string, userId: string): Promise<boolean> {
    const m = this.meetings.get(meetingId);
    return m?.host_id === userId || this.sessions.some((s) => s.meetingId === meetingId && s.userId === userId);
  }

  async addMessage(input: { meetingId: string; senderId: string; body: string }): Promise<MessageRecord> {
    const rec: MessageRecord = {
      id: randomUUID(),
      meeting_id: input.meetingId,
      sender_id: input.senderId,
      sender_name: this.profiles.get(input.senderId)?.display_name ?? 'Unknown',
      body: input.body,
      created_at: new Date().toISOString(),
    };
    this.messages.push(rec);
    return rec;
  }

  async listMessages(meetingId: string, limit: number): Promise<MessageRecord[]> {
    return this.messages.filter((m) => m.meeting_id === meetingId).slice(-limit);
  }

  async addEvent(meetingId: string, actorId: string | null, type: EventType): Promise<void> {
    this.events.push({ meetingId, actorId, type });
  }
}
