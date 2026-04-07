import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique } = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock('../db/prisma', () => ({
  prisma: {
    subscription: { findUnique },
  },
}));

import { isPremiumActive } from './subscription.service';

describe('isPremiumActive', () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it('false если подписки нет', async () => {
    findUnique.mockResolvedValue(null);
    expect(await isPremiumActive(1)).toBe(false);
  });

  it('false если план не premium', async () => {
    findUnique.mockResolvedValue({
      isActive: true,
      plan: 'free',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(await isPremiumActive(1)).toBe(false);
  });

  it('false если expiresAt в прошлом', async () => {
    findUnique.mockResolvedValue({
      isActive: true,
      plan: 'premium',
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await isPremiumActive(1)).toBe(false);
  });

  it('false если expiresAt null', async () => {
    findUnique.mockResolvedValue({
      isActive: true,
      plan: 'premium',
      expiresAt: null,
    });
    expect(await isPremiumActive(1)).toBe(false);
  });

  it('true для активного premium с будущей датой', async () => {
    findUnique.mockResolvedValue({
      isActive: true,
      plan: 'premium',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(await isPremiumActive(1)).toBe(true);
  });
});
