import type { Request } from "express";
import { UnauthorizedError } from "./errors";

export function getAuthenticatedUserId(req: Request) {
  const userId = req.auth?.userId;

  if (!userId) {
    throw new UnauthorizedError("Missing authenticated user.");
  }

  return userId;
}
