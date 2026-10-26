import { z } from 'zod';
import type { IceServerConfig } from '../types.js';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().min(1, 'CLIENT_ORIGIN is required (comma-separated list allowed)'),
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'SUPABASE_SERVICE_ROLE_KEY looks too short'),
  LOG_LEVEL: z.string().default('info'),
  TURN_URLS: z.string().default(''),
  TURN_USERNAME: z.string().default(''),
  TURN_CREDENTIAL: z.string().default(''),
});

export type Env = z.infer<typeof schema>;

/** Validates environment variables once at startup; fails fast with a readable message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}

export function parseOrigins(clientOrigin: string): string[] {
  return clientOrigin
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

/** STUN is always included; TURN only when configured on the server (never bundled into the client). */
export function buildIceServers(env: Pick<Env, 'TURN_URLS' | 'TURN_USERNAME' | 'TURN_CREDENTIAL'>): IceServerConfig[] {
  const servers: IceServerConfig[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  const turnUrls = env.TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean);
  if (turnUrls.length > 0 && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
    servers.push({ urls: turnUrls, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
  }
  return servers;
}
