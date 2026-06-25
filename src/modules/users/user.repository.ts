import { prisma } from "../../db/prisma";

export const userRepository = {
  findById(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
    });
  },

  findByProvider(provider: "GOOGLE", providerUserId: string) {
    return prisma.authAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId,
        },
      },
      include: {
        user: true,
      },
    });
  },
};
