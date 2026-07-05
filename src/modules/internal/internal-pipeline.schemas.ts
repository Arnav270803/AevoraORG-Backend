import { z } from "zod";
import { jsonObjectSchema, optionalTrimmedString } from "../../utils/validation";

const pipelineJobStatusSchema = z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]);
const pipelineStepStatusSchema = z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"]);
const renderOutputKindSchema = z.enum(["VIDEO", "IMAGE", "SCRIPT", "METADATA"]);
const shotStatusSchema = z.enum(["PLANNED", "KEYFRAME_READY", "VIDEO_READY", "FAILED"]);

export const internalJobIdParamSchema = z.object({
  jobId: z.string().uuid(),
});

export const internalStepRunIdParamSchema = z.object({
  stepRunId: z.string().uuid(),
});

export const internalAdIdParamSchema = z.object({
  adId: z.string().uuid(),
});

export const internalShotIdParamSchema = z.object({
  shotId: z.string().uuid(),
});

export const claimPipelineJobSchema = z.object({
  workerId: optionalTrimmedString(120),
  type: z.enum(["AD_GENERATION", "RENDER_EXPORT"]).default("AD_GENERATION"),
});

export const updatePipelineJobSchema = z.object({
  status: pipelineJobStatusSchema.optional(),
  resultPayload: jsonObjectSchema.optional(),
  errorCode: optionalTrimmedString(120),
  errorMessage: optionalTrimmedString(2000),
});

export const updatePipelineStepRunSchema = z.object({
  status: pipelineStepStatusSchema.optional(),
  provider: optionalTrimmedString(80),
  externalStepId: optionalTrimmedString(180),
  inputPayload: jsonObjectSchema.optional(),
  outputPayload: jsonObjectSchema.optional(),
  errorCode: optionalTrimmedString(120),
  errorMessage: optionalTrimmedString(2000),
});

export const upsertShotsSchema = z.object({
  shots: z.array(
    z.object({
      shotNumber: z.number().int().positive(),
      role: z.string().trim().min(1).max(80),
      status: shotStatusSchema.default("PLANNED"),
      durationSeconds: z.number().int().positive().max(120),
      promptPayload: jsonObjectSchema,
      keyframeAssetId: z.string().uuid().optional(),
      videoAssetId: z.string().uuid().optional(),
    }),
  ).min(1).max(50),
});

export const updateShotSchema = z.object({
  status: shotStatusSchema.optional(),
  role: z.string().trim().min(1).max(80).optional(),
  durationSeconds: z.number().int().positive().max(120).optional(),
  promptPayload: jsonObjectSchema.optional(),
  keyframeAssetId: z.string().uuid().nullable().optional(),
  videoAssetId: z.string().uuid().nullable().optional(),
});

export const createGeneratedAssetSchema = z.object({
  kind: z.enum(["PRODUCT_IMAGE", "REFERENCE_IMAGE", "LOGO", "BRAND_GUIDE", "OTHER"]).default("OTHER"),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().positive().max(2_147_483_647).optional(),
  storageProvider: z.string().trim().min(1).max(80).default("mock"),
  storageKey: z.string().trim().min(1).max(500),
  url: z.string().url().optional(),
  checksum: optionalTrimmedString(256),
  metadata: jsonObjectSchema.optional(),
});

export const createRenderOutputSchema = z.object({
  jobId: z.string().uuid().optional(),
  kind: renderOutputKindSchema,
  storageProvider: z.string().trim().min(1).max(80).default("mock"),
  storageKey: z.string().trim().min(1).max(500),
  url: z.string().url().optional(),
  mimeType: optionalTrimmedString(120),
  sizeBytes: z.number().int().positive().max(2_147_483_647).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().int().positive().optional(),
  metadata: jsonObjectSchema.optional(),
});

export type ClaimPipelineJobInput = z.infer<typeof claimPipelineJobSchema>;
export type UpdatePipelineJobInput = z.infer<typeof updatePipelineJobSchema>;
export type UpdatePipelineStepRunInput = z.infer<typeof updatePipelineStepRunSchema>;
export type UpsertShotsInput = z.infer<typeof upsertShotsSchema>;
export type UpdateShotInput = z.infer<typeof updateShotSchema>;
export type CreateGeneratedAssetInput = z.infer<typeof createGeneratedAssetSchema>;
export type CreateRenderOutputInput = z.infer<typeof createRenderOutputSchema>;
