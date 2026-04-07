import { Prisma } from '@prisma/client';
import { getConfig } from '../config';
import { prisma } from '../db/prisma';

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

/** Парсинг JSON истории из БД; экспорт для юнит-тестов краевых случаев. */
export function parseStoredMessages(json: unknown): ChatMessage[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((m) => m && typeof m === 'object' && 'role' in m && 'content' in m)
    .map((m) => {
      const o = m as { role: string; content: string };
      const role = o.role === 'assistant' || o.role === 'user' || o.role === 'system' ? o.role : 'user';
      return { role, content: String(o.content ?? '') };
    });
}

export async function getActiveSession(userId: number) {
  let session = await prisma.session.findFirst({
    where: { userId, isActive: true },
    orderBy: { id: 'desc' },
  });
  if (!session) {
    session = await prisma.session.create({
      data: { userId, messages: [], isActive: true },
    });
  }
  return session;
}

export async function startNewSession(userId: number) {
  await prisma.session.updateMany({
    where: { userId, isActive: true },
    data: { isActive: false },
  });
  return prisma.session.create({
    data: { userId, messages: [], isActive: true },
  });
}

export async function getHistoryForLlm(sessionId: number): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const cfg = getConfig();
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return [];
  const all = parseStoredMessages(session.messages).filter((m): m is { role: 'user' | 'assistant'; content: string } => {
    return m.role === 'user' || m.role === 'assistant';
  });
  return all.slice(-cfg.MAX_HISTORY_MESSAGES);
}

export async function appendExchange(sessionId: number, userText: string, assistantText: string): Promise<void> {
  const cfg = getConfig();
  const maxStored = cfg.MAX_HISTORY_MESSAGES * 2;
  // H2: читаем и записываем в одной транзакции для атомарности
  await prisma.$transaction(async (tx) => {
    const session = await tx.session.findUnique({ where: { id: sessionId } });
    if (!session) return;
    const list = parseStoredMessages(session.messages);
    list.push({ role: 'user', content: userText });
    list.push({ role: 'assistant', content: assistantText });
    if (list.length > maxStored) {
      list.splice(0, list.length - maxStored);
    }
    await tx.session.update({
      where: { id: sessionId },
      data: { messages: list as Prisma.InputJsonValue },
    });
  });
}
