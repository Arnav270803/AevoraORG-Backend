import type { RequestHandler } from "express";
import { HTTP_STATUS } from "../../constants/http";
import { internalPipelineService } from "./internal-pipeline.service";

export const claimPipelineJob: RequestHandler = async (req, res) => {
  const job = await internalPipelineService.claimPipelineJob(req.body);

  res.status(HTTP_STATUS.OK).json({ job });
};

export const getPipelineJobContext: RequestHandler = async (req, res) => {
  const context = await internalPipelineService.getPipelineJobContext(req.params.jobId);

  res.status(HTTP_STATUS.OK).json({ context });
};

export const updatePipelineJob: RequestHandler = async (req, res) => {
  const job = await internalPipelineService.updatePipelineJob(req.params.jobId, req.body);

  res.status(HTTP_STATUS.OK).json({ job });
};

export const updatePipelineStepRun: RequestHandler = async (req, res) => {
  const stepRun = await internalPipelineService.updatePipelineStepRun(req.params.stepRunId, req.body);

  res.status(HTTP_STATUS.OK).json({ stepRun });
};

export const upsertShots: RequestHandler = async (req, res) => {
  const shots = await internalPipelineService.upsertShots(req.params.adId, req.body);

  res.status(HTTP_STATUS.OK).json({ shots });
};

export const updateShot: RequestHandler = async (req, res) => {
  const shot = await internalPipelineService.updateShot(req.params.shotId, req.body);

  res.status(HTTP_STATUS.OK).json({ shot });
};

export const createGeneratedAsset: RequestHandler = async (req, res) => {
  const asset = await internalPipelineService.createGeneratedAsset(req.params.adId, req.body);

  res.status(HTTP_STATUS.CREATED).json({ asset });
};

export const createRenderOutput: RequestHandler = async (req, res) => {
  const renderOutput = await internalPipelineService.createRenderOutput(req.params.adId, req.body);

  res.status(HTTP_STATUS.CREATED).json({ renderOutput });
};
