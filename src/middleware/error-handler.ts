import type { ErrorRequestHandler } from "express";
import { env } from "../config/env";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";
import { ZodError } from "zod";

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const statusCode = error instanceof AppError ? error.statusCode : error instanceof ZodError ? HTTP_STATUS.BAD_REQUEST : HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const message = error instanceof AppError ? error.message : error instanceof ZodError ? `Invalid creative data: ${error.issues[0]?.message ?? "schema validation failed"}` : "Internal server error.";

  // The client only sees a generic message, so keep the real cause in the logs (CloudWatch on AWS).
  if (statusCode >= HTTP_STATUS.INTERNAL_SERVER_ERROR) logger.error(`Request failed: ${req.method} ${req.originalUrl}`, error);

  res.status(statusCode).json({
    error: {
      message,
      statusCode,
      ...(env.NODE_ENV === "development" ? { details: error.message } : {}),
    },
  });
};
