import type { PipelineJobType, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { NotFoundError } from "../../utils/errors";
import type { CreatePipelineJobInput } from "./pipeline-job.schemas";

export const pipelineJobService = {
  async createPipelineJob(ownerId: string, adId: string, input: CreatePipelineJobInput) {
    await assertAdOwner(ownerId, adId);

    return prisma.pipelineJob.create({
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
        renderOutputs: true,
      },
    });
  },

  async listPipelineJobs(ownerId: string, adId: string) {
    await assertAdOwner(ownerId, adId);

    return prisma.pipelineJob.findMany({
      where: { adId },
      orderBy: { createdAt: "desc" },
      include: {
        stepRuns: {
          orderBy: { sequence: "asc" },
        },
        renderOutputs: true,
      },
    });
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
        renderOutputs: true,
      },
    });

    if (!job) {
      throw new NotFoundError("Pipeline job was not found.");
    }

    return job;
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
