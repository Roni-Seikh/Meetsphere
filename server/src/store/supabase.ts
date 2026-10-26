import type { SupabaseClient } from '@supabase/supabase-js';
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

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`Database error (${context}): ${error?.message ?? 'unknown'}`);
}

/** Supabase (Postgres) implementation. Uses the service-role client, so it bypasses RLS: the
 * server itself is responsible for authorization before calling any method here. */
export function createSupabaseStore(db: SupabaseClient): MeetingStore {
  return {
    async createMeeting(input: NewMeeting): Promise<MeetingRecord> {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await db
          .from('meetings')
          .insert({
            code: generateMeetingCode(),
            host_id: input.hostId,
            title: input.title,
            scheduled_for: input.scheduledFor,
            password_hash: input.passwordHash,
            max_participants: input.maxParticipants,
            access_mode: input.accessMode,
          })
          .select()
          .single();
        if (!error && data) return data as MeetingRecord;
        if (error?.code !== '23505') fail('createMeeting', error); // retry only on code collision
      }
      throw new Error('Could not allocate a unique meeting code');
    },

    async getMeetingByCode(code) {
      const { data, error } = await db.from('meetings').select('*').eq('code', code).maybeSingle();
      if (error) fail('getMeetingByCode', error);
      return (data as MeetingRecord | null) ?? null;
    },

    async listMeetingsForUser(userId) {
      const [hosted, parts] = await Promise.all([
        db.from('meetings').select('*').eq('host_id', userId).order('created_at', { ascending: false }).limit(100),
        db.from('meeting_participants').select('meeting_id').eq('user_id', userId).limit(200),
      ]);
      if (hosted.error) fail('listHosted', hosted.error);
      if (parts.error) fail('listParticipated', parts.error);
      const hostedIds = new Set((hosted.data ?? []).map((m) => m.id as string));
      const otherIds = [...new Set((parts.data ?? []).map((p) => p.meeting_id as string))].filter((id) => !hostedIds.has(id));
      let others: MeetingRecord[] = [];
      if (otherIds.length > 0) {
        const res = await db.from('meetings').select('*').in('id', otherIds);
        if (res.error) fail('listOthers', res.error);
        others = (res.data ?? []) as MeetingRecord[];
      }
      return [...((hosted.data ?? []) as MeetingRecord[]), ...others]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 100);
    },

    async getProfile(id) {
      const { data, error } = await db.from('profiles').select('id, display_name').eq('id', id).maybeSingle();
      if (error) fail('getProfile', error);
      return (data as ProfileRecord | null) ?? null;
    },

    async getProfiles(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await db.from('profiles').select('id, display_name').in('id', ids);
      if (error) fail('getProfiles', error);
      return (data ?? []) as ProfileRecord[];
    },

    async updateDisplayName(id, name) {
      const { data, error } = await db
        .from('profiles')
        .update({ display_name: name, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id, display_name')
        .single();
      if (error || !data) fail('updateDisplayName', error);
      return data as ProfileRecord;
    },

    async markLive(meetingId) {
      const { error } = await db
        .from('meetings')
        .update({ status: 'live', started_at: new Date().toISOString() })
        .eq('id', meetingId)
        .eq('status', 'scheduled');
      if (error) fail('markLive', error);
    },

    async endMeeting(meetingId) {
      const { error } = await db
        .from('meetings')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', meetingId)
        .neq('status', 'ended');
      if (error) fail('endMeeting', error);
    },

    async openSession(meetingId, userId, role: Role) {
      // Close any stale open session first so the partial unique index (one open session) holds.
      await this.closeSession(meetingId, userId);
      const { error } = await db.from('meeting_participants').insert({ meeting_id: meetingId, user_id: userId, role });
      if (error) fail('openSession', error);
    },

    async closeSession(meetingId, userId, removedBy) {
      const patch: Record<string, unknown> = { left_at: new Date().toISOString() };
      if (removedBy) patch.removed_by = removedBy;
      const { error } = await db
        .from('meeting_participants')
        .update(patch)
        .eq('meeting_id', meetingId)
        .eq('user_id', userId)
        .is('left_at', null);
      if (error) fail('closeSession', error);
    },

    async closeAllSessions(meetingId) {
      const { error } = await db
        .from('meeting_participants')
        .update({ left_at: new Date().toISOString() })
        .eq('meeting_id', meetingId)
        .is('left_at', null);
      if (error) fail('closeAllSessions', error);
    },

    async wasRemoved(meetingId, userId) {
      const { data, error } = await db
        .from('meeting_participants')
        .select('id')
        .eq('meeting_id', meetingId)
        .eq('user_id', userId)
        .not('removed_by', 'is', null)
        .limit(1);
      if (error) fail('wasRemoved', error);
      return (data ?? []).length > 0;
    },

    async hasParticipated(meetingId, userId) {
      const { data, error } = await db
        .from('meeting_participants')
        .select('id')
        .eq('meeting_id', meetingId)
        .eq('user_id', userId)
        .limit(1);
      if (error) fail('hasParticipated', error);
      return (data ?? []).length > 0;
    },

    async addMessage({ meetingId, senderId, body }) {
      const { data, error } = await db
        .from('meeting_messages')
        .insert({ meeting_id: meetingId, sender_id: senderId, body })
        .select('id, meeting_id, sender_id, body, created_at, profiles:sender_id(display_name)')
        .single();
      if (error || !data) fail('addMessage', error);
      return toMessage(data as unknown as RawMessage);
    },

    async listMessages(meetingId, limit) {
      const { data, error } = await db
        .from('meeting_messages')
        .select('id, meeting_id, sender_id, body, created_at, profiles:sender_id(display_name)')
        .eq('meeting_id', meetingId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) fail('listMessages', error);
      return ((data ?? []) as unknown as RawMessage[]).map(toMessage).reverse();
    },

    async addEvent(meetingId, actorId, type: EventType, meta = {}) {
      const { error } = await db.from('meeting_events').insert({ meeting_id: meetingId, actor_id: actorId, type, meta });
      if (error) fail('addEvent', error);
    },
  };
}

interface RawMessage {
  id: string;
  meeting_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  profiles: { display_name: string } | { display_name: string }[] | null;
}

function toMessage(r: RawMessage): MessageRecord {
  const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
  return {
    id: r.id,
    meeting_id: r.meeting_id,
    sender_id: r.sender_id,
    sender_name: profile?.display_name ?? 'Unknown',
    body: r.body,
    created_at: r.created_at,
  };
}
