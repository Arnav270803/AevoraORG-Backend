import { z } from "zod";

export const googleSignInSchema = z.object({
  credential: z.string().min(1),
});

export const refreshSessionSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = refreshSessionSchema;
