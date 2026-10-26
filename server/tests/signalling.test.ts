import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatPayload } from '../src/sockets/signalling.js';
import { asJoined, connectClient, join, once, sleep, startHarness, TOKENS, type Harness } from './helpers.js';

let h: Harness;
const open: Socket[] = [];
beforeAll(async () => {
  h = await startHarness(150);
});
afterEach(() => {
  while (open.length) open.pop()!.close();
});
afterAll(async () => {
  await h.close();
});

async function client(token: string | null): Promise<Socket> {
  const s = await connectClient(h.baseUrl, token);
  open.push(s);
  return s;
}

async function newMeeting(opts: { password?: string; max?: number; waiting?: boolean } = {}) {
  const bcrypt = (await import('bcryptjs')).default;
  return h.store.createMeeting({
    hostId: 'user-alice',
    title: 'Test',
    scheduledFor: null,
    passwordHash: opts.password ? await bcrypt.hash(opts.password, 4) : null,
    maxParticipants: opts.max ?? 4,
    accessMode: opts.waiting ? 'waiting_room' : 'open',
  });
}

describe('socket authentication', () => {
  it('rejects connections without a valid token', async () => {
    await expect(connectClient(h.baseUrl, null)).rejects.toThrow(/unauthorized/);
    await expect(connectClient(h.baseUrl, 'invalid-token-123')).rejects.toThrow(/unauthorized/);
  });
});

describe('joining and roles', () => {
  it('host joins, starts the meeting; role is decided by the server', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    const res = asJoined(await join(alice, m.code));
    expect(res.self.role).toBe('host');
    expect(res.peers).toEqual([]);
    expect(res.iceServers.length).toBeGreaterThan(0);
    expect((await h.store.getMeetingByCode(m.code))?.status).toBe('live');
  });

  it('a non-host cannot join before the host starts', async () => {
    const m = await newMeeting();
    const bob = await client(TOKENS.bob);
    const res = await join(bob, m.code);
    expect(res).toMatchObject({ ok: false, code: 'NOT_STARTED' });
  });

  it('client-supplied roles are ignored', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const bob = await client(TOKENS.bob);
    const res = await new Promise<{ ok: boolean; self?: { role: string } }>((r) =>
      bob.emit('room:join', { code: m.code, role: 'host', userId: 'user-alice' }, r),
    );
    expect(res.ok).toBe(true);
    expect(res.self?.role).toBe('participant');
  });

  it('enforces meeting passwords', async () => {
    const m = await newMeeting({ password: 'hunter22' });
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const bob = await client(TOKENS.bob);
    expect(await join(bob, m.code)).toMatchObject({ ok: false, code: 'BAD_PASSWORD' });
    expect(await join(bob, m.code, 'wrong-pass')).toMatchObject({ ok: false, code: 'BAD_PASSWORD' });
    expect((await join(bob, m.code, 'hunter22')).ok).toBe(true);
  });

  it('enforces capacity', async () => {
    const m = await newMeeting({ max: 2 });
    const [a, b, c] = [await client(TOKENS.alice), await client(TOKENS.bob), await client(TOKENS.carol)];
    expect((await join(a, m.code)).ok).toBe(true);
    expect((await join(b, m.code)).ok).toBe(true);
    expect(await join(c, m.code)).toMatchObject({ ok: false, code: 'ROOM_FULL' });
  });

  it('rejects malformed join payloads and unknown meetings', async () => {
    const alice = await client(TOKENS.alice);
    const bad = await new Promise((r) => alice.emit('room:join', { code: 'x' }, r));
    expect(bad).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    expect(await join(alice, 'abc-defg-hij')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('peers are announced and removed on leave (no stale state)', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const joined = once<{ userId: string; name: string }>(alice, 'peer:joined');
    const bob = await client(TOKENS.bob);
    const res = await join(bob, m.code);
    expect(asJoined(res).peers.map((p) => p.userId)).toEqual(['user-alice']);
    expect((await joined).name).toBe('Bob');
    const left = once<{ userId: string }>(alice, 'peer:left');
    bob.close();
    expect((await left).userId).toBe('user-bob');
    expect(h.signalling.registry.size(m.id)).toBe(1);
  });

  it('a second tab replaces the first without duplicating the participant', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const bob1 = await client(TOKENS.bob);
    await join(bob1, m.code);
    const replaced = once(bob1, 'room:replaced');
    const bob2 = await client(TOKENS.bob);
    await join(bob2, m.code);
    await replaced;
    expect(h.signalling.registry.peers(m.id).map((p) => p.userId).sort()).toEqual(['user-alice', 'user-bob']);
    // closing the stale socket must not remove the new session
    bob1.close();
    await sleep(100);
    expect(h.signalling.registry.get(m.id, 'user-bob')?.socketId).toBe(bob2.id);
    expect(h.store.sessions.filter((s) => s.userId === 'user-bob' && s.leftAt === null)).toHaveLength(1);
  });
});

