import type { AssetKind, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { storageProvider } from "../../infrastructure/storage";
import { NotFoundError } from "../../utils/errors";
import type { CreateAssetInput } from "./asset.schemas";

export const assetService = {
  async createAsset(ownerId: string, adId: string, input: CreateAssetInput) {
    await assertAdOwner(ownerId, adId);

    const preparedAsset = await storageProvider.prepareAsset({
      ownerId,
      adId,
      fileName: input.fileName,
      mimeType: input.mimeType,
    });

    return prisma.asset.create({
      data: {
        adId,
        uploadedById: ownerId,
        kind: input.kind as AssetKind,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageProvider: preparedAsset.provider,
        storageKey: preparedAsset.key,
        url: preparedAsset.url,
        checksum: input.checksum,
        metadata: toJson(input.metadata),
      },
    });
  },

  async listAssets(ownerId: string, adId: string) {
    await assertAdOwner(ownerId, adId);

    return prisma.asset.findMany({
      where: { adId },
      orderBy: { createdAt: "desc" },
    });
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
