import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createPayment, loadPayment } = vi.hoisted(() => ({
  createPayment: vi.fn(),
  loadPayment: vi.fn(),
}));

vi.mock('@webzaytsev/yookassa-ts-sdk', () => ({
  CurrencyEnum: { RUB: 'RUB' },
  YooKassa: () => ({
    payments: { create: createPayment, load: loadPayment },
  }),
}));

vi.mock('../config', () => ({
  getConfig: () => ({
    YOOKASSA_SHOP_ID: 'shop_test',
    YOOKASSA_SECRET_KEY: 'secret_test',
    YOOKASSA_RETURN_URL: 'https://example.com/done',
  }),
  subscriptionAmountFormatted: () => '70.00',
}));

vi.mock('../lib/logger', () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { createSubscriptionCheckout, chargeRecurring } from './yookassa-client';

describe('createSubscriptionCheckout', () => {
  beforeEach(() => createPayment.mockReset());

  it('возвращает confirmationUrl при type=redirect', async () => {
    createPayment.mockResolvedValue({
      id: 'pay-1',
      confirmation: {
        type: 'redirect',
        confirmation_url: 'https://yookassa.ru/pay/abc123',
      },
    });

    const result = await createSubscriptionCheckout(42, 'test@example.com');

    expect(result.confirmationUrl).toBe('https://yookassa.ru/pay/abc123');
    expect(result.paymentId).toBe('pay-1');
    expect(result.amount).toBe('70.00');
  });

  it('пробрасывает metadata с internal_user_id', async () => {
    createPayment.mockResolvedValue({
      id: 'pay-2',
      confirmation: { type: 'redirect', confirmation_url: 'https://x.ru' },
    });

    await createSubscriptionCheckout(99, 'user@example.com');

    const payloadArg = createPayment.mock.calls[0][0];
    expect(payloadArg.metadata.internal_user_id).toBe('99');
    // save_payment_method отключён до одобрения ЮKassa
    expect(payloadArg.save_payment_method).toBeUndefined();
    expect(payloadArg.capture).toBe(true);
    expect(payloadArg.receipt.customer.email).toBe('user@example.com');
    expect(payloadArg.receipt.items[0].quantity).toBe(1);
    expect(payloadArg.receipt.tax_system_code).toBe(2);
  });

  it('бросает если confirmation отсутствует (null)', async () => {
    createPayment.mockResolvedValue({ id: 'pay-3', confirmation: null });

    await expect(createSubscriptionCheckout(1, 'a@b.com')).rejects.toThrow('Не получена ссылка на оплату от ЮKassa');
  });

  it('бросает если confirmation.type не redirect', async () => {
    createPayment.mockResolvedValue({
      id: 'pay-4',
      confirmation: { type: 'embedded', token: 'tkn' },
    });

    await expect(createSubscriptionCheckout(1, 'a@b.com')).rejects.toThrow('Не получена ссылка на оплату от ЮKassa');
  });

  it('бросает если confirmation_url не строка', async () => {
    createPayment.mockResolvedValue({
      id: 'pay-5',
      confirmation: { type: 'redirect', confirmation_url: 12345 },
    });

    await expect(createSubscriptionCheckout(1, 'a@b.com')).rejects.toThrow('Не получена ссылка на оплату от ЮKassa');
  });
});

describe('chargeRecurring', () => {
  beforeEach(() => createPayment.mockReset());

  it('вызывает payments.create с payment_method_id и metadata', async () => {
    createPayment.mockResolvedValue({ id: 'rec-1', status: 'succeeded' });

    const result = await chargeRecurring('pm_method_1', '70.00', {
      internal_user_id: '5',
      kind: 'renewal',
    });

    const arg = createPayment.mock.calls[0][0];
    expect(arg.payment_method_id).toBe('pm_method_1');
    expect(arg.amount).toEqual({ value: '70.00', currency: 'RUB' });
    expect(arg.metadata).toEqual({ internal_user_id: '5', kind: 'renewal' });
    expect(arg.capture).toBe(true);
    expect(result.id).toBe('rec-1');
  });
});
