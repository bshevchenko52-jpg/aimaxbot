import type { Api, Bot } from '@maxhub/max-bot-api';

let botRef: Bot | null = null;

export function setBot(bot: Bot): void {
  botRef = bot;
}

export function getBot(): Bot {
  if (!botRef) throw new Error('Bot not initialized');
  return botRef;
}

export function getBotApi(): Api {
  return getBot().api;
}
