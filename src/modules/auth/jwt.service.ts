import { jwtVerify, SignJWT } from "jose";
import { env } from "../../config/env";
import { TOKEN_TYPE } from "../../constants/auth";
import { UnauthorizedError } from "../../utils/errors";
import type { AccessTokenPayload, RefreshTokenPayload, UserRole } from "./auth.types";

const encoder = new TextEncoder();
const accessSecret = encoder.encode(env.JWT_ACCESS_SECRET);
const refreshSecret = encoder.encode(env.JWT_REFRESH_SECRET);

export async function signAccessToken(input: { userId: string; email: string; role?: UserRole }) {
  return new SignJWT({
    email: input.email,
    role: input.role ?? "user",
    tokenType: TOKEN_TYPE.ACCESS,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.userId)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_EXPIRES_IN)
    .sign(accessSecret);
}

export async function signRefreshToken(input: { userId: string; tokenId: string }) {
  return new SignJWT({
    tokenType: TOKEN_TYPE.REFRESH,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.userId)
    .setJti(input.tokenId)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(env.JWT_REFRESH_EXPIRES_IN)
    .sign(refreshSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, accessSecret, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  }).catch(() => {
    throw new UnauthorizedError("Invalid or expired access token.");
  });

  if (!payload.sub || payload.tokenType !== TOKEN_TYPE.ACCESS) {
    throw new UnauthorizedError("Invalid access token.");
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    role: payload.role === "admin" ? "admin" : "user",
    tokenType: TOKEN_TYPE.ACCESS,
  };
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, refreshSecret, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  }).catch(() => {
    throw new UnauthorizedError("Invalid or expired refresh token.");
  });

  if (!payload.sub || payload.tokenType !== TOKEN_TYPE.REFRESH || typeof payload.jti !== "string") {
    throw new UnauthorizedError("Invalid refresh token.");
  }

  return {
    sub: payload.sub,
    jti: payload.jti,
    tokenType: TOKEN_TYPE.REFRESH,
  };
}
