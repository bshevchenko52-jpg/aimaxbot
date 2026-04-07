import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique } = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock('../db/prisma', () => ({
  prisma: {
    subscription: { findUnique },
    user: { update: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('../config', () => ({
  getConfig: () => ({
    FREE_DAILY_CHAR_LIMIT: 100,
    PREMIUM_DAILY_CHAR_LIMIT: 10_000,
  }),
}));

import { remainingChars } from './limit.service';

describe('remainingChars', () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it('free: лимит из FREE_DAILY_CHAR_LIMIT', async () => {
    findUnique.mockResolvedValue(null);
    expect(await remainingChars(1, 30)).toBe(70);
  });

  it('premium активна: PREMIUM_DAILY_CHAR_LIMIT', async () => {
    const future = new Date(Date.now() + 86_400_000);
    findUnique.mockResolvedValue({
      isActive: true,
      plan: 'premium',
      expiresAt: future,
    });
    expect(await remainingChars(2, 100)).toBe(9900);
  });

  it('premium истекла — как free', async () => {
    const past = new Date(Date.now() - 86_400_000);
    findUnique.mockResolvedValue({
      isActive: true,
      plan: 'premium',
      expiresAt: past,
    });
    expect(await remainingChars(3, 20)).toBe(80);
  });

  it('не уходит в отрицательные остатки', async () => {
    findUnique.mockResolvedValue(null);
    expect(await remainingChars(4, 150)).toBe(0);
  });
});
