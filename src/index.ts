import type { Server } from 'node:http';
import { Bot } from '@maxhub/max-bot-api';
import { getConfig } from './config';
import { prisma } from './db/prisma';
import { log } from './lib/logger';
import { setBot } from './bot/bot-instance';
import { registerBot } from './bot/register-bot';
import { createApp } from './server/create-app';
import { startCronJobs } from './services/cron.service';

async function main(): Promise<void> {
  const cfg = getConfig();
  await prisma.$connect();
  log.info('База данных подключена');

  const bot = new Bot(cfg.BOT_TOKEN);
  setBot(bot);
  registerBot(bot);

  bot.catch((err, ctx) => {
    log.error('Ошибка в обработчике бота', { err, updateType: ctx?.updateType });
  });

  const app = createApp();
  const server: Server = app.listen(cfg.WEBHOOK_PORT, () => {
    log.info(`HTTP-сервер: порт ${cfg.WEBHOOK_PORT} (webhook ЮKassa: POST /api/yookassa/webhook)`);
  });

  const cronTasks = startCronJobs();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal}: завершение процесса…`);
    // H4: останавливаем cron до отключения Prisma
    for (const task of cronTasks) {
      try { task.stop(); } catch { /* ignore */ }
    }
    try {
      bot.stop();
    } catch (e) {
      log.warn('bot.stop()', e);
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  log.info('Запуск long polling MAX Bot…');
  await bot.start();
}

main().catch((e) => {
  log.error('Фатальная ошибка при запуске', e);
  process.exit(1);
});
