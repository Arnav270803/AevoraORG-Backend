import { createHash } from "node:crypto";
import { AppError, BadRequestError } from "../../utils/errors";
import type { ShotContent, TimelineContent } from "./workspace.schemas";

export function conflict(message = "This draft changed. Reload the workspace before saving again."): never { throw new AppError(message, 409); }
export function assertExpectedRevision(actual: string | null, expected: string | null) { if (actual !== expected) conflict(); }
export function objectValue(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function stableFingerprint(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)]));
    return v;
  }
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function shotCompositionFingerprint(shot: ShotContent) {
  return stableFingerprint({ visualDescription: shot.visualDescription, framing: shot.camera.framing, lensFeel: shot.camera.lensFeel,
    lighting: shot.lighting, environment: shot.environment, objects: shot.objects, productContinuityNotes: shot.productContinuityNotes,
    imagePrompt: shot.imagePrompt, negativePrompt: shot.negativePrompt, referenceAssetIds: shot.referenceAssetIds });
}
export function shotMotionFingerprint(shot: ShotContent) {
  return stableFingerprint({ composition: shotCompositionFingerprint(shot), movement: shot.camera.movement, videoPrompt: shot.videoPrompt, durationSeconds: shot.durationSeconds });
}
export function classifyShotChange(before: ShotContent, after: ShotContent): "composition" | "motion" | "editorial" {
  if (shotCompositionFingerprint(before) !== shotCompositionFingerprint(after)) return "composition";
  return shotMotionFingerprint(before) !== shotMotionFingerprint(after) ? "motion" : "editorial";
}
export function validateShotGenerationInputs(shot: ShotContent, kind: "KEYFRAME" | "CLIP") {
  if (!shot.visualDescription.trim() || !shot.camera.framing.trim()) throw new BadRequestError("Describe the shot and camera framing before generating media.");
  if (kind === "KEYFRAME" && !shot.imagePrompt.trim()) throw new BadRequestError("Write an image prompt before generating a keyframe, or upload a keyframe manually.");
  if (kind === "CLIP" && !shot.videoPrompt.trim()) throw new BadRequestError("Write a motion/video prompt before generating this clip.");
}
export function mediaDurationSeconds(metadata: unknown): number | undefined {
  const data = objectValue(metadata);
  if (typeof data.durationSeconds === "number" && Number.isFinite(data.durationSeconds) && data.durationSeconds > 0) return data.durationSeconds;
  if (typeof data.durationMs === "number" && Number.isFinite(data.durationMs) && data.durationMs > 0) return data.durationMs / 1000;
  const probe = objectValue(data.probe);
  if (typeof probe.durationSeconds === "number" && Number.isFinite(probe.durationSeconds) && probe.durationSeconds > 0) return probe.durationSeconds;
  return undefined;
}
export function validateTimelineMedia(timeline: TimelineContent, assets: Array<{ id: string; mimeType: string; status: string; metadata: unknown }>, shotIds: string[]) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  for (const item of [...timeline.clips, ...timeline.audioTracks]) {
    const asset = byId.get(item.assetId);
    if (!asset || asset.status !== "READY") throw new BadRequestError("Every timeline asset must be a ready asset belonging to this ad.");
    const isClip = "shotId" in item;
    if (isClip && (!shotIds.includes(item.shotId) || !asset.mimeType.startsWith("video/"))) throw new BadRequestError("Timeline clips require a valid shot and video asset.");
    if (!isClip && !asset.mimeType.startsWith("audio/") && !asset.mimeType.startsWith("video/")) throw new BadRequestError("Audio tracks require an audio or video asset.");
    const duration = mediaDurationSeconds(asset.metadata);
    if (duration === undefined) throw new BadRequestError("Source media duration is unknown. Import or generate measured media before trimming it.");
    if ((item.sourceInFrame + item.durationFrames) / timeline.fps > duration + 1 / timeline.fps) throw new BadRequestError("A trim extends beyond its source media. Shorten the clip; sources are not looped.");
  }
}
export function safeMetadata(value: unknown): Record<string, unknown> {
  const input = objectValue(value);
  const allowed = ["generatedRole", "shotId", "sourceRevisionId", "timelineRevisionId", "sourceShotRevisionId", "sourceScriptRevisionId", "conditioningAssetId", "compositionFingerprint", "motionFingerprint", "width", "height", "durationSeconds", "durationMs", "fps", "hasAudio", "localUpload", "format", "sampleRate", "channels", "legacyImport", "stale"];
  return Object.fromEntries(Object.entries(input).filter(([key, item]) => allowed.includes(key) && ["string", "number", "boolean"].includes(typeof item)));
}
export function redactAttemptMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAttemptMetadata);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/api.?key|secret|authorization|base64|credential|signed.?url/i.test(key) && !/^(token|accessToken|refreshToken|leaseToken)$/i.test(key)).map(([key, item]) => [key, redactAttemptMetadata(item)]));
  if (typeof value === "string") {
    if (value.startsWith("data:")) return "[redacted]";
    if (/^https?:\/\//i.test(value)) { try { const url = new URL(value); url.search = ""; url.username = ""; url.password = ""; return url.toString(); } catch { return "[redacted]"; } }
  }
  return value;
}
