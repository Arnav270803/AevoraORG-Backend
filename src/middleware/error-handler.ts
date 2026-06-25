import type { ErrorRequestHandler } from "express";
import { env } from "../config/env";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/errors";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const statusCode = error instanceof AppError ? error.statusCode : HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const message = error instanceof AppError ? error.message : "Internal server error.";

  res.status(statusCode).json({
    error: {
      message,
      statusCode,
      ...(env.NODE_ENV === "development" ? { details: error.message } : {}),
    },
  });
};
