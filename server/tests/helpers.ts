import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import { createSignalling, type JoinOk, type JoinResult, type Signalling } from '../src/sockets/signalling.js';
import { MemoryStore } from '../src/store/memory.js';
import type { Authenticator, AuthUser } from '../src/types.js';

export const USERS: Record<string, AuthUser> = {
  'token-alice-0000': { id: 'user-alice', name: 'Alice' },
  'token-bob-000000': { id: 'user-bob', name: 'Bob' },
  'token-carol-0000': { id: 'user-carol', name: 'Carol' },
  'token-dave-00000': { id: 'user-dave', name: 'Dave' },
};
export const TOKENS = { alice: 'token-alice-0000', bob: 'token-bob-000000', carol: 'token-carol-0000', dave: 'token-dave-00000' };

export interface Harness {
  store: MemoryStore;
  server: http.Server;
  signalling: Signalling;
  baseUrl: string;
  app: ReturnType<typeof createApp>;
  close(): Promise<void>;
}

export async function startHarness(emptyRoomGraceMs = 100): Promise<Harness> {
  const store = new MemoryStore();
  for (const u of Object.values(USERS)) store.addProfile(u.id, u.name);
  const authenticate: Authenticator = async (t) => USERS[t] ?? null;
  const logger = createLogger('silent');
  const ice = [{ urls: ['stun:stun.example.org'] }];
  let signalling!: Signalling;
  const app = createApp({
    store,
    authenticate,
    hub: { endMeeting: (id, actor) => signalling.endMeeting(id, actor) },
    clientOrigins: ['http://localhost:5173'],
    iceServers: ice,
    logger,
  });
  const server = http.createServer(app);
  signalling = createSignalling(server, {
    store,
    authenticate,
    origins: ['http://localhost:5173'],
    iceServers: ice,
    logger,
    emptyRoomGraceMs,
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  return {
    store,
    server,
    signalling,
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => signalling.shutdown(),
  };
}

export function connectClient(baseUrl: string, token: string | null): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(baseUrl, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => {
      s.close();
      reject(e);
    });
  });
}

export function join(s: Socket, code: string, password?: string): Promise<JoinResult> {
  return new Promise((resolve) => s.emit('room:join', { code, password }, resolve));
}

/** Narrow a join result to a successful, fully-joined one (fails the test otherwise). */
export function asJoined(r: JoinResult): JoinOk {
  if (!r.ok || 'waiting' in r) throw new Error(`expected a full join, got ${JSON.stringify(r)}`);
  return r;
}

export function once<T = unknown>(s: Socket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    s.once(event, (v: T) => {
      clearTimeout(t);
      resolve(v);
    });
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
