import { Keyboard } from '@maxhub/max-bot-api';

const SUPPORT_URL = 'https://max.ru/u/f9LHodD0cOIsD1_JrvYbcmpcX2P_UhKVkp4wuzH7-Z1tGpqpeXznAX1Ld2o';

export function mainMenu() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback('Новый диалог', 'new_session'),
      Keyboard.button.callback('Статус', 'status'),
    ],
    [Keyboard.button.callback('Подписка Premium', 'subscribe')],
    [Keyboard.button.callback('История диалогов', 'history')],
    [Keyboard.button.callback('Услуги и цены', 'services')],
    [Keyboard.button.link('Поддержка', SUPPORT_URL)],
  ]);
}

export function subscribeHint() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('Оформить подписку', 'subscribe')],
  ]);
}

export function backToMenu() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('Главное меню', 'main_menu')],
  ]);
}

/** Главное меню админ-панели */
export function adminMenu() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('Статистика', 'adm_stats')],
    [Keyboard.button.callback('Список пользователей', 'adm_users_0')],
    [Keyboard.button.callback('Главное меню', 'main_menu')],
  ]);
}

/** Навигация по списку пользователей */
export function adminUserListNav(page: number, totalPages: number) {
  const nav: ReturnType<typeof Keyboard.button.callback>[] = [];
  if (page > 0) nav.push(Keyboard.button.callback('<< Назад', `adm_users_${page - 1}`));
  if (page < totalPages - 1) nav.push(Keyboard.button.callback('Вперёд >>', `adm_users_${page + 1}`));
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [];
  if (nav.length > 0) rows.push(nav);
  rows.push([Keyboard.button.callback('Админ-меню', 'adm_menu')]);
  return Keyboard.inlineKeyboard(rows);
}

/** Кнопки под карточкой пользователя */
export function adminUserCard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('Список пользователей', 'adm_users_0')],
    [Keyboard.button.callback('Админ-меню', 'adm_menu')],
  ]);
}
