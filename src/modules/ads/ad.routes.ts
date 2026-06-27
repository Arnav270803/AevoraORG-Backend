import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { validateBody, validateParams } from "../../middleware/validate";
import { asyncHandler } from "../../utils/async-handler";
import { assetRouter } from "../assets/asset.routes";
import { adPipelineJobRouter } from "../pipeline-jobs/pipeline-job.routes";
import { getAd, updateAd } from "./ad.controller";
import { adIdParamSchema, updateAdSchema } from "./ad.schemas";

export const adRouter = Router();

adRouter.use(authenticate);

adRouter.get("/:adId", validateParams(adIdParamSchema), asyncHandler(getAd));
adRouter.patch("/:adId", validateParams(adIdParamSchema), validateBody(updateAdSchema), asyncHandler(updateAd));
adRouter.use("/:adId/assets", assetRouter);
adRouter.use("/:adId/pipeline-jobs", adPipelineJobRouter);
