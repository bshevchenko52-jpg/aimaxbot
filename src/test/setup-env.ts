/**
 * Минимальный .env для модулей, вызывающих getConfig() при импорте/в тестах.
 */
import { resetConfigCacheForTests } from '../config';

const defaults: Record<string, string> = {
  BOT_TOKEN: 'test-bot-token',
  OPENROUTER_API_KEY: 'test-or-key',
  OPENROUTER_REFERER: 'https://example.test',
  OPENROUTER_TITLE: 'Test Bot',
  AI_MODEL: 'openai/gpt-4o-mini',
  SYSTEM_PROMPT: 'You are a test assistant.',
  YOOKASSA_SHOP_ID: '123456',
  YOOKASSA_SECRET_KEY: 'test-secret',
  YOOKASSA_RETURN_URL: 'https://example.test/pay/return',
  DATABASE_URL: 'postgresql://bot:bot@localhost:5432/golfclub_test',
  WEBHOOK_PORT: '3000',
  TRUST_PROXY: '1',
  FREE_DAILY_CHAR_LIMIT: '5000',
  PREMIUM_DAILY_CHAR_LIMIT: '500000',
  SUBSCRIPTION_PRICE_RUB: '299',
  MAX_HISTORY_MESSAGES: '30',
  LOG_LEVEL: 'error',
};

for (const [key, value] of Object.entries(defaults)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

process.env.NODE_ENV = 'test';

resetConfigCacheForTests();
