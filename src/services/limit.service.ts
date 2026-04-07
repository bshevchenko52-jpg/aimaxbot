import { getConfig } from '../config';
import { prisma } from '../db/prisma';

export async function getDailyLimit(userId: number): Promise<number> {
  const cfg = getConfig();
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  const premium = sub?.isActive === true && sub.plan === 'premium' && sub.expiresAt && sub.expiresAt > new Date();
  return premium ? cfg.PREMIUM_DAILY_CHAR_LIMIT : cfg.FREE_DAILY_CHAR_LIMIT;
}

export async function remainingChars(userId: number, dailyCharsUsed: number): Promise<number> {
  const limit = await getDailyLimit(userId);
  return Math.max(0, limit - dailyCharsUsed);
}

export async function useChars(userId: number, chars: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { dailyCharsUsed: { increment: chars } },
  });
}

export async function resetAllDailyLimits(): Promise<void> {
  await prisma.user.updateMany({
    data: {
      dailyCharsUsed: 0,
      lastResetAt: new Date(),
    },
  });
}