describe('signalling relay', () => {
  it('relays descriptions and ICE only between members of the same room, with server-set sender', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const bob = await client(TOKENS.bob);
    await join(bob, m.code);

    const gotDesc = once<{ from: string; data: { type: string } }>(alice, 'signal:description');
    bob.emit('signal:description', { to: 'user-alice', data: { type: 'offer', sdp: 'v=0' }, from: 'spoofed' });
    const d = await gotDesc;
    expect(d.from).toBe('user-bob');
    expect(d.data.type).toBe('offer');

    const gotIce = once<{ from: string }>(bob, 'signal:ice');
    alice.emit('signal:ice', { to: 'user-bob', data: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 } });
    expect((await gotIce).from).toBe('user-alice');
  });

  it('does not relay to users in a different room', async () => {
    const m1 = await newMeeting();
    const m2 = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m1.code);
    const carol = await client(TOKENS.carol);
    const m2host = await h.store.createMeeting({ hostId: 'user-carol', title: 'c', scheduledFor: null, passwordHash: null, maxParticipants: 4, accessMode: 'open' });
    await join(carol, m2host.code);
    let received = false;
    carol.on('signal:description', () => (received = true));
    alice.emit('signal:description', { to: 'user-carol', data: { type: 'offer', sdp: 'x' } });
    await sleep(150);
    expect(received).toBe(false);
    void m2;
  });
});

describe('chat', () => {
  it('delivers messages to the room with sender identity and persists them', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const bob = await client(TOKENS.bob);
    await join(bob, m.code);
    const got = once<ChatPayload>(alice, 'chat:message');
    const ack = await new Promise<{ ok: boolean }>((r) => bob.emit('chat:send', { body: '  hello team  ' }, r));
    expect(ack.ok).toBe(true);
    const msg = await got;
    expect(msg.body).toBe('hello team');
    expect(msg.senderName).toBe('Bob');
    expect(msg.senderId).toBe('user-bob');
    expect(h.store.messages.some((x) => x.body === 'hello team')).toBe(true);
  });

  it('rejects empty, oversized, and out-of-room messages', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    const outsider = await client(TOKENS.dave);
    const send = (s: Socket, body: unknown) => new Promise<{ ok: boolean }>((r) => s.emit('chat:send', { body }, r));
    expect((await send(outsider, 'hi')).ok).toBe(false); // not in any room
    await join(alice, m.code);
    expect((await send(alice, '   ')).ok).toBe(false);
    expect((await send(alice, 'x'.repeat(2001))).ok).toBe(false);
    expect((await send(alice, 42)).ok).toBe(false);
  });

  it('rate-limits floods', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const results: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      results.push((await new Promise<{ ok: boolean }>((r) => alice.emit('chat:send', { body: `m${i}` }, r))).ok);
    }
    expect(results.filter(Boolean).length).toBeLessThan(10);
  });

  it('new joiners receive recent history', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    await new Promise((r) => alice.emit('chat:send', { body: 'earlier' }, r));
    const bob = await client(TOKENS.bob);
    const res = await join(bob, m.code);
    expect(asJoined(res).messages.map((x) => x.body)).toEqual(['earlier']);
  });
});

