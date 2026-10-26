import type { Role } from '../store/types.js';

export interface Participant {
  userId: string;
  name: string;
  role: Role;
  socketId: string;
  audio: boolean;
  video: boolean;
  screen: boolean;
  hand: boolean;
  joinedAt: number;
}

export interface PublicPeer {
  userId: string;
  name: string;
  role: Role;
  audio: boolean;
  video: boolean;
  screen: boolean;
  hand: boolean;
}

export interface Waiting {
  userId: string;
  name: string;
  socketId: string;
}

export function toPublic(p: Participant): PublicPeer {
  return { userId: p.userId, name: p.name, role: p.role, audio: p.audio, video: p.video, screen: p.screen, hand: p.hand };
}

/**
 * Authoritative in-memory room state: meetingId -> (userId -> Participant).
 * Map lookups are O(1); listing a room is O(n) in participants (n <= 8 in this app).
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, Map<string, Participant>>();
  private readonly waiting = new Map<string, Map<string, Waiting>>();
  private readonly admitted = new Map<string, Set<string>>();

  /** Adds (or replaces) a participant. If the same user was already present on another socket,
   * the previous entry is returned as `evicted` so the caller can notify and clean it up. */
  join(meetingId: string, p: Participant): { evicted: Participant | null } {
    let room = this.rooms.get(meetingId);
    if (!room) {
      room = new Map();
      this.rooms.set(meetingId, room);
    }
    const previous = room.get(p.userId) ?? null;
    room.set(p.userId, p);
    return { evicted: previous && previous.socketId !== p.socketId ? previous : null };
  }

  /** Removes the participant only if the given socket is still the current one (prevents a stale
   * disconnect from removing a user who already rejoined on a new socket). */
  leave(meetingId: string, userId: string, socketId: string): boolean {
    const room = this.rooms.get(meetingId);
    const current = room?.get(userId);
    if (!room || !current || current.socketId !== socketId) return false;
    room.delete(userId);
    if (room.size === 0) this.rooms.delete(meetingId);
    return true;
  }

  get(meetingId: string, userId: string): Participant | undefined {
    return this.rooms.get(meetingId)?.get(userId);
  }

  peers(meetingId: string): Participant[] {
    return [...(this.rooms.get(meetingId)?.values() ?? [])];
  }

  size(meetingId: string): number {
    return this.rooms.get(meetingId)?.size ?? 0;
  }

  updateMedia(meetingId: string, userId: string, patch: Partial<Pick<Participant, 'audio' | 'video' | 'screen' | 'hand'>>): Participant | undefined {
    const p = this.get(meetingId, userId);
    if (p) Object.assign(p, patch);
    return p;
  }

  clear(meetingId: string): Participant[] {
    const all = this.peers(meetingId);
    this.rooms.delete(meetingId);
    this.admitted.delete(meetingId);
    return all;
  }

  // ---- waiting room ----
  /** Adds a guest to the waiting list (one entry per user; the newest socket wins). */
  addWaiting(meetingId: string, w: Waiting): Waiting | null {
    let list = this.waiting.get(meetingId);
    if (!list) {
      list = new Map();
      this.waiting.set(meetingId, list);
    }
    const previous = list.get(w.userId) ?? null;
    list.set(w.userId, w);
    return previous && previous.socketId !== w.socketId ? previous : null;
  }

  getWaiting(meetingId: string, userId: string): Waiting | undefined {
    return this.waiting.get(meetingId)?.get(userId);
  }

  /** Removes a waiting entry. With socketId given, only removes it if that socket is still current. */
  removeWaiting(meetingId: string, userId: string, socketId?: string): boolean {
    const list = this.waiting.get(meetingId);
    const cur = list?.get(userId);
    if (!list || !cur || (socketId !== undefined && cur.socketId !== socketId)) return false;
    list.delete(userId);
    if (list.size === 0) this.waiting.delete(meetingId);
    return true;
  }

  listWaiting(meetingId: string): Waiting[] {
    return [...(this.waiting.get(meetingId)?.values() ?? [])];
  }

  clearWaiting(meetingId: string): Waiting[] {
    const all = this.listWaiting(meetingId);
    this.waiting.delete(meetingId);
    return all;
  }

  /** Remember that the host let this user in, so reconnects do not send them back to the lobby. */
  admit(meetingId: string, userId: string): void {
    let set = this.admitted.get(meetingId);
    if (!set) {
      set = new Set();
      this.admitted.set(meetingId, set);
    }
    set.add(userId);
  }

  isAdmitted(meetingId: string, userId: string): boolean {
    return this.admitted.get(meetingId)?.has(userId) ?? false;
  }

  revokeAdmission(meetingId: string, userId: string): void {
    this.admitted.get(meetingId)?.delete(userId);
  }
}
