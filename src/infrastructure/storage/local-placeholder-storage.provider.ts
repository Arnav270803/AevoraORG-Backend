import { randomUUID } from "node:crypto";
import { env } from "../../config/env";
import type { PrepareAssetInput, PreparedStorageObject, StorageProvider } from "./storage.types";

export class LocalPlaceholderStorageProvider implements StorageProvider {
  private readonly provider = "local-placeholder";

  async prepareAsset(input: PrepareAssetInput): Promise<PreparedStorageObject> {
    const safeName = input.fileName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);
    const storageKey = `users/${input.ownerId}/ads/${input.adId}/assets/${randomUUID()}-${safeName || "asset"}`;
    const baseUrl = env.LOCAL_STORAGE_PUBLIC_BASE_URL ?? `${env.BACKEND_URL}/local-assets`;

    return {
      provider: this.provider,
      key: storageKey,
      url: `${baseUrl.replace(/\/$/, "")}/${storageKey}`,
    };
  }
}
