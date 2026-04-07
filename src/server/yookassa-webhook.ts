import type { Request, Response } from 'express';
import {
  isYooKassaIP,
  parseNotification,
  WebhookValidationError,
} from '@webzaytsev/yookassa-ts-sdk';
import { log } from '../lib/logger';
import { prisma } from '../db/prisma';
import * as yookassaPay from '../payments/yookassa-client';
import * as subscriptionService from '../services/subscription.service';
import { getClientIp } from './client-ip';

export async function handleYooKassaWebhook(req: Request, res: Response): Promise<void> {
  const ip = getClientIp(req);
  if (!isYooKassaIP(ip)) {
    log.warn('YooKassa webhook: отклонён IP', ip);
    res.status(403).send('Forbidden');
    return;
  }

  let notification: ReturnType<typeof parseNotification>;
  try {
    notification = parseNotification(req.body);
  } catch (e) {
    if (e instanceof WebhookValidationError) {
      log.warn('YooKassa webhook: неверное тело', e.message);
      res.status(400).send('Bad Request');
      return;
    }
    throw e;
  }

  if (!notification.event.startsWith('payment.')) {
    res.status(200).send('OK');
    return;
  }

  // H5: верифицируем payment.canceled через API (не доверяем только webhook)
  if (notification.event === 'payment.canceled') {
    const id = notification.object.id;
    try {
      const loaded = await yookassaPay.loadPayment(id);
      if (loaded.status === 'canceled') {
        await prisma.transaction.updateMany({
          where: { yookassaId: id },
          data: { status: 'canceled' },
        });
      } else {
        log.warn(`YooKassa: canceled webhook но статус API ${loaded.status} [${id}]`);
      }
    } catch (e) {
      log.error('YooKassa webhook: ошибка обработки payment.canceled', e);
    }
    res.status(200).send('OK');
    return;
  }

  if (notification.event !== 'payment.succeeded') {
    res.status(200).send('OK');
    return;
  }

  // B3: всегда возвращаем 200 — ЮKassa не будет ретраить при ошибках обработки
  try {
    const paymentId = notification.object.id;
    const loaded = await yookassaPay.loadPayment(paymentId);
    if (loaded.status !== 'succeeded') {
      log.info(`YooKassa: loadPayment не succeeded [${loaded.status}] ${paymentId}`);
      res.status(200).send('OK');
      return;
    }

    const dup = await prisma.transaction.findUnique({ where: { yookassaId: paymentId } });
    if (dup?.status === 'succeeded') {
      res.status(200).send('OK');
      return;
    }

    const meta = loaded.metadata ?? {};
    const uidRaw = meta.internal_user_id;
    const userId = typeof uidRaw === 'string' ? Number.parseInt(uidRaw, 10) : Number.NaN;
    if (!Number.isFinite(userId) || userId <= 0) {
      log.warn('YooKassa: нет internal_user_id в metadata', meta);
      res.status(200).send('OK');
      return;
    }

    const amount = loaded.amount?.value ?? '0.00';
    const isRenewal = meta.kind === 'renewal';

    if (isRenewal) {
      // C2: атомарная идемпотентность — обновляем только если ещё не succeeded
      const updated = await prisma.transaction.updateMany({
        where: { yookassaId: paymentId, status: { not: 'succeeded' } },
        data: { status: 'succeeded' },
      });
      if (updated.count > 0) {
        await subscriptionService.extendPremiumAfterRecurring(userId);
      }
    } else {
      const pm = loaded.payment_method;
      const paymentMethodId =
        pm &&
        typeof pm === 'object' &&
        'saved' in pm &&
        pm.saved === true &&
        'id' in pm &&
        typeof pm.id === 'string'
          ? pm.id
          : null;
      await subscriptionService.activatePremiumAfterPayment({
        userId,
        paymentMethodId,
        yookassaId: paymentId,
        amount,
        recurring: false,
      });
    }
  } catch (e) {
    log.error('YooKassa webhook: ошибка обработки', e);
    // B3: НЕ возвращаем 500 — ЮKassa не должна ретраить при ошибках на нашей стороне
  }

  res.status(200).send('OK');
}
