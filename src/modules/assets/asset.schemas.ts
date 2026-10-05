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

// Uploads arrive as base64 JSON. AWS Lambda accepts at most 6MB per request, so a
// 4MB file (about 5.6MB once base64-encoded) is the largest that fits.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const UPLOAD_TOO_LARGE = "Image and audio uploads must be 4MB or smaller.";

export const uploadAssetSchema = z.object({
  kind: assetKindSchema.default("OTHER"),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "audio/mpeg", "audio/wav", "audio/ogg"]),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES, UPLOAD_TOO_LARGE).optional(),
  dataBase64: z.string().min(1).max(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4, UPLOAD_TOO_LARGE).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  metadata: jsonObjectSchema.optional(),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UploadAssetInput = z.infer<typeof uploadAssetSchema>;
