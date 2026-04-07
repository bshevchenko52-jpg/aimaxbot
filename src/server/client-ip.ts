import type { Request } from 'express';

/**
 * IP клиента с учётом reverse-proxy (nginx).
 * Использует req.ip, который учитывает настройку trust proxy в Express,
 * чтобы предотвратить спуфинг через заголовок X-Forwarded-For.
 * @see https://yookassa.ru/developers/using-api/webhooks#ip
 */
export function getClientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? '';
}
