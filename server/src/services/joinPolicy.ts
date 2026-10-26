import bcrypt from 'bcryptjs';
import { AppError } from '../errors.js';
import type { MeetingRecord, MeetingStore, Role } from '../store/types.js';
import type { AuthUser } from '../types.js';

/**
 * Server-side decision on whether a user may enter a meeting, and with which role.
 * The role comes ONLY from the database (host_id), never from the client.
 */
export async function authorizeJoin(
  store: MeetingStore,
  meeting: MeetingRecord,
  user: AuthUser,
  password?: string,
): Promise<Role> {
  if (meeting.status === 'ended') {
    throw new AppError(410, 'MEETING_ENDED', 'This meeting has ended.');
  }
  if (await store.wasRemoved(meeting.id, user.id)) {
    throw new AppError(403, 'REMOVED', 'You were removed from this meeting by the host.');
  }
  if (meeting.host_id === user.id) return 'host';
  if (meeting.status === 'scheduled') {
    throw new AppError(409, 'NOT_STARTED', 'The host has not started this meeting yet. Try again in a moment.');
  }
  if (meeting.password_hash) {
    const ok = password ? await bcrypt.compare(password, meeting.password_hash) : false;
    if (!ok) throw new AppError(403, 'BAD_PASSWORD', 'Incorrect meeting password.');
  }
  return 'participant';
}
