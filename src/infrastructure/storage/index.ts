import { LocalStorageProvider } from "./local-storage.provider";
import type { StorageProvider } from "./storage.types";

export const storageProvider: StorageProvider = new LocalStorageProvider();
