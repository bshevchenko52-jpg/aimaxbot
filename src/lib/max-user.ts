import type { Context } from '@maxhub/max-bot-api';
import type { User } from '@maxhub/max-bot-api/dist/core/network/api';

/**
 * Для update `message_created` поля `user` в контексте нет — отправитель в `message.sender`.
 * См. типы MessageCreatedUpdate в @maxhub/max-bot-api.
 */
export function resolveMaxUser(ctx: Context): User {
  if (ctx.user) return ctx.user;
  const sender = ctx.message?.sender;
  if (sender && !sender.is_bot) return sender;
  throw new Error('Cannot resolve MAX user from context');
}

/** True если сообщение от бота (в т.ч. от этого бота) — не отвечаем. */
export function isBotSender(ctx: Context): boolean {
  return ctx.message?.sender?.is_bot === true;
}
