import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { buildIceServers, loadEnv, parseOrigins } from '../src/config/env.js';
import { AppError } from '../src/errors.js';
import { extractMeetingCode, generateMeetingCode } from '../src/lib/codes.js';
import { TokenBucket } from '../src/lib/tokenBucket.js';
import { cachedAuthenticator } from '../src/middleware/auth.js';
import { authorizeJoin } from '../src/services/joinPolicy.js';
import { RoomRegistry, type Participant } from '../src/sockets/registry.js';
import { MemoryStore } from '../src/store/memory.js';
import { MEETING_CODE_RE } from '../src/types.js';

const p = (userId: string, socketId: string, extra: Partial<Participant> = {}): Participant => ({
  userId,
  name: userId,
  role: 'participant',
  socketId,
  audio: true,
  video: true,
  screen: false,
  hand: false,
  joinedAt: 0,
  ...extra,
});

describe('meeting codes', () => {
  it('generates codes matching the DB constraint', () => {
    for (let i = 0; i < 200; i++) expect(generateMeetingCode()).toMatch(MEETING_CODE_RE);
  });
  it('extracts a code from a bare code or invite URL', () => {
    expect(extractMeetingCode('abc-defg-hij')).toBe('abc-defg-hij');
    expect(extractMeetingCode('https://x.app/room/ABC-DEFG-HIJ?x=1')).toBe('abc-defg-hij');
    expect(extractMeetingCode('nonsense')).toBeNull();
  });
});

describe('RoomRegistry', () => {
  it('tracks participants and evicts duplicate sessions of the same user', () => {
    const r = new RoomRegistry();
    expect(r.join('m1', p('a', 's1')).evicted).toBeNull();
    expect(r.join('m1', p('b', 's2')).evicted).toBeNull();
    const res = r.join('m1', p('a', 's3'));
    expect(res.evicted?.socketId).toBe('s1');
    expect(r.size('m1')).toBe(2);
    expect(r.get('m1', 'a')?.socketId).toBe('s3');
  });
  it('ignores a stale socket leaving after a newer socket replaced it', () => {
    const r = new RoomRegistry();
    r.join('m1', p('a', 's1'));
    r.join('m1', p('a', 's2'));
    expect(r.leave('m1', 'a', 's1')).toBe(false);
    expect(r.size('m1')).toBe(1);
    expect(r.leave('m1', 'a', 's2')).toBe(true);
    expect(r.size('m1')).toBe(0);
  });
  it('isolates rooms and clears them', () => {
    const r = new RoomRegistry();
    r.join('m1', p('a', 's1'));
    r.join('m2', p('b', 's2'));
    expect(r.peers('m1').map((x) => x.userId)).toEqual(['a']);
    expect(r.clear('m1')).toHaveLength(1);
    expect(r.size('m1')).toBe(0);
    expect(r.size('m2')).toBe(1);
  });
});

describe('RoomRegistry waiting room', () => {
  it('tracks waiting guests, replaces duplicates, and only removes the current socket', () => {
    const r = new RoomRegistry();
    expect(r.addWaiting('m1', { userId: 'a', name: 'A', socketId: 's1' })).toBeNull();
    expect(r.addWaiting('m1', { userId: 'a', name: 'A', socketId: 's2' })?.socketId).toBe('s1');
    expect(r.removeWaiting('m1', 'a', 's1')).toBe(false); // stale socket
    expect(r.listWaiting('m1')).toHaveLength(1);
    expect(r.removeWaiting('m1', 'a', 's2')).toBe(true);
    expect(r.listWaiting('m1')).toHaveLength(0);
  });
  it('remembers admissions until the room is cleared', () => {
    const r = new RoomRegistry();
    r.admit('m1', 'a');
    expect(r.isAdmitted('m1', 'a')).toBe(true);
    expect(r.isAdmitted('m1', 'b')).toBe(false);
    expect(r.isAdmitted('m2', 'a')).toBe(false);
    r.clear('m1');
    expect(r.isAdmitted('m1', 'a')).toBe(false);
  });
});

