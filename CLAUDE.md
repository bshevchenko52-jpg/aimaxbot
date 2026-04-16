# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Проект

MAX messenger AI-бот (long polling) с оплатой подписки через ЮKassa и ответами через OpenRouter LLM. Монолит Node.js/TypeScript: Express + MAX bot + cron в одном процессе.

## Команды

```bash
npm run dev              # Запуск с hot-reload (tsx watch)
npm run build            # Компиляция TypeScript → dist/
npm start                # Запуск скомпилированного dist/index.js

npm test                 # Запуск всех тестов (vitest run) — 71 тест
npm run test:watch       # Тесты в watch-режиме
npx vitest run src/services/user.service.test.ts  # Один тест-файл

npm run db:generate      # prisma generate
npm run db:migrate       # prisma migrate dev (разработка)
npm run db:push          # prisma db push (быстрое применение схемы)
npm run db:deploy        # prisma migrate deploy (продакшен)

docker compose up -d --build  # Полный стек с PostgreSQL
```

## Деплой

Сервер `72.56.241.185` (SSH: `ssh -i C:\Keys\golfclub_key root@72.56.241.185`), путь `/opt/golfclub`.
Домен `iiibt.ru`, nginx → порт 3000, HTTPS через Let's Encrypt.
Git-репо на сервере **нет** — файлы копируются через `scp`, потом `docker compose up -d --build bot`.

```bash
# Деплой изменённых файлов:
scp -i "C:/Keys/golfclub_key" src/some/file.ts root@72.56.241.185:/opt/golfclub/src/some/file.ts
ssh -i "C:/Keys/golfclub_key" root@72.56.241.185 "cd /opt/golfclub && docker compose up -d --build bot"
```

## Архитектура

Единая точка входа `src/index.ts` поднимает: Prisma → Bot (long polling) → Express (порт 3000) → cron-задачи.

**Слои:**
- `src/bot/` — обработчики команд MAX, клавиатуры, singleton бота (`getBotApi()` для доступа из сервисов)
- `src/server/` — Express: webhook ЮKassa (`POST /api/yookassa/webhook`), healthcheck (`GET /health`), статика из `public/`
- `src/services/` — бизнес-логика: подписки, лимиты символов, cron (автопродление, деактивация, сброс лимитов), управление пользователями, память диалогов
- `src/payments/` — клиент ЮKassa: создание checkout, рекуррентные списания, retry при 500
- `src/ai/` — вызовы OpenRouter (fetch к chat/completions)
- `src/db/prisma.ts` — экземпляр PrismaClient
- `src/config.ts` — Zod-валидация всех env-переменных при старте

**Модели Prisma:** User, Session (JSON messages), Subscription, Transaction. Схема в `prisma/schema.prisma`.

## Особенности

- **MAX Bot API**: у события `message_created` отправитель — `message.sender`, не `ctx.user`. Для получения пользователя использовать `resolveMaxUser()` из `src/lib/max-user.ts`.
- **CommonJS**: проект использует `module: "CommonJS"` в tsconfig. ESM-only пакеты нужно оборачивать динамическим import.
- **Тесты**: vitest, setup-файл `src/test/setup-env.ts` подставляет тестовые env-переменные и сбрасывает кэш конфига. Тесты не требуют БД — моки через vitest.
- **Один инстанс**: нельзя запускать несколько экземпляров с cron — двойные автосписания.
- **Webhook ЮKassa**: проверка IP через `isYooKassaIP` из SDK, повторный запрос платежа `payments.load` для подтверждения, идемпотентность по `Transaction.yookassaId`. Webhook возвращает 200 немедленно, обработка асинхронна.
- **Dockerfile**: `COPY prisma ./prisma` обязательно ДО `npm ci` в обоих стейджах; используется `npm ci --ignore-scripts` + явный `npx prisma generate`.
- **Веб-поиск**: OpenRouter server tool `openrouter:web_search`; `tool_choice: "required"` несовместим с server tools.
- **ЮKassa рекуррентные платежи**: `save_payment_method: true` закомментирован — магазин не одобрён ЮKassa. После одобрения раскомментировать в `src/payments/yookassa-client.ts:57`.
- **Email для чеков**: бот запрашивает email у пользователя перед созданием платежа (54-ФЗ). Хранится в `User.email`. Без email рекуррентное автопродление пропускается с warn в лог.
- **Пустые сессии**: `getRecentSessions()` фильтрует сессии без сообщений на уровне приложения (Prisma JSON-фильтр для пустых массивов ненадёжен).
- **Админ-панель**: команда `/admin` доступна пользователям с `isAdmin=true`. Первые админы задаются через `ADMIN_MAX_USER_IDS` в env (список maxUserId через запятую). Флаг обновляется при каждом обращении к боту. Сервис: `src/services/admin.service.ts`.

## Cron-расписание (Europe/Moscow)

- `00:00` — сброс дневных лимитов
- `00:01` — автопродление подписок (±24ч от expiresAt, требует рекуррентные платежи)
- `00:10` — деактивация истёкших
- `09:00` — напоминания пользователям за 3 дня до конца

## ЮKassa — настройки в продакшене

- **Webhook URL**: `https://iiibt.ru/api/yookassa/webhook`
- **События**: `payment.succeeded`, `payment.canceled`
- **Shop ID**: 1315903
- **Return URL**: `https://iiibt.ru/payment/done`
- **Рекуррентные**: не активны, запросить у менеджера ЮKassa
