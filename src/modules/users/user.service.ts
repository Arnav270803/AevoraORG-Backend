import type { User } from "@prisma/client";
import { prisma } from "../../db/prisma";
import type { GoogleProfile } from "../auth/auth.types";

export const userService = {
  async upsertGoogleUser(profile: GoogleProfile): Promise<User> {
    return prisma.$transaction(async (tx) => {
      const existingAccount = await tx.authAccount.findUnique({
        where: {
          provider_providerUserId: {
            provider: "GOOGLE",
            providerUserId: profile.providerUserId,
          },
        },
        include: {
          user: true,
        },
      });

      if (existingAccount) {
        return tx.user.update({
          where: { id: existingAccount.userId },
          data: {
            email: profile.email,
            emailVerified: profile.emailVerified,
            name: profile.name,
            avatarUrl: profile.avatarUrl,
            lastLoginAt: new Date(),
          },
        });
      }

      const existingUser = await tx.user.findUnique({
        where: { email: profile.email },
      });

      if (existingUser) {
        await tx.authAccount.create({
          data: {
            userId: existingUser.id,
            provider: "GOOGLE",
            providerUserId: profile.providerUserId,
          },
        });

        return tx.user.update({
          where: { id: existingUser.id },
          data: {
            emailVerified: profile.emailVerified,
            name: profile.name,
            avatarUrl: profile.avatarUrl,
            lastLoginAt: new Date(),
          },
        });
      }

      return tx.user.create({
        data: {
          email: profile.email,
          emailVerified: profile.emailVerified,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
          lastLoginAt: new Date(),
          authAccounts: {
            create: {
              provider: "GOOGLE",
              providerUserId: profile.providerUserId,
            },
          },
        },
      });
    });
  },
};
