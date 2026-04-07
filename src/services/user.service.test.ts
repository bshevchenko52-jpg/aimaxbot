import { beforeEach, describe, expect, it, vi } from 'vitest';

const { upsert } = vi.hoisted(() => ({ upsert: vi.fn() }));

vi.mock('../db/prisma', () => ({
  prisma: { user: { upsert } },
}));

import type { User as MaxUser } from '@maxhub/max-bot-api/dist/core/network/api';
import { getOrCreateByMaxUser } from './user.service';

function maxUser(overrides: Partial<MaxUser> = {}): MaxUser {
  return {
    user_id: 5,
    name: 'Test User',
    username: 'tester',
    is_bot: false,
    ...overrides,
  } as MaxUser;
}

describe('getOrCreateByMaxUser', () => {
  beforeEach(() => upsert.mockReset());

  it('вызывает upsert с bigint maxUserId', async () => {
    upsert.mockResolvedValue({ id: 1 });

    await getOrCreateByMaxUser(maxUser({ user_id: 42 }));

    expect(upsert).toHaveBeenCalledWith({
      where: { maxUserId: 42n },
      create: { maxUserId: 42n, username: 'tester', name: 'Test User' },
      update: { username: 'tester', name: 'Test User' },
    });
  });

  it('передаёт undefined для username если не задан', async () => {
    upsert.mockResolvedValue({});

    await getOrCreateByMaxUser(maxUser({ user_id: 7, username: undefined }));

    const call = upsert.mock.calls[0][0];
    expect(call.create.username).toBeUndefined();
    expect(call.update.username).toBeUndefined();
  });

  it('возвращает результат upsert', async () => {
    const dbUser = { id: 99, maxUserId: 3n, name: 'Hi' };
    upsert.mockResolvedValue(dbUser);

    const result = await getOrCreateByMaxUser(maxUser());

    expect(result).toBe(dbUser);
  });
});
