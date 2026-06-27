import type { AdStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { NotFoundError } from "../../utils/errors";
import type { CreateAdInput, UpdateAdInput } from "./ad.schemas";

export const adService = {
  async createAd(ownerId: string, projectId: string, input: CreateAdInput) {
    await assertProjectOwner(ownerId, projectId);

    return prisma.ad.create({
      data: {
        projectId,
        title: input.title ?? input.productName ?? "Untitled ad",
        productName: input.productName,
        brandName: input.brandName,
        category: input.category,
        referenceNotes: input.referenceNotes,
        objective: input.objective,
        platform: input.platform,
        aspectRatio: input.aspectRatio,
        durationSeconds: input.durationSeconds,
        creativeBrief: toJson(input.creativeBrief),
        pipelineSpec: toJson(input.pipelineSpec),
      },
    });
  },

  async getAd(ownerId: string, adId: string) {
    const ad = await prisma.ad.findFirst({
      where: {
        id: adId,
        project: { ownerId },
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
          },
        },
        assets: {
          orderBy: { createdAt: "desc" },
        },
        pipelineJobs: {
          orderBy: { createdAt: "desc" },
          include: {
            stepRuns: {
              orderBy: { sequence: "asc" },
            },
            renderOutputs: true,
          },
        },
        renderOutputs: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!ad) {
      throw new NotFoundError("Ad was not found.");
    }

    return ad;
  },

  async updateAd(ownerId: string, adId: string, input: UpdateAdInput) {
    await assertAdOwner(ownerId, adId);

    return prisma.ad.update({
      where: { id: adId },
      data: {
        title: input.title,
        status: input.status as AdStatus | undefined,
        productName: input.productName,
        brandName: input.brandName,
        category: input.category,
        referenceNotes: input.referenceNotes,
        objective: input.objective,
        platform: input.platform,
        aspectRatio: input.aspectRatio,
        durationSeconds: input.durationSeconds,
        creativeBrief: toJson(input.creativeBrief),
        pipelineSpec: toJson(input.pipelineSpec),
      },
    });
  },

  async assertAdOwner(ownerId: string, adId: string) {
    return assertAdOwner(ownerId, adId);
  },
};

async function assertProjectOwner(ownerId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ownerId,
    },
    select: { id: true },
  });

  if (!project) {
    throw new NotFoundError("Project was not found.");
  }
}

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

  return ad;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}
