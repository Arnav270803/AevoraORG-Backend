import type {
  AssetKind,
  PipelineJobStatus,
  PipelineJobType,
  PipelineStepStatus,
  Prisma,
  RenderOutputKind,
  ShotStatus,
} from "@prisma/client";
import { prisma } from "../../db/prisma";
import { NotFoundError } from "../../utils/errors";
import type {
  ClaimPipelineJobInput,
  CreateGeneratedAssetInput,
  CreateRenderOutputInput,
  UpdatePipelineJobInput,
  UpdatePipelineStepRunInput,
  UpdateShotInput,
  UpsertShotsInput,
} from "./internal-pipeline.schemas";

const workerSteps = [
  "hydrate_input",
  "product_analysis",
  "creative_concepts",
  "concept_scoring",
  "selected_creative_brief",
  "script_generation",
  "shot_list_generation",
  "keyframe_generation",
  "video_clip_generation",
  "final_render",
  "qc",
];

export const internalPipelineService = {
  async claimPipelineJob(input: ClaimPipelineJobInput) {
    return prisma.$transaction(async (tx) => {
      const queuedJob = await tx.pipelineJob.findFirst({
        where: {
          status: "QUEUED",
          type: input.type as PipelineJobType,
        },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        include: {
          stepRuns: {
            orderBy: { sequence: "asc" },
          },
        },
      });

      if (!queuedJob) {
        return null;
      }

      const existingNames = new Set(queuedJob.stepRuns.map((step) => step.name));
      const missingSteps = workerSteps.filter((name) => !existingNames.has(name));

      if (missingSteps.length > 0) {
        const maxSequence = queuedJob.stepRuns.reduce((max, step) => Math.max(max, step.sequence), 0);
        await tx.pipelineStepRun.createMany({
          data: missingSteps.map((name, index) => ({
            jobId: queuedJob.id,
            name,
            sequence: maxSequence + index + 1,
          })),
        });
      }

      await tx.ad.update({
        where: { id: queuedJob.adId },
        data: { status: "GENERATING" },
      });

      return tx.pipelineJob.update({
        where: { id: queuedJob.id },
        data: {
          status: "RUNNING",
          provider: queuedJob.provider ?? "aevora-agentic-core",
          externalJobId: input.workerId,
          startedAt: queuedJob.startedAt ?? new Date(),
        },
        include: jobInclude,
      });
    });
  },

  async getPipelineJobContext(jobId: string) {
    const job = await prisma.pipelineJob.findUnique({
      where: { id: jobId },
      include: jobContextInclude,
    });

    if (!job) {
      throw new NotFoundError("Pipeline job was not found.");
    }

    return job;
  },

  async updatePipelineJob(jobId: string, input: UpdatePipelineJobInput) {
    const completedAt = input.status && ["SUCCEEDED", "FAILED", "CANCELED"].includes(input.status) ? new Date() : undefined;
    const job = await prisma.pipelineJob.update({
      where: { id: jobId },
      data: {
        status: input.status as PipelineJobStatus | undefined,
        resultPayload: toJson(input.resultPayload),
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        completedAt,
      },
      include: jobInclude,
    });

    if (input.status === "SUCCEEDED" || input.status === "FAILED") {
      await prisma.ad.update({
        where: { id: job.adId },
        data: { status: input.status === "SUCCEEDED" ? "COMPLETED" : "FAILED" },
      });
    }

    return job;
  },

  async updatePipelineStepRun(stepRunId: string, input: UpdatePipelineStepRunInput) {
    const now = new Date();

    return prisma.pipelineStepRun.update({
      where: { id: stepRunId },
      data: {
        status: input.status as PipelineStepStatus | undefined,
        provider: input.provider,
        externalStepId: input.externalStepId,
        inputPayload: toJson(input.inputPayload),
        outputPayload: toJson(input.outputPayload),
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        startedAt: input.status === "RUNNING" ? now : undefined,
        completedAt: input.status && ["SUCCEEDED", "FAILED", "SKIPPED"].includes(input.status) ? now : undefined,
      },
    });
  },

  async upsertShots(adId: string, input: UpsertShotsInput) {
    await assertAd(adId);

    const shots = [];

    for (const shot of input.shots) {
      shots.push(await prisma.shot.upsert({
        where: {
          adId_shotNumber: {
            adId,
            shotNumber: shot.shotNumber,
          },
        },
        update: {
          role: shot.role,
          status: shot.status as ShotStatus,
          durationSeconds: shot.durationSeconds,
          promptPayload: shot.promptPayload as Prisma.InputJsonValue,
          keyframeAssetId: shot.keyframeAssetId,
          videoAssetId: shot.videoAssetId,
        },
        create: {
          adId,
          shotNumber: shot.shotNumber,
          role: shot.role,
          status: shot.status as ShotStatus,
          durationSeconds: shot.durationSeconds,
          promptPayload: shot.promptPayload as Prisma.InputJsonValue,
          keyframeAssetId: shot.keyframeAssetId,
          videoAssetId: shot.videoAssetId,
        },
      }));
    }

    return shots;
  },

  async updateShot(shotId: string, input: UpdateShotInput) {
    return prisma.shot.update({
      where: { id: shotId },
      data: {
        status: input.status as ShotStatus | undefined,
        role: input.role,
        durationSeconds: input.durationSeconds,
        promptPayload: toJson(input.promptPayload),
        keyframeAssetId: input.keyframeAssetId,
        videoAssetId: input.videoAssetId,
      },
    });
  },

  async createGeneratedAsset(adId: string, input: CreateGeneratedAssetInput) {
    const ad = await getAdOwner(adId);

    return prisma.asset.create({
      data: {
        adId,
        uploadedById: ad.project.ownerId,
        kind: input.kind as AssetKind,
        status: "READY",
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageProvider: input.storageProvider,
        storageKey: input.storageKey,
        url: input.url,
        checksum: input.checksum,
        metadata: toJson(input.metadata),
      },
    });
  },

  async createRenderOutput(adId: string, input: CreateRenderOutputInput) {
    await assertAd(adId);

    return prisma.renderOutput.create({
      data: {
        adId,
        jobId: input.jobId,
        kind: input.kind as RenderOutputKind,
        storageProvider: input.storageProvider,
        storageKey: input.storageKey,
        url: input.url,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        width: input.width,
        height: input.height,
        durationMs: input.durationMs,
        metadata: toJson(input.metadata),
      },
    });
  },
};

