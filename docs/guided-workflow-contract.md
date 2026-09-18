# Guided workflow contract v1

Implementation contract shared by backend, pipeline, and frontend. Runtime validation is deferred; do not start services or apply migrations during implementation.

## Creative data

Ads have an explicit `workflowMode` of `GUIDED` or `LEGACY_AUTOMATIC`. Existing rows retain automatic mode through the additive migration; the new frontend sends guided mode explicitly. Converting an ad with an active automatic job is rejected until that job finishes.

Artifact kinds: `SCRIPT`, `STORYBOARD`, `SHOT_PLAN`, `TIMELINE`. Each artifact has stable `id`, `adId`, `kind`, nullable `shotId`, `currentRevisionId`, `approvedRevisionId`. Revisions have `id`, `artifactId`, `version`, `content`, `sourceRevisionIds`, `origin`, `createdAt`. Content is immutable. Approval is tied to an exact revision. Existing Asset records are immutable media candidates. Shot UUID is identity; storyboard order is separate.

Script content: `{ voiceover: [{ id, startSecond, endSecond, text, delivery }], captions: [{ id, startSecond, endSecond, text, emphasis? }] }`.

Shot content uses existing ShotPlan fields plus `shotId` and optional `scriptBeatIds`. Storyboard content: `{ shots: [{ shotId, revisionId }] }`, ordered by array position. Backend creates/reconciles stable shot IDs when generated plans are published.

Timeline content: `{ fps, width, height, clips: [{ id, shotId, assetId, sourceInFrame, durationFrames, fit: 'contain'|'cover', muted, volume }], overlays: [{ id, text, startFrame, endFrame, position: 'top'|'center'|'bottom', fontSize, color }], audioTracks: [{ id, assetId, startFrame, sourceInFrame, durationFrames, volume, fadeInFrames, fadeOutFrames }], normalizeAudio }`. All frame units are at the timeline fps. Clips play consecutively in array order. No implicit looping or gaps. Exact output duration is sum of clip durationFrames. Source timing uses media timestamps converted from timeline frame units.

## Public API (normal user auth)

- `GET /api/ads/:adId/workspace` -> `{ workspace }`. Workspace: `{ ad, artifacts, revisions, shots, assets, jobs, renderOutputs, allowedActions, warnings }`. Artifacts include current/approved revision pointers; revisions include current/history content; shots expose stable IDs and selected asset IDs. Redact provider internals from jobs/assets.
- `PATCH /api/ads/:adId/script` body `{ expectedRevisionId: string|null, content }` -> `{ workspace }`.
- `PATCH /api/ads/:adId/storyboard` body `{ expectedRevisionId: string|null, shotIds: string[] }` -> `{ workspace }` (order/removal). Shot creation uses POST below.
- `POST /api/ads/:adId/shots` body `{ content }` -> `{ workspace }` (new shot); `PATCH /api/ads/:adId/shots/:shotId` body `{ expectedRevisionId: string|null, content }` -> `{ workspace }`.
- `PATCH /api/ads/:adId/timeline` body `{ expectedRevisionId: string|null, content }` -> `{ workspace }`.
- `POST /api/ads/:adId/approvals` body `{ artifactId, revisionId }` -> `{ workspace }`.
- `POST /api/ads/:adId/revisions/:revisionId/restore` -> `{ workspace }` (new draft copy, never mutate history).
- `POST /api/ads/:adId/shots/:shotId/select-asset` body `{ kind: 'KEYFRAME'|'CLIP', assetId, expectedRevisionId }` -> `{ workspace }`. Selection explicitly accepts that candidate; only compatible revisions or manual uploads permitted.
- `POST /api/ads/:adId/actions` body `{ operation, shotId?, expectedRevisionId: string|null, idempotencyKey, settings?: { providerMode?, imageProvider? } }` -> `{ job }`. Operations: `GENERATE_SCRIPT`, `GENERATE_STORYBOARD`, `GENERATE_KEYFRAME`, `GENERATE_CLIP`, `RENDER_EXPORT`. Keyframe and clip requests target one shot. Backend enforces approvals, frozen inputs, ownership and idempotency. No arbitrary client stage arrays for guided operations.
- `POST /api/pipeline-jobs/:jobId/cancel` -> `{ job }`.
- Failed guided jobs expose a credential-free `retryAction` containing the original public action fields and idempotency key. Resubmitting it requeues the same job/snapshot/attempts; it does not create a replacement paid request. An uncertain submission without a known operation ID requires reconciliation.
- `POST /api/ads/:adId/import-legacy` -> `{ workspace }`: explicit, idempotent legacy import. GET never mutates historical data. Imported revisions have origin legacy_import and are not human approved.
- Existing upload API continues supporting product/keyframe images. Add audio upload with verified MIME/type and bounded size, only if needed by timeline.

