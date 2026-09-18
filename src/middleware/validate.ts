import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { BadRequestError } from "../utils/errors";

export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const issue = result.error.issues[0];
      next(new BadRequestError(issue ? `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}` : "Invalid request body."));
      return;
    }

    req.body = result.data;
    next();
  };
}

export function validateParams(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      next(new BadRequestError("Invalid route parameters."));
      return;
    }

    req.params = result.data;
    next();
  };
}
