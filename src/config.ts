import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_REFERER: z.string().url().optional().default('https://localhost'),
  OPENROUTER_TITLE: z.string().optional().default('MAX AI Bot'),
  AI_MODEL: z.string().min(1).default('openai/gpt-4o-mini'),
  WEB_SEARCH_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .transform((v) => v === 'true' || v === '1')
    .default('true'),
  SYSTEM_PROMPT: z.string().min(1),
  YOOKASSA_SHOP_ID: z.string().min(1),
  YOOKASSA_SECRET_KEY: z.string().min(1),
  YOOKASSA_RETURN_URL: z.string().url(),
  WEBHOOK_PORT: z.coerce.number().int().positive().default(3000),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  DATABASE_URL: z.string().min(1),
  FREE_DAILY_CHAR_LIMIT: z.coerce.number().int().positive().default(4_000),
  PREMIUM_DAILY_CHAR_LIMIT: z.coerce.number().int().positive().default(150_000),
  SUBSCRIPTION_PRICE_RUB: z.coerce.number().positive().default(70),
  MAX_HISTORY_MESSAGES: z.coerce.number().int().positive().max(200).default(100),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ADMIN_MAX_USER_IDS: z
    .string()
    .optional()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
});

export type AppConfig = z.infer<typeof envSchema>;


let cached: AppConfig | null = null;

/** Сброс кэша для тестов (после смены `process.env`). */
export function resetConfigCacheForTests(): void {
  cached = null;
}

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables — see .env.example');
  }
  cached = parsed.data;
  return cached;
}

export function subscriptionAmountFormatted(): string {
  const c = getConfig();
  return c.SUBSCRIPTION_PRICE_RUB.toFixed(2);
}
