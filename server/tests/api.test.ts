import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, TOKENS, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('REST API', () => {
  it('exposes a health check without auth', async () => {
    const res = await request(h.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('sets security headers and hides x-powered-by', async () => {
    const res = await request(h.app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects missing or invalid tokens with 401', async () => {
    expect((await request(h.app).get('/api/meetings')).status).toBe(401);
    expect((await request(h.app).get('/api/meetings').set(auth('garbage-token-value'))).status).toBe(401);
  });

  it('creates a meeting and never leaks the password hash', async () => {
    const res = await request(h.app)
      .post('/api/meetings')
      .set(auth(TOKENS.alice))
      .send({ title: 'Sprint review', password: 'secret1', maxParticipants: 3 });
    expect(res.status).toBe(201);
    expect(res.body.meeting.code).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    expect(res.body.meeting.hasPassword).toBe(true);
    expect(res.body.meeting.isHost).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
    expect(JSON.stringify(res.body)).not.toContain('$2');
  });

  it('rejects invalid input with a validation error', async () => {
    const bad = [
      { title: '' },
      { title: 'x', maxParticipants: 99 },
      { title: 'x', password: '12' },
      { title: 'x', scheduledFor: 'tomorrow' },
    ];
    for (const body of bad) {
      const res = await request(h.app).post('/api/meetings').set(auth(TOKENS.alice)).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects malformed JSON', async () => {
    const res = await request(h.app)
      .post('/api/meetings')
      .set(auth(TOKENS.alice))
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
  });

  it('lists only meetings the user hosts or joined', async () => {
    const created = await request(h.app).post('/api/meetings').set(auth(TOKENS.alice)).send({ title: 'Mine' });
    const mine = await request(h.app).get('/api/meetings').set(auth(TOKENS.alice));
    expect(mine.body.meetings.some((m: { code: string }) => m.code === created.body.meeting.code)).toBe(true);
    const others = await request(h.app).get('/api/meetings').set(auth(TOKENS.bob));
    expect(others.body.meetings.some((m: { code: string }) => m.code === created.body.meeting.code)).toBe(false);
  });

  it('returns 404 for unknown or malformed codes', async () => {
    expect((await request(h.app).get('/api/meetings/abc-defg-hij').set(auth(TOKENS.alice))).status).toBe(404);
    expect((await request(h.app).get('/api/meetings/not-a-code').set(auth(TOKENS.alice))).status).toBe(404);
  });

  it('only the host may end a meeting', async () => {
    const created = await request(h.app).post('/api/meetings').set(auth(TOKENS.alice)).send({ title: 'End me' });
    const code = created.body.meeting.code as string;
    expect((await request(h.app).post(`/api/meetings/${code}/end`).set(auth(TOKENS.bob))).status).toBe(403);
    expect((await request(h.app).post(`/api/meetings/${code}/end`).set(auth(TOKENS.alice))).status).toBe(200);
    expect((await request(h.app).post(`/api/meetings/${code}/end`).set(auth(TOKENS.alice))).status).toBe(409);
  });

  it('chat history is forbidden for non-participants', async () => {
    const created = await request(h.app).post('/api/meetings').set(auth(TOKENS.alice)).send({ title: 'Private' });
    const code = created.body.meeting.code as string;
    expect((await request(h.app).get(`/api/meetings/${code}/messages`).set(auth(TOKENS.bob))).status).toBe(403);
    expect((await request(h.app).get(`/api/meetings/${code}/messages`).set(auth(TOKENS.alice))).status).toBe(200);
  });

  it('serves ICE servers to authenticated users only', async () => {
    expect((await request(h.app).get('/api/ice')).status).toBe(401);
    const res = await request(h.app).get('/api/ice').set(auth(TOKENS.alice));
    expect(res.body.iceServers[0].urls[0]).toMatch(/^stun:/);
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await request(h.app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
