import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../modules/auth/jwt.service";
import { UnauthorizedError } from "../utils/errors";

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header("authorization");

    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedError("Missing bearer token.");
    }

    const token = header.slice("Bearer ".length);
    const payload = await verifyAccessToken(token);

    req.auth = {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
    };

    next();
  } catch (error) {
    next(error);
  }
}
