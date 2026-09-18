import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { env } from "../../config/env";
import type {
  PrepareAssetInput,
  PreparedStorageObject,
  StorageProvider,
  WriteAssetInput,
} from "./storage.types";

export class LocalStorageProvider implements StorageProvider {
  private readonly provider = "local";
  private readonly root = resolve(env.LOCAL_STORAGE_DIR);

  async prepareAsset(input: PrepareAssetInput): Promise<PreparedStorageObject> {
    const safeName = safeFileName(input.fileName, input.mimeType);
    const storageKey = `users/${input.ownerId}/ads/${input.adId}/assets/${randomUUID()}-${safeName}`;
    const baseUrl = env.LOCAL_STORAGE_PUBLIC_BASE_URL ?? `${env.BACKEND_URL}/local-assets`;

    return {
      provider: this.provider,
      key: storageKey,
      url: `${baseUrl.replace(/\/$/, "")}/${storageKey}`,
    };
  }

  async writeAsset(input: WriteAssetInput): Promise<PreparedStorageObject> {
    const prepared = await this.prepareAsset(input);
    const localPath = resolve(this.root, prepared.key.replace(/\//g, sep));

    if (!localPath.startsWith(`${this.root}${sep}`)) {
      throw new Error("Refusing to write an asset outside local storage.");
    }

    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, input.data);

    return prepared;
  }
}

function safeFileName(fileName: string, mimeType: string) {
  const extension = extensionForMimeType(mimeType);
  const stem = fileName
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

  return `${stem || "asset"}${extension}`;
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "audio/mpeg") return ".mp3";
  if (mimeType === "audio/wav") return ".wav";
  if (mimeType === "audio/ogg") return ".ogg";
  return ".bin";
}
