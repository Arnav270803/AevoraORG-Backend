import { z } from "zod";
import { jsonObjectSchema, optionalTrimmedString } from "../../utils/validation";

const adStatusSchema = z.enum(["DRAFT", "READY", "GENERATING", "COMPLETED", "FAILED", "ARCHIVED"]);

export const adIdParamSchema = z.object({
  adId: z.string().uuid(),
});

export const createAdSchema = z.object({
  title: optionalTrimmedString(160),
  productName: optionalTrimmedString(160),
  brandName: optionalTrimmedString(160),
  category: optionalTrimmedString(160),
  referenceNotes: optionalTrimmedString(4000),
  objective: optionalTrimmedString(500),
  platform: optionalTrimmedString(80),
  aspectRatio: optionalTrimmedString(20),
  durationSeconds: z.number().int().positive().max(600).optional(),
  creativeBrief: jsonObjectSchema.optional(),
  pipelineSpec: jsonObjectSchema.optional(),
});

export const updateAdSchema = createAdSchema
  .extend({
    status: adStatusSchema.optional(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  });

export type CreateAdInput = z.infer<typeof createAdSchema>;
export type UpdateAdInput = z.infer<typeof updateAdSchema>;
