import type { PipelineJobType, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { lockAd, transaction, isGuided } from "../workspace/workspace.repository";
import { conflict, objectValue } from "../workspace/workspace.rules";
import { publicJob } from "../workspace/workspace.service";
import type { CreatePipelineJobInput } from "./pipeline-job.schemas";

export const pipelineJobService = {
  async createPipelineJob(ownerId: string, adId: string, input: CreatePipelineJobInput) {
    return transaction(async (tx) => {
      const ad = await lockAd(tx, adId, ownerId);
      if (Object.prototype.hasOwnProperty.call(input.requestPayload ?? {}, "guided")) throw new BadRequestError("Guided snapshots can only be created by the workspace action API.");
      if (ad.workflowMode === "GUIDED" || objectValue(ad.pipelineSpec).mode === "guided" || await tx.creativeArtifact.count({ where: { adId } })) conflict("Use workspace actions for guided ads; arbitrary automatic stage requests are disabled.");
      return tx.pipelineJob.create({
      data: {
        adId,
        requestedById: ownerId,
        type: input.type as PipelineJobType,
        priority: input.priority,
        provider: input.provider,
        requestPayload: toJson(input.requestPayload),
        stepRuns: input.steps?.length
          ? {
              create: input.steps.map((step, index) => ({
                name: step.name,
                sequence: step.sequence ?? index + 1,
                inputPayload: toJson(step.inputPayload),
              })),
            }
          : undefined,
      },
      include: {
        stepRuns: {
          orderBy: { sequence: "asc" },
        },
        providerJobs: true,
        renderOutputs: true,
      },
      });
    });
  },

  async listPipelineJobs(ownerId: string, adId: string) {
    await assertAdOwner(ownerId, adId);

    const jobs = await prisma.pipelineJob.findMany({
      where: { adId },
      orderBy: { createdAt: "desc" },
      include: {
        stepRuns: {
          orderBy: { sequence: "asc" },
        },
        providerJobs: true,
        renderOutputs: true,
      },
    });
    return jobs.map((job) => isGuided(job) ? publicJob(job) : job);
  },

  async getPipelineJob(ownerId: string, jobId: string) {
    const job = await prisma.pipelineJob.findFirst({
      where: {
        id: jobId,
        ad: {
          project: { ownerId },
        },
      },
      include: {
        ad: {
          select: {
            id: true,
            title: true,
            projectId: true,
          },
        },
        stepRuns: {
          orderBy: { sequence: "asc" },
        },
        providerJobs: true,
        renderOutputs: true,
      },
    });

    if (!job) {
      throw new NotFoundError("Pipeline job was not found.");
    }

    return isGuided(job) ? publicJob(job) : job;
  },
};

async function assertAdOwner(ownerId: string, adId: string) {
  const ad = await prisma.ad.findFirst({
    where: {
      id: adId,
      project: { ownerId },
    },
    select: { id: true },
  });

  if (!ad) {
    throw new NotFoundError("Ad was not found.");
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}
