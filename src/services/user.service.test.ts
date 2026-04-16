import { beforeEach, describe, expect, it, vi } from 'vitest';

const { upsert, mockGetConfig } = vi.hoisted(() => ({
  upsert: vi.fn(),
  mockGetConfig: vi.fn(() => ({ ADMIN_MAX_USER_IDS: [] as string[] })),
}));

vi.mock('../db/prisma', () => ({
  prisma: { user: { upsert } },
}));

vi.mock('../config', () => ({
  getConfig: mockGetConfig,
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
  beforeEach(() => {
    upsert.mockReset();
    mockGetConfig.mockReturnValue({ ADMIN_MAX_USER_IDS: [] });
  });

  it('вызывает upsert с bigint maxUserId', async () => {
    upsert.mockResolvedValue({ id: 1 });

    await getOrCreateByMaxUser(maxUser({ user_id: 42 }));

    expect(upsert).toHaveBeenCalledWith({
      where: { maxUserId: 42n },
      create: { maxUserId: 42n, username: 'tester', name: 'Test User', isAdmin: false },
      update: { username: 'tester', name: 'Test User', isAdmin: false },
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

  it('ставит isAdmin=true если maxUserId в ADMIN_MAX_USER_IDS', async () => {
    mockGetConfig.mockReturnValue({ ADMIN_MAX_USER_IDS: ['100', '200'] });
    upsert.mockResolvedValue({ id: 1 });

    await getOrCreateByMaxUser(maxUser({ user_id: 100 }));

    const call = upsert.mock.calls[0][0];
    expect(call.create.isAdmin).toBe(true);
    expect(call.update.isAdmin).toBe(true);
  });

  it('ставит isAdmin=false если maxUserId НЕ в ADMIN_MAX_USER_IDS', async () => {
    mockGetConfig.mockReturnValue({ ADMIN_MAX_USER_IDS: ['100', '200'] });
    upsert.mockResolvedValue({ id: 1 });

    await getOrCreateByMaxUser(maxUser({ user_id: 999 }));

    const call = upsert.mock.calls[0][0];
    expect(call.create.isAdmin).toBe(false);
    expect(call.update.isAdmin).toBe(false);
  });
});
