import { Prisma, type CreativeArtifact, type CreativeArtifactKind, type PipelineJob } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { assertExpectedRevision, classifyShotChange, conflict, objectValue, stableFingerprint } from "./workspace.rules";
import { scriptContentSchema, shotContentSchema, storyboardContentSchema, type ShotContent } from "./workspace.schemas";

export type Tx = Prisma.TransactionClient;
export function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(work, { maxWait: 10000, timeout: 20000 });
}
export async function lockAd(tx: Tx, adId: string, ownerId?: string) {
  const owned = await tx.ad.findFirst({ where: { id: adId, ...(ownerId ? { project: { ownerId } } : {}) }, select: { id: true } });
  if (!owned) throw new NotFoundError("Ad was not found.");
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ads" WHERE "id" = ${adId} FOR UPDATE`);
  const ad = await tx.ad.findUnique({ where: { id: adId }, include: { project: true, assets: true, shots: { orderBy: { shotNumber: "asc" } } } });
  if (!ad) throw new NotFoundError("Ad was not found.");
  if (ownerId) {
    const active = await tx.pipelineJob.findMany({ where: { adId, status: { in: ["QUEUED", "RUNNING"] } } });
    if (active.some((job) => !isGuided(job))) conflict("An automatic generation is still queued or running. Wait for it to finish before switching this ad to guided editing.");
  }
  return ad;
}
export function getArtifact(tx: Tx, adId: string, kind: CreativeArtifactKind, shotId?: string) {
  return tx.creativeArtifact.findUnique({ where: { adId_kind_scopeKey: { adId, kind, scopeKey: shotId ?? "root" } }, include: { currentRevision: true, approvedRevision: true } });
}
export async function ensureArtifact(tx: Tx, adId: string, kind: CreativeArtifactKind, shotId?: string) {
  await tx.ad.update({ where: { id: adId }, data: { workflowMode: "GUIDED" } });
  return tx.creativeArtifact.upsert({ where: { adId_kind_scopeKey: { adId, kind, scopeKey: shotId ?? "root" } },
    create: { adId, kind, scopeKey: shotId ?? "root", shotId }, update: {} });
}
export async function addRevision(tx: Tx, artifact: CreativeArtifact, content: unknown, options: {
  origin: string; sourceRevisionIds?: string[]; authorId?: string; sourceJobId?: string; publish?: boolean; parentRevisionId?: string | null;
}) {
  const sourceRevisionIds = [...new Set(options.sourceRevisionIds ?? [])];
  if (sourceRevisionIds.length) {
    const count = await tx.creativeRevision.count({ where: { id: { in: sourceRevisionIds }, artifact: { adId: artifact.adId } } });
    if (count !== sourceRevisionIds.length) throw new BadRequestError("A source revision does not belong to this ad.");
  }
  const latest = await tx.creativeRevision.aggregate({ where: { artifactId: artifact.id }, _max: { version: true } });
  const revision = await tx.creativeRevision.create({ data: { artifactId: artifact.id, version: (latest._max.version ?? 0) + 1,
    content: json(content), sourceRevisionIds, origin: options.origin, authorId: options.authorId, sourceJobId: options.sourceJobId,
    parentRevisionId: options.parentRevisionId === undefined ? artifact.currentRevisionId : options.parentRevisionId } });
  if (options.publish !== false) {
    await tx.creativeArtifact.update({ where: { id: artifact.id }, data: { currentRevisionId: revision.id } });
    if (artifact.kind !== "TIMELINE") await tx.creativeArtifact.updateMany({ where: { adId: artifact.adId, kind: "TIMELINE" }, data: { approvedRevisionId: null } });
  }
  return revision;
}
export function requireApproved(artifact: Awaited<ReturnType<typeof getArtifact>>, label: string) {
  if (!artifact?.currentRevision || artifact.approvedRevisionId !== artifact.currentRevisionId) throw new BadRequestError(`Save and approve the current ${label} before continuing.`);
  return artifact.currentRevision;
}
export async function validateShotReferences(tx: Tx, adId: string, content: ShotContent) {
  const ids = [...new Set(content.referenceAssetIds)];
  if (ids.length !== content.referenceAssetIds.length) throw new BadRequestError("Reference images must be unique.");
  if (ids.length && await tx.asset.count({ where: { id: { in: ids }, adId, status: "READY", mimeType: { startsWith: "image/" } } }) !== ids.length)
    throw new BadRequestError("Every reference must be a ready image belonging to this ad.");
  if (content.scriptBeatIds?.length) {
    const script = await getArtifact(tx, adId, "SCRIPT");
    if (!script?.currentRevision) throw new BadRequestError("Create the script before linking script beats.");
    const parsed = scriptContentSchema.parse(script.currentRevision.content);
    const beatIds = new Set([...parsed.voiceover, ...parsed.captions].map((beat) => beat.id));
    if (content.scriptBeatIds.some((id) => !beatIds.has(id))) throw new BadRequestError("A linked script beat is missing from the current script.");
  }
}
export async function updateShotDraft(tx: Tx, adId: string, shotId: string, expectedRevisionId: string | null, content: ShotContent, authorId: string, provenance?: { origin: string; parentRevisionId: string; updateStoryboard?: boolean }) {
  const shot = await tx.shot.findFirst({ where: { id: shotId, adId } });
  if (!shot) throw new NotFoundError("Shot was not found.");
  if (content.shotId && content.shotId !== shotId) throw new BadRequestError("The shot ID cannot be changed.");
  await validateShotReferences(tx, adId, content);
  const artifact = await ensureArtifact(tx, adId, "SHOT_PLAN", shotId);
  assertExpectedRevision(artifact.currentRevisionId, expectedRevisionId);
  const previous = artifact.currentRevisionId ? await tx.creativeRevision.findUnique({ where: { id: artifact.currentRevisionId } }) : null;
  const before = previous ? shotContentSchema.parse(previous.content) : null;
  const next = { ...content, shotId, shotNumber: shot.shotNumber };
  const script = await getArtifact(tx, adId, "SCRIPT");
  const revision = await addRevision(tx, artifact, next, { origin: provenance?.origin ?? "user_edit", parentRevisionId: provenance?.parentRevisionId,
    authorId, sourceRevisionIds: script?.currentRevisionId ? [script.currentRevisionId] : [] });
  const change = before ? classifyShotChange(before, next) : "composition";
  const keyframeCompatible = !!previous && shot.keyframeRevisionId === previous.id && !!shot.keyframeAssetId;
  const videoCompatible = !!previous && shot.videoRevisionId === previous.id && !!shot.videoAssetId;
  await tx.shot.update({ where: { id: shotId }, data: {
    role: next.role, durationSeconds: Math.ceil(next.durationSeconds), promptPayload: json(next),
    ...(change === "composition" ? { keyframeRevisionId: null, videoRevisionId: null, status: "PLANNED" } :
      change === "motion" ? { keyframeRevisionId: keyframeCompatible ? revision.id : null, videoRevisionId: null, status: keyframeCompatible ? "KEYFRAME_READY" : "PLANNED" } :
      { keyframeRevisionId: keyframeCompatible ? revision.id : null, videoRevisionId: videoCompatible ? revision.id : null,
        status: videoCompatible ? "VIDEO_READY" : keyframeCompatible ? "KEYFRAME_READY" : "PLANNED" }),
  } });
  const board = await getArtifact(tx, adId, "STORYBOARD");
  if (board?.currentRevision && provenance?.updateStoryboard !== false) {
    const storyboard = storyboardContentSchema.parse(board.currentRevision.content);
    if (storyboard.shots.some((item) => item.shotId === shotId)) {
      const shots = storyboard.shots.map((item) => item.shotId === shotId ? { shotId, revisionId: revision.id } : item);
      await addRevision(tx, board, { shots }, { origin: "user_edit", authorId, sourceRevisionIds: [...shots.map((item) => item.revisionId), ...(script?.currentRevisionId ? [script.currentRevisionId] : [])] });
    }
  }
  return revision;
}
export async function isScriptCompatible(tx: Tx, adId: string, revisionIds: string[]) {
  const script = await getArtifact(tx, adId, "SCRIPT");
  if (!script?.currentRevision || script.currentRevisionId !== script.approvedRevisionId) return false;
  const sources = await tx.creativeRevision.findMany({ where: { id: { in: revisionIds }, artifact: { adId, kind: "SCRIPT" } } });
  if (!sources.length) return true; // Manually composed artifacts may not use a script.
  const currentVoiceover = scriptContentSchema.parse(script.currentRevision.content).voiceover;
  return sources.some((source) => stableFingerprint(scriptContentSchema.parse(source.content).voiceover) === stableFingerprint(currentVoiceover));
}
export function isGuided(job: Pick<PipelineJob, "type" | "requestPayload">) { return job.type === "GUIDED_GENERATION" || objectValue(job.requestPayload).guided !== undefined; }
export function guidedPayload(job: Pick<PipelineJob, "type" | "requestPayload">) {
  if (!isGuided(job)) throw new BadRequestError("This operation requires a guided job.");
  const guided = objectValue(objectValue(job.requestPayload).guided);
  if (guided.contractVersion !== 1) throw new BadRequestError("Unsupported guided job contract.");
  return guided;
}
export function assertLease(job: Pick<PipelineJob, "leaseToken" | "leaseExpiresAt" | "status">, token: string, allowCompleted = false) {
  if (job.leaseToken !== token) conflict("This worker lease has been replaced. Stop this execution.");
  if (allowCompleted && (job.status === "SUCCEEDED" || job.status === "FAILED" || job.status === "CANCELED")) return;
  if (job.status !== "RUNNING" || !job.leaseExpiresAt || job.leaseExpiresAt <= new Date()) conflict("This worker lease has expired. Stop this execution.");
}
