import { beforeEach, describe, expect, it, vi } from 'vitest';

const { userCount, userFindMany, userFindUnique, subCount, txAggregate, txFindMany } =
  vi.hoisted(() => ({
    userCount: vi.fn(),
    userFindMany: vi.fn(),
    userFindUnique: vi.fn(),
    subCount: vi.fn(),
    txAggregate: vi.fn(),
    txFindMany: vi.fn(),
  }));

vi.mock('../db/prisma', () => ({
  prisma: {
    user: { count: userCount, findMany: userFindMany, findUnique: userFindUnique },
    subscription: { count: subCount },
    transaction: { aggregate: txAggregate, findMany: txFindMany },
  },
}));

import { getStats, getUserList, getUserCard } from './admin.service';

beforeEach(() => {
  userCount.mockReset();
  userFindMany.mockReset();
  userFindUnique.mockReset();
  subCount.mockReset();
  txAggregate.mockReset();
  txFindMany.mockReset();
});

describe('getStats', () => {
  it('возвращает корректную статистику', async () => {
    userCount.mockResolvedValue(50);
    subCount.mockResolvedValue(10);
    txAggregate.mockResolvedValue({ _sum: { amount: { toNumber: () => 25000 } } });

    const result = await getStats();

    expect(result).toEqual({
      totalUsers: 50,
      activePremium: 10,
      totalRevenue: 25000,
    });

    expect(subCount).toHaveBeenCalledWith({ where: { isActive: true, plan: 'premium' } });
    expect(txAggregate).toHaveBeenCalledWith({
      where: { status: 'succeeded' },
      _sum: { amount: true },
    });
  });

  it('возвращает totalRevenue=0 если нет транзакций', async () => {
    userCount.mockResolvedValue(5);
    subCount.mockResolvedValue(0);
    txAggregate.mockResolvedValue({ _sum: { amount: null } });

    const result = await getStats();

    expect(result.totalRevenue).toBe(0);
  });
});

describe('getUserList', () => {
  it('возвращает пагинированный список пользователей', async () => {
    const mockUsers = [
      { id: 2, name: 'Bob', maxUserId: 200n, createdAt: new Date(), subscription: { plan: 'premium', isActive: true } },
      { id: 1, name: 'Alice', maxUserId: 100n, createdAt: new Date(), subscription: null },
    ];

    userCount.mockResolvedValue(20);
    userFindMany.mockResolvedValue(mockUsers);

    const result = await getUserList(0, 10);

    expect(result).toEqual({ total: 20, users: mockUsers });

    expect(userFindMany).toHaveBeenCalledWith({
      skip: 0,
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        maxUserId: true,
        createdAt: true,
        subscription: { select: { plan: true, isActive: true } },
      },
    });
  });

  it('передаёт корректные skip и take', async () => {
    userCount.mockResolvedValue(50);
    userFindMany.mockResolvedValue([]);

    await getUserList(20, 5);

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 5 }),
    );
  });
});

describe('getUserCard', () => {
  it('возвращает карточку пользователя с транзакциями', async () => {
    const mockUser = { id: 1, name: 'Alice', subscription: { plan: 'premium', isActive: true } };
    const mockTxs = [
      { id: 10, userId: 1, amount: 500, status: 'succeeded', createdAt: new Date() },
    ];

    userFindUnique.mockResolvedValue(mockUser);
    txFindMany.mockResolvedValue(mockTxs);
    txAggregate.mockResolvedValue({ _sum: { amount: { toNumber: () => 1500 } } });

    const result = await getUserCard(1);

    expect(result).toEqual({
      user: mockUser,
      transactions: mockTxs,
      totalPaid: 1500,
    });

    expect(userFindUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      include: { subscription: true },
    });
    expect(txFindMany).toHaveBeenCalledWith({
      where: { userId: 1 },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    expect(txAggregate).toHaveBeenCalledWith({
      where: { userId: 1, status: 'succeeded' },
      _sum: { amount: true },
    });
  });

  it('возвращает null если пользователь не найден', async () => {
    userFindUnique.mockResolvedValue(null);

    const result = await getUserCard(999);

    expect(result).toBeNull();
    expect(txFindMany).not.toHaveBeenCalled();
    expect(txAggregate).not.toHaveBeenCalled();
  });
});
