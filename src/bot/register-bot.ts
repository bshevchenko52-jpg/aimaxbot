import { Bot, Keyboard, type Context } from '@maxhub/max-bot-api';
import type { User as DbUser } from '@prisma/client';
import { getConfig, subscriptionAmountFormatted } from '../config';
import { completeChat } from '../ai/openrouter';
import { log } from '../lib/logger';
import { isBotSender, resolveMaxUser } from '../lib/max-user';
import * as yookassaPay from '../payments/yookassa-client';
import * as limitService from '../services/limit.service';
import * as memoryService from '../services/memory.service';
import * as subscriptionService from '../services/subscription.service';
import * as userService from '../services/user.service';
import { prisma } from '../db/prisma';
import { mainMenu, subscribeHint, backToMenu } from './keyboards';

const MAX_SINGLE_MSG = 4000;

// H1: per-user throttle — Map<userId, timestamp последнего сообщения>
const msgThrottle = new Map<number, number>();
const subscribeThrottle = new Map<number, number>();
const MSG_COOLDOWN_MS = 3_000;
const SUBSCRIBE_COOLDOWN_MS = 60_000;

// B1: ожидание email для чека 54-ФЗ
const awaitingEmail = new Set<number>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function buildStatusMarkdown(user: DbUser): Promise<string> {
  const sub = await subscriptionService.ensureSubscriptionRow(user.id);
  const cfg = getConfig();
  const premium = await subscriptionService.isPremiumActive(user.id);
  // Свежий dailyCharsUsed из БД для точности
  const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
  const dailyUsed = freshUser?.dailyCharsUsed ?? user.dailyCharsUsed;
  const left = await limitService.remainingChars(user.id, dailyUsed);
  const limit = premium ? cfg.PREMIUM_DAILY_CHAR_LIMIT : cfg.FREE_DAILY_CHAR_LIMIT;
  const exp = sub.expiresAt ? sub.expiresAt.toISOString().slice(0, 10) : '—';
  const tier = sub.isActive && sub.plan === 'premium' ? 'Premium' : 'Бесплатно';
  const autoRenew = sub.paymentMethodId ? ' (автопродление включено)' : '';
  return (
    `**Тариф:** ${tier}${autoRenew}\n` +
      '**Символы сегодня:** ' +
      `${dailyUsed} / ${limit} (осталось ${left})\n` +
      `**Конец подписки:** ${exp}\n` +
      `**Модель:** ${cfg.AI_MODEL}`
  );
}

async function sendWelcome(ctx: Context) {
  const text =
    '**Привет.** Я AI-ассистент. Напишите сообщение — отвечу в контексте диалога.\n\n' +
    'Команды: /new — новый диалог, /history — старые диалоги, /status — лимиты, /subscribe — оплата, /cancel — отключить автопродление, /help.';
  await ctx.reply(text, { format: 'markdown', attachments: [mainMenu()] });
}

function payKeyboard(url: string) {
  return Keyboard.inlineKeyboard([[Keyboard.button.link('Перейти к оплате', url)]]);
}

