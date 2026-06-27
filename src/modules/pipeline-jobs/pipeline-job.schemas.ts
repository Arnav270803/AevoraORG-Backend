import { z } from "zod";
import { jsonObjectSchema, optionalTrimmedString } from "../../utils/validation";

const pipelineJobTypeSchema = z.enum(["AD_GENERATION", "RENDER_EXPORT"]);

export const pipelineJobIdParamSchema = z.object({
  jobId: z.string().uuid(),
});

export const createPipelineJobSchema = z.object({
  type: pipelineJobTypeSchema.default("AD_GENERATION"),
  priority: z.number().int().min(0).max(100).default(0),
  provider: optionalTrimmedString(80),
  requestPayload: jsonObjectSchema.optional(),
  steps: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        sequence: z.number().int().positive().optional(),
        inputPayload: jsonObjectSchema.optional(),
      }),
    )
    .max(25)
    .optional(),
});

export type CreatePipelineJobInput = z.infer<typeof createPipelineJobSchema>;
