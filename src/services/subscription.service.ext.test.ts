import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  subFindUnique: vi.fn(),
  subFindMany: vi.fn(),
  subUpdate: vi.fn(),
  subUpdateMany: vi.fn(),
  userFindUnique: vi.fn(),
  txCreate: vi.fn(),
  txFindFirst: vi.fn(),
  sendMessage: vi.fn(),
  chargeRecurring: vi.fn(),
}));

vi.mock('../db/prisma', () => ({
  prisma: {
    subscription: {
      findUnique: mocks.subFindUnique,
      findMany: mocks.subFindMany,
      update: mocks.subUpdate,
      updateMany: mocks.subUpdateMany,
    },
    user: { findUnique: mocks.userFindUnique },
    transaction: { create: mocks.txCreate, findFirst: mocks.txFindFirst },
  },
}));

vi.mock('../bot/bot-instance', () => ({
  getBotApi: () => ({ sendMessageToUser: mocks.sendMessage }),
}));

vi.mock('../lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../config', () => ({
  getConfig: () => ({ SUBSCRIPTION_PRICE_RUB: 70 }),
}));

vi.mock('../payments/yookassa-client', () => ({
  chargeRecurring: mocks.chargeRecurring,
}));

import { deactivateExpired, extendPremiumAfterRecurring, tryAutoRenew } from './subscription.service';

const DAY = 86_400_000;

describe('extendPremiumAfterRecurring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subUpdate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue(null);
  });

  it('продлевает от текущей expiresAt если она в будущем', async () => {
    const future = new Date(Date.now() + 5 * DAY);
    mocks.subFindUnique.mockResolvedValue({ expiresAt: future });

    await extendPremiumAfterRecurring(1);

    const { data } = mocks.subUpdate.mock.calls[0][0];
    const diff = data.expiresAt.getTime() - future.getTime();
    expect(Math.round(diff / DAY)).toBe(30);
    expect(data.isActive).toBe(true);
    expect(data.plan).toBe('premium');
  });

  it('продлевает от now если expiresAt в прошлом', async () => {
    const past = new Date(Date.now() - DAY);
    mocks.subFindUnique.mockResolvedValue({ expiresAt: past });

    const before = Date.now();
    await extendPremiumAfterRecurring(2);
    const after = Date.now();

    const { data } = mocks.subUpdate.mock.calls[0][0];
    const base = data.expiresAt.getTime() - 30 * DAY;
    expect(base).toBeGreaterThanOrEqual(before);
    expect(base).toBeLessThanOrEqual(after);
  });

  it('продлевает от now если подписки нет (null)', async () => {
    mocks.subFindUnique.mockResolvedValue(null);
    await extendPremiumAfterRecurring(3);
    const { where } = mocks.subUpdate.mock.calls[0][0];
    expect(where.userId).toBe(3);
  });

  it('отправляет уведомление пользователю', async () => {
    mocks.subFindUnique.mockResolvedValue(null);
    mocks.userFindUnique.mockResolvedValue({ id: 5, maxUserId: '100500' });

    await extendPremiumAfterRecurring(5);

    expect(mocks.sendMessage).toHaveBeenCalledWith(100500, 'Подписка продлена ещё на 30 суток.');
  });

  it('не падает если sendMessage бросает', async () => {
    mocks.subFindUnique.mockResolvedValue(null);
    mocks.userFindUnique.mockResolvedValue({ id: 6, maxUserId: '42' });
    mocks.sendMessage.mockRejectedValue(new Error('network'));

    await expect(extendPremiumAfterRecurring(6)).resolves.toBeUndefined();
  });
});

describe('deactivateExpired', () => {
  beforeEach(() => {
    mocks.subUpdateMany.mockResolvedValue({ count: 0 });
  });

  it('вызывает updateMany с правильными данными', async () => {
    await deactivateExpired();

    expect(mocks.subUpdateMany).toHaveBeenCalledOnce();
    const { where, data } = mocks.subUpdateMany.mock.calls[0][0];
    expect(where.isActive).toBe(true);
    expect(where.plan).toBe('premium');
    expect(where.expiresAt.lte).toBeInstanceOf(Date);
    expect(data.isActive).toBe(false);
    expect(data.plan).toBe('free');
    // paymentMethodId не обнуляется — нужен для автопродления если webhook придёт позже
    expect(data.paymentMethodId).toBeUndefined();
  });
});

describe('tryAutoRenew', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.txCreate.mockResolvedValue({});
    // C1: по умолчанию нет недавних транзакций — позволяем списание
    mocks.txFindFirst.mockResolvedValue(null);
  });

  it('создаёт transaction после успешного рекуррентного платежа', async () => {
    mocks.subFindMany.mockResolvedValue([
      {
        userId: 10,
        paymentMethodId: 'pm_abc',
        user: { maxUserId: '99', email: 'user10@example.com' },
      },
    ]);
    mocks.chargeRecurring.mockResolvedValue({ id: 'pay-rec-1', status: 'succeeded' });

    await tryAutoRenew();

    expect(mocks.chargeRecurring).toHaveBeenCalledWith(
      'pm_abc',
      '70.00',
      { internal_user_id: '10', kind: 'renewal' },
      'user10@example.com',
    );
    expect(mocks.txCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 10,
          yookassaId: 'pay-rec-1',
          recurring: true,
        }),
      }),
    );
  });

  it('уведомляет пользователя при ошибке списания', async () => {
    mocks.subFindMany.mockResolvedValue([
      {
        userId: 11,
        paymentMethodId: 'pm_fail',
        user: { maxUserId: '77', email: null },
      },
    ]);
    mocks.chargeRecurring.mockRejectedValue(new Error('no funds'));

    await tryAutoRenew();

    expect(mocks.txCreate).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      77,
      expect.stringContaining('/subscribe'),
    );
  });

  it('пропускает подписки без paymentMethodId', async () => {
    mocks.subFindMany.mockResolvedValue([
      { userId: 12, paymentMethodId: null, user: { maxUserId: '55', email: null } },
    ]);

    await tryAutoRenew();

    expect(mocks.chargeRecurring).not.toHaveBeenCalled();
  });

  it('не падает если нет подписок для продления', async () => {
    mocks.subFindMany.mockResolvedValue([]);
    await expect(tryAutoRenew()).resolves.toBeUndefined();
  });
});
