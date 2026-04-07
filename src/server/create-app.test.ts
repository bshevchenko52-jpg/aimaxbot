import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const { queryRaw } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock('../db/prisma', () => ({
  prisma: {
    $queryRaw: queryRaw,
  },
}));

vi.mock('./yookassa-webhook', () => ({
  handleYooKassaWebhook: vi.fn(async (_req: unknown, res: { status: (n: number) => { send: (b: string) => void } }) => {
    res.status(200).send('OK');
  }),
}));

import { createApp } from './create-app';

describe('createApp', () => {
  beforeEach(() => {
    queryRaw.mockReset();
  });

  it('GET /health 200 при успешном SELECT 1', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /health 503 если БД недоступна', async () => {
    queryRaw.mockRejectedValue(new Error('db down'));
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'db_unavailable' });
  });

  it('POST /api/yookassa/webhook отвечает (мок хендлера)', async () => {
    queryRaw.mockResolvedValue([]);
    const res = await request(createApp()).post('/api/yookassa/webhook').send({});
    expect(res.status).toBe(200);
  });

  it('trust proxy берётся из конфига', () => {
    const app = createApp();
    expect(app.get('trust proxy')).toBe(1);
  });
});
