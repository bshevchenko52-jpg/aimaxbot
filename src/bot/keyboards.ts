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
