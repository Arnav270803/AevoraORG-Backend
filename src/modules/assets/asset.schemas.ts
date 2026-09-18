import { z } from "zod";
import { jsonObjectSchema, optionalTrimmedString } from "../../utils/validation";

const assetKindSchema = z.enum(["PRODUCT_IMAGE", "REFERENCE_IMAGE", "LOGO", "BRAND_GUIDE", "OTHER"]);

export const createAssetSchema = z.object({
  kind: assetKindSchema.default("OTHER"),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().positive().max(2_147_483_647).optional(),
  checksum: optionalTrimmedString(256),
  metadata: jsonObjectSchema.optional(),
});

export const uploadAssetSchema = z.object({
  kind: assetKindSchema.default("OTHER"),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "audio/mpeg", "audio/wav", "audio/ogg"]),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024).optional(),
  dataBase64: z.string().min(1).max(7_100_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  metadata: jsonObjectSchema.optional(),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UploadAssetInput = z.infer<typeof uploadAssetSchema>;