const jobInclude = {
  stepRuns: {
    orderBy: { sequence: "asc" as const },
  },
  renderOutputs: true,
  providerJobs: true,
};

const jobContextInclude = {
  ad: {
    include: {
      project: {
        select: {
          id: true,
          name: true,
          ownerId: true,
        },
      },
      assets: {
        orderBy: { createdAt: "desc" as const },
      },
      shots: {
        orderBy: { shotNumber: "asc" as const },
      },
      renderOutputs: {
        orderBy: { createdAt: "desc" as const },
      },
      providerJobs: {
        orderBy: { createdAt: "desc" as const },
      },
    },
  },
  stepRuns: {
    orderBy: { sequence: "asc" as const },
  },
  renderOutputs: true,
  providerJobs: true,
};

async function assertAd(adId: string) {
  const ad = await prisma.ad.findUnique({
    where: { id: adId },
    select: { id: true },
  });

  if (!ad) {
    throw new NotFoundError("Ad was not found.");
  }
}

async function getAdOwner(adId: string) {
  const ad = await prisma.ad.findUnique({
    where: { id: adId },
    select: {
      id: true,
      project: {
        select: {
          ownerId: true,
        },
      },
    },
  });

  if (!ad) {
    throw new NotFoundError("Ad was not found.");
  }

  return ad;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}
