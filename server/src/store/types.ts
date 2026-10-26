export type MeetingStatus = 'scheduled' | 'live' | 'ended';
export type Role = 'host' | 'participant';

export interface MeetingRecord {
  id: string;
  code: string;
  host_id: string;
  title: string;
  status: MeetingStatus;
  scheduled_for: string | null;
  access_mode: 'open' | 'waiting_room' | 'invite_only';
  password_hash: string | null;
  max_participants: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface ProfileRecord {
  id: string;
  display_name: string;
}

export interface MessageRecord {
  id: string;
  meeting_id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
}

export interface NewMeeting {
  hostId: string;
  title: string;
  scheduledFor: string | null;
  passwordHash: string | null;
  maxParticipants: number;
  accessMode: 'open' | 'waiting_room';
}

export type EventType =
  | 'created'
  | 'started'
  | 'joined'
  | 'left'
  | 'removed'
  | 'ended'
  | 'screen_share_started'
  | 'screen_share_stopped';

/** Persistence boundary. Supabase implementation in production, in-memory in tests. */
export interface MeetingStore {
  createMeeting(input: NewMeeting): Promise<MeetingRecord>;
  getMeetingByCode(code: string): Promise<MeetingRecord | null>;
  listMeetingsForUser(userId: string): Promise<MeetingRecord[]>;
  getProfile(id: string): Promise<ProfileRecord | null>;
  getProfiles(ids: string[]): Promise<ProfileRecord[]>;
  updateDisplayName(id: string, name: string): Promise<ProfileRecord>;
  markLive(meetingId: string): Promise<void>;
  endMeeting(meetingId: string): Promise<void>;
  openSession(meetingId: string, userId: string, role: Role): Promise<void>;
  closeSession(meetingId: string, userId: string, removedBy?: string): Promise<void>;
  closeAllSessions(meetingId: string): Promise<void>;
  wasRemoved(meetingId: string, userId: string): Promise<boolean>;
  hasParticipated(meetingId: string, userId: string): Promise<boolean>;
  addMessage(input: { meetingId: string; senderId: string; body: string }): Promise<MessageRecord>;
  listMessages(meetingId: string, limit: number): Promise<MessageRecord[]>;
  addEvent(meetingId: string, actorId: string | null, type: EventType, meta?: Record<string, unknown>): Promise<void>;
}