Save/approval concurrency conflict -> HTTP 409. Missing prerequisites -> HTTP 400 with readable message. Every foreign artifact/asset/revision is validated against owning ad.

## Worker execution

Add `GUIDED_GENERATION` job type, preserve `AD_GENERATION` and existing `RENDER_EXPORT`. Guided renders use `RENDER_EXPORT` plus guided request payload. Claim accepts `types: ['AD_GENERATION','GUIDED_GENERATION','RENDER_EXPORT']`, `workerId`, `contractVersion: 1`; legacy type parameter remains supported. New guided jobs must not be claimed by legacy workers. Returned job includes `leaseToken`, `requestPayload`, `providerJobs`, stepRuns. Claims are atomic, have heartbeat/expiry, stale tokens cannot write.

Guided job `requestPayload.guided` is an immutable snapshot:
`{ contractVersion: 1, operation, adInput, targetArtifactId?, expectedRevisionId, scriptRevisionId?, script?, storyboardRevisionId?, shotRevisionId?, shot?, conditioningAsset?, referenceAssets?, timelineRevisionId?, timeline?, settings }`.

`adInput` matches existing CanonicalAdInput. `shot` matches ShotPlan plus shotId. Asset inputs contain assetId/id, fileName, mimeType, url, storageKey, storageProvider, metadata as required for worker access. settings pins providerMode (when specified), imageProvider, and server-side configured model/settings at dispatch where available; no API keys persisted. Worker records actual resolved provider config in attempt metadata.

The worker keeps the lease token returned by its claim; fetching context must not replace that token with a later claimant's token. Lease checks and publication must be serialized with reclamation so a stale worker cannot write between a token check and the result transaction.

- Existing internal context endpoint returns frozen request payload, provider attempts, lease, and existing ad context.
- `POST /api/internal/guided-jobs/:jobId/heartbeat` body `{ leaseToken }` -> `{ cancelRequested }`.
- `POST /api/internal/guided-jobs/:jobId/provider-attempt` body `{ leaseToken, state: 'PREPARED'|'SUBMITTED'|'COMPLETED'|'UNCERTAIN'|'FAILED', provider, model?, operationId?, requestFingerprint, metadata? }` -> `{ attempt }`. Idempotent logical attempt per job/fingerprint. No plaintext credentials/base64 inputs or signed query strings in metadata.
- `POST /api/internal/guided-jobs/:jobId/complete` body `{ leaseToken, result: { kind: 'SCRIPT'|'STORYBOARD'|'KEYFRAME'|'CLIP'|'EXPORT', content?, asset?, render?, metadata? } }` -> `{ job }`. SCRIPT content is script; STORYBOARD content is `{ shots: ShotPlan[] }`; KEYFRAME/CLIP asset matches existing generated-asset input, plus measured metadata; EXPORT render matches existing render-output input. Backend registers result transactionally/idempotently, publishes matching revisions only, marks job succeeded, never marks whole ad complete for script/shot jobs. Late/canceled results cannot replace current selection.
- `POST /api/internal/guided-jobs/:jobId/fail` body `{ leaseToken, errorCode, errorMessage, uncertain? }` -> `{ job }`.

Automatic workflow remains supported. Guided executor loads frozen inputs and stops at its target. Image generation uses an optional configured adapter plus manual uploads; absent configuration must fail clearly, never fabricate a keyframe. No new provider credentials are required for implementing manual keyframe selection.

## Required behaviors

Current draft is distinct from approved revision. Saved edits invalidate dependent readiness, not media history. Caption-only/timeline changes retain source footage. Shot motion edits invalidate only the shot clip. Composition/reference changes invalidate that keyframe and clip. Late provider results remain historical candidates. Downloads can be retried without repeating known GPU requests. Timeline exports use exact media versions, measured duration, captions and optional audio. Existing final videos remain accessible.
