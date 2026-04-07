import { Prisma } from '@prisma/client';
import { getConfig } from '../config';
import { prisma } from '../db/prisma';
import { log } from '../lib/logger';
import * as yookassaPay from '../payments/yookassa-client';
import { getBotApi } from '../bot/bot-instance';

const PREMIUM_PLAN = 'premium';
const DAY_MS = 86_400_000;

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

export async function ensureSubscriptionRow(userId: number) {
  return prisma.subscription.upsert({
    where: { userId },
    create: { userId, plan: 'free', isActive: false },
    update: {},
  });
}

export async function getSubscription(userId: number) {
  return prisma.subscription.findUnique({ where: { userId } });
}

export async function isPremiumActive(userId: number): Promise<boolean> {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub?.isActive || sub.plan !== PREMIUM_PLAN) return false;
  if (!sub.expiresAt) return false;
  return sub.expiresAt > new Date();
}

export async function activatePremiumAfterPayment(args: {
  userId: number;
  paymentMethodId: string | null;
  yookassaId: string;
  amount: string;
  recurring: boolean;
}): Promise<void> {
  const { userId, paymentMethodId, yookassaId, amount, recurring } = args;
  const expiresAt = addDays(new Date(), 30);

  await prisma.$transaction(async (tx) => {
    await tx.transaction.upsert({
      where: { yookassaId },
      create: {
        userId,
        yookassaId,
        amount: new Prisma.Decimal(amount),
        currency: 'RUB',
        status: 'succeeded',
        recurring,
      },
      update: { status: 'succeeded', recurring },
    });
    await tx.subscription.upsert({
      where: { userId },
      create: {
        userId,
        plan: PREMIUM_PLAN,
        isActive: true,
        expiresAt,
        paymentMethodId: paymentMethodId ?? undefined,
      },
      update: {
        plan: PREMIUM_PLAN,
        isActive: true,
        expiresAt,
        paymentMethodId: paymentMethodId ?? undefined,
        renewalWarnedAt: null,
      },
    });
  });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user) {
    try {
      const api = getBotApi();
      await api.sendMessageToUser(
        Number(user.maxUserId),
        'Подписка Premium активна на 30 суток. Приятного пользования.',
        { format: 'markdown' },
      );
    } catch (e) {
      log.warn('Не удалось отправить уведомление об оплате', e);
    }
  }
}

export async function deactivateExpired(): Promise<void> {
  const now = new Date();
  await prisma.subscription.updateMany({
    where: {
      isActive: true,
      plan: PREMIUM_PLAN,
      expiresAt: { lte: now },
    },
    data: {
      isActive: false,
      plan: 'free',
      // C3: НЕ обнуляем paymentMethodId — он нужен если webhook автопродления
      // придёт после деактивации (окно между 00:10 и фактическим ответом ЮKassa)
    },
  });
}

export async function sendExpiryReminders(): Promise<void> {
  const in3days = addDays(new Date(), 3);
  const subs = await prisma.subscription.findMany({
    where: {
      isActive: true,
      plan: PREMIUM_PLAN,
      expiresAt: { lte: in3days, gte: new Date() },
      OR: [{ renewalWarnedAt: null }, { renewalWarnedAt: { lt: new Date(Date.now() - 2 * DAY_MS) } }],
    },
    include: { user: true },
  });

  const api = getBotApi();
  for (const s of subs) {
    try {
      await api.sendMessageToUser(
        Number(s.user.maxUserId),
        `Подписка заканчивается: **${s.expiresAt?.toISOString().slice(0, 10)}**. Продлите через команду /subscribe`,
        { format: 'markdown' },
      );
      await prisma.subscription.update({
        where: { id: s.id },
        data: { renewalWarnedAt: new Date() },
      });
    } catch (e) {
      log.warn('reminder failed', e);
    }
  }
}

/** Автосписание за ~24 ч до окончания (и «догон» за 24 ч после), если сохранён payment_method_id. Запускать до deactivateExpired. */
export async function tryAutoRenew(): Promise<void> {
  const cfg = getConfig();
  const now = new Date();
  const past = new Date(now.getTime() - DAY_MS);
  const soon = new Date(now.getTime() + DAY_MS);
  const subs = await prisma.subscription.findMany({
    where: {
      isActive: true,
      plan: PREMIUM_PLAN,
      paymentMethodId: { not: null },
      expiresAt: { not: null, gt: past, lte: soon },
    },
    include: { user: { select: { maxUserId: true, email: true } } },
  });

  const amount = cfg.SUBSCRIPTION_PRICE_RUB.toFixed(2);

  for (const s of subs) {
    if (!s.paymentMethodId) continue;
    try {
      // C1: проверяем — не было ли уже попытки списания за последние 48ч
      const recent = await prisma.transaction.findFirst({
        where: {
          userId: s.userId,
          recurring: true,
          createdAt: { gte: new Date(now.getTime() - 2 * DAY_MS) },
          status: { in: ['pending', 'succeeded'] },
        },
      });
      if (recent) {
        log.info(`Auto-renew skip: недавняя транзакция ${recent.id} для user ${s.userId}`);
        continue;
      }

      const userEmail = s.user.email ?? '';
      const payment = await yookassaPay.chargeRecurring(s.paymentMethodId, amount, {
        internal_user_id: String(s.userId),
        kind: 'renewal',
      }, userEmail);
      await prisma.transaction.create({
        data: {
          userId: s.userId,
          yookassaId: payment.id,
          amount: new Prisma.Decimal(amount),
          currency: 'RUB',
          status: payment.status ?? 'pending',
          recurring: true,
        },
      });
      log.info(`Recurring payment created ${payment.id} for user ${s.userId}`);
    } catch (e) {
      log.error('Auto-renew failed', e);
      try {
        const api = getBotApi();
        await api.sendMessageToUser(
          Number(s.user.maxUserId),
          'Не удалось автоматически продлить подписку. Оформите заново: /subscribe',
        );
      } catch {
        /* ignore */
      }
    }
  }
}

/** Продление периода после успешного webhook по рекуррентному платежу. */
export async function extendPremiumAfterRecurring(userId: number): Promise<void> {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  const now = new Date();
  const base = sub?.expiresAt && sub.expiresAt > now ? sub.expiresAt : now;
  const expiresAt = addDays(base, 30);
  await prisma.subscription.update({
    where: { userId },
    data: {
      isActive: true,
      plan: PREMIUM_PLAN,
      expiresAt,
    },
  });
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user) {
    try {
      const api = getBotApi();
      await api.sendMessageToUser(Number(user.maxUserId), 'Подписка продлена ещё на 30 суток.');
    } catch (e) {
      log.warn('Не удалось уведомить о продлении подписки (recurring)', e);
    }
  }
}
