import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authRateLimit } from "../../middleware/rate-limit";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../utils/async-handler";
import { devSignIn, getMe, googleSignIn, logout, refreshSession } from "./auth.controller";
import { devSignInSchema, googleSignInSchema, logoutSchema, refreshSessionSchema } from "./auth.schemas";

export const authRouter = Router();

authRouter.post("/google", authRateLimit, validateBody(googleSignInSchema), asyncHandler(googleSignIn));
authRouter.post("/dev", authRateLimit, validateBody(devSignInSchema), asyncHandler(devSignIn));
authRouter.post("/refresh", authRateLimit, validateBody(refreshSessionSchema), asyncHandler(refreshSession));
authRouter.post("/logout", authRateLimit, validateBody(logoutSchema), asyncHandler(logout));
authRouter.get("/me", authenticate, asyncHandler(getMe));
