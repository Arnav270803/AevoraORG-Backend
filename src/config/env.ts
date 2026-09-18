import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),
  JWT_ISSUER: z.string().default("aevora-api"),
  JWT_AUDIENCE: z.string().default("aevora-web"),
  FRONTEND_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  BACKEND_URL: z.string().url().default("http://localhost:4000"),
  LOCAL_STORAGE_DIR: z.string().min(1).default("storage"),
  LOCAL_STORAGE_PUBLIC_BASE_URL: z.string().url().optional(),
  PIPELINE_LOCAL_OUTPUT_DIR: z.string().min(1).default("../Aevora_Agentic_core/output"),
  AEVORA_PIPELINE_SERVICE_TOKEN: z.string().min(16).default("dev-pipeline-service-token"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ENDPOINT: z.string().url().optional(),
  STORAGE_PUBLIC_BASE_URL: z.string().url().optional(),
});

export const env = envSchema.parse(process.env);
