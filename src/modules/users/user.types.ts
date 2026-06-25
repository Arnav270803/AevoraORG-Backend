export type UserProfile = {
  id: string;
  email: string;
  emailVerified: boolean;
  name?: string | null;
  avatarUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date | null;
};
