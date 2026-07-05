-- Pipeline worker gap models for shot-level planning, provider operation tracking,
-- and richer render metadata.

CREATE TYPE "ShotStatus" AS ENUM ('PLANNED', 'KEYFRAME_READY', 'VIDEO_READY', 'FAILED');
CREATE TYPE "ProviderJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED');

ALTER TABLE "render_outputs"
  ADD COLUMN "width" INTEGER,
  ADD COLUMN "height" INTEGER,
  ADD COLUMN "durationMs" INTEGER;

CREATE TABLE "shots" (
  "id" TEXT NOT NULL,
  "adId" TEXT NOT NULL,
  "shotNumber" INTEGER NOT NULL,
  "role" TEXT NOT NULL,
  "status" "ShotStatus" NOT NULL DEFAULT 'PLANNED',
  "durationSeconds" INTEGER NOT NULL,
  "promptPayload" JSONB NOT NULL,
  "keyframeAssetId" TEXT,
  "videoAssetId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "shots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_jobs" (
  "id" TEXT NOT NULL,
  "adId" TEXT NOT NULL,
  "jobId" TEXT,
  "stepRunId" TEXT,
  "provider" TEXT NOT NULL,
  "model" TEXT,
  "operationId" TEXT,
  "status" "ProviderJobStatus" NOT NULL DEFAULT 'QUEUED',
  "requestPayload" JSONB,
  "responsePayload" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "provider_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shots_adId_shotNumber_key" ON "shots"("adId", "shotNumber");
CREATE INDEX "shots_adId_idx" ON "shots"("adId");
CREATE INDEX "provider_jobs_adId_idx" ON "provider_jobs"("adId");
CREATE INDEX "provider_jobs_jobId_idx" ON "provider_jobs"("jobId");
CREATE INDEX "provider_jobs_stepRunId_idx" ON "provider_jobs"("stepRunId");
CREATE INDEX "provider_jobs_status_idx" ON "provider_jobs"("status");

ALTER TABLE "shots"
  ADD CONSTRAINT "shots_adId_fkey"
  FOREIGN KEY ("adId") REFERENCES "ads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_jobs"
  ADD CONSTRAINT "provider_jobs_adId_fkey"
  FOREIGN KEY ("adId") REFERENCES "ads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_jobs"
  ADD CONSTRAINT "provider_jobs_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "pipeline_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "provider_jobs"
  ADD CONSTRAINT "provider_jobs_stepRunId_fkey"
  FOREIGN KEY ("stepRunId") REFERENCES "pipeline_step_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
