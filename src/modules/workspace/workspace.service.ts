import { randomUUID } from "node:crypto";
import type { PipelineJob } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { assertExpectedRevision, conflict, objectValue, safeMetadata, shotCompositionFingerprint, shotMotionFingerprint, stableFingerprint, validateTimelineMedia } from "./workspace.rules";
import { addRevision, ensureArtifact, getArtifact, isScriptCompatible, json, lockAd, requireApproved, transaction, updateShotDraft, validateShotReferences, type Tx } from "./workspace.repository";
import { scriptContentSchema, shotContentSchema, storyboardContentSchema, timelineContentSchema, type ScriptContent, type ShotContent, type TimelineContent } from "./workspace.schemas";

export function publicJob(job: PipelineJob) {
  const guided = objectValue(objectValue(job.requestPayload).guided);
  return { id: job.id, adId: job.adId, type: job.type, status: job.status, operation: guided.operation ?? null,
    shotId: objectValue(guided.shot).shotId ?? null, createdAt: job.createdAt, updatedAt: job.updatedAt,
    startedAt: job.startedAt, completedAt: job.completedAt, cancelRequested: !!job.cancelRequestedAt,
    errorCode: job.errorCode, errorMessage: job.errorMessage, idempotencyKey: job.idempotencyKey,
    expectedRevisionId: guided.expectedRevisionId ?? null, settings: objectValue(objectValue(job.requestPayload).actionRequest).settings ?? {},
    retryAction: objectValue(job.requestPayload).actionRequest ?? null };
}
export async function getWorkspace(ownerId: string, adId: string) {
  const ad = await prisma.ad.findFirst({ where: { id: adId, project: { ownerId } } });
  if (!ad) throw new NotFoundError("Ad was not found.");
  const [artifacts, shots, assets, jobs, renderOutputs] = await Promise.all([
    prisma.creativeArtifact.findMany({ where: { adId }, orderBy: { createdAt: "asc" }, include: { revisions: { orderBy: { version: "desc" }, take: 100 }, currentRevision: true, approvedRevision: true, approvals: true } }),
    prisma.shot.findMany({ where: { adId }, orderBy: { shotNumber: "asc" } }),
    prisma.asset.findMany({ where: { adId }, orderBy: { createdAt: "desc" } }),
    prisma.pipelineJob.findMany({ where: { adId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.renderOutput.findMany({ where: { adId }, orderBy: { createdAt: "desc" } }),
  ]);
  const current = (kind: string) => artifacts.find((artifact) => artifact.kind === kind && artifact.scopeKey === "root");
  const approved = (kind: string) => { const a = current(kind); return !!a?.currentRevisionId && a.currentRevisionId === a.approvedRevisionId; };
  const allowedActions = ["GENERATE_SCRIPT"];
  if (approved("SCRIPT")) allowedActions.push("GENERATE_STORYBOARD");
  if (approved("SCRIPT") && approved("STORYBOARD")) allowedActions.push("GENERATE_KEYFRAME", "GENERATE_CLIP");
  if (approved("TIMELINE")) allowedActions.push("RENDER_EXPORT");
  const warnings: string[] = [];
  if (!artifacts.length && (shots.length || renderOutputs.length)) warnings.push("This is an automatic-generation project. Import its existing artifacts to start guided editing; original media and exports remain available.");
  if (artifacts.some((artifact) => artifact.currentRevision && artifact.currentRevision.version > 100)) warnings.push("The most recent 100 revisions per artifact are shown; older revisions remain stored.");
  const revisions = [...new Map(artifacts.flatMap((artifact) => [...artifact.revisions, ...(artifact.currentRevision ? [artifact.currentRevision] : []), ...(artifact.approvedRevision ? [artifact.approvedRevision] : [])]).map((revision) => [revision.id, revision])).values()];
  return {
    ad, artifacts: artifacts.map(({ revisions: _revisions, currentRevision: _current, approvedRevision: _approved, ...artifact }) => artifact), revisions,
    shots: shots.map((shot) => {
      const revisionId = artifacts.find((artifact) => artifact.shotId === shot.id)?.currentRevisionId;
      return { ...shot, keyframeCompatible: !!revisionId && shot.keyframeRevisionId === revisionId && !!shot.keyframeAssetId,
        videoCompatible: !!revisionId && shot.videoRevisionId === revisionId && !!shot.videoAssetId };
    }),
    assets: assets.map(({ metadata, ...asset }) => ({ ...asset, metadata: safeMetadata(metadata) })),
    jobs: jobs.map(publicJob), renderOutputs: renderOutputs.map(({ metadata, ...output }) => ({ ...output, metadata: safeMetadata(metadata) })),
    allowedActions, warnings,
  };
}
export const workspaceService = {
  getWorkspace,
  async saveScript(ownerId: string, adId: string, input: { expectedRevisionId: string | null; content: ScriptContent }) {
    await transaction(async (tx) => {
      await lockAd(tx, adId, ownerId);
      const artifact = await ensureArtifact(tx, adId, "SCRIPT");
      assertExpectedRevision(artifact.currentRevisionId, input.expectedRevisionId);
      await addRevision(tx, artifact, input.content, { origin: "user_edit", authorId: ownerId });
    });
    return getWorkspace(ownerId, adId);
  },
  async saveShot(ownerId: string, adId: string, shotId: string, input: { expectedRevisionId: string | null; content: ShotContent }) {
    await transaction(async (tx) => { await lockAd(tx, adId, ownerId); await updateShotDraft(tx, adId, shotId, input.expectedRevisionId, input.content, ownerId); });
    return getWorkspace(ownerId, adId);
  },
  async createShot(ownerId: string, adId: string, input: { content: ShotContent }) {
    await transaction(async (tx) => {
      const ad = await lockAd(tx, adId, ownerId);
      if (ad.shots.length >= 50) throw new BadRequestError("An ad may contain at most 50 shots.");
      const shotId = randomUUID();
      const shotNumber = Math.max(0, ...ad.shots.map((shot) => shot.shotNumber)) + 1;
      const content = { ...input.content, shotId, shotNumber };
      await validateShotReferences(tx, adId, content);
      await tx.shot.create({ data: { id: shotId, adId, shotNumber, role: content.role, durationSeconds: Math.ceil(content.durationSeconds), promptPayload: json(content) } });
      const artifact = await ensureArtifact(tx, adId, "SHOT_PLAN", shotId);
      const script = await getArtifact(tx, adId, "SCRIPT");
      const sourceRevisionIds = script?.currentRevisionId ? [script.currentRevisionId] : [];
      const revision = await addRevision(tx, artifact, content, { origin: "user_edit", authorId: ownerId, sourceRevisionIds });
      const board = await ensureArtifact(tx, adId, "STORYBOARD");
      const old = board.currentRevisionId ? await tx.creativeRevision.findUnique({ where: { id: board.currentRevisionId } }) : null;
      const shots = [...(old ? storyboardContentSchema.parse(old.content).shots : []), { shotId, revisionId: revision.id }];
      await addRevision(tx, board, { shots }, { origin: "user_edit", authorId: ownerId, sourceRevisionIds: [...sourceRevisionIds, ...shots.map((shot) => shot.revisionId)] });
    });
    return getWorkspace(ownerId, adId);
  },
  async saveStoryboard(ownerId: string, adId: string, input: { expectedRevisionId: string | null; shotIds: string[] }) {
    await transaction(async (tx) => {
      await lockAd(tx, adId, ownerId);
      const board = await ensureArtifact(tx, adId, "STORYBOARD");
      assertExpectedRevision(board.currentRevisionId, input.expectedRevisionId);
      const shots = [];
      for (const shotId of input.shotIds) {
        const artifact = await getArtifact(tx, adId, "SHOT_PLAN", shotId);
        if (!artifact?.currentRevisionId) throw new BadRequestError("Every storyboard shot must belong to this ad and have a saved plan.");
        shots.push({ shotId, revisionId: artifact.currentRevisionId });
      }
      const script = await getArtifact(tx, adId, "SCRIPT");
      await addRevision(tx, board, { shots }, { origin: "user_edit", authorId: ownerId,
        sourceRevisionIds: [...shots.map((shot) => shot.revisionId), ...(script?.currentRevisionId ? [script.currentRevisionId] : [])] });
    });
    return getWorkspace(ownerId, adId);
  },
  async saveTimeline(ownerId: string, adId: string, input: { expectedRevisionId: string | null; content: TimelineContent }) {
    await transaction(async (tx) => {
      const ad = await lockAd(tx, adId, ownerId);
      validateTimelineMedia(input.content, ad.assets, ad.shots.map((shot) => shot.id));
      const timeline = await ensureArtifact(tx, adId, "TIMELINE");
      assertExpectedRevision(timeline.currentRevisionId, input.expectedRevisionId);
      const sourceRevisionIds = await currentSources(tx, adId, input.content.clips.map((clip) => clip.shotId));
      await addRevision(tx, timeline, input.content, { origin: "user_edit", authorId: ownerId, sourceRevisionIds });
    });
    return getWorkspace(ownerId, adId);
  },
  async approve(ownerId: string, adId: string, input: { artifactId: string; revisionId: string }) {
    await transaction(async (tx) => {
      const ad = await lockAd(tx, adId, ownerId);
      const artifact = await tx.creativeArtifact.findFirst({ where: { id: input.artifactId, adId }, include: { currentRevision: true } });
      if (!artifact) throw new NotFoundError("Artifact was not found.");
      assertExpectedRevision(artifact.currentRevisionId, input.revisionId);
      if (!artifact.currentRevision) throw new BadRequestError("Save a draft before approving it.");
      if (artifact.kind === "SCRIPT") validateScriptForApproval(scriptContentSchema.parse(artifact.currentRevision.content), ad.durationSeconds ?? 30);
      if (artifact.kind === "SHOT_PLAN") await validateShotReferences(tx, adId, shotContentSchema.parse(artifact.currentRevision.content));
      if (artifact.kind === "STORYBOARD") {
        const script = requireApproved(await getArtifact(tx, adId, "SCRIPT"), "script");
        if (!await isScriptCompatible(tx, adId, artifact.currentRevision.sourceRevisionIds)) throw new BadRequestError("The storyboard was created from a different script. Save/review it against the current script first.");
        const board = storyboardContentSchema.parse(artifact.currentRevision.content);
        let duration = 0;
        for (const entry of board.shots) {
          const plan = await getArtifact(tx, adId, "SHOT_PLAN", entry.shotId);
          if (!plan?.currentRevision || plan.currentRevisionId !== entry.revisionId) conflict("A storyboard shot has changed. Reload and review the storyboard.");
          const content = shotContentSchema.parse(plan.currentRevision.content);
          await validateShotReferences(tx, adId, content);
          duration += content.durationSeconds;
          await recordApproval(tx, plan.id, entry.revisionId, ownerId);
        }
        if (duration > 600) throw new BadRequestError("Storyboard duration cannot exceed 10 minutes.");
        void script;
      }
      if (artifact.kind === "TIMELINE") await validateTimelineForExport(tx, adId, timelineContentSchema.parse(artifact.currentRevision.content));
      await recordApproval(tx, artifact.id, input.revisionId, ownerId);
    });
    return getWorkspace(ownerId, adId);
  },
  async restore(ownerId: string, adId: string, revisionId: string) {
    await transaction(async (tx) => {
      const ad = await lockAd(tx, adId, ownerId);
      const revision = await tx.creativeRevision.findFirst({ where: { id: revisionId, artifact: { adId } }, include: { artifact: true } });
      if (!revision) throw new NotFoundError("Revision was not found.");
      if (revision.artifact.kind === "SHOT_PLAN" && revision.artifact.shotId) {
        await updateShotDraft(tx, adId, revision.artifact.shotId, revision.artifact.currentRevisionId, shotContentSchema.parse(revision.content), ownerId,
          { origin: "restore", parentRevisionId: revision.id });
      } else if (revision.artifact.kind === "STORYBOARD") {
        const board = storyboardContentSchema.parse(revision.content);
        const shots = [];
        for (const entry of board.shots) {
          const source = await tx.creativeRevision.findFirst({ where: { id: entry.revisionId, artifact: { adId, shotId: entry.shotId } } });
          const current = await getArtifact(tx, adId, "SHOT_PLAN", entry.shotId);
          if (!source || !current) throw new BadRequestError("A storyboard source revision is unavailable.");
          const restored = await updateShotDraft(tx, adId, entry.shotId, current.currentRevisionId, shotContentSchema.parse(source.content), ownerId,
            { origin: "restore", parentRevisionId: source.id, updateStoryboard: false });
          shots.push({ shotId: entry.shotId, revisionId: restored.id });
        }
        const script = await getArtifact(tx, adId, "SCRIPT");
        await addRevision(tx, revision.artifact, { shots }, { origin: "restore", authorId: ownerId, parentRevisionId: revision.id,
          sourceRevisionIds: [...shots.map((shot) => shot.revisionId), ...(script?.currentRevisionId ? [script.currentRevisionId] : [])] });
      } else {
        if (revision.artifact.kind === "SCRIPT") scriptContentSchema.parse(revision.content);
        if (revision.artifact.kind === "TIMELINE") validateTimelineMedia(timelineContentSchema.parse(revision.content), ad.assets, ad.shots.map((shot) => shot.id));
        await addRevision(tx, revision.artifact, revision.content, { origin: "restore", authorId: ownerId, sourceRevisionIds: revision.sourceRevisionIds, parentRevisionId: revision.id });
      }
    });
    return getWorkspace(ownerId, adId);
  },
  async selectAsset(ownerId: string, adId: string, shotId: string, input: { kind: "KEYFRAME" | "CLIP"; assetId: string; expectedRevisionId: string | null }) {
    await transaction(async (tx) => {
      const ad = await lockAd(tx, adId, ownerId);
      const shot = ad.shots.find((value) => value.id === shotId);
      const plan = await getArtifact(tx, adId, "SHOT_PLAN", shotId);
      if (!shot || !plan?.currentRevision) throw new NotFoundError("Shot was not found.");
      assertExpectedRevision(plan.currentRevisionId, input.expectedRevisionId);
      const asset = ad.assets.find((value) => value.id === input.assetId && value.status === "READY");
      if (!asset) throw new BadRequestError("Select a ready media asset belonging to this ad.");
      if (!asset.mimeType.startsWith(input.kind === "KEYFRAME" ? "image/" : "video/")) throw new BadRequestError("This media type cannot be selected for that role.");
      const metadata = objectValue(asset.metadata);
      const content = shotContentSchema.parse(plan.currentRevision.content);
      const manual = metadata.localUpload === true && input.kind === "KEYFRAME";
      const fingerprint = input.kind === "KEYFRAME" ? shotCompositionFingerprint(content) : shotMotionFingerprint(content);
      const candidateFingerprint = metadata[input.kind === "KEYFRAME" ? "compositionFingerprint" : "motionFingerprint"];
      const sourceRevision = metadata.sourceRevisionId ?? metadata.sourceShotRevisionId;
      const currentSelection = input.kind === "KEYFRAME" ? shot.keyframeAssetId === asset.id && shot.keyframeRevisionId === plan.currentRevisionId : shot.videoAssetId === asset.id && shot.videoRevisionId === plan.currentRevisionId;
      if (!manual && !currentSelection && (metadata.shotId !== shotId || (candidateFingerprint !== fingerprint && sourceRevision !== plan.currentRevisionId)))
        throw new BadRequestError("This candidate belongs to a different shot revision. Restore that revision or generate a compatible candidate.");
      if (input.kind === "CLIP" && !currentSelection && metadata.conditioningAssetId !== shot.keyframeAssetId) throw new BadRequestError("This clip used a different selected keyframe.");
      await tx.shot.update({ where: { id: shotId }, data: input.kind === "KEYFRAME" ? {
        keyframeAssetId: asset.id, keyframeRevisionId: plan.currentRevisionId,
        ...(shot.keyframeAssetId !== asset.id ? { videoRevisionId: null, status: "KEYFRAME_READY" } : {}),
      } : { videoAssetId: asset.id, videoRevisionId: plan.currentRevisionId, status: "VIDEO_READY" } });
      await tx.creativeArtifact.updateMany({ where: { adId, kind: "TIMELINE" }, data: { approvedRevisionId: null } });
    });
    return getWorkspace(ownerId, adId);
  },
};
export function validateScriptForApproval(script: ScriptContent, targetDuration: number) {
  if (![...script.voiceover, ...script.captions].some((cue) => cue.text.trim())) throw new BadRequestError("Write at least one script beat or caption before approval.");
  for (const list of [script.voiceover, script.captions]) {
    let previousStart = -1;
    for (const cue of list) {
      if (!cue.text.trim() || cue.startSecond < previousStart || cue.endSecond > targetDuration) throw new BadRequestError("Script cues must contain text, be in time order, and fit the ad duration.");
      previousStart = cue.startSecond;
    }
  }
  for (let index = 1; index < script.voiceover.length; index++) if (script.voiceover[index].startSecond < script.voiceover[index - 1].endSecond)
    throw new BadRequestError("Voiceover beats must not overlap.");
}
export async function recordApproval(tx: Tx, artifactId: string, revisionId: string, approvedById: string) {
  await tx.creativeApproval.upsert({ where: { artifactId_revisionId_approvedById: { artifactId, revisionId, approvedById } }, create: { artifactId, revisionId, approvedById }, update: {} });
  await tx.creativeArtifact.update({ where: { id: artifactId }, data: { approvedRevisionId: revisionId } });
}
async function currentSources(tx: Tx, adId: string, shotIds: string[]) {
  const artifacts = await tx.creativeArtifact.findMany({ where: { adId, OR: [{ kind: { in: ["SCRIPT", "STORYBOARD"] } }, { shotId: { in: shotIds } }] } });
  return artifacts.flatMap((artifact) => artifact.currentRevisionId ? [artifact.currentRevisionId] : []);
}
export async function validateTimelineForExport(tx: Tx, adId: string, timeline: TimelineContent) {
  requireApproved(await getArtifact(tx, adId, "SCRIPT"), "script");
  const [assets, shots] = await Promise.all([tx.asset.findMany({ where: { adId } }), tx.shot.findMany({ where: { adId } })]);
  validateTimelineMedia(timeline, assets, shots.map((shot) => shot.id));
  const board = requireApproved(await getArtifact(tx, adId, "STORYBOARD"), "storyboard");
  if (!await isScriptCompatible(tx, adId, board.sourceRevisionIds)) throw new BadRequestError("The storyboard must be reviewed against the current script before export.");
  const boardShotIds = new Set(storyboardContentSchema.parse(board.content).shots.map((entry) => entry.shotId));
  for (const clip of timeline.clips) {
    const shot = shots.find((item) => item.id === clip.shotId);
    const plan = await getArtifact(tx, adId, "SHOT_PLAN", clip.shotId);
    requireApproved(plan, "shot plan");
    if (!boardShotIds.has(clip.shotId) || !shot || shot.videoAssetId !== clip.assetId || shot.videoRevisionId !== plan?.currentRevisionId)
      throw new BadRequestError("A timeline clip is stale or has not been selected for the current shot. Review the clip selection before export.");
  }
}
