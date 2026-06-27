import type { RequestHandler } from "express";
import { HTTP_STATUS } from "../../constants/http";
import { getAuthenticatedUserId } from "../../utils/request-auth";
import { pipelineJobService } from "./pipeline-job.service";

export const createPipelineJob: RequestHandler = async (req, res) => {
  const job = await pipelineJobService.createPipelineJob(getAuthenticatedUserId(req), req.params.adId, req.body);

  res.status(HTTP_STATUS.CREATED).json({ job });
};

export const listPipelineJobs: RequestHandler = async (req, res) => {
  const jobs = await pipelineJobService.listPipelineJobs(getAuthenticatedUserId(req), req.params.adId);

  res.status(HTTP_STATUS.OK).json({ jobs });
};

export const getPipelineJob: RequestHandler = async (req, res) => {
  const job = await pipelineJobService.getPipelineJob(getAuthenticatedUserId(req), req.params.jobId);

  res.status(HTTP_STATUS.OK).json({ job });
};
