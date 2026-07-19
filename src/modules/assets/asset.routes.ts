import { Router } from "express";
import { validateBody, validateParams } from "../../middleware/validate";
import { asyncHandler } from "../../utils/async-handler";
import { adIdParamSchema } from "../ads/ad.schemas";
import { createAsset, listAssets, uploadAsset } from "./asset.controller";
import { createAssetSchema, uploadAssetSchema } from "./asset.schemas";

export const assetRouter = Router({ mergeParams: true });

assetRouter.post("/", validateParams(adIdParamSchema), validateBody(createAssetSchema), asyncHandler(createAsset));
assetRouter.post("/upload", validateParams(adIdParamSchema), validateBody(uploadAssetSchema), asyncHandler(uploadAsset));
assetRouter.get("/", validateParams(adIdParamSchema), asyncHandler(listAssets));
