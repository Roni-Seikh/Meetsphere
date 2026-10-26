import 'dotenv/config';
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { createApp } from './app.js';
import { buildIceServers, loadEnv, parseOrigins } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { cachedAuthenticator } from './middleware/auth.js';
import { createSignalling } from './sockets/signalling.js';
import { createSupabaseStore } from './store/supabase.js';
import type { Authenticator } from './types.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const store = createSupabaseStore(db);

const verifyWithSupabase: Authenticator = async (token) => {
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const profile = await store.getProfile(data.user.id);
  const fallback = data.user.email?.split('@')[0] ?? 'Guest';
  return { id: data.user.id, name: profile?.display_name ?? fallback };
};
const authenticate = cachedAuthenticator(verifyWithSupabase);

const origins = parseOrigins(env.CLIENT_ORIGIN);
const iceServers = buildIceServers(env);

const app = createApp({
  store,
  authenticate,
  hub: { endMeeting: (id, actor) => signalling.endMeeting(id, actor) },
  clientOrigins: origins,
  iceServers,
  logger,
});
const server = http.createServer(app);
const signalling = createSignalling(server, { store, authenticate, origins, iceServers, logger });

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, origins, turnConfigured: iceServers.length > 1 }, 'MeetSphere server listening');
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down gracefully');
  const force = setTimeout(() => {
    logger.error('forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
  force.unref();
  try {
    await signalling.shutdown(); // closes websocket clients and the http server
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    logger.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled promise rejection'));
