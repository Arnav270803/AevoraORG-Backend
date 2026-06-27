import { Router } from "express";
import { validateBody, validateParams } from "../../middleware/validate";
import { asyncHandler } from "../../utils/async-handler";
import { adIdParamSchema } from "../ads/ad.schemas";
import { createAsset, listAssets } from "./asset.controller";
import { createAssetSchema } from "./asset.schemas";

export const assetRouter = Router({ mergeParams: true });

assetRouter.post("/", validateParams(adIdParamSchema), validateBody(createAssetSchema), asyncHandler(createAsset));
assetRouter.get("/", validateParams(adIdParamSchema), asyncHandler(listAssets));
