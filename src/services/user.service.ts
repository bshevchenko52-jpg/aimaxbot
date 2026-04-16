import type { User as MaxUser } from '@maxhub/max-bot-api/dist/core/network/api';
import { getConfig } from '../config';
import { prisma } from '../db/prisma';

export async function getOrCreateByMaxUser(maxUser: MaxUser) {
  const cfg = getConfig();
  const isAdmin = cfg.ADMIN_MAX_USER_IDS.includes(String(maxUser.user_id));

  return prisma.user.upsert({
    where: { maxUserId: BigInt(maxUser.user_id) },
    create: {
      maxUserId: BigInt(maxUser.user_id),
      username: maxUser.username ?? undefined,
      name: maxUser.name,
      isAdmin,
    },
    update: {
      username: maxUser.username ?? undefined,
      name: maxUser.name,
      isAdmin,
    },
  });
}
