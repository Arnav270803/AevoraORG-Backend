import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { validateBody, validateParams } from "../../middleware/validate";
import { asyncHandler } from "../../utils/async-handler";
import { createAdSchema } from "../ads/ad.schemas";
import { createProject, createProjectAd, getProject, listProjects } from "./project.controller";
import { createProjectSchema, projectIdParamSchema } from "./project.schemas";

export const projectRouter = Router();

projectRouter.use(authenticate);

projectRouter.post("/", validateBody(createProjectSchema), asyncHandler(createProject));
projectRouter.get("/", asyncHandler(listProjects));
projectRouter.get("/:projectId", validateParams(projectIdParamSchema), asyncHandler(getProject));
projectRouter.post(
  "/:projectId/ads",
  validateParams(projectIdParamSchema),
  validateBody(createAdSchema),
  asyncHandler(createProjectAd),
);
