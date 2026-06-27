import { z } from "zod";

export function optionalTrimmedString(maxLength: number) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().trim().max(maxLength).optional(),
  );
}

export const jsonObjectSchema = z.record(z.unknown());
