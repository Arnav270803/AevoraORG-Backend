import { z } from "zod";

export const googleSignInSchema = z.object({
  credential: z.string().min(1),
});

export const devSignInSchema = z.object({
  email: z.string().email().default("dev@aevora.local"),
  name: z.string().trim().min(1).max(120).default("Aevora Dev User"),
});

export const refreshSessionSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = refreshSessionSchema;
