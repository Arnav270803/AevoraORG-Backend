import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { NotFoundError } from "../../utils/errors";
import { conflict, objectValue } from "../workspace/workspace.rules";
import { json, lockAd, transaction, type Tx } from "../workspace/workspace.repository";
import { assertLegacyJob, claimJob, providerAttemptDto } from "../workspace/workspace.worker";
import type { CreateGeneratedAssetInput, CreateRenderOutputInput, UpdatePipelineJobInput,
  UpdatePipelineStepRunInput, UpdateShotInput, UpsertShotsInput } from "./internal-pipeline.schemas";

export const internalPipelineService = {
  claimPipelineJob: claimJob,
  async getPipelineJobContext(jobId: string) {
    const job = await prisma.pipelineJob.findUnique({ where: { id: jobId }, include: jobContextInclude });
    if (!job) throw new NotFoundError("Pipeline job was not found.");
    return { ...job, providerJobs: job.providerJobs.map(providerAttemptDto) };
  },
  async updatePipelineJob(jobId: string, input: UpdatePipelineJobInput) {
    return transaction(async (tx) => {
      const existing = await tx.pipelineJob.findUnique({ where: { id: jobId } });
      if (!existing) throw new NotFoundError("Pipeline job was not found.");
      await guardLegacyAd(tx, existing.adId); await assertLegacyJob(tx, jobId);
      const completedAt = input.status && ["SUCCEEDED", "FAILED", "CANCELED"].includes(input.status) ? new Date() : undefined;
      const job = await tx.pipelineJob.update({ where: { id: jobId }, data: { status: input.status, resultPayload: toJson(input.resultPayload),
        errorCode: input.errorCode, errorMessage: input.errorMessage, completedAt }, include: jobInclude });
      if (input.status === "SUCCEEDED" || input.status === "FAILED") await tx.ad.update({ where: { id: job.adId }, data: { status: input.status === "SUCCEEDED" ? "COMPLETED" : "FAILED" } });
      return job;
    });
  },
  async updatePipelineStepRun(stepRunId: string, input: UpdatePipelineStepRunInput) {
    return transaction(async (tx) => {
      const step = await tx.pipelineStepRun.findUnique({ where: { id: stepRunId }, include: { job: true } });
      if (!step) throw new NotFoundError("Pipeline step was not found.");
      await guardLegacyAd(tx, step.job.adId); await assertLegacyJob(tx, step.jobId);
      const now = new Date();
      return tx.pipelineStepRun.update({ where: { id: stepRunId }, data: { ...input, inputPayload: toJson(input.inputPayload), outputPayload: toJson(input.outputPayload),
        startedAt: input.status === "RUNNING" ? now : undefined, completedAt: input.status && ["SUCCEEDED", "FAILED", "SKIPPED"].includes(input.status) ? now : undefined } });
    });
  },
  async upsertShots(adId: string, input: UpsertShotsInput) {
    return transaction(async (tx) => {
      await guardLegacyAd(tx, adId);
      const shots = [];
      for (const shot of input.shots) {
        await validateAssetIds(tx, adId, [shot.keyframeAssetId, shot.videoAssetId]);
        const data = { ...shot, promptPayload: json(shot.promptPayload) };
        shots.push(await tx.shot.upsert({ where: { adId_shotNumber: { adId, shotNumber: shot.shotNumber } }, update: data, create: { ...data, adId } }));
      }
      return shots;
    });
  },
  async updateShot(shotId: string, input: UpdateShotInput) {
    return transaction(async (tx) => {
      const shot = await tx.shot.findUnique({ where: { id: shotId } });
      if (!shot) throw new NotFoundError("Shot was not found.");
      await guardLegacyAd(tx, shot.adId);
      await validateAssetIds(tx, shot.adId, [input.keyframeAssetId, input.videoAssetId]);
      return tx.shot.update({ where: { id: shotId }, data: { ...input, promptPayload: toJson(input.promptPayload) } });
    });
  },
  async createGeneratedAsset(adId: string, input: CreateGeneratedAssetInput) {
    return transaction(async (tx) => {
      const ad = await guardLegacyAd(tx, adId);
      return tx.asset.create({ data: { ...input, adId, uploadedById: ad.project.ownerId, status: "READY", metadata: toJson(input.metadata) } });
    });
  },
  async createRenderOutput(adId: string, input: CreateRenderOutputInput) {
    return transaction(async (tx) => {
      await guardLegacyAd(tx, adId);
      if (input.jobId) { const job = await assertLegacyJob(tx, input.jobId); if (job.adId !== adId) throw new NotFoundError("Pipeline job was not found."); }
      return tx.renderOutput.create({ data: { ...input, adId, metadata: toJson(input.metadata) } });
    });
  },
};
const jobInclude = { stepRuns: { orderBy: { sequence: "asc" as const } }, renderOutputs: true, providerJobs: true };
const jobContextInclude = {
  ad: { include: { project: { select: { id: true, name: true, ownerId: true } }, assets: { orderBy: { createdAt: "desc" as const } },
    shots: { orderBy: { shotNumber: "asc" as const } }, renderOutputs: { orderBy: { createdAt: "desc" as const } }, providerJobs: { orderBy: { createdAt: "desc" as const } } } },
  ...jobInclude,
};
async function guardLegacyAd(tx: Tx, adId: string) {
  const ad = await lockAd(tx, adId);
  if (ad.workflowMode === "GUIDED" || objectValue(ad.pipelineSpec).mode === "guided" || await tx.creativeArtifact.count({ where: { adId } })) conflict("This ad uses guided revisions. Legacy worker writes are disabled; use the lease-guarded guided result API.");
  return ad;
}
async function validateAssetIds(tx: Tx, adId: string, values: Array<string | null | undefined>) {
  const ids = [...new Set(values.filter((value): value is string => !!value))];
  if (ids.length && await tx.asset.count({ where: { adId, id: { in: ids } } }) !== ids.length) throw new NotFoundError("A referenced asset was not found in this ad.");
}
function toJson(value: unknown): Prisma.InputJsonValue | undefined { return value === undefined ? undefined : json(value); }
