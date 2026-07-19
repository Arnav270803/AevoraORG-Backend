import { createHash } from "node:crypto";
import type { AssetKind, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { storageProvider } from "../../infrastructure/storage";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import type { CreateAssetInput, UploadAssetInput } from "./asset.schemas";

const MAX_LOCAL_IMAGE_BYTES = 5 * 1024 * 1024;

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

  async uploadAsset(ownerId: string, adId: string, input: UploadAssetInput) {
    await assertAdOwner(ownerId, adId);

    const data = Buffer.from(input.dataBase64, "base64");
    if (data.byteLength === 0 || data.byteLength > MAX_LOCAL_IMAGE_BYTES) {
      throw new BadRequestError("Image uploads must be 5MB or smaller.");
    }

    if (input.sizeBytes !== undefined && input.sizeBytes !== data.byteLength) {
      throw new BadRequestError("Uploaded image size does not match the request metadata.");
    }

    const preparedAsset = await storageProvider.writeAsset({
      ownerId,
      adId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      data,
    });

    return prisma.asset.create({
      data: {
        adId,
        uploadedById: ownerId,
        kind: input.kind as AssetKind,
        status: "READY",
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: data.byteLength,
        storageProvider: preparedAsset.provider,
        storageKey: preparedAsset.key,
        url: preparedAsset.url,
        checksum: createHash("sha256").update(data).digest("hex"),
        metadata: toJson({
          ...input.metadata,
          localUpload: true,
        }),
      },
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