describe('host controls', () => {
  it('non-hosts cannot remove or end', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const bob = await client(TOKENS.bob);
    await join(bob, m.code);
    const rm = await new Promise<{ ok: boolean }>((r) => bob.emit('host:remove', { userId: 'user-alice' }, r));
    expect(rm.ok).toBe(false);
    const end = await new Promise<{ ok: boolean }>((r) => bob.emit('host:end', r));
    expect(end.ok).toBe(false);
    expect(h.signalling.registry.size(m.id)).toBe(2);
  });

  it('host removes a participant, who cannot rejoin', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const bob = await client(TOKENS.bob);
    await join(bob, m.code);
    const removed = once(bob, 'room:removed');
    const ack = await new Promise<{ ok: boolean }>((r) => alice.emit('host:remove', { userId: 'user-bob' }, r));
    expect(ack.ok).toBe(true);
    await removed;
    expect(h.signalling.registry.size(m.id)).toBe(1);
    expect(await join(bob, m.code)).toMatchObject({ ok: false, code: 'REMOVED' });
  });

  it('host ends the meeting for everyone', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const bob = await client(TOKENS.bob);
    await join(bob, m.code);
    const ended = once(bob, 'room:ended');
    const ack = await new Promise<{ ok: boolean }>((r) => alice.emit('host:end', r));
    expect(ack.ok).toBe(true);
    await ended;
    expect((await h.store.getMeetingByCode(m.code))?.status).toBe('ended');
    expect(h.signalling.registry.size(m.id)).toBe(0);
    expect(await join(bob, m.code)).toMatchObject({ ok: false, code: 'MEETING_ENDED' });
  });

  it('marks a meeting ended after the room stays empty past the grace period', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    alice.close();
    await sleep(400);
    expect((await h.store.getMeetingByCode(m.code))?.status).toBe('ended');
  });

  it('a quick refresh (rejoin within grace) keeps the meeting alive', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    alice.close();
    await sleep(30);
    const again = await client(TOKENS.alice);
    expect((await join(again, m.code)).ok).toBe(true);
    await sleep(300);
    expect((await h.store.getMeetingByCode(m.code))?.status).toBe('live');
  });
});

describe('media state', () => {
  it('broadcasts mic/camera/screen state to peers', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const bob = await client(TOKENS.bob);
    await join(bob, m.code);
    const got = once<{ userId: string; audio: boolean; screen: boolean }>(alice, 'media:state');
    bob.emit('media:state', { audio: false, video: true, screen: true });
    const s = await got;
    expect(s).toMatchObject({ userId: 'user-bob', audio: false, screen: true });
  });
});

