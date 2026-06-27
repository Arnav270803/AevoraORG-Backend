import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { validateBody, validateParams } from "../../middleware/validate";
import { asyncHandler } from "../../utils/async-handler";
import { adIdParamSchema } from "../ads/ad.schemas";
import { createPipelineJob, getPipelineJob, listPipelineJobs } from "./pipeline-job.controller";
import { createPipelineJobSchema, pipelineJobIdParamSchema } from "./pipeline-job.schemas";

export const adPipelineJobRouter = Router({ mergeParams: true });
export const pipelineJobRouter = Router();

adPipelineJobRouter.post(
  "/",
  validateParams(adIdParamSchema),
  validateBody(createPipelineJobSchema),
  asyncHandler(createPipelineJob),
);
adPipelineJobRouter.get("/", validateParams(adIdParamSchema), asyncHandler(listPipelineJobs));

pipelineJobRouter.use(authenticate);
pipelineJobRouter.get("/:jobId", validateParams(pipelineJobIdParamSchema), asyncHandler(getPipelineJob));
