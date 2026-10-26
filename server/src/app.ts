import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { z } from 'zod';
import type { Logger } from './lib/logger.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';
import { meetingsRouter, type MeetingsHub } from './routes/meetings.js';
import type { MeetingStore } from './store/types.js';
import type { Authenticator, IceServerConfig } from './types.js';

export interface AppDeps {
  store: MeetingStore;
  authenticate: Authenticator;
  hub: MeetingsHub;
  clientOrigins: string[];
  iceServers: IceServerConfig[];
  logger: Logger;
}

const profileSchema = z.object({ displayName: z.string().trim().min(1).max(60) });

export function createApp(deps: AppDeps): Express {
  const { store, authenticate, hub, logger } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // hosting platforms terminate TLS in front of us

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || deps.clientOrigins.includes(origin)),
      methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '20kb' }));

  // Structured request log: method, path and status only (no headers, bodies or tokens).
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start }, 'http');
    });
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()), time: new Date().toISOString() });
  });

  const api = express.Router();
  api.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 600,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
    }),
  );
  api.use(requireAuth(authenticate));

  api.get('/me', (req, res) => {
    res.json({ id: req.user!.id, displayName: req.user!.name });
  });
  api.patch('/me', async (req, res) => {
    const { displayName } = profileSchema.parse(req.body);
    const profile = await store.updateDisplayName(req.user!.id, displayName);
    res.json({ id: profile.id, displayName: profile.display_name });
  });
  api.get('/ice', (_req, res) => {
    res.json({ iceServers: deps.iceServers });
  });
  api.use('/meetings', meetingsRouter(store, hub));

  app.use('/api', api);
  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
