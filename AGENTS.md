# AGENTS.md

Описание автоматизированных процессов и сервисов бота.

## Cron-агенты (src/services/cron.service.ts)

| Агент | Расписание (МСК) | Функция |
|-------|-----------------|---------|
| **Сброс лимитов** | `00:00` ежедневно | `limitService.resetAllDailyLimits()` — обнуляет `User.dailyCharsUsed` для всех пользователей |
| **Автопродление** | `00:01` ежедневно | `subscriptionService.tryAutoRenew()` — списывает оплату за подписки, истекающие в течение ±24ч |
| **Деактивация** | `00:10` ежедневно | `subscriptionService.deactivateExpired()` — переводит истёкшие подписки в `plan: free, isActive: false` |
| **Напоминания** | `09:00` ежедневно | `subscriptionService.sendExpiryReminders()` — шлёт уведомление за 3 дня до конца подписки (не чаще раза в 2 дня) |

### Логика автопродления (tryAutoRenew)

1. Найти подписки с `paymentMethodId != null` и `expiresAt` в окне `[now-24h, now+24h]`
2. Проверить: не было ли попытки списания за последние 48ч (дедупликация)
3. Проверить: есть ли email пользователя (54-ФЗ — обязателен для чека)
4. Вызвать `chargeRecurring` — рекуррентный платёж без подтверждения
5. Создать `Transaction` со статусом `pending`
6. При ошибке: уведомить пользователя в бот, залогировать

> ⚠️ **Статус:** рекуррентные платежи не активны — магазин ЮKassa не одобрён. Автопродление не работает до подключения `save_payment_method`.

## Webhook-агент (src/server/yookassa-webhook.ts)

Обрабатывает HTTP-уведомления от ЮKassa на `POST /api/yookassa/webhook`.

**Поток обработки:**
1. Проверить IP источника (`isYooKassaIP` из SDK)
2. Распарсить и валидировать тело (`parseNotification`)
3. **Вернуть 200 немедленно** (ЮKassa требует ответ < 10 сек)
4. Асинхронно: загрузить платёж через API (`loadPayment`) для верификации статуса
5. Идемпотентность: проверить `Transaction.yookassaId` — не обработан ли уже
6. `payment.succeeded` → `activatePremiumAfterPayment` или `extendPremiumAfterRecurring`
7. `payment.canceled` → обновить статус `Transaction`

## Bot-агент (src/bot/register-bot.ts)

Обрабатывает сообщения пользователей в MAX long polling.

**Команды:**

| Команда | Описание |
|---------|----------|
| `/start`, `bot_started` | Приветствие + главное меню |
| `/help` | Справка по командам |
| `/new` | Новый диалог (сброс контекста) |
| `/history` | Список последних 10 непустых диалогов |
| `/status` | Текущий тариф и лимиты |
| `/subscribe` | Создание платежа ЮKassa (запрашивает email если нет) |
| `/cancel` | Отключить автопродление (обнулить `paymentMethodId`) |

**Callbacks (inline-кнопки):**

| Callback | Действие |
|----------|----------|
| `subscribe` | Аналог `/subscribe` |
| `new_session` | Аналог `/new` |
| `status` | Аналог `/status` |
| `history` | Аналог `/history` |
| `main_menu` | Показать главное меню |
| `services` | Описание тарифов и реквизиты |
| `hv_{id}` | Просмотр старого диалога (последние 10 сообщений) |
| `hr_{id}` | Возобновление старого диалога (делает его активным) |

**Throttle:**
- Сообщения: 3 сек между запросами (молчаливый skip)
- `/subscribe`: 60 сек между созданием платежей (только после выхода за email-шаг)

## Сервисы

| Сервис | Файл | Ответственность |
|--------|------|-----------------|
| `userService` | `services/user.service.ts` | `getOrCreateByMaxUser` — upsert пользователя по maxUserId |
| `subscriptionService` | `services/subscription.service.ts` | Активация, продление, деактивация, напоминания |
| `memoryService` | `services/memory.service.ts` | Сессии диалогов, история, appendExchange |
| `limitService` | `services/limit.service.ts` | Дневные лимиты символов, сброс |
| `yookassaPay` | `payments/yookassa-client.ts` | createSubscriptionCheckout, chargeRecurring, loadPayment + retry |
| `completeChat` | `ai/openrouter.ts` | Запросы к OpenRouter LLM |
