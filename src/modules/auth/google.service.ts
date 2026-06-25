import { OAuth2Client } from "google-auth-library";
import { env } from "../../config/env";
import { UnauthorizedError } from "../../utils/errors";
import type { GoogleProfile } from "./auth.types";

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

export async function verifyGoogleCredential(credential: string): Promise<GoogleProfile> {
  const ticket = await googleClient
    .verifyIdToken({
      idToken: credential,
      audience: env.GOOGLE_CLIENT_ID,
    })
    .catch(() => {
      throw new UnauthorizedError("Google token could not be verified.");
    });

  const payload = ticket.getPayload();

  if (!payload?.sub || !payload.email) {
    throw new UnauthorizedError("Google token is missing required identity claims.");
  }

  if (!payload.email_verified) {
    throw new UnauthorizedError("Google email address is not verified.");
  }

  return {
    providerUserId: payload.sub,
    email: payload.email,
    emailVerified: Boolean(payload.email_verified),
    name: payload.name,
    avatarUrl: payload.picture,
  };
}
