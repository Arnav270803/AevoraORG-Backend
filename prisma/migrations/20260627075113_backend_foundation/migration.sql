-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AdStatus" AS ENUM ('DRAFT', 'READY', 'GENERATING', 'COMPLETED', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('PRODUCT_IMAGE', 'REFERENCE_IMAGE', 'LOGO', 'BRAND_GUIDE', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('REGISTERED', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "PipelineJobType" AS ENUM ('AD_GENERATION', 'RENDER_EXPORT');

-- CreateEnum
CREATE TYPE "PipelineJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PipelineStepStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "RenderOutputKind" AS ENUM ('VIDEO', 'IMAGE', 'SCRIPT', 'METADATA');

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AdStatus" NOT NULL DEFAULT 'DRAFT',
    "productName" TEXT,
    "brandName" TEXT,
    "category" TEXT,
    "referenceNotes" TEXT,
    "objective" TEXT,
    "platform" TEXT,
    "aspectRatio" TEXT,
    "durationSeconds" INTEGER,
    "creativeBrief" JSONB,
    "pipelineSpec" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL DEFAULT 'OTHER',
    "status" "AssetStatus" NOT NULL DEFAULT 'REGISTERED',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT,
    "checksum" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_jobs" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "type" "PipelineJobType" NOT NULL DEFAULT 'AD_GENERATION',
    "status" "PipelineJobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "externalJobId" TEXT,
    "requestPayload" JSONB,
    "resultPayload" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "pipeline_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_step_runs" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PipelineStepStatus" NOT NULL DEFAULT 'PENDING',
    "sequence" INTEGER NOT NULL,
    "provider" TEXT,
    "externalStepId" TEXT,
    "inputPayload" JSONB,
    "outputPayload" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "pipeline_step_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "render_outputs" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "jobId" TEXT,
    "kind" "RenderOutputKind" NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "render_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_ownerId_idx" ON "projects"("ownerId");

-- CreateIndex
CREATE INDEX "projects_ownerId_status_idx" ON "projects"("ownerId", "status");

-- CreateIndex
CREATE INDEX "ads_projectId_idx" ON "ads"("projectId");

-- CreateIndex
CREATE INDEX "ads_projectId_status_idx" ON "ads"("projectId", "status");

-- CreateIndex
CREATE INDEX "assets_adId_idx" ON "assets"("adId");

-- CreateIndex
CREATE INDEX "assets_uploadedById_idx" ON "assets"("uploadedById");

-- CreateIndex
CREATE INDEX "pipeline_jobs_adId_idx" ON "pipeline_jobs"("adId");

-- CreateIndex
CREATE INDEX "pipeline_jobs_requestedById_idx" ON "pipeline_jobs"("requestedById");

-- CreateIndex
CREATE INDEX "pipeline_jobs_status_idx" ON "pipeline_jobs"("status");

-- CreateIndex
CREATE INDEX "pipeline_step_runs_jobId_idx" ON "pipeline_step_runs"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_step_runs_jobId_sequence_key" ON "pipeline_step_runs"("jobId", "sequence");

-- CreateIndex
CREATE INDEX "render_outputs_adId_idx" ON "render_outputs"("adId");

-- CreateIndex
CREATE INDEX "render_outputs_jobId_idx" ON "render_outputs"("jobId");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_adId_fkey" FOREIGN KEY ("adId") REFERENCES "ads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_jobs" ADD CONSTRAINT "pipeline_jobs_adId_fkey" FOREIGN KEY ("adId") REFERENCES "ads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_jobs" ADD CONSTRAINT "pipeline_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_step_runs" ADD CONSTRAINT "pipeline_step_runs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "pipeline_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "render_outputs" ADD CONSTRAINT "render_outputs_adId_fkey" FOREIGN KEY ("adId") REFERENCES "ads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "render_outputs" ADD CONSTRAINT "render_outputs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "pipeline_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
