import { prisma } from '../db/prisma';

/** Общая статистика сервиса */
export async function getStats() {
  const [totalUsers, activePremium, revenue] = await Promise.all([
    prisma.user.count(),
    prisma.subscription.count({ where: { isActive: true, plan: 'premium' } }),
    prisma.transaction.aggregate({
      where: { status: 'succeeded' },
      _sum: { amount: true },
    }),
  ]);
  return {
    totalUsers,
    activePremium,
    totalRevenue: revenue._sum.amount?.toNumber() ?? 0,
  };
}

/** Пагинированный список пользователей */
export async function getUserList(skip: number, take: number) {
  const [total, users] = await Promise.all([
    prisma.user.count(),
    prisma.user.findMany({
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        maxUserId: true,
        createdAt: true,
        subscription: { select: { plan: true, isActive: true } },
      },
    }),
  ]);
  return { total, users };
}

/** Карточка пользователя с транзакциями */
export async function getUserCard(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  });
  if (!user) return null;

  const [transactions, revenue] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.transaction.aggregate({
      where: { userId, status: 'succeeded' },
      _sum: { amount: true },
    }),
  ]);

  return {
    user,
    transactions,
    totalPaid: revenue._sum.amount?.toNumber() ?? 0,
  };
}
