import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { NotFoundError } from "../../utils/errors";
import type { CreateProjectInput } from "./project.schemas";

export const projectService = {
  createProject(ownerId: string, input: CreateProjectInput) {
    return prisma.project.create({
      data: {
        ownerId,
        name: input.name,
        description: input.description,
        metadata: toJson(input.metadata),
      },
    });
  },

  listProjects(ownerId: string) {
    return prisma.project.findMany({
      where: { ownerId },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: {
          select: { ads: true },
        },
      },
    });
  },

  async getProject(ownerId: string, projectId: string) {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        ownerId,
      },
      include: {
        ads: {
          orderBy: { updatedAt: "desc" },
          include: {
            _count: {
              select: {
                assets: true,
                pipelineJobs: true,
                renderOutputs: true,
              },
            },
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundError("Project was not found.");
    }

    return project;
  },
};

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}
