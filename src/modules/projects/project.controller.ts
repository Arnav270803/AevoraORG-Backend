import type { RequestHandler } from "express";
import { HTTP_STATUS } from "../../constants/http";
import { getAuthenticatedUserId } from "../../utils/request-auth";
import { adService } from "../ads/ad.service";
import { projectService } from "./project.service";

export const createProject: RequestHandler = async (req, res) => {
  const project = await projectService.createProject(getAuthenticatedUserId(req), req.body);

  res.status(HTTP_STATUS.CREATED).json({ project });
};

export const listProjects: RequestHandler = async (req, res) => {
  const projects = await projectService.listProjects(getAuthenticatedUserId(req));

  res.status(HTTP_STATUS.OK).json({ projects });
};

export const getProject: RequestHandler = async (req, res) => {
  const project = await projectService.getProject(getAuthenticatedUserId(req), req.params.projectId);

  res.status(HTTP_STATUS.OK).json({ project });
};

export const createProjectAd: RequestHandler = async (req, res) => {
  const ad = await adService.createAd(getAuthenticatedUserId(req), req.params.projectId, req.body);

  res.status(HTTP_STATUS.CREATED).json({ ad });
};
