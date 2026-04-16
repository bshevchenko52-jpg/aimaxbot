# MAX AI Bot

AI-ассистент в мессенджере MAX с подпиской Premium через ЮKassa.

## Стек

- **Node.js 20 + TypeScript** — монолит (bot + webhook + cron)
- **MAX Bot API** — long polling (`@maxhub/max-bot-api`)
- **OpenRouter** — LLM-запросы (OpenAI-compatible)
- **ЮKassa** — приём оплаты, 54-ФЗ чеки (`@webzaytsev/yookassa-ts-sdk`)
- **PostgreSQL 16** — хранение пользователей, сессий, подписок, транзакций
- **Prisma ORM** — схема и миграции
- **Docker + Compose** — деплой

## Требования

- Docker + Docker Compose
- Домен с HTTPS (nginx + Let's Encrypt)
- Аккаунт [MAX Developer](https://dev.max.ru) — токен бота
- Аккаунт [OpenRouter](https://openrouter.ai) — API ключ
- Аккаунт [ЮKassa](https://yookassa.ru) — shop_id + secret_key

## Быстрый старт (локально)

```bash
git clone https://github.com/bshevchenko52-jpg/aimaxbot.git
cd aimaxbot
cp .env.example .env
# Заполнить .env (см. раздел ниже)
docker compose up -d --build
```

## Переменные окружения (.env)

| Переменная | Обязательная | Описание |
|---|---|---|
| `BOT_TOKEN` | ✅ | Токен бота от dev.max.ru |
| `OPENROUTER_API_KEY` | ✅ | Ключ OpenRouter |
| `AI_MODEL` | — | Модель (default: `openai/gpt-4o-mini`) |
| `WEB_SEARCH_ENABLED` | — | Веб-поиск через OpenRouter (default: `true`) |
| `SYSTEM_PROMPT` | ✅ | Системный промпт бота |
| `YOOKASSA_SHOP_ID` | ✅ | ID магазина ЮKassa |
| `YOOKASSA_SECRET_KEY` | ✅ | Секретный ключ ЮKassa |
| `YOOKASSA_RETURN_URL` | ✅ | URL после оплаты (напр. `https://domain.ru/payment/done`) |
| `WEBHOOK_PORT` | — | Порт HTTP-сервера (default: `3000`) |
| `TRUST_PROXY` | — | Уровень nginx-прокси (default: `1`) |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `FREE_DAILY_CHAR_LIMIT` | — | Дневной лимит символов free (default: `4000`) |
| `PREMIUM_DAILY_CHAR_LIMIT` | — | Дневной лимит символов premium (default: `150000`) |
| `SUBSCRIPTION_PRICE_RUB` | — | Цена подписки в рублях (default: `70`) |
| `MAX_HISTORY_MESSAGES` | — | Пар сообщений в контексте LLM (default: `100`) |
| `LOG_LEVEL` | — | Уровень логов: debug/info/warn/error (default: `info`) |
| `ADMIN_MAX_USER_IDS` | — | maxUserId админов через запятую |

## Деплой на сервер (Ubuntu 22.04)

```bash
# 1. Установить Docker (если нет)
bash deploy/install-docker.sh

# 2. Скопировать файлы на сервер
scp -r . root@SERVER_IP:/opt/golfclub

# 3. Создать .env
cp /opt/golfclub/.env.example /opt/golfclub/.env
nano /opt/golfclub/.env  # заполнить все ✅ поля

# 4. Запустить
cd /opt/golfclub
docker compose up -d --build

# 5. Проверить
docker compose logs bot -f
curl https://your-domain.ru/health
```

## Настройка nginx

```nginx
server {
    listen 443 ssl;
    server_name your-domain.ru;

    ssl_certificate     /etc/letsencrypt/live/your-domain.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.ru/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Host $host;
    }
}
```

## Настройка ЮKassa

1. **Webhook URL** — в личном кабинете ЮKassa → Интеграция → HTTP-уведомления:
   ```
   https://your-domain.ru/api/yookassa/webhook
   ```
   События: `payment.succeeded`, `payment.canceled`

2. **Рекуррентные платежи** (автопродление) — требует отдельного одобрения менеджером ЮKassa.
   Написать на `b2b@yookassa.ru`: *"Прошу подключить save_payment_method для магазина ID XXXXXX"*
   После одобрения — раскомментировать строку `save_payment_method: true` в [src/payments/yookassa-client.ts](src/payments/yookassa-client.ts#L57).

3. **Тестовые карты** (тестовый магазин):
   - Успешная оплата без 3DS: `5555555555554444`
   - Успешная оплата с 3DS: `5555555555554477`
   - Недостаточно средств: `5555555555554600`

## Команды разработки

```bash
npm run dev          # hot-reload (tsx watch)
npm run build        # TypeScript → dist/
npm start            # запуск скомпилированного

npm test             # vitest run (71 тест)
npm run test:watch   # watch-режим

npm run db:generate  # prisma generate
npm run db:migrate   # prisma migrate dev
npm run db:push      # prisma db push (быстро, без миграций)
npm run db:deploy    # prisma migrate deploy (продакшен)
```

## Архитектура

```
src/
├── index.ts                  # точка входа: Prisma → Bot → Express → Cron
├── config.ts                 # Zod-валидация env
├── bot/
│   ├── register-bot.ts       # команды, callbacks, обработка сообщений
│   ├── keyboards.ts          # inline-клавиатуры
│   └── bot-instance.ts       # singleton getBotApi()
├── server/
│   ├── create-app.ts         # Express: статика, /health, webhook
│   ├── yookassa-webhook.ts   # обработчик ЮKassa (IP-проверка, async)
│   └── client-ip.ts          # getClientIp с учётом trust proxy
├── services/
│   ├── subscription.service.ts  # активация, продление, автопродление, напоминания
│   ├── memory.service.ts        # сессии диалогов, история
│   ├── limit.service.ts         # дневные лимиты символов
│   ├── user.service.ts          # getOrCreate пользователя
│   └── cron.service.ts          # 4 cron-задачи (00:00, 00:01, 00:10, 09:00 МСК)
├── payments/
│   └── yookassa-client.ts    # createSubscriptionCheckout, chargeRecurring, loadPayment
├── ai/
│   └── openrouter.ts         # fetch к OpenRouter chat/completions
├── db/
│   └── prisma.ts             # singleton PrismaClient
└── lib/
    ├── logger.ts             # pino-like логгер
    └── max-user.ts           # resolveMaxUser, isBotSender
```

## Cron (Europe/Moscow)

| Время | Задача |
|-------|--------|
| `00:00` | Сброс дневных лимитов символов |
| `00:01` | Попытки автопродления подписок (требует рекуррентные) |
| `00:10` | Деактивация истёкших подписок |
| `09:00` | Напоминания пользователям за 3 дня до конца |

## Страницы сайта

| URL | Описание |
|-----|----------|
| `/` | Главная (тарифы, описание) |
| `/oferta.html` | Публичная оферта |
| `/privacy.html` | Политика конфиденциальности |
| `/payment/done` | Страница после оплаты |
| `/health` | Healthcheck (статус БД) |
| `/api/yookassa/webhook` | Webhook ЮKassa (POST) |

## Продакшен

- **Сервер:** `72.56.241.185`
- **Домен:** `iiibt.ru` → nginx → порт 3000
- **Путь:** `/opt/golfclub`
- **SSH:** `ssh -i C:\Keys\golfclub_key root@72.56.241.185`

## Реквизиты

ИП Шевченко Богдан Александрович  
ИНН: 612509322600 | ОГРНИП: 326619600075470