describe('waiting room', () => {
  const ask = <T>(s: Socket, event: string, payload: unknown) => new Promise<T>((r) => s.emit(event, payload, r));

  it('guests wait until the host admits them; host sees the list', async () => {
    const m = await newMeeting({ waiting: true });
    const alice = await client(TOKENS.alice);
    const hostList = once<{ userId: string; name: string }[]>(alice, 'waiting:list');
    await join(alice, m.code); // host joins directly (and receives the (empty) list)
    expect(await hostList).toEqual([]);

    const bob = await client(TOKENS.bob);
    const list = once<{ userId: string }[]>(alice, 'waiting:list');
    const res = await join(bob, m.code);
    expect(res).toMatchObject({ ok: true, waiting: true });
    expect((await list).map((w) => w.userId)).toEqual(['user-bob']);
    expect(h.signalling.registry.size(m.id)).toBe(1); // still not in the room

    // a waiting guest cannot chat or signal into the room
    const chat = await ask<{ ok: boolean }>(bob, 'chat:send', { body: 'hi' });
    expect(chat.ok).toBe(false);

    const admitted = once(bob, 'waiting:admitted');
    expect((await ask<{ ok: boolean }>(alice, 'host:admit', { userId: 'user-bob' })).ok).toBe(true);
    await admitted;
    const real = asJoined(await join(bob, m.code));
    expect(real.self.role).toBe('participant');
    expect(h.signalling.registry.size(m.id)).toBe(2);
  });

  it('host can decline; the guest is not let in and the list is updated', async () => {
    const m = await newMeeting({ waiting: true });
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const bob = await client(TOKENS.bob);
    await join(bob, m.code);
    const denied = once(bob, 'waiting:denied');
    expect((await ask<{ ok: boolean }>(alice, 'host:deny', { userId: 'user-bob' })).ok).toBe(true);
    await denied;
    expect(h.signalling.registry.listWaiting(m.id)).toHaveLength(0);
    // joining again just puts them back at the door, never inside
    expect(await join(bob, m.code)).toMatchObject({ waiting: true });
    expect(h.signalling.registry.size(m.id)).toBe(1);
  });

  it('only the host can admit or decline; a guest cannot admit themselves', async () => {
    const m = await newMeeting({ waiting: true });
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const bob = await client(TOKENS.bob);
    await join(bob, m.code);
    expect((await ask<{ ok: boolean }>(bob, 'host:admit', { userId: 'user-bob' })).ok).toBe(false);
    expect((await ask<{ ok: boolean }>(bob, 'host:deny', { userId: 'user-bob' })).ok).toBe(false);
    expect(h.signalling.registry.listWaiting(m.id)).toHaveLength(1);
    expect(h.signalling.registry.size(m.id)).toBe(1);
  });

  it('a guest who disconnects leaves the waiting list', async () => {
    const m = await newMeeting({ waiting: true });
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const bob = await client(TOKENS.bob);
    await join(bob, m.code);
    const updated = once<unknown[]>(alice, 'waiting:list');
    bob.close();
    expect(await updated).toEqual([]);
  });

  it('the password is still checked before a guest may wait', async () => {
    const m = await newMeeting({ waiting: true, password: 'letmein1' });
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const bob = await client(TOKENS.bob);
    expect(await join(bob, m.code, 'wrong')).toMatchObject({ ok: false, code: 'BAD_PASSWORD' });
    expect(h.signalling.registry.listWaiting(m.id)).toHaveLength(0);
  });

  it('ending the meeting tells waiting guests', async () => {
    const m = await newMeeting({ waiting: true });
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const bob = await client(TOKENS.bob);
    await join(bob, m.code);
    const ended = once(bob, 'room:ended');
    expect((await new Promise<{ ok: boolean }>((r) => alice.emit('host:end', r))).ok).toBe(true);
    await ended;
    expect(h.signalling.registry.listWaiting(m.id)).toHaveLength(0);
  });
});

describe('hand raising and reactions', () => {
  it('broadcasts hand state to others and shows it to later joiners', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const bob = await client(TOKENS.bob);
    await join(bob, m.code);
    const got = once<{ userId: string; raised: boolean }>(alice, 'hand:state');
    bob.emit('hand:set', { raised: true });
    expect(await got).toEqual({ userId: 'user-bob', raised: true });
    const carol = await client(TOKENS.carol);
    const res = asJoined(await join(carol, m.code));
    expect(res.peers.find((p) => p.userId === 'user-bob')?.hand).toBe(true);
  });

  it('ignores invalid hand payloads and hands from outside a room', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const dave = await client(TOKENS.dave); // not in any room
    let seen = false;
    alice.on('hand:state', () => (seen = true));
    dave.emit('hand:set', { raised: true });
    alice.emit('hand:set', { raised: 'yes' });
    await sleep(120);
    expect(seen).toBe(false);
  });

  it('delivers allowed reactions to the whole room, rejects others, and rate-limits', async () => {
    const m = await newMeeting();
    const alice = await client(TOKENS.alice);
    await join(alice, m.code);
    const bob = await client(TOKENS.bob);
    await join(bob, m.code);
    const got = once<{ userId: string; name: string; emoji: string }>(alice, 'reaction');
    bob.emit('reaction:send', { emoji: '🎉' });
    expect(await got).toEqual({ userId: 'user-bob', name: 'Bob', emoji: '🎉' });

    const received: string[] = [];
    alice.on('reaction', (r: { emoji: string }) => received.push(r.emoji));
    bob.emit('reaction:send', { emoji: '<script>' }); // not in the allow-list
    for (let i = 0; i < 12; i++) bob.emit('reaction:send', { emoji: '👍' });
    await sleep(200);
    expect(received.includes('<script>')).toBe(false);
    expect(received.length).toBeLessThan(12);
    expect(received.length).toBeGreaterThan(0);
  });
});