export function registerBot(bot: Bot): void {
  bot.on('bot_started', async (ctx) => {
    try {
      const maxUser = resolveMaxUser(ctx);
      const user = await userService.getOrCreateByMaxUser(maxUser);
      await subscriptionService.ensureSubscriptionRow(user.id);
      await sendWelcome(ctx);
    } catch (e) {
      log.error('bot_started', e);
    }
  });

  bot.command('start', async (ctx) => {
    try {
      const maxUser = resolveMaxUser(ctx);
      const user = await userService.getOrCreateByMaxUser(maxUser);
      await subscriptionService.ensureSubscriptionRow(user.id);
      await sendWelcome(ctx);
    } catch (e) {
      log.error('/start', e);
      await ctx.reply('Не удалось зарегистрироваться. Попробуйте позже.');
    }
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      '**/new** — начать новый диалог (очистить память).\n' +
        '**/history** — посмотреть старые диалоги.\n' +
        '**/status** — тариф и оставшийся лимит символов на сегодня.\n' +
        '**/subscribe** — оплата подписки Premium (ЮKassa, 30 дней).\n' +
        '**/cancel** — отключить автопродление подписки.\n' +
        '**/start** — меню.\n\n' +
        'По вопросам и проблемам — кнопка **Поддержка** в меню.',
      { format: 'markdown', attachments: [mainMenu()] },
    );
  });

  bot.command('new', async (ctx) => {
    try {
      const maxUser = resolveMaxUser(ctx);
      const user = await userService.getOrCreateByMaxUser(maxUser);
      await memoryService.startNewSession(user.id);
      await ctx.reply('Контекст сброшен. Можно писать новое сообщение.', { attachments: [backToMenu()] });
    } catch (e) {
      log.error('/new', e);
      await ctx.reply('Ошибка при создании сессии.');
    }
  });

  bot.command('status', async (ctx) => {
    try {
      const maxUser = resolveMaxUser(ctx);
      const user = await userService.getOrCreateByMaxUser(maxUser);
      const text = await buildStatusMarkdown(user);
      await ctx.reply(text, { format: 'markdown', attachments: [mainMenu()] });
    } catch (e) {
      log.error('/status', e);
      await ctx.reply('Не удалось получить статус.');
    }
  });

  bot.command('history', async (ctx) => {
    try {
      const maxUser = resolveMaxUser(ctx);
      const user = await userService.getOrCreateByMaxUser(maxUser);
      const sessions = await memoryService.getRecentSessions(user.id, 10);
      if (sessions.length === 0) {
        await ctx.reply('Диалогов пока нет.', { attachments: [mainMenu()] });
        return;
      }
      const lines: string[] = ['**Последние диалоги:**\n'];
      const buttons: Array<Array<ReturnType<typeof Keyboard.button.callback>>> = [];
      for (const s of sessions) {
        const msgs = memoryService.parseStoredMessages(s.messages);
        const preview = msgs.find((m) => m.role === 'user')?.content ?? '(пусто)';
        const short = preview.length > 50 ? preview.slice(0, 50) + '…' : preview;
        const date = s.updatedAt.toISOString().slice(0, 10);
        const active = s.isActive ? ' *(текущий)*' : '';
        lines.push(`${date}${active} — ${short}`);
        if (!s.isActive) {
          buttons.push([Keyboard.button.callback(`${date} — ${short.slice(0, 30)}`, `hv_${s.id}`)]);
        }
      }
      const kb = buttons.length > 0
        ? Keyboard.inlineKeyboard([...buttons, [Keyboard.button.callback('Главное меню', 'main_menu')]])
        : mainMenu();
      await ctx.reply(lines.join('\n'), { format: 'markdown', attachments: [kb] });
    } catch (e) {
      log.error('/history', e);
      await ctx.reply('Не удалось загрузить историю.');
    }
  });

  bot.action(/^hv_\d+$/, async (ctx) => {
    await ctx.answerOnCallback({}).catch(() => undefined);
    try {
      const payload = ctx.callback?.payload ?? '';
      const sessionId = parseInt(payload.replace('hv_', ''), 10);
      if (!sessionId) return;
      const maxUser = resolveMaxUser(ctx);
      const user = await userService.getOrCreateByMaxUser(maxUser);
      const msgs = await memoryService.getSessionMessages(sessionId, user.id);
      if (!msgs || msgs.length === 0) {
        await ctx.reply('Диалог пуст или не найден.');
        return;
      }
      const last = msgs.slice(-10);
      const lines: string[] = ['**Диалог:**\n'];
      for (const m of last) {
        const prefix = m.role === 'user' ? '**Вы:**' : '**Бот:**';
        const content = m.content.length > 300 ? m.content.slice(0, 300) + '…' : m.content;
        lines.push(`${prefix} ${content}\n`);
      }
      if (msgs.length > 10) {
        lines.unshift(`_(показаны последние 10 из ${msgs.length} сообщений)_\n`);
      }
      const resumeBtn = Keyboard.inlineKeyboard([
        [Keyboard.button.callback('Продолжить этот диалог', `hr_${sessionId}`)],
        [Keyboard.button.callback('Главное меню', 'main_menu')],
      ]);
      await ctx.reply(lines.join('\n'), { format: 'markdown', attachments: [resumeBtn] });
    } catch (e) {
      log.error('hv_ callback', e);
      await ctx.reply('Не удалось загрузить диалог.');
    }
  });

  // Возобновление старого диалога
  bot.action(/^hr_\d+$/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Диалог восстановлен' }).catch(() => undefined);
    try {
      const payload = ctx.callback?.payload ?? '';
      const sessionId = parseInt(payload.replace('hr_', ''), 10);
      if (!sessionId) return;
      const maxUser = resolveMaxUser(ctx);
      const user = await userService.getOrCreateByMaxUser(maxUser);
      // Деактивируем текущую сессию, активируем выбранную
      await prisma.session.updateMany({ where: { userId: user.id, isActive: true }, data: { isActive: false } });
      const restored = await prisma.session.updateMany({ where: { id: sessionId, userId: user.id }, data: { isActive: true } });
      if (restored.count === 0) {
        await ctx.reply('Диалог не найден.');
        return;
      }
      await ctx.reply('Диалог восстановлен. Продолжайте общение.', { attachments: [backToMenu()] });
    } catch (e) {
      log.error('hr_ callback', e);
      await ctx.reply('Не удалось восстановить диалог.');
    }
  });

  // M5: команда отмены автопродления
  bot.command('cancel', async (ctx) => {
    try {
      const maxUser = resolveMaxUser(ctx);
      const user = await userService.getOrCreateByMaxUser(maxUser);
      const sub = await subscriptionService.getSubscription(user.id);
      if (!sub?.paymentMethodId) {
        await ctx.reply('Автопродление не подключено или уже отключено.');
        return;
      }
      await prisma.subscription.update({
        where: { userId: user.id },
        data: { paymentMethodId: null },
      });
      await ctx.reply(
        'Автопродление подписки отключено. Подписка действует до истечения текущего периода.\n' +
          'Для ручного продления используйте /subscribe.',
        { attachments: [mainMenu()] },
      );
    } catch (e) {
      log.error('/cancel', e);
      await ctx.reply('Не удалось отключить автопродление. Попробуйте позже.');
    }
  });

  const doSubscribe = async (ctx: Context) => {
    try {
      const maxUser = resolveMaxUser(ctx);
      const user = await userService.getOrCreateByMaxUser(maxUser);

      // H1: throttle на /subscribe — не чаще раза в минуту
      const lastSub = subscribeThrottle.get(user.id) ?? 0;
      if (Date.now() - lastSub < SUBSCRIBE_COOLDOWN_MS) {
        await ctx.reply('Подождите минуту перед повторным запросом оплаты.');
        return;
      }
      subscribeThrottle.set(user.id, Date.now());

      await subscriptionService.ensureSubscriptionRow(user.id);

      // B1: нужен email для чека (54-ФЗ)
      const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
      if (!freshUser?.email) {
        awaitingEmail.add(user.id);
        await ctx.reply('Для формирования кассового чека (54-ФЗ) введите ваш email:');
        return;
      }

      const { confirmationUrl } = await yookassaPay.createSubscriptionCheckout(user.id, freshUser.email);
      await ctx.reply(
        `Оплата подписки Premium — **${subscriptionAmountFormatted()} ₽** / 30 дней.\n` +
          'Нажмите кнопку и завершите оплату на стороне ЮKassa.',
        { format: 'markdown', attachments: [payKeyboard(confirmationUrl)] },
      );
    } catch (e) {
      log.error('subscribe', e);
      await ctx.reply('Не удалось создать платёж. Попробуйте позже или проверьте настройки ЮKassa.');
    }
  };

  bot.command('subscribe', doSubscribe);

  bot.action('subscribe', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Создаю ссылку…' }).catch(() => undefined);
    await doSubscribe(ctx);
  });

  bot.action('new_session', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Готово' }).catch(() => undefined);
    try {
      const maxUser = resolveMaxUser(ctx);
      const user = await userService.getOrCreateByMaxUser(maxUser);
      await memoryService.startNewSession(user.id);
      await ctx.reply('Новый диалог начат.', { attachments: [backToMenu()] });
    } catch (e) {
      log.error('callback new_session', e);
      await ctx.reply('Ошибка.');
    }
  });

  bot.action('services', async (ctx) => {
    await ctx.answerOnCallback({}).catch(() => undefined);
    const cfg = getConfig();
    const text =
      '**AI-ассистент в мессенджере MAX**\n\n' +
      'Умный помощник на базе искусственного интеллекта. Отвечает на вопросы, помогает с текстами, анализом данных, кодом и повседневными задачами.\n\n' +
      '**Тарифы:**\n' +
      `— Бесплатный: ${cfg.FREE_DAILY_CHAR_LIMIT} символов/день, 0 ₽\n` +
      `— Premium: ${cfg.PREMIUM_DAILY_CHAR_LIMIT} символов/день, ${subscriptionAmountFormatted()} ₽ / 30 дней\n\n` +
      '**Что входит в Premium:**\n' +
      `— ${cfg.PREMIUM_DAILY_CHAR_LIMIT} символов в день (вместо ${cfg.FREE_DAILY_CHAR_LIMIT})\n` +
      '— Автопродление подписки\n' +
      '— Приоритетная поддержка\n\n' +
      '**Оплата:** ЮKassa (Visa, MasterCard, МИР, СБП)\n' +
      'Данные карт не хранятся на нашем сервере.\n\n' +
      '**Реквизиты:**\n' +
      'ИП Шевченко Богдан Александрович\n' +
      'ИНН: 612509322600 | ОГРНИП: 326619600075470\n' +
      'Тел: +7 951 833 87 50 | bshevchenko52@gmail.com\n\n' +
      'Оферта: https://iiibt.ru/oferta.html\n' +
      'Конфиденциальность: https://iiibt.ru/privacy.html';
    await ctx.reply(text, { format: 'markdown', attachments: [mainMenu()] });
  });

  bot.action('main_menu', async (ctx) => {
    await ctx.answerOnCallback({}).catch(() => undefined);
    await ctx.reply('Главное меню:', { attachments: [mainMenu()] });
  });

  bot.action('history', async (ctx) => {
    await ctx.answerOnCallback({}).catch(() => undefined);
    try {
      const maxUser = resolveMaxUser(ctx);
      const user = await userService.getOrCreateByMaxUser(maxUser);
      const sessions = await memoryService.getRecentSessions(user.id, 10);
      if (sessions.length === 0) {
        await ctx.reply('Диалогов пока нет.', { attachments: [mainMenu()] });
        return;
      }
      const lines: string[] = ['**Последние диалоги:**\n'];
      const buttons: Array<Array<ReturnType<typeof Keyboard.button.callback>>> = [];
      for (const s of sessions) {
        const msgs = memoryService.parseStoredMessages(s.messages);
        const preview = msgs.find((m) => m.role === 'user')?.content ?? '(пусто)';
        const short = preview.length > 50 ? preview.slice(0, 50) + '…' : preview;
        const date = s.updatedAt.toISOString().slice(0, 10);
        const active = s.isActive ? ' *(текущий)*' : '';
        lines.push(`${date}${active} — ${short}`);
        if (!s.isActive) {
          buttons.push([Keyboard.button.callback(`${date} — ${short.slice(0, 30)}`, `hv_${s.id}`)]);
        }
      }
      const kb = buttons.length > 0
        ? Keyboard.inlineKeyboard([...buttons, [Keyboard.button.callback('Главное меню', 'main_menu')]])
        : mainMenu();
      await ctx.reply(lines.join('\n'), { format: 'markdown', attachments: [kb] });
    } catch (e) {
      log.error('callback history', e);
      await ctx.reply('Не удалось загрузить историю.');
    }
  });

  bot.action('status', async (ctx) => {
    await ctx.answerOnCallback({}).catch(() => undefined);
    try {
      const maxUser = resolveMaxUser(ctx);
      const user = await userService.getOrCreateByMaxUser(maxUser);
      const text = await buildStatusMarkdown(user);
      await ctx.reply(text, { format: 'markdown', attachments: [mainMenu()] });
    } catch (e) {
      log.error('callback status', e);
      // H3: отвечаем пользователю при ошибке
      await ctx.reply('Не удалось получить статус.').catch(() => undefined);
    }
  });

  bot.on('message_created', async (ctx, next) => {
    if (isBotSender(ctx)) {
      await next();
      return;
    }
    const textRaw = ctx.message?.body?.text;
    if (!textRaw || !String(textRaw).trim()) {
      await next();
      return;
    }
    const text = String(textRaw).trim();
    if (text.startsWith('/')) {
      await next();
      return;
    }

    if (text.length > MAX_SINGLE_MSG) {
      await ctx.reply(
        `Сообщение слишком длинное (${text.length} символов, максимум ${MAX_SINGLE_MSG}). Разбейте на части.`,
      );
      return;
    }

    try {
      const maxUser = resolveMaxUser(ctx);
      const user = await userService.getOrCreateByMaxUser(maxUser);

      // B1: обработка email, введённого для чека
      if (awaitingEmail.has(user.id)) {
        const emailInput = text.toLowerCase().trim();
        if (EMAIL_RE.test(emailInput)) {
          await prisma.user.update({ where: { id: user.id }, data: { email: emailInput } });
          awaitingEmail.delete(user.id);
          await doSubscribe(ctx);
        } else {
          await ctx.reply('Некорректный email. Введите действующий адрес электронной почты:');
        }
        return;
      }

      // H1: throttle на сообщения — не чаще раза в 3 секунды
      const lastMsg = msgThrottle.get(user.id) ?? 0;
      if (Date.now() - lastMsg < MSG_COOLDOWN_MS) {
        return; // молча игнорируем, не засоряем чат
      }
      msgThrottle.set(user.id, Date.now());

      await subscriptionService.ensureSubscriptionRow(user.id);

      // C4: атомарная проверка + резервирование лимита через conditional update
      const limit = await limitService.getDailyLimit(user.id);
      const reserved = await prisma.user.updateMany({
        where: {
          id: user.id,
          dailyCharsUsed: { lte: limit - text.length },
        },
        data: { dailyCharsUsed: { increment: text.length } },
      });

      if (reserved.count === 0) {
        await ctx.reply(
          'Лимит символов на сегодня исчерпан. Завтра лимит обновится, либо оформите Premium: /subscribe',
          { attachments: [subscribeHint()] },
        );
        return;
      }

      const session = await memoryService.getActiveSession(user.id);
      const history = await memoryService.getHistoryForLlm(session.id);

      const replyAi = await completeChat(history, text);

      // Вычисляем доступный остаток после резервирования text.length
      const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
      const usedAfterReserve = freshUser?.dailyCharsUsed ?? 0;
      const remaining = Math.max(0, limit - usedAfterReserve);

      let answer = replyAi;
      if (answer.length > remaining) {
        answer = answer.slice(0, remaining) + '\n… (сокращено из‑за дневного лимита символов)';
      }

      await memoryService.appendExchange(session.id, text, answer);
      // Списываем только символы ответа (text.length уже зарезервирован выше)
      if (answer.length > 0) {
        await limitService.useChars(user.id, answer.length);
      }
      await ctx.reply(answer, { format: 'markdown' });
    } catch (e) {
      log.error('message_created LLM', e);
      await ctx.reply('Сервис временно недоступен. Попробуйте позже.');
    }
  });
}
