import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../../config/env";
import { safeFileName } from "./local-storage.provider";
import type {
  PrepareAssetInput,
  PreparedStorageObject,
  StorageProvider,
  WriteAssetInput,
} from "./storage.types";

export class S3StorageProvider implements StorageProvider {
  private readonly provider = "s3";
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly client: S3Client;

  constructor() {
    if (!env.S3_BUCKET || !env.S3_REGION || !env.STORAGE_PUBLIC_BASE_URL) {
      throw new Error("S3_BUCKET, S3_REGION and STORAGE_PUBLIC_BASE_URL are required when STORAGE_DRIVER=s3.");
    }

    this.bucket = env.S3_BUCKET;
    this.publicBaseUrl = env.STORAGE_PUBLIC_BASE_URL.replace(/\/$/, "");
    this.client = new S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    });
  }

  async prepareAsset(input: PrepareAssetInput): Promise<PreparedStorageObject> {
    const safeName = safeFileName(input.fileName, input.mimeType);
    const storageKey = `users/${input.ownerId}/ads/${input.adId}/assets/${randomUUID()}-${safeName}`;

    return {
      provider: this.provider,
      key: storageKey,
      url: `${this.publicBaseUrl}/${storageKey}`,
    };
  }

  async writeAsset(input: WriteAssetInput): Promise<PreparedStorageObject> {
    const prepared = await this.prepareAsset(input);

    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: prepared.key,
      Body: input.data,
      ContentType: input.mimeType,
    }));

    return prepared;
  }
}
