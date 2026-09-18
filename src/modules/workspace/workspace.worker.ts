import { randomUUID } from "node:crypto";
import { Prisma, type PipelineJobType } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { conflict, objectValue, redactAttemptMetadata, shotCompositionFingerprint, shotMotionFingerprint, stableFingerprint } from "./workspace.rules";
import { addRevision, assertLease, ensureArtifact, getArtifact, guidedPayload, isGuided, json, lockAd, transaction, type Tx } from "./workspace.repository";
import { publicJob, validateTimelineForExport } from "./workspace.service";
import { scriptContentSchema, shotContentSchema, storyboardContentSchema, timelineContentSchema, type AttemptInput, type CompleteInput } from "./workspace.schemas";

const LEASE_MS = 120000;
const automaticSteps = ["hydrate_input", "product_analysis", "creative_concepts", "concept_scoring", "selected_creative_brief", "script_generation", "shot_list_generation", "keyframe_generation", "video_clip_generation", "final_render", "qc"];
export function providerAttemptDto<T extends { attemptState: string | null }>(attempt: T) { return { ...attempt, state: attempt.attemptState }; }
export async function claimJob(input: { workerId?: string; type?: string; types?: string[]; contractVersion?: number }) {
  const types = input.types?.length ? input.types : [input.type ?? "AD_GENERATION"];
  const guidedCapable = input.contractVersion === 1;
  return transaction(async (tx) => {
    const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT j."id" FROM "pipeline_jobs" j JOIN "ads" a ON a."id" = j."adId"
      WHERE j."type"::text IN (${Prisma.join(types)}) AND j."cancelRequestedAt" IS NULL
      AND (j."status" = 'QUEUED' OR (${guidedCapable} AND j."status" = 'RUNNING' AND j."leaseExpiresAt" < CURRENT_TIMESTAMP AND j."requestPayload" ? 'guided'))
      AND (${guidedCapable} OR (j."type"::text <> 'GUIDED_GENERATION' AND NOT COALESCE(j."requestPayload" ? 'guided', false)))
      ORDER BY j."priority" DESC, j."createdAt" ASC FOR UPDATE OF a SKIP LOCKED LIMIT 1`);
    if (!ids[0]) return null;
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "pipeline_jobs" WHERE "id" = ${ids[0].id} FOR UPDATE`);
    const existing = await tx.pipelineJob.findUniqueOrThrow({ where: { id: ids[0].id }, include: { stepRuns: true } });
    if (existing.cancelRequestedAt || (existing.status !== "QUEUED" && !(existing.status === "RUNNING" && existing.leaseExpiresAt && existing.leaseExpiresAt < new Date()))) return null;
    const guided = isGuided(existing);
    if (guided) guidedPayload(existing);
    if (!guided) {
      const names = new Set(existing.stepRuns.map((step) => step.name));
      const maxSequence = Math.max(0, ...existing.stepRuns.map((step) => step.sequence));
      await tx.pipelineStepRun.createMany({ data: automaticSteps.filter((name) => !names.has(name)).map((name, index) => ({ jobId: existing.id, name, sequence: maxSequence + index + 1 })) });
      await tx.ad.update({ where: { id: existing.adId }, data: { status: "GENERATING" } });
    }
    const now = new Date();
    const job = await tx.pipelineJob.update({ where: { id: existing.id }, data: { status: "RUNNING", externalJobId: input.workerId,
      provider: existing.provider ?? "aevora-agentic-core", startedAt: existing.startedAt ?? now,
      ...(guided ? { leaseToken: randomUUID(), leaseExpiresAt: new Date(now.getTime() + LEASE_MS), heartbeatAt: now } : {}),
    }, include: { stepRuns: { orderBy: { sequence: "asc" } }, renderOutputs: true, providerJobs: true } });
    if (guided) await tx.pipelineStepRun.updateMany({ where: { jobId: job.id }, data: { status: "RUNNING", startedAt: now } });
    return { ...job, providerJobs: job.providerJobs.map(providerAttemptDto) };
  });
}
async function leasedJob(tx: Tx, jobId: string, token: string, allowCompleted = false) {
  const initial = await tx.pipelineJob.findUnique({ where: { id: jobId } });
  if (!initial) throw new NotFoundError("Pipeline job was not found.");
  await lockAd(tx, initial.adId);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "pipeline_jobs" WHERE "id" = ${jobId} FOR UPDATE`);
  const job = await tx.pipelineJob.findUniqueOrThrow({ where: { id: jobId } });
  guidedPayload(job); assertLease(job, token, allowCompleted);
  return job;
}
export const guidedWorkerService = {
  async heartbeat(jobId: string, leaseToken: string) {
    return transaction(async (tx) => {
      const job = await leasedJob(tx, jobId, leaseToken, true);
      if (job.status === "CANCELED" || job.cancelRequestedAt) return { cancelRequested: true };
      if (job.status !== "RUNNING") return { cancelRequested: true };
      await tx.pipelineJob.update({ where: { id: jobId }, data: { heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
      return { cancelRequested: false };
    });
  },
  async providerAttempt(jobId: string, input: AttemptInput) {
    return transaction(async (tx) => {
      const job = await leasedJob(tx, jobId, input.leaseToken);
      if (job.cancelRequestedAt) conflict("This job has been canceled.");
      const old = await tx.providerJob.findUnique({ where: { jobId_requestFingerprint: { jobId, requestFingerprint: input.requestFingerprint } } });
      if (old && (old.provider !== input.provider || (old.model && input.model && old.model !== input.model))) conflict("The logical provider attempt cannot change provider or model.");
      if (old?.operationId && input.operationId && old.operationId !== input.operationId) conflict("A different provider operation ID is already recorded for this request.");
      if (old?.attemptState === "COMPLETED" && input.state !== "COMPLETED") return providerAttemptDto(old);
      if (old?.operationId && input.state === "PREPARED") conflict("This provider request was already submitted. Resume its existing operation.");
      const metadata = json(redactAttemptMetadata({ ...objectValue(old?.metadata), ...input.metadata }));
      const status = input.state === "COMPLETED" ? "SUCCEEDED" : input.state === "FAILED" ? "FAILED" : input.state === "UNCERTAIN" ? "BLOCKED" : input.state === "PREPARED" ? "QUEUED" : "RUNNING";
      const attempt = await tx.providerJob.upsert({ where: { jobId_requestFingerprint: { jobId, requestFingerprint: input.requestFingerprint } },
        create: { adId: job.adId, jobId, requestFingerprint: input.requestFingerprint, provider: input.provider, model: input.model,
          operationId: input.operationId, attemptState: input.state, status, metadata },
        update: { operationId: input.operationId, model: input.model, attemptState: input.state, status, metadata },
      });
      return providerAttemptDto(attempt);
    });
  },
  async complete(jobId: string, input: CompleteInput) {
    return transaction(async (tx) => {
      const job = await leasedJob(tx, jobId, input.leaseToken, true);
      if (job.status === "SUCCEEDED" || (job.status === "CANCELED" && job.resultPayload)) return publicJob(job);
      if (job.status === "FAILED") conflict("This job has failed. Retry it before completing work.");
      const snapshot = guidedPayload(job);
      if (stableFingerprint(snapshot) !== job.snapshotHash) conflict("The frozen job inputs have changed.");
      const expectedKind: Record<string, string> = { GENERATE_SCRIPT: "SCRIPT", GENERATE_STORYBOARD: "STORYBOARD", GENERATE_KEYFRAME: "KEYFRAME", GENERATE_CLIP: "CLIP", RENDER_EXPORT: "EXPORT" };
      if (expectedKind[String(snapshot.operation)] !== input.result.kind) throw new BadRequestError("The result kind does not match the requested operation.");
      const ad = await tx.ad.findUniqueOrThrow({ where: { id: job.adId }, include: { project: true, shots: true } });
      const target = await tx.creativeArtifact.findFirst({ where: { id: String(snapshot.targetArtifactId), adId: job.adId } });
      if (!target) throw new BadRequestError("The target artifact is unavailable.");
      let publish = job.status !== "CANCELED" && !job.cancelRequestedAt && target.currentRevisionId === (snapshot.expectedRevisionId ?? null);
      if (input.result.kind === "EXPORT" && target.approvedRevisionId !== snapshot.timelineRevisionId) publish = false;
      if (input.result.kind === "CLIP") {
        const shot = ad.shots.find((value) => value.id === objectValue(snapshot.shot).shotId);
        if (!shot || shot.keyframeAssetId !== (objectValue(snapshot.conditioningAsset).assetId ?? objectValue(snapshot.conditioningAsset).id) || shot.keyframeRevisionId !== snapshot.shotRevisionId) publish = false;
      }
      for (const [field, kind] of [["scriptRevisionId", "SCRIPT"], ["storyboardRevisionId", "STORYBOARD"]] as const) {
        if (snapshot[field]) {
          const source = await getArtifact(tx, job.adId, kind);
          if (source?.currentRevisionId !== snapshot[field] || source.approvedRevisionId !== snapshot[field]) publish = false;
        }
      }
      const result: Record<string, unknown> = { kind: input.result.kind, stale: !publish };
      if (input.result.kind === "SCRIPT") {
        const content = scriptContentSchema.parse(input.result.content);
        const revision = await addRevision(tx, target, content, { origin: "generated", sourceJobId: job.id, publish });
        result.revisionId = revision.id;
      } else if (input.result.kind === "STORYBOARD") {
        const raw = objectValue(input.result.content).shots;
        if (!Array.isArray(raw) || raw.length < 1 || raw.length > 50) throw new BadRequestError("A storyboard result must contain 1 to 50 shot plans.");
        const plans = raw.map((item) => shotContentSchema.parse(item));
        if (new Set(plans.map((plan) => plan.shotNumber)).size !== plans.length) throw new BadRequestError("Generated shot numbers must be unique.");
        const oldBoard = target.currentRevisionId ? await tx.creativeRevision.findUnique({ where: { id: target.currentRevisionId } }) : null;
        const previousIds = oldBoard ? storyboardContentSchema.parse(oldBoard.content).shots.map((entry) => entry.shotId) : [];
        const entries = [];
        for (let index = 0; index < plans.length; index++) {
          const plan = plans[index];
          const old = plan.shotId ? ad.shots.find((shot) => shot.id === plan.shotId) : ad.shots.find((shot) => shot.id === previousIds[index]);
          if (plan.shotId && !old) throw new BadRequestError("Generated shot identity does not belong to this ad.");
          const shotId = old?.id ?? randomUUID();
          const shotNumber = old?.shotNumber ?? Math.max(0, ...ad.shots.map((shot) => shot.shotNumber)) + index + 1;
          const content = { ...plan, shotId, shotNumber };
          const referenceIds = [...new Set(content.referenceAssetIds)];
          if (referenceIds.length && await tx.asset.count({ where: { adId: job.adId, id: { in: referenceIds }, status: "READY" } }) !== referenceIds.length)
            throw new BadRequestError("Generated references must belong to this ad.");
          if (!old) await tx.shot.create({ data: { id: shotId, adId: job.adId, shotNumber, role: content.role, durationSeconds: Math.ceil(content.durationSeconds), promptPayload: json(content) } });
          const artifact = await ensureArtifact(tx, job.adId, "SHOT_PLAN", shotId);
          const revision = await addRevision(tx, artifact, content, { origin: "generated", sourceJobId: job.id, publish,
            sourceRevisionIds: typeof snapshot.scriptRevisionId === "string" ? [snapshot.scriptRevisionId] : [] });
          if (publish) await tx.shot.update({ where: { id: shotId }, data: { role: content.role, durationSeconds: Math.ceil(content.durationSeconds), promptPayload: json(content), keyframeRevisionId: null, videoRevisionId: null, status: "PLANNED" } });
          entries.push({ shotId, revisionId: revision.id });
        }
        const revision = await addRevision(tx, target, { shots: entries }, { origin: "generated", sourceJobId: job.id, publish,
          sourceRevisionIds: [...entries.map((entry) => entry.revisionId), ...(typeof snapshot.scriptRevisionId === "string" ? [snapshot.scriptRevisionId] : [])] });
        result.revisionId = revision.id;
      } else if (input.result.kind === "KEYFRAME" || input.result.kind === "CLIP") {
        const asset = input.result.asset;
        if (!asset) throw new BadRequestError("A media result requires an asset.");
        const shot = shotContentSchema.parse(snapshot.shot);
        if (!shot.shotId || !ad.shots.some((value) => value.id === shot.shotId)) throw new BadRequestError("The media result has no valid target shot.");
        if (!asset.mimeType.startsWith(input.result.kind === "KEYFRAME" ? "image/" : "video/")) throw new BadRequestError("Generated media type does not match its role.");
        const created = await tx.asset.create({ data: { ...asset, adId: job.adId, uploadedById: ad.project.ownerId, status: "READY",
          metadata: json({ ...objectValue(redactAttemptMetadata(asset.metadata)), ...objectValue(redactAttemptMetadata(input.result.metadata)), generatedRole: input.result.kind,
            shotId: shot.shotId, sourceRevisionId: snapshot.shotRevisionId, sourceShotRevisionId: snapshot.shotRevisionId,
            sourceScriptRevisionId: snapshot.scriptRevisionId, conditioningAssetId: objectValue(snapshot.conditioningAsset).assetId ?? objectValue(snapshot.conditioningAsset).id,
            compositionFingerprint: shotCompositionFingerprint(shot), motionFingerprint: shotMotionFingerprint(shot), stale: !publish }),
        } });
        result.assetId = created.id;
        // Human selection is explicit. Finished or late candidates never silently replace it.
      } else {
        if (!input.result.render) throw new BadRequestError("An export result requires a render output.");
        const render = input.result.render;
        if (publish) {
          try { await validateTimelineForExport(tx, job.adId, timelineContentSchema.parse(snapshot.timeline)); }
          catch (error) { if (error instanceof BadRequestError || (error instanceof Error && "statusCode" in error)) publish = false; else throw error; }
        }
        if (render.kind !== "VIDEO" || !render.durationMs || !render.width || !render.height) throw new BadRequestError("An export must include measured video dimensions and duration.");
        const created = await tx.renderOutput.create({ data: { ...render, jobId: job.id, adId: job.adId,
          metadata: json({ ...objectValue(redactAttemptMetadata(render.metadata)), sourceRevisionId: snapshot.timelineRevisionId, timelineRevisionId: snapshot.timelineRevisionId, stale: !publish }) } });
        result.stale = !publish;
        result.renderOutputId = created.id;
        const otherExports = await tx.pipelineJob.count({ where: { adId: job.adId, id: { not: job.id }, type: "RENDER_EXPORT", status: { in: ["QUEUED", "RUNNING"] } } });
        if (job.status !== "CANCELED") await tx.ad.update({ where: { id: job.adId }, data: { status: otherExports ? "GENERATING" : publish ? "COMPLETED" : "READY" } });
      }
      const completed = await tx.pipelineJob.update({ where: { id: job.id }, data: { status: job.status === "CANCELED" ? "CANCELED" : "SUCCEEDED", resultPayload: json(result), completedAt: new Date(), leaseExpiresAt: null } });
      if (job.status !== "CANCELED") await tx.pipelineStepRun.updateMany({ where: { jobId }, data: { status: "SUCCEEDED", outputPayload: json(result), completedAt: new Date() } });
      return publicJob(completed);
    });
  },
  async fail(jobId: string, input: { leaseToken: string; errorCode: string; errorMessage: string; uncertain?: boolean }) {
    return transaction(async (tx) => {
      const job = await leasedJob(tx, jobId, input.leaseToken, true);
      if (job.status === "CANCELED" || job.status === "SUCCEEDED" || job.status === "FAILED") return publicJob(job);
      const completed = await tx.pipelineJob.update({ where: { id: jobId }, data: { status: "FAILED", errorCode: input.errorCode,
        errorMessage: input.errorMessage, resultPayload: input.uncertain ? json({ uncertain: true }) : undefined, completedAt: new Date(), leaseExpiresAt: null } });
      await tx.pipelineStepRun.updateMany({ where: { jobId }, data: { status: "FAILED", errorCode: input.errorCode, errorMessage: input.errorMessage, completedAt: new Date() } });
      if (guidedPayload(job).operation === "RENDER_EXPORT") await tx.ad.update({ where: { id: job.adId }, data: { status: "FAILED" } });
      return publicJob(completed);
    });
  },
};
export async function assertLegacyJob(tx: Tx, jobId: string) {
  const job = await tx.pipelineJob.findUnique({ where: { id: jobId } });
  if (!job) throw new NotFoundError("Pipeline job was not found.");
  if (isGuided(job)) throw new BadRequestError("Guided jobs require lease-guarded guided worker APIs.");
  if (await tx.creativeArtifact.count({ where: { adId: job.adId } })) conflict("This ad now uses guided revisions. Legacy worker writes cannot replace them.");
  return job;
}