describe('TokenBucket', () => {
  it('allows a burst then throttles, then refills', () => {
    let now = 0;
    const b = new TokenBucket(3, 1, () => now);
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
    now += 1000;
    expect(b.take()).toBe(true);
  });
});

describe('env validation', () => {
  const good = {
    CLIENT_ORIGIN: 'http://localhost:5173,https://app.example.com/',
    SUPABASE_URL: 'https://abc.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
  } as NodeJS.ProcessEnv;
  it('accepts valid config and applies defaults', () => {
    const env = loadEnv(good);
    expect(env.PORT).toBe(4000);
    expect(parseOrigins(env.CLIENT_ORIGIN)).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });
  it('fails fast with a readable message', () => {
    expect(() => loadEnv({} as NodeJS.ProcessEnv)).toThrow(/Invalid environment configuration/);
  });
  it('only adds TURN when fully configured', () => {
    expect(buildIceServers({ TURN_URLS: '', TURN_USERNAME: '', TURN_CREDENTIAL: '' })).toHaveLength(1);
    expect(buildIceServers({ TURN_URLS: 'turn:t.example:443', TURN_USERNAME: 'u', TURN_CREDENTIAL: 'c' })).toHaveLength(2);
  });
});

describe('cachedAuthenticator', () => {
  it('caches successful lookups only', async () => {
    let calls = 0;
    const auth = cachedAuthenticator(async (t) => {
      calls++;
      return t === 'good' ? { id: '1', name: 'A' } : null;
    });
    await auth('good');
    await auth('good');
    await auth('bad');
    await auth('bad');
    expect(calls).toBe(3);
  });
});

describe('authorizeJoin', () => {
  async function setup(password?: string) {
    const store = new MemoryStore();
    const meeting = await store.createMeeting({
      hostId: 'host',
      title: 'T',
      scheduledFor: null,
      passwordHash: password ? await bcrypt.hash(password, 4) : null,
      maxParticipants: 4,
      accessMode: 'open',
    });
    return { store, meeting };
  }
  it('gives the host role from the DB and blocks others until the host starts', async () => {
    const { store, meeting } = await setup();
    expect(await authorizeJoin(store, meeting, { id: 'host', name: 'H' })).toBe('host');
    await expect(authorizeJoin(store, meeting, { id: 'u', name: 'U' })).rejects.toMatchObject({ code: 'NOT_STARTED' });
    await store.markLive(meeting.id);
    const live = (await store.getMeetingByCode(meeting.code))!;
    expect(await authorizeJoin(store, live, { id: 'u', name: 'U' })).toBe('participant');
  });
  it('enforces the password', async () => {
    const { store, meeting } = await setup('secret1');
    await store.markLive(meeting.id);
    const live = (await store.getMeetingByCode(meeting.code))!;
    await expect(authorizeJoin(store, live, { id: 'u', name: 'U' })).rejects.toBeInstanceOf(AppError);
    await expect(authorizeJoin(store, live, { id: 'u', name: 'U' }, 'wrong')).rejects.toMatchObject({ code: 'BAD_PASSWORD' });
    expect(await authorizeJoin(store, live, { id: 'u', name: 'U' }, 'secret1')).toBe('participant');
  });
  it('rejects ended meetings and removed users', async () => {
    const { store, meeting } = await setup();
    await store.markLive(meeting.id);
    await store.openSession(meeting.id, 'u', 'participant');
    await store.closeSession(meeting.id, 'u', 'host');
    const live = (await store.getMeetingByCode(meeting.code))!;
    await expect(authorizeJoin(store, live, { id: 'u', name: 'U' })).rejects.toMatchObject({ code: 'REMOVED' });
    await store.endMeeting(meeting.id);
    const ended = (await store.getMeetingByCode(meeting.code))!;
    await expect(authorizeJoin(store, ended, { id: 'host', name: 'H' })).rejects.toMatchObject({ code: 'MEETING_ENDED' });
  });
});
