import cron, { type ScheduledTask } from 'node-cron';
import { log } from '../lib/logger';
import * as limitService from './limit.service';
import * as subscriptionService from './subscription.service';

// H4: возвращаем задачи для graceful stop при shutdown
export function startCronJobs(): ScheduledTask[] {
  const tasks: ScheduledTask[] = [];

  tasks.push(
    cron.schedule(
      '0 0 * * *',
      () => {
        void limitService
          .resetAllDailyLimits()
          .then(() => log.info('Сброшены дневные лимиты символов'))
          .catch((e) => log.error('Cron 00:00: сброс дневных лимитов символов', e));
      },
      { timezone: 'Europe/Moscow' },
    ),
  );

  tasks.push(
    cron.schedule(
      '1 0 * * *',
      () => {
        void subscriptionService
          .tryAutoRenew()
          .then(() => log.info('Попытки автопродления подписок'))
          .catch((e) => log.error('Cron 00:01: автопродление подписок', e));
      },
      { timezone: 'Europe/Moscow' },
    ),
  );

  tasks.push(
    cron.schedule(
      '10 0 * * *',
      () => {
        void subscriptionService
          .deactivateExpired()
          .then(() => log.info('Деактивация истекших подписок'))
          .catch((e) => log.error('Cron 00:10: деактивация истекших подписок', e));
      },
      { timezone: 'Europe/Moscow' },
    ),
  );

  tasks.push(
    cron.schedule(
      '0 9 * * *',
      () => {
        void subscriptionService
          .sendExpiryReminders()
          .then(() => log.info('Напоминания о подписке'))
          .catch((e) => log.error('Cron 09:00: напоминания о подписке', e));
      },
      { timezone: 'Europe/Moscow' },
    ),
  );

  log.info('Cron: Europe/Moscow — 00:00 лимиты, 00:01 автопродление, 00:10 деактивация, 09:00 напоминания');
  return tasks;
}
