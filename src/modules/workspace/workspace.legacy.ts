import { randomUUID } from "node:crypto";
import { BadRequestError } from "../../utils/errors";
import { mediaDurationSeconds, objectValue } from "./workspace.rules";
import { addRevision, ensureArtifact, json, lockAd, transaction } from "./workspace.repository";
import { getWorkspace } from "./workspace.service";
import { scriptContentSchema, shotContentSchema, timelineContentSchema } from "./workspace.schemas";

/** Explicit bounded import from database payloads only; never crawl arbitrary paths or mutate old jobs/assets. */
export async function importLegacy(ownerId: string, adId: string) {
  await transaction(async (tx) => {
    const ad = await lockAd(tx, adId, ownerId);
    if (await tx.creativeArtifact.count({ where: { adId } })) return;
    const jobs = await tx.pipelineJob.findMany({ where: { adId }, orderBy: { createdAt: "desc" }, take: 20,
      include: { stepRuns: { where: { name: "script_generation", status: "SUCCEEDED" } } } });
    const scriptValue = jobs.flatMap((job) => job.stepRuns).map((step) => objectValue(step.outputPayload).script)
      .find((value) => scriptContentSchema.safeParse(value).success);
    if (!scriptValue) throw new BadRequestError("No valid saved legacy script was found. The existing video is preserved; create a new script draft to use guided editing.");
    const scriptArtifact = await ensureArtifact(tx, adId, "SCRIPT");
    const script = await addRevision(tx, scriptArtifact, scriptContentSchema.parse(scriptValue), { origin: "legacy_import", authorId: ownerId });
    const entries = [];
    for (const shot of ad.shots.slice(0, 50)) {
      const parsed = shotContentSchema.safeParse({ ...objectValue(shot.promptPayload), shotId: shot.id, shotNumber: shot.shotNumber });
      if (!parsed.success) continue;
      const artifact = await ensureArtifact(tx, adId, "SHOT_PLAN", shot.id);
      const revision = await addRevision(tx, artifact, parsed.data, { origin: "legacy_import", authorId: ownerId, sourceRevisionIds: [script.id] });
      const image = ad.assets.find((asset) => asset.id === shot.keyframeAssetId && asset.status === "READY" && asset.mimeType.startsWith("image/"));
      const video = ad.assets.find((asset) => asset.id === shot.videoAssetId && asset.status === "READY" && asset.mimeType.startsWith("video/"));
      await tx.shot.update({ where: { id: shot.id }, data: { keyframeRevisionId: image ? revision.id : null, videoRevisionId: video ? revision.id : null } });
      entries.push({ shotId: shot.id, revisionId: revision.id });
    }
    if (!entries.length) return;
    const boardArtifact = await ensureArtifact(tx, adId, "STORYBOARD");
    const board = await addRevision(tx, boardArtifact, { shots: entries }, { origin: "legacy_import", authorId: ownerId, sourceRevisionIds: [script.id, ...entries.map((entry) => entry.revisionId)] });
    const fps = 30;
    const clips = entries.flatMap((entry) => {
      const shot = ad.shots.find((item) => item.id === entry.shotId);
      const asset = ad.assets.find((item) => item.id === shot?.videoAssetId && item.mimeType.startsWith("video/") && item.status === "READY");
      const duration = asset ? mediaDurationSeconds(asset.metadata) : undefined;
      return asset && shot && duration ? [{ id: randomUUID(), shotId: shot.id, assetId: asset.id, sourceInFrame: 0,
        durationFrames: Math.max(1, Math.floor(Math.min(duration, shot.durationSeconds) * fps)), fit: "contain" as const, muted: false, volume: 1 }] : [];
    });
    if (clips.length !== entries.length) return; // Unknown sources remain accessible; do not invent measured media durations.
    const [w, h] = ad.aspectRatio === "16:9" ? [1920, 1080] : ad.aspectRatio === "1:1" ? [1080, 1080] : [1080, 1920];
    const total = clips.reduce((sum, clip) => sum + clip.durationFrames, 0);
    const content = scriptContentSchema.parse(script.content);
    const timeline = timelineContentSchema.parse({ fps, width: w, height: h, clips, audioTracks: [], normalizeAudio: true,
      overlays: content.captions.filter((caption) => Math.round(caption.startSecond * fps) < total).map((caption) => ({
        id: randomUUID(), text: caption.text, startFrame: Math.round(caption.startSecond * fps),
        endFrame: Math.min(total, Math.max(Math.round(caption.startSecond * fps) + 1, Math.round(caption.endSecond * fps))),
        position: "bottom", fontSize: 42, color: "#ffffff",
      })) });
    const timelineArtifact = await ensureArtifact(tx, adId, "TIMELINE");
    await addRevision(tx, timelineArtifact, timeline, { origin: "legacy_import", authorId: ownerId, sourceRevisionIds: [script.id, board.id, ...entries.map((entry) => entry.revisionId)] });
  });
  return getWorkspace(ownerId, adId);
}
