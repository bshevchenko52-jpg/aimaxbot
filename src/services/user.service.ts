import type { User as MaxUser } from '@maxhub/max-bot-api/dist/core/network/api';
import { prisma } from '../db/prisma';

export async function getOrCreateByMaxUser(maxUser: MaxUser) {
  return prisma.user.upsert({
    where: { maxUserId: BigInt(maxUser.user_id) },
    create: {
      maxUserId: BigInt(maxUser.user_id),
      username: maxUser.username ?? undefined,
      name: maxUser.name,
    },
    update: {
      username: maxUser.username ?? undefined,
      name: maxUser.name,
    },
  });
}
