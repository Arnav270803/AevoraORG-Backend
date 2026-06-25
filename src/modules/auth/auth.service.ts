import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { userService } from "../users/user.service";
import { NotFoundError, UnauthorizedError } from "../../utils/errors";
import type { AuthSession, GoogleSignInInput, PublicUser, RefreshSessionInput } from "./auth.types";
import { verifyGoogleCredential } from "./google.service";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "./jwt.service";
import { getRefreshTokenExpiresAt, hashRefreshToken } from "./refresh-token.service";

export const authService = {
  async signInWithGoogle(input: GoogleSignInInput): Promise<AuthSession> {
    const googleProfile = await verifyGoogleCredential(input.credential);
    const user = await userService.upsertGoogleUser(googleProfile);

    return createSessionForUser(user, {
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });
  },

  async refreshSession(input: RefreshSessionInput): Promise<AuthSession> {
    const payload = await verifyRefreshToken(input.refreshToken);
    const tokenHash = hashRefreshToken(input.refreshToken);
    const existingRefreshToken = await prisma.refreshToken.findUnique({
      where: { id: payload.jti },
      include: { user: true },
    });

    if (
      !existingRefreshToken ||
      existingRefreshToken.userId !== payload.sub ||
      existingRefreshToken.tokenHash !== tokenHash ||
      existingRefreshToken.revokedAt ||
      existingRefreshToken.expiresAt <= new Date()
    ) {
      throw new UnauthorizedError("Refresh token is invalid or expired.");
    }

    const nextRefreshTokenId = randomUUID();
    const nextRefreshToken = await signRefreshToken({
      userId: existingRefreshToken.userId,
      tokenId: nextRefreshTokenId,
    });

    await prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        where: {
          id: existingRefreshToken.id,
          tokenHash,
          revokedAt: null,
          expiresAt: {
            gt: new Date(),
          },
        },
        data: {
          revokedAt: new Date(),
          lastUsedAt: new Date(),
        },
      });

      if (revoked.count !== 1) {
        throw new UnauthorizedError("Refresh token is invalid or expired.");
      }

      await tx.refreshToken.create({
        data: {
          id: nextRefreshTokenId,
          userId: existingRefreshToken.userId,
          tokenHash: hashRefreshToken(nextRefreshToken),
          expiresAt: getRefreshTokenExpiresAt(),
          userAgent: input.userAgent,
          ipAddress: input.ipAddress,
        },
      });
    });

    const accessToken = await signAccessToken({
      userId: existingRefreshToken.user.id,
      email: existingRefreshToken.user.email,
      role: toJwtRole(existingRefreshToken.user.role),
    });

    return {
      user: toPublicUser(existingRefreshToken.user),
      accessToken,
      refreshToken: nextRefreshToken,
    };
  },

  async logout(refreshToken: string): Promise<void> {
    const payload = await verifyRefreshToken(refreshToken);

    await prisma.refreshToken.updateMany({
      where: {
        id: payload.jti,
        userId: payload.sub,
        tokenHash: hashRefreshToken(refreshToken),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        lastUsedAt: new Date(),
      },
    });
  },

  async getCurrentUser(userId?: string) {
    if (!userId) {
      throw new UnauthorizedError("Missing authenticated user.");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError("Authenticated user was not found.");
    }

    return toPublicUser(user);
  },
};

async function createSessionForUser(
  user: User,
  context: {
    userAgent?: string;
    ipAddress?: string;
  },
): Promise<AuthSession> {
  const refreshTokenId = randomUUID();
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({
      userId: user.id,
      email: user.email,
      role: toJwtRole(user.role),
    }),
    signRefreshToken({
      userId: user.id,
      tokenId: refreshTokenId,
    }),
  ]);

  await prisma.refreshToken.create({
    data: {
      id: refreshTokenId,
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: getRefreshTokenExpiresAt(),
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    },
  });

  return {
    user: toPublicUser(user),
    accessToken,
    refreshToken,
  };
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

function toJwtRole(role: User["role"]) {
  return role === "ADMIN" ? "admin" : "user";
}
