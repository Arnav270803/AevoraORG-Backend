export type PrepareAssetInput = {
  ownerId: string;
  adId: string;
  fileName: string;
  mimeType: string;
};

export type WriteAssetInput = PrepareAssetInput & {
  data: Uint8Array;
};

export type PreparedStorageObject = {
  provider: string;
  key: string;
  url?: string;
};

export interface StorageProvider {
  prepareAsset(input: PrepareAssetInput): Promise<PreparedStorageObject>;
  writeAsset(input: WriteAssetInput): Promise<PreparedStorageObject>;
}
