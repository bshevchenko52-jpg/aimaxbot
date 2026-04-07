import { afterEach, describe, expect, it } from 'vitest';
import { getConfig, resetConfigCacheForTests, subscriptionAmountFormatted } from './config';

const envSnapshot = { ...process.env };

describe('getConfig', () => {
  afterEach(() => {
    process.env = { ...envSnapshot };
    resetConfigCacheForTests();
  });

  it('подставляет default OPENROUTER_REFERER если ключ отсутствует', () => {
    delete process.env.OPENROUTER_REFERER;
    resetConfigCacheForTests();
    expect(getConfig().OPENROUTER_REFERER).toBe('https://localhost');
  });

  it('коэрцирует WEBHOOK_PORT в число', () => {
    process.env.WEBHOOK_PORT = '8080';
    resetConfigCacheForTests();
    expect(getConfig().WEBHOOK_PORT).toBe(8080);
  });

  it('бросает при пустом BOT_TOKEN', () => {
    process.env.BOT_TOKEN = '';
    resetConfigCacheForTests();
    expect(() => getConfig()).toThrow('Invalid environment variables');
  });

  it('subscriptionAmountFormatted фиксирует 2 десятичных знака', () => {
    process.env.SUBSCRIPTION_PRICE_RUB = '199.5';
    resetConfigCacheForTests();
    expect(subscriptionAmountFormatted()).toBe('199.50');
  });
});
