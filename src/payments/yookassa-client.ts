import { CurrencyEnum, YooKassa } from '@webzaytsev/yookassa-ts-sdk';
import { getConfig, subscriptionAmountFormatted } from '../config';
import { log } from '../lib/logger';

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
  };
}

/** Первый платёж с сохранением способа оплаты (карта и т.д.) для автопродления. СБП может не вернуть сохраняемый метод. */
export async function createSubscriptionCheckout(internalUserId: number, userEmail: string) {
  const c = getConfig();
  const amount = subscriptionAmountFormatted();
  const description = 'Подписка Premium (30 дней)';
  const payment = await sdk().payments.create(
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
    `sub-${internalUserId}-${Date.now()}`,
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
  return sdk().payments.create(
    {
      amount: { value: amountValue, currency: CurrencyEnum.RUB },
      payment_method_id: paymentMethodId,
      capture: true,
      description,
      receipt: buildReceipt(userEmail, description, amountValue),
      metadata,
    },
    `renew-${metadata.internal_user_id}-${Date.now()}`,
  );
}

export async function loadPayment(id: string) {
  return sdk().payments.load(id);
}
