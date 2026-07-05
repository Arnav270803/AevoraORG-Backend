import type { RequestHandler } from "express";
import { env } from "../config/env";
import { UnauthorizedError } from "../utils/errors";

export const authenticateInternal: RequestHandler = (req, _res, next) => {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;

  if (!token || token !== env.AEVORA_PIPELINE_SERVICE_TOKEN) {
    next(new UnauthorizedError("Invalid pipeline service token."));
    return;
  }

  next();
};
