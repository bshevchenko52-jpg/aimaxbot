import { describe, expect, it } from 'vitest';
import type { Context } from '@maxhub/max-bot-api';
import { isBotSender, resolveMaxUser } from './max-user';

function ctx(p: Partial<Context>): Context {
  return p as Context;
}

describe('resolveMaxUser', () => {
  it('возвращает ctx.user если есть', () => {
    const user = { user_id: 1, is_bot: false, name: 'u' } as Context['user'];
    expect(resolveMaxUser(ctx({ user }))).toBe(user);
  });

  it('fallback на message.sender для human', () => {
    const sender = { user_id: 42, is_bot: false, name: 's' } as NonNullable<Context['message']>['sender'];
    expect(
      resolveMaxUser(
        ctx({
          message: { sender } as NonNullable<Context['message']>,
        }),
      ),
    ).toBe(sender);
  });

  it('бросает если sender — бот', () => {
    const sender = { user_id: 1, is_bot: true, name: 'bot' } as NonNullable<Context['message']>['sender'];
    expect(() =>
      resolveMaxUser(
        ctx({
          message: { sender } as NonNullable<Context['message']>,
        }),
      ),
    ).toThrow('Cannot resolve MAX user');
  });

  it('бросает если нет user и sender', () => {
    expect(() => resolveMaxUser(ctx({}))).toThrow('Cannot resolve MAX user');
  });
});

describe('isBotSender', () => {
  it('true для sender.is_bot', () => {
    const sender = { is_bot: true } as NonNullable<Context['message']>['sender'];
    expect(isBotSender(ctx({ message: { sender } as NonNullable<Context['message']> }))).toBe(true);
  });

  it('false если sender человек', () => {
    const sender = { is_bot: false } as NonNullable<Context['message']>['sender'];
    expect(isBotSender(ctx({ message: { sender } as NonNullable<Context['message']> }))).toBe(false);
  });

  it('false если нет message', () => {
    expect(isBotSender(ctx({}))).toBe(false);
  });
});
