export type PrepareAssetInput = {
  ownerId: string;
  adId: string;
  fileName: string;
  mimeType: string;
};

export type PreparedStorageObject = {
  provider: string;
  key: string;
  url?: string;
};

export interface StorageProvider {
  prepareAsset(input: PrepareAssetInput): Promise<PreparedStorageObject>;
}
