import type { Asset } from "@prisma/client";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { assertExpectedRevision, conflict, objectValue, stableFingerprint, validateShotGenerationInputs } from "./workspace.rules";
import { ensureArtifact, getArtifact, isScriptCompatible, json, lockAd, requireApproved, transaction } from "./workspace.repository";
import { publicJob, validateScriptForApproval, validateTimelineForExport } from "./workspace.service";
import { scriptContentSchema, shotContentSchema, storyboardContentSchema, timelineContentSchema, type ActionInput } from "./workspace.schemas";

function frozenAsset(asset: Asset) {
  return { id: asset.id, assetId: asset.id, kind: asset.kind, status: asset.status, fileName: asset.fileName, mimeType: asset.mimeType,
    storageProvider: asset.storageProvider, storageKey: asset.storageKey, url: asset.url, metadata: asset.metadata };
}
export async function dispatchAction(ownerId: string, adId: string, input: ActionInput) {
  return transaction(async (tx) => {
    const ad = await lockAd(tx, adId, ownerId);
    const actionFingerprint = stableFingerprint({ operation: input.operation, shotId: input.shotId ?? null,
      expectedRevisionId: input.expectedRevisionId, settings: input.settings ?? {} });
    const previous = await tx.pipelineJob.findUnique({ where: { adId_idempotencyKey: { adId, idempotencyKey: input.idempotencyKey } } });
    if (previous) {
      if (objectValue(previous.requestPayload).actionFingerprint !== actionFingerprint) conflict("This idempotency key was used for a different action. Use a new key for a new request.");
      if (previous.status === "FAILED") {
        // Recovery preserves the immutable inputs and provider operation IDs. The worker resumes ingestion rather than submitting again.
        const retried = await tx.pipelineJob.update({ where: { id: previous.id }, data: { status: "QUEUED", errorCode: null,
          errorMessage: null, completedAt: null, leaseToken: null, leaseExpiresAt: null, heartbeatAt: null } });
        await tx.pipelineStepRun.updateMany({ where: { jobId: previous.id }, data: { status: "PENDING", errorCode: null, errorMessage: null, completedAt: null } });
        return publicJob(retried);
      }
      return publicJob(previous);
    }
    const isShot = input.operation === "GENERATE_KEYFRAME" || input.operation === "GENERATE_CLIP";
    if (isShot !== !!input.shotId) throw new BadRequestError("Keyframe and clip actions require one shot; other actions must not target a shot.");
    const kind = input.operation === "GENERATE_SCRIPT" ? "SCRIPT" : input.operation === "GENERATE_STORYBOARD" ? "STORYBOARD" : isShot ? "SHOT_PLAN" : "TIMELINE";
    if (input.shotId && !ad.shots.some((shot) => shot.id === input.shotId)) throw new NotFoundError("Shot was not found.");
    const target = await ensureArtifact(tx, adId, kind, input.shotId);
    assertExpectedRevision(target.currentRevisionId, input.expectedRevisionId);
    const readyAssets = ad.assets.filter((asset) => asset.status === "READY");
    const brief = objectValue(ad.creativeBrief);
    const adInput = {
      adId, projectId: ad.projectId, projectName: ad.project.name, productName: ad.productName ?? ad.title,
      brandName: ad.brandName ?? "", category: ad.category ?? "", objective: ad.objective ?? "Generate a product advertisement",
      platform: ad.platform ?? "instagram", aspectRatio: ad.aspectRatio ?? "9:16", durationSeconds: ad.durationSeconds ?? 30,
      referenceNotes: ad.referenceNotes ?? "", imageGuidance: Array.isArray(brief.imageGuidance) ? brief.imageGuidance.filter((v): v is string => typeof v === "string") : [],
      assets: readyAssets.map(frozenAsset),
    };
    const guided: Record<string, unknown> = { contractVersion: 1, operation: input.operation, adInput, targetArtifactId: target.id,
      expectedRevisionId: input.expectedRevisionId, settings: {
        ...(process.env.PIPELINE_PROVIDER_MODE ? { providerMode: process.env.PIPELINE_PROVIDER_MODE } : {}),
        ...(process.env.PIPELINE_IMAGE_PROVIDER ? { imageProvider: process.env.PIPELINE_IMAGE_PROVIDER } : {}),
        ...input.settings,
      } };
    if (input.operation !== "GENERATE_SCRIPT") {
      const script = requireApproved(await getArtifact(tx, adId, "SCRIPT"), "script");
      const content = scriptContentSchema.parse(script.content);
      validateScriptForApproval(content, adInput.durationSeconds);
      guided.scriptRevisionId = script.id; guided.script = content;
    }
    if (isShot) {
      const board = requireApproved(await getArtifact(tx, adId, "STORYBOARD"), "storyboard");
      if (!await isScriptCompatible(tx, adId, board.sourceRevisionIds)) throw new BadRequestError("Review and save the storyboard against the current approved script before generating media.");
      const shot = ad.shots.find((item) => item.id === input.shotId);
      const shotArtifact = await getArtifact(tx, adId, "SHOT_PLAN", input.shotId);
      const revision = requireApproved(shotArtifact, "shot plan");
      if (!shot || !storyboardContentSchema.parse(board.content).shots.some((entry) => entry.shotId === shot.id && entry.revisionId === revision.id))
        throw new BadRequestError("The shot must be part of the current approved storyboard.");
      const content = shotContentSchema.parse(revision.content);
      validateShotGenerationInputs(content, input.operation === "GENERATE_KEYFRAME" ? "KEYFRAME" : "CLIP");
      guided.storyboardRevisionId = board.id; guided.shotRevisionId = revision.id; guided.shot = content;
      guided.referenceAssets = content.referenceAssetIds.map((id) => {
        const asset = readyAssets.find((value) => value.id === id && value.mimeType.startsWith("image/"));
        if (!asset) throw new BadRequestError("A shot reference image is missing or not ready.");
        return frozenAsset(asset);
      });
      if (input.operation === "GENERATE_CLIP") {
        const keyframe = readyAssets.find((asset) => asset.id === shot.keyframeAssetId && asset.mimeType.startsWith("image/"));
        if (!keyframe || shot.keyframeRevisionId !== revision.id) throw new BadRequestError("Select a compatible keyframe before generating this clip.");
        guided.conditioningAsset = frozenAsset(keyframe);
      }
    }
    if (input.operation === "RENDER_EXPORT") {
      const revision = requireApproved(await getArtifact(tx, adId, "TIMELINE"), "timeline");
      const timeline = timelineContentSchema.parse(revision.content);
      await validateTimelineForExport(tx, adId, timeline);
      guided.timelineRevisionId = revision.id; guided.timeline = timeline;
      const board = requireApproved(await getArtifact(tx, adId, "STORYBOARD"), "storyboard");
      guided.storyboardRevisionId = board.id;
    }
    const job = await tx.pipelineJob.create({ data: { adId, requestedById: ownerId,
      type: input.operation === "RENDER_EXPORT" ? "RENDER_EXPORT" : "GUIDED_GENERATION", idempotencyKey: input.idempotencyKey,
      snapshotHash: stableFingerprint(guided), requestPayload: json({ guided, actionFingerprint, actionRequest: input }),
      stepRuns: { create: { name: input.operation.toLowerCase(), sequence: 1 } },
    } });
    if (input.operation === "RENDER_EXPORT") await tx.ad.update({ where: { id: adId }, data: { status: "GENERATING" } });
    return publicJob(job);
  });
}
export async function cancelJob(ownerId: string, jobId: string) {
  return transaction(async (tx) => {
    const found = await tx.pipelineJob.findFirst({ where: { id: jobId, ad: { project: { ownerId } } } });
    if (!found) throw new NotFoundError("Pipeline job was not found.");
    await lockAd(tx, found.adId, ownerId);
    const job = await tx.pipelineJob.findUniqueOrThrow({ where: { id: jobId } });
    if (objectValue(job.requestPayload).guided === undefined) throw new BadRequestError("Cancellation is available for guided jobs only; the automatic worker does not support cancellation.");
    if (["SUCCEEDED", "FAILED", "CANCELED"].includes(job.status)) return publicJob(job);
    const canceled = await tx.pipelineJob.update({ where: { id: jobId }, data: { status: "CANCELED", cancelRequestedAt: new Date(), completedAt: new Date() } });
    await tx.pipelineStepRun.updateMany({ where: { jobId }, data: { status: "SKIPPED", completedAt: new Date() } });
    if (objectValue(objectValue(job.requestPayload).guided).operation === "RENDER_EXPORT") {
      const hasOutput = await tx.renderOutput.count({ where: { adId: job.adId, kind: "VIDEO" } });
      await tx.ad.update({ where: { id: job.adId }, data: { status: hasOutput ? "COMPLETED" : "READY" } });
    }
    return publicJob(canceled);
  });
}
