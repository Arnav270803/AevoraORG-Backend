import { z } from "zod";
import { jsonObjectSchema, optionalTrimmedString } from "../../utils/validation";

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid(),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalTrimmedString(1000),
  metadata: jsonObjectSchema.optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
