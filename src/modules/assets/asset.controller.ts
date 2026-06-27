import type { RequestHandler } from "express";
import { HTTP_STATUS } from "../../constants/http";
import { getAuthenticatedUserId } from "../../utils/request-auth";
import { assetService } from "./asset.service";

export const createAsset: RequestHandler = async (req, res) => {
  const asset = await assetService.createAsset(getAuthenticatedUserId(req), req.params.adId, req.body);

  res.status(HTTP_STATUS.CREATED).json({ asset });
};

export const listAssets: RequestHandler = async (req, res) => {
  const assets = await assetService.listAssets(getAuthenticatedUserId(req), req.params.adId);

  res.status(HTTP_STATUS.OK).json({ assets });
};
