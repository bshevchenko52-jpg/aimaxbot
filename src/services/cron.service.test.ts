import { afterEach, describe, expect, it, vi } from 'vitest';
import cron from 'node-cron';

vi.mock('./limit.service', () => ({
  resetAllDailyLimits: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./subscription.service', () => ({
  tryAutoRenew: vi.fn().mockResolvedValue(undefined),
  deactivateExpired: vi.fn().mockResolvedValue(undefined),
  sendExpiryReminders: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { startCronJobs } from './cron.service';

describe('startCronJobs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('регистрирует 4 задачи с ожидаемыми cron-выражениями и timezone', () => {
    const schedule = vi
      .spyOn(cron, 'schedule')
      .mockReturnValue({ stop: vi.fn() } as ReturnType<typeof cron.schedule>);
    startCronJobs();
    expect(schedule).toHaveBeenCalledTimes(4);
    const exprs = schedule.mock.calls.map((c) => c[0]);
    expect(exprs).toEqual(['0 0 * * *', '1 0 * * *', '10 0 * * *', '0 9 * * *']);
    const zones = schedule.mock.calls.map((c) => (c[2] as { timezone?: string })?.timezone);
    expect(zones.every((z) => z === 'Europe/Moscow')).toBe(true);
  });
});
