import type { RequestHandler } from "express";
import { HTTP_STATUS } from "../../constants/http";
import { startWorkerIfWorkIsWaiting } from "../../infrastructure/worker/worker-trigger";
import { getAuthenticatedUserId } from "../../utils/request-auth";
import { adService } from "./ad.service";

export const getAd: RequestHandler = async (req, res) => {
  const ad = await adService.getAd(getAuthenticatedUserId(req), req.params.adId);
  await startWorkerIfWorkIsWaiting(req.params.adId);

  res.status(HTTP_STATUS.OK).json({ ad });
};

export const updateAd: RequestHandler = async (req, res) => {
  const ad = await adService.updateAd(getAuthenticatedUserId(req), req.params.adId, req.body);

  res.status(HTTP_STATUS.OK).json({ ad });
};
