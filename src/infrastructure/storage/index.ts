import { env } from "../../config/env";
import { LocalStorageProvider } from "./local-storage.provider";
import { S3StorageProvider } from "./s3-storage.provider";
import type { StorageProvider } from "./storage.types";

export const storageProvider: StorageProvider =
  env.STORAGE_DRIVER === "s3" ? new S3StorageProvider() : new LocalStorageProvider();
