import { CurrencyEnum, YooKassa } from '@webzaytsev/yookassa-ts-sdk';
import { getConfig, subscriptionAmountFormatted } from '../config';
import { log } from '../lib/logger';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

/** Retry с exponential backoff для ошибок 429/500+ (тот же idempotence key). */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.errorCode ?? err?.response?.status;
      // Клиентские ошибки (кроме 429) — не ретраим
      if (status && status >= 400 && status < 500 && status !== 429) throw err;
      if (attempt === MAX_RETRIES) throw err;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
      log.warn(`YooKassa retry ${attempt + 1}/${MAX_RETRIES} через ${Math.round(delay)}ms`, { status });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}

function sdk() {
  const c = getConfig();
  return YooKassa({
    shop_id: c.YOOKASSA_SHOP_ID,
    secret_key: c.YOOKASSA_SECRET_KEY,
  });
}

/** Чек для 54-ФЗ (УСН без НДС, vat_code=1). */
function buildReceipt(userEmail: string, description: string, amount: string) {
  return {
    customer: { email: userEmail },
    items: [
      {
        description,
        amount: { value: amount, currency: CurrencyEnum.RUB },
        vat_code: 1, // 1 = без НДС (УСН)
        quantity: 1,
        payment_subject: 'service' as const,
        payment_mode: 'full_payment' as const,
      },
    ],
    tax_system_code: 2, // УСН доходы
  };
}

/** Первый платёж с сохранением способа оплаты (карта и т.д.) для автопродления. СБП может не вернуть сохраняемый метод. */
export async function createSubscriptionCheckout(internalUserId: number, userEmail: string) {
  const c = getConfig();
  const amount = subscriptionAmountFormatted();
  const description = 'Подписка Premium (30 дней)';
  const idempotenceKey = `sub-${internalUserId}-${Date.now()}`;
  const payment = await withRetry(() =>
    sdk().payments.create(
      {
        amount: { value: amount, currency: CurrencyEnum.RUB },
        confirmation: {
          type: 'redirect',
          return_url: c.YOOKASSA_RETURN_URL,
        },
        capture: true,
        save_payment_method: true,
        description,
        receipt: buildReceipt(userEmail, description, amount),
        metadata: {
          internal_user_id: String(internalUserId),
          product: 'premium_monthly',
        },
      },
      idempotenceKey,
    ),
  );

  const conf = payment.confirmation;
  let url: string | undefined;
  if (conf && typeof conf === 'object' && 'type' in conf && conf.type === 'redirect') {
    const u = 'confirmation_url' in conf ? (conf as { confirmation_url?: string }).confirmation_url : undefined;
    url = typeof u === 'string' ? u : undefined;
  }

  if (!url) {
    log.error('YooKassa: no confirmation_url', payment);
    throw new Error('Не получена ссылка на оплату от ЮKassa');
  }

  return { paymentId: payment.id, confirmationUrl: url, amount };
}

export async function chargeRecurring(
  paymentMethodId: string,
  amountValue: string,
  metadata: Record<string, string>,
  userEmail: string,
) {
  const description = 'Автопродление Premium';
  const idempotenceKey = `renew-${metadata.internal_user_id}-${Date.now()}`;
  return withRetry(() =>
    sdk().payments.create(
      {
        amount: { value: amountValue, currency: CurrencyEnum.RUB },
        payment_method_id: paymentMethodId,
        capture: true,
        description,
        receipt: buildReceipt(userEmail, description, amountValue),
        metadata,
      },
      idempotenceKey,
    ),
  );
}

export async function loadPayment(id: string) {
  return sdk().payments.load(id);
}
