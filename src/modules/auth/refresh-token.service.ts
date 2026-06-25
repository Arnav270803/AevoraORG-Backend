import { createHash } from "node:crypto";
import { env } from "../../config/env";
import { BadRequestError } from "../../utils/errors";

export function hashRefreshToken(refreshToken: string) {
  return createHash("sha256").update(refreshToken).digest("hex");
}

export function getRefreshTokenExpiresAt() {
  return new Date(Date.now() + parseDurationToMilliseconds(env.JWT_REFRESH_EXPIRES_IN));
}

function parseDurationToMilliseconds(duration: string) {
  const match = duration.trim().match(/^(\d+)([smhd])$/i);

  if (!match) {
    throw new BadRequestError("JWT_REFRESH_EXPIRES_IN must use s, m, h, or d, for example 30d.");
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  } as const;

  return amount * multipliers[unit as keyof typeof multipliers];
}
