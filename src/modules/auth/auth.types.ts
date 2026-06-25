export type UserRole = "user" | "admin";

export type AuthenticatedUser = {
  userId: string;
  email?: string;
  role: UserRole;
};

export type GoogleProfile = {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  avatarUrl?: string;
};

export type PublicUser = {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
};

export type AuthSession = {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
};

export type GoogleSignInInput = {
  credential: string;
  userAgent?: string;
  ipAddress?: string;
};

export type RefreshSessionInput = {
  refreshToken: string;
  userAgent?: string;
  ipAddress?: string;
};

export type AccessTokenPayload = {
  sub: string;
  email?: string;
  role: UserRole;
  tokenType: "access";
};

export type RefreshTokenPayload = {
  sub: string;
  jti: string;
  tokenType: "refresh";
};
