import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { resolve } from "node:path";
import { corsOptions } from "./config/cors";
import { env } from "./config/env";
import { errorHandler } from "./middleware/error-handler";
import { notFoundHandler } from "./middleware/not-found";
import { adRouter } from "./modules/ads/ad.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { healthRouter } from "./modules/health/health.routes";
import { internalPipelineRouter } from "./modules/internal/internal-pipeline.routes";
import { pipelineJobRouter } from "./modules/pipeline-jobs/pipeline-job.routes";
import { projectRouter } from "./modules/projects/project.routes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false }));

  if (env.NODE_ENV !== "test") {
    app.use(morgan("dev"));
  }

  app.use(
    "/local-assets",
    (_request, response, next) => {
      response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      next();
    },
    express.static(resolve(env.LOCAL_STORAGE_DIR)),
  );

  app.use(
    "/pipeline-output",
    (_request, response, next) => {
      response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      next();
    },
    express.static(resolve(env.PIPELINE_LOCAL_OUTPUT_DIR)),
  );

  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/internal", internalPipelineRouter);
  app.use("/api/projects", projectRouter);
  app.use("/api/ads", adRouter);
  app.use("/api/pipeline-jobs", pipelineJobRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
