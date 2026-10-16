import { Prisma } from "@prisma/client";
import { Router } from "express";
import { HTTP_STATUS } from "../../constants/http";
import { prisma } from "../../db/prisma";
import { logger } from "../../utils/logger";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.status(HTTP_STATUS.OK).json({
    status: "ok",
    service: "aevora-backend",
  });
});

// Separate from "/" on purpose: Lambda's readiness check calls "/", and that must not wait for the database.
healthRouter.get("/db", async (_req, res) => {
  const startedAt = Date.now();
  try {
    await prisma.user.count();
    res.status(HTTP_STATUS.OK).json({ database: "ok", ms: Date.now() - startedAt });
  } catch (error) {
    logger.error("Database health check failed.", error);
    const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code
      : error instanceof Prisma.PrismaClientInitializationError ? error.errorCode ?? "initialization" : "unknown";
    res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({ database: "error", code, reason: describeDatabaseError(error), ms: Date.now() - startedAt });
  }
});

// A short reason without hosts or usernames, which Prisma's messages contain.
function describeDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Authentication failed/i.test(message)) return "authentication_failed";
  if (/Database `[^`]*` does not exist/i.test(message)) return "database_does_not_exist";
  if (/does not exist in the current database|relation .* does not exist/i.test(message)) return "tables_missing";
  if (/Can't reach database server|ECONNREFUSED|ENOTFOUND/i.test(message)) return "server_unreachable";
  if (/timed out|timeout/i.test(message)) return "timeout";
  if (/TLS|SSL|certificate/i.test(message)) return "tls_error";
  if (/must start with the protocol|invalid.*(url|connection string)|invalid port/i.test(message)) return "invalid_database_url";
  return "unknown";
}
