import path from 'node:path';
import express from 'express';
import type { Application, NextFunction, Request, Response } from 'express';
import { getConfig } from '../config';
import { prisma } from '../db/prisma';
import { log } from '../lib/logger';
import { handleYooKassaWebhook } from './yookassa-webhook';

export function createApp(): Application {
  const app = express();
  const cfg = getConfig();
  app.set('trust proxy', cfg.TRUST_PROXY);

  // Оферта и политика конфиденциальности
  app.use(express.static(path.join(process.cwd(), 'public')));

  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok' });
    } catch (err) {
      log.error('/health: база недоступна', err);
      res.status(503).json({ status: 'db_unavailable' });
    }
  });

  app.post('/api/yookassa/webhook', express.json({ limit: '10kb' }), (req, res, next) => {
    void handleYooKassaWebhook(req, res).catch(next);
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    log.error('Unhandled Express error', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return app;
}
