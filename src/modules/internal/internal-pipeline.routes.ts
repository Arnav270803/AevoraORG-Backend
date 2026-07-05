import { Router } from "express";
import { authenticateInternal } from "../../middleware/authenticate-internal";
import { validateBody, validateParams } from "../../middleware/validate";
import { asyncHandler } from "../../utils/async-handler";
import {
  claimPipelineJob,
  createGeneratedAsset,
  createRenderOutput,
  getPipelineJobContext,
  updatePipelineJob,
  updatePipelineStepRun,
  updateShot,
  upsertShots,
} from "./internal-pipeline.controller";
import {
  claimPipelineJobSchema,
  createGeneratedAssetSchema,
  createRenderOutputSchema,
  internalAdIdParamSchema,
  internalJobIdParamSchema,
  internalShotIdParamSchema,
  internalStepRunIdParamSchema,
  updatePipelineJobSchema,
  updatePipelineStepRunSchema,
  updateShotSchema,
  upsertShotsSchema,
} from "./internal-pipeline.schemas";

export const internalPipelineRouter = Router();

internalPipelineRouter.use(authenticateInternal);

internalPipelineRouter.post(
  "/pipeline-jobs/claim",
  validateBody(claimPipelineJobSchema),
  asyncHandler(claimPipelineJob),
);
internalPipelineRouter.get(
  "/pipeline-jobs/:jobId/context",
  validateParams(internalJobIdParamSchema),
  asyncHandler(getPipelineJobContext),
);
internalPipelineRouter.patch(
  "/pipeline-jobs/:jobId",
  validateParams(internalJobIdParamSchema),
  validateBody(updatePipelineJobSchema),
  asyncHandler(updatePipelineJob),
);
internalPipelineRouter.patch(
  "/pipeline-step-runs/:stepRunId",
  validateParams(internalStepRunIdParamSchema),
  validateBody(updatePipelineStepRunSchema),
  asyncHandler(updatePipelineStepRun),
);
internalPipelineRouter.post(
  "/ads/:adId/shots",
  validateParams(internalAdIdParamSchema),
  validateBody(upsertShotsSchema),
  asyncHandler(upsertShots),
);
internalPipelineRouter.patch(
  "/shots/:shotId",
  validateParams(internalShotIdParamSchema),
  validateBody(updateShotSchema),
  asyncHandler(updateShot),
);
internalPipelineRouter.post(
  "/ads/:adId/assets/generated",
  validateParams(internalAdIdParamSchema),
  validateBody(createGeneratedAssetSchema),
  asyncHandler(createGeneratedAsset),
);
internalPipelineRouter.post(
  "/ads/:adId/render-outputs",
  validateParams(internalAdIdParamSchema),
  validateBody(createRenderOutputSchema),
  asyncHandler(createRenderOutput),
);
