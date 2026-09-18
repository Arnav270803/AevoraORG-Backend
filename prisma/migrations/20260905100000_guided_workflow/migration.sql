-- Additive only: existing automatic jobs, media and outputs remain untouched.
ALTER TYPE "PipelineJobType" ADD VALUE 'GUIDED_GENERATION';
CREATE TYPE "CreativeArtifactKind" AS ENUM ('SCRIPT', 'STORYBOARD', 'SHOT_PLAN', 'TIMELINE');
CREATE TYPE "WorkflowMode" AS ENUM ('LEGACY_AUTOMATIC', 'GUIDED');
ALTER TABLE "ads" ADD COLUMN "workflowMode" "WorkflowMode" NOT NULL DEFAULT 'LEGACY_AUTOMATIC';
ALTER TABLE "pipeline_jobs" ADD COLUMN "idempotencyKey" TEXT,
 ADD COLUMN "snapshotHash" TEXT, ADD COLUMN "leaseToken" TEXT,
 ADD COLUMN "leaseExpiresAt" TIMESTAMP(3), ADD COLUMN "heartbeatAt" TIMESTAMP(3),
 ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);
ALTER TABLE "shots" ADD COLUMN "keyframeRevisionId" TEXT, ADD COLUMN "videoRevisionId" TEXT;
ALTER TABLE "provider_jobs" ADD COLUMN "requestFingerprint" TEXT,
 ADD COLUMN "attemptState" TEXT, ADD COLUMN "metadata" JSONB;
CREATE UNIQUE INDEX "pipeline_jobs_adId_idempotencyKey_key" ON "pipeline_jobs"("adId", "idempotencyKey");
CREATE INDEX "pipeline_jobs_status_leaseExpiresAt_idx" ON "pipeline_jobs"("status", "leaseExpiresAt");
CREATE UNIQUE INDEX "provider_jobs_jobId_requestFingerprint_key" ON "provider_jobs"("jobId", "requestFingerprint");
CREATE TABLE "creative_artifacts" (
 "id" TEXT NOT NULL, "adId" TEXT NOT NULL, "kind" "CreativeArtifactKind" NOT NULL,
 "scopeKey" TEXT NOT NULL DEFAULT 'root', "shotId" TEXT,
 "currentRevisionId" TEXT, "approvedRevisionId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "creative_artifacts_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "creative_revisions" (
 "id" TEXT NOT NULL, "artifactId" TEXT NOT NULL, "version" INTEGER NOT NULL,
 "content" JSONB NOT NULL, "sourceRevisionIds" TEXT[] NOT NULL,
 "origin" TEXT NOT NULL, "schemaVersion" INTEGER NOT NULL DEFAULT 1,
 "authorId" TEXT, "sourceJobId" TEXT, "parentRevisionId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "creative_revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "creative_artifacts_adId_kind_scopeKey_key" ON "creative_artifacts"("adId", "kind", "scopeKey");
CREATE UNIQUE INDEX "creative_artifacts_currentRevisionId_key" ON "creative_artifacts"("currentRevisionId");
CREATE UNIQUE INDEX "creative_artifacts_approvedRevisionId_key" ON "creative_artifacts"("approvedRevisionId");
CREATE INDEX "creative_artifacts_adId_idx" ON "creative_artifacts"("adId");
CREATE UNIQUE INDEX "creative_revisions_artifactId_version_key" ON "creative_revisions"("artifactId", "version");
CREATE INDEX "creative_revisions_artifactId_idx" ON "creative_revisions"("artifactId");
ALTER TABLE "creative_artifacts" ADD CONSTRAINT "creative_artifacts_adId_fkey" FOREIGN KEY ("adId") REFERENCES "ads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "creative_artifacts" ADD CONSTRAINT "creative_artifacts_shotId_fkey" FOREIGN KEY ("shotId") REFERENCES "shots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "creative_artifacts" ADD CONSTRAINT "creative_artifacts_scope_check" CHECK (
 ("kind" = 'SHOT_PLAN' AND "shotId" IS NOT NULL AND "scopeKey" = "shotId") OR
 ("kind" <> 'SHOT_PLAN' AND "shotId" IS NULL AND "scopeKey" = 'root')
);
ALTER TABLE "creative_revisions" ADD CONSTRAINT "creative_revisions_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "creative_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "creative_artifacts" ADD CONSTRAINT "creative_artifacts_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "creative_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "creative_artifacts" ADD CONSTRAINT "creative_artifacts_approvedRevisionId_fkey" FOREIGN KEY ("approvedRevisionId") REFERENCES "creative_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "creative_revisions" ADD CONSTRAINT "creative_revisions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "creative_revisions" ADD CONSTRAINT "creative_revisions_sourceJobId_fkey" FOREIGN KEY ("sourceJobId") REFERENCES "pipeline_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "creative_revisions" ADD CONSTRAINT "creative_revisions_parentRevisionId_fkey" FOREIGN KEY ("parentRevisionId") REFERENCES "creative_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "creative_approvals" (
 "id" TEXT NOT NULL, "artifactId" TEXT NOT NULL, "revisionId" TEXT NOT NULL,
 "approvedById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "creative_approvals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "creative_approvals_artifactId_revisionId_approvedById_key" ON "creative_approvals"("artifactId", "revisionId", "approvedById");
ALTER TABLE "creative_approvals" ADD CONSTRAINT "creative_approvals_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "creative_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "creative_approvals" ADD CONSTRAINT "creative_approvals_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "creative_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "creative_approvals" ADD CONSTRAINT "creative_approvals_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
