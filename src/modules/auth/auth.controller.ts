import type { RequestHandler } from "express";
import { HTTP_STATUS } from "../../constants/http";
import { authService } from "./auth.service";

export const devSignIn: RequestHandler = async (req, res) => {
  const session = await authService.signInForDevelopment({
    email: req.body.email,
    name: req.body.name,
    userAgent: req.header("user-agent"),
    ipAddress: req.ip,
  });

  res.status(HTTP_STATUS.OK).json(session);
};

export const googleSignIn: RequestHandler = async (req, res) => {
  const session = await authService.signInWithGoogle({
    credential: req.body.credential,
    userAgent: req.header("user-agent"),
    ipAddress: req.ip,
  });

  res.status(HTTP_STATUS.OK).json(session);
};

export const refreshSession: RequestHandler = async (req, res) => {
  const session = await authService.refreshSession({
    refreshToken: req.body.refreshToken,
    userAgent: req.header("user-agent"),
    ipAddress: req.ip,
  });

  res.status(HTTP_STATUS.OK).json(session);
};

export const logout: RequestHandler = async (req, res) => {
  await authService.logout(req.body.refreshToken);

  res.status(HTTP_STATUS.NO_CONTENT).send();
};

export const getMe: RequestHandler = async (req, res) => {
  const user = await authService.getCurrentUser(req.auth?.userId);

  res.status(HTTP_STATUS.OK).json({ user });
};
