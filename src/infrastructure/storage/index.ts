import { LocalPlaceholderStorageProvider } from "./local-placeholder-storage.provider";
import type { StorageProvider } from "./storage.types";

export const storageProvider: StorageProvider = new LocalPlaceholderStorageProvider();
