import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createGeneratedAssetSchema, createRenderOutputSchema } from "../internal/internal-pipeline.schemas";

const uuid = z.string().uuid();
const text = z.string().max(12000);
const frame = z.number().int().min(0);
const positiveFrames = z.number().int().min(1).max(360000);
export const scriptContentSchema = z.object({
  voiceover: z.array(z.object({ id: uuid.default(() => randomUUID()), startSecond: z.number().min(0).max(600),
    endSecond: z.number().positive().max(600), text: z.string().max(4000), delivery: z.string().max(500) })
    .refine((v) => v.endSecond > v.startSecond, "Voiceover end must be after its start.")).max(100),
  captions: z.array(z.object({ id: uuid.default(() => randomUUID()), startSecond: z.number().min(0).max(600),
    endSecond: z.number().positive().max(600), text: z.string().max(4000), emphasis: z.string().max(200).optional() })
    .refine((v) => v.endSecond > v.startSecond, "Caption end must be after its start.")).max(100),
}).superRefine((v, ctx) => {
  const ids = [...v.voiceover, ...v.captions].map((item) => item.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Script beat IDs must be unique." });
});
export const shotContentSchema = z.object({
  shotId: uuid.optional(), shotNumber: z.number().int().min(1).max(10000),
  role: z.enum(["hook", "problem", "product_hero", "benefit", "proof", "cta"]),
  durationSeconds: z.number().positive().max(120), visualDescription: text,
  camera: z.object({ framing: z.string().max(1500), movement: z.string().max(1500), lensFeel: z.string().max(1500) }),
  lighting: text, environment: text, objects: z.array(z.string().max(1000)).max(100),
  productContinuityNotes: z.array(z.string().max(1500)).max(100), captionText: z.string().max(4000),
  imagePrompt: text, videoPrompt: text, negativePrompt: text,
  referenceAssetIds: z.array(uuid).max(30), scriptBeatIds: z.array(uuid).max(100).optional(),
});
export const storyboardContentSchema = z.object({ shots: z.array(z.object({ shotId: uuid, revisionId: uuid })).min(1).max(50) })
  .refine((value) => new Set(value.shots.map((shot) => shot.shotId)).size === value.shots.length && new Set(value.shots.map((shot) => shot.revisionId)).size === value.shots.length,
    "Storyboard shot identities and revisions must be unique.");
export const timelineContentSchema = z.object({
  fps: z.number().int().min(1).max(60), width: z.number().int().min(64).max(4096), height: z.number().int().min(64).max(4096),
  clips: z.array(z.object({ id: uuid, shotId: uuid, assetId: uuid, sourceInFrame: frame, durationFrames: positiveFrames,
    fit: z.enum(["contain", "cover"]), muted: z.boolean(), volume: z.number().min(0).max(2) })).min(1).max(50),
  overlays: z.array(z.object({ id: uuid, text: z.string().max(2000), startFrame: frame, endFrame: positiveFrames,
    position: z.enum(["top", "center", "bottom"]), fontSize: z.number().int().min(8).max(200), color: z.string().regex(/^#[a-fA-F0-9]{6}$/) })).max(200),
  audioTracks: z.array(z.object({ id: uuid, assetId: uuid, startFrame: frame, sourceInFrame: frame,
    durationFrames: positiveFrames, volume: z.number().min(0).max(2), fadeInFrames: frame, fadeOutFrames: frame })).max(20),
  normalizeAudio: z.boolean(),
}).superRefine((v, ctx) => {
  const total = v.clips.reduce((sum, clip) => sum + clip.durationFrames, 0);
  if (total > v.fps * 600) ctx.addIssue({ code: "custom", message: "Timeline cannot exceed 10 minutes." });
  if (v.width % 2 || v.height % 2) ctx.addIssue({ code: "custom", message: "Video dimensions must be even." });
  const ids = [...v.clips, ...v.overlays, ...v.audioTracks].map((item) => item.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Timeline item IDs must be unique." });
  for (const overlay of v.overlays) if (overlay.endFrame <= overlay.startFrame || overlay.endFrame > total)
    ctx.addIssue({ code: "custom", message: "Caption range must fit inside the timeline." });
  for (const audio of v.audioTracks) if (audio.startFrame + audio.durationFrames > total || audio.fadeInFrames + audio.fadeOutFrames > audio.durationFrames)
    ctx.addIssue({ code: "custom", message: "Audio range and fades must fit inside the timeline." });
});
export const expectedRevisionSchema = uuid.nullable();
export const saveScriptSchema = z.object({ expectedRevisionId: expectedRevisionSchema, content: scriptContentSchema });
export const saveShotSchema = z.object({ expectedRevisionId: expectedRevisionSchema, content: shotContentSchema });
export const createShotSchema = z.object({ content: shotContentSchema });
export const saveStoryboardSchema = z.object({ expectedRevisionId: expectedRevisionSchema, shotIds: z.array(uuid).min(1).max(50) })
  .refine((v) => new Set(v.shotIds).size === v.shotIds.length, "A shot can appear only once in the storyboard.");
export const saveTimelineSchema = z.object({ expectedRevisionId: expectedRevisionSchema, content: timelineContentSchema });
export const approvalSchema = z.object({ artifactId: uuid, revisionId: uuid });
export const selectAssetSchema = z.object({ kind: z.enum(["KEYFRAME", "CLIP"]), assetId: uuid, expectedRevisionId: expectedRevisionSchema });
export const operationSchema = z.enum(["GENERATE_SCRIPT", "GENERATE_STORYBOARD", "GENERATE_KEYFRAME", "GENERATE_CLIP", "RENDER_EXPORT"]);
export const actionSchema = z.object({
  operation: operationSchema, shotId: uuid.optional(), expectedRevisionId: expectedRevisionSchema,
  idempotencyKey: z.string().min(8).max(180).regex(/^[A-Za-z0-9_-]+$/),
  settings: z.object({ providerMode: z.enum(["mock", "google", "runpod", "fal", "openai", "ltx"]).optional(), imageProvider: z.string().max(80).optional() }).strict().optional(),
});
export const leaseSchema = z.object({ leaseToken: uuid });
export const attemptSchema = leaseSchema.extend({
  state: z.enum(["PREPARED", "SUBMITTED", "COMPLETED", "UNCERTAIN", "FAILED"]),
  provider: z.string().min(1).max(80), model: z.string().max(200).optional(), operationId: z.string().max(300).optional(),
  requestFingerprint: z.string().min(8).max(200), metadata: z.record(z.unknown()).optional(),
});
export const completeSchema = leaseSchema.extend({ result: z.object({
  kind: z.enum(["SCRIPT", "STORYBOARD", "KEYFRAME", "CLIP", "EXPORT"]), content: z.unknown().optional(),
  asset: createGeneratedAssetSchema.optional(), render: createRenderOutputSchema.optional(), metadata: z.record(z.unknown()).optional(),
}) });
export const failSchema = leaseSchema.extend({ errorCode: z.string().min(1).max(120), errorMessage: z.string().min(1).max(2000), uncertain: z.boolean().optional() });
export type ScriptContent = z.infer<typeof scriptContentSchema>;
export type ShotContent = z.infer<typeof shotContentSchema>;
export type TimelineContent = z.infer<typeof timelineContentSchema>;
export type ActionInput = z.infer<typeof actionSchema>;
export type CompleteInput = z.infer<typeof completeSchema>;
export type AttemptInput = z.infer<typeof attemptSchema>;
