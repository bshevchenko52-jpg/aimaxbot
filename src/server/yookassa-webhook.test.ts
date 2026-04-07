import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { WebhookValidationError } from '@webzaytsev/yookassa-ts-sdk';

const sdkMocks = vi.hoisted(() => ({
  isYooKassaIP: vi.fn(),
  parseNotification: vi.fn(),
}));

vi.mock('@webzaytsev/yookassa-ts-sdk', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@webzaytsev/yookassa-ts-sdk')>();
  return {
    ...mod,
    isYooKassaIP: sdkMocks.isYooKassaIP,
    parseNotification: sdkMocks.parseNotification,
  };
});

const { prismaMock, loadPayment, activatePremiumAfterPayment, extendPremiumAfterRecurring } = vi.hoisted(
  () => ({
    prismaMock: {
      transaction: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
    },
    loadPayment: vi.fn(),
    activatePremiumAfterPayment: vi.fn(),
    extendPremiumAfterRecurring: vi.fn(),
  }),
);

vi.mock('../db/prisma', () => ({ prisma: prismaMock }));
vi.mock('../payments/yookassa-client', () => ({ loadPayment }));
vi.mock('../services/subscription.service', () => ({
  activatePremiumAfterPayment,
  extendPremiumAfterRecurring,
}));

import { handleYooKassaWebhook } from './yookassa-webhook';

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

function req(body: unknown): Request {
  return {
    body,
    headers: {},
    socket: { remoteAddress: '185.71.76.1' },
  } as Request;
}

describe('handleYooKassaWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMocks.isYooKassaIP.mockReturnValue(true);
  });

  it('403 если IP не из пула ЮKassa', async () => {
    sdkMocks.isYooKassaIP.mockReturnValue(false);
    const res = mockRes();
    await handleYooKassaWebhook(req({}), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('400 при WebhookValidationError', async () => {
    sdkMocks.parseNotification.mockImplementation(() => {
      throw new WebhookValidationError('bad');
    });
    const res = mockRes();
    await handleYooKassaWebhook(req({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('200 OK для события не payment.*', async () => {
    sdkMocks.parseNotification.mockReturnValue({ event: 'refund.succeeded', object: {} });
    const res = mockRes();
    await handleYooKassaWebhook(req({ x: 1 }), res);
    expect(loadPayment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('payment.canceled верифицирует через API и обновляет транзакцию', async () => {
    sdkMocks.parseNotification.mockReturnValue({
      event: 'payment.canceled',
      object: { id: 'pay-cancel-1' },
    });
    // H5: теперь для canceled тоже вызываем loadPayment
    loadPayment.mockResolvedValue({ status: 'canceled' });
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 });
    const res = mockRes();
    await handleYooKassaWebhook(req({}), res);
    expect(loadPayment).toHaveBeenCalledWith('pay-cancel-1');
    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { yookassaId: 'pay-cancel-1' },
      data: { status: 'canceled' },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('200 без loadPayment если статус не payment.succeeded', async () => {
    sdkMocks.parseNotification.mockReturnValue({
      event: 'payment.waiting_for_capture',
      object: { id: 'p1' },
    });
    const res = mockRes();
    await handleYooKassaWebhook(req({}), res);
    expect(loadPayment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('200 если loadPayment не succeeded', async () => {
    sdkMocks.parseNotification.mockReturnValue({
      event: 'payment.succeeded',
      object: { id: 'p2' },
    });
    loadPayment.mockResolvedValue({ status: 'pending' });
    const res = mockRes();
    await handleYooKassaWebhook(req({}), res);
    expect(activatePremiumAfterPayment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('200 если транзакция уже succeeded (идемпотентность)', async () => {
    sdkMocks.parseNotification.mockReturnValue({
      event: 'payment.succeeded',
      object: { id: 'p3' },
    });
    loadPayment.mockResolvedValue({
      status: 'succeeded',
      amount: { value: '299.00' },
      metadata: { internal_user_id: '1' },
    });
    prismaMock.transaction.findUnique.mockResolvedValue({ status: 'succeeded' });
    const res = mockRes();
    await handleYooKassaWebhook(req({}), res);
    expect(activatePremiumAfterPayment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('200 без активации если нет internal_user_id', async () => {
    sdkMocks.parseNotification.mockReturnValue({
      event: 'payment.succeeded',
      object: { id: 'p4' },
    });
    loadPayment.mockResolvedValue({
      status: 'succeeded',
      amount: { value: '1' },
      metadata: {},
    });
    prismaMock.transaction.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await handleYooKassaWebhook(req({}), res);
    expect(activatePremiumAfterPayment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('renewal: updateMany (идемпотентно) + extendPremiumAfterRecurring', async () => {
    sdkMocks.parseNotification.mockReturnValue({
      event: 'payment.succeeded',
      object: { id: 'p-ren' },
    });
    loadPayment.mockResolvedValue({
      status: 'succeeded',
      amount: { value: '299.00' },
      metadata: { internal_user_id: '7', kind: 'renewal' },
    });
    prismaMock.transaction.findUnique.mockResolvedValue({ status: 'pending' });
    // C2: updateMany возвращает count > 0 → extendPremiumAfterRecurring вызывается
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 });
    const res = mockRes();
    await handleYooKassaWebhook(req({}), res);
    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { yookassaId: 'p-ren', status: { not: 'succeeded' } },
      data: { status: 'succeeded' },
    });
    expect(extendPremiumAfterRecurring).toHaveBeenCalledWith(7);
    expect(activatePremiumAfterPayment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('первая оплата: activatePremiumAfterPayment с payment_method id', async () => {
    sdkMocks.parseNotification.mockReturnValue({
      event: 'payment.succeeded',
      object: { id: 'p-new' },
    });
    loadPayment.mockResolvedValue({
      status: 'succeeded',
      amount: { value: '299.00' },
      metadata: { internal_user_id: '3' },
      payment_method: { saved: true, id: 'pm_abc' },
    });
    prismaMock.transaction.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await handleYooKassaWebhook(req({}), res);
    expect(activatePremiumAfterPayment).toHaveBeenCalledWith({
      userId: 3,
      paymentMethodId: 'pm_abc',
      yookassaId: 'p-new',
      amount: '299.00',
      recurring: false,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
