import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sessionFindUnique, sessionUpdate, txImpl } = vi.hoisted(() => {
  const sessionFindUnique = vi.fn();
  const sessionUpdate = vi.fn();
  // $transaction вызывает callback с tx, у которого есть session.findUnique и session.update
  const txImpl = vi.fn((cb: (tx: unknown) => Promise<unknown>) =>
    cb({ session: { findUnique: sessionFindUnique, update: sessionUpdate } }),
  );
  return { sessionFindUnique, sessionUpdate, txImpl };
});

vi.mock('../db/prisma', () => ({
  prisma: {
    $transaction: txImpl,
    session: {
      findUnique: sessionFindUnique,
      update: sessionUpdate,
    },
  },
}));

vi.mock('../config', () => ({
  getConfig: () => ({
    MAX_HISTORY_MESSAGES: 2,
  }),
}));

import { appendExchange, getHistoryForLlm } from './memory.service';

describe('getHistoryForLlm', () => {
  beforeEach(() => {
    sessionFindUnique.mockReset();
  });

  it('возвращает [] если сессии нет', async () => {
    sessionFindUnique.mockResolvedValue(null);
    expect(await getHistoryForLlm(999)).toEqual([]);
  });

  it('отрезает system и берёт последние MAX_HISTORY_MESSAGES сообщений user/assistant', async () => {
    sessionFindUnique.mockResolvedValue({
      id: 1,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
        { role: 'assistant', content: 'd' },
        { role: 'user', content: 'e' },
        { role: 'assistant', content: 'f' },
      ],
    });

    const hist = await getHistoryForLlm(1);
    expect(hist).toEqual([
      { role: 'user', content: 'e' },
      { role: 'assistant', content: 'f' },
    ]);
  });
});

describe('appendExchange', () => {
  beforeEach(() => {
    sessionFindUnique.mockReset();
    sessionUpdate.mockReset();
  });

  it('ничего не делает если сессия не найдена', async () => {
    sessionFindUnique.mockResolvedValue(null);
    await appendExchange(1, 'u', 'a');
    expect(sessionUpdate).not.toHaveBeenCalled();
  });

  it('обрезает хвост до MAX_HISTORY_MESSAGES * 2 элементов', async () => {
    const many = Array.from({ length: 6 }, (_, i) => [
      { role: 'user' as const, content: `u${i}` },
      { role: 'assistant' as const, content: `a${i}` },
    ]).flat();

    sessionFindUnique.mockResolvedValue({
      id: 5,
      messages: many,
    });
    sessionUpdate.mockResolvedValue(undefined);

    await appendExchange(5, 'last_u', 'last_a');

    expect(sessionUpdate).toHaveBeenCalledTimes(1);
    const data = sessionUpdate.mock.calls[0][0].data as { messages: unknown[] };
    expect(data.messages).toHaveLength(4);
    expect(data.messages).toEqual([
      { role: 'user', content: 'u5' },
      { role: 'assistant', content: 'a5' },
      { role: 'user', content: 'last_u' },
      { role: 'assistant', content: 'last_a' },
    ]);
  });
});
