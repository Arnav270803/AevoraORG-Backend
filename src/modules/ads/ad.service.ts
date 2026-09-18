import type { AdStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { NotFoundError } from "../../utils/errors";
import type { CreateAdInput, UpdateAdInput } from "./ad.schemas";
import { transaction, lockAd, isGuided } from "../workspace/workspace.repository";
import { conflict } from "../workspace/workspace.rules";
import { publicJob } from "../workspace/workspace.service";

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
        workflowMode: input.workflowMode,
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
        shots: {
          orderBy: { shotNumber: "asc" },
        },
        pipelineJobs: {
          orderBy: { createdAt: "desc" },
          include: {
            stepRuns: {
              orderBy: { sequence: "asc" },
            },
            providerJobs: true,
            renderOutputs: true,
          },
        },
        renderOutputs: {
          orderBy: { createdAt: "desc" },
        },
        providerJobs: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!ad) {
      throw new NotFoundError("Ad was not found.");
    }

    return { ...ad, pipelineJobs: ad.pipelineJobs.map((job) => isGuided(job) ? publicJob(job) : job),
      providerJobs: ad.providerJobs.map(({ id, provider, model, status, createdAt }) => ({ id, provider, model, status, createdAt })) };
  },

  async updateAd(ownerId: string, adId: string, input: UpdateAdInput) {
    return transaction(async (tx) => {
      const existing = await lockAd(tx, adId, ownerId);
      const hasArtifacts = await tx.creativeArtifact.count({ where: { adId } });
      if ((existing.workflowMode === "GUIDED" || hasArtifacts) && input.status && input.status !== "ARCHIVED") conflict("Guided completion status is managed by the workflow, not by ad edits.");
      if (hasArtifacts && input.workflowMode === "LEGACY_AUTOMATIC") conflict("This ad has guided revisions. Create a separate automatic ad to preserve this revision history.");
      if (hasArtifacts && Object.keys(input).some((key) => !["title", "status", "workflowMode"].includes(key))) conflict("This ad has guided revisions. Edit its script, storyboard, shots, or timeline through the workspace.");
      return tx.ad.update({
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
        workflowMode: input.workflowMode,
      },
      });
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
