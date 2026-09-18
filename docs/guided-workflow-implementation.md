# Guided editing implementation handoff

## Scope

The new guided workspace is an additive path alongside the existing automatic pipeline. A generation request targets one operation, then stops. Creative edits are stored independently from generated media and final exports.

| Area | Implementation |
| --- | --- |
| Persistence | Immutable script, storyboard, shot-plan and timeline revisions; current/approved pointers; approval audit and source provenance |
| Editing API | Ownership-checked saves, optimistic concurrency, explicit approvals, history restore, shot order, media selection and legacy import |
| Execution | Frozen operation snapshots, idempotent dispatch, worker leases, heartbeat/cancel handling and persisted provider attempts |
| Dependency handling | Composition/motion fingerprints distinguish edits that invalidate image/clip readiness from editorial-only changes; previous media is retained |
| Frontend | Reopenable ad URL, My Ads, script/shot editors, autosave, local draft protection, revision inspection, real media previews and candidate selection |
| Timeline | Ordered source clips, frame-based trims, contain/cover fitting, timed text, optional uploaded/source audio, gain and fades |
| Export | FFmpeg recipe built from the frozen edit; ffprobe validates actual media streams, duration, frame rate, dimensions and audio |
| Image generation | Optional separate RunPod image endpoint; manual keyframe upload/selection remains usable without it |

## Main implementation locations

- Backend: `prisma/schema.prisma`, `prisma/migrations/20260905100000_guided_workflow/`, and `src/modules/workspace/`.
- Pipeline: `src/contracts/guided.ts`, `src/pipeline/guided-executor.ts`, `src/render/timeline-renderer.ts`, and `src/media/probe.ts` in Aevora_Agentic_core.
- Frontend: `src/components/guided/` and `src/api/guidedWorkspaceApi.ts` in Aevora-looks-core.
- Shared API boundary: [contract](guided-workflow-contract.md).
- Later deployment/testing: [rollout and acceptance matrix](guided-workflow-rollout.md).

## Important boundaries

Implementation and static verification are not end-to-end acceptance. The database migration must be reviewed and applied to a test database before the new APIs can be used. Services, workers, database migration application, provider generation, browser checks, media rendering and runtime tests were intentionally deferred at the user's request.

The existing video-provider configuration is preserved. A video endpoint is not automatically an image endpoint: real cinematic keyframe generation needs a separately configured image worker that supports the documented adapter contract. Uploaded keyframes do not need a new generation provider.

Voiceover editing stores text and delivery direction. It does not synthesize speech. Recorded voiceover/music can be uploaded and mixed in the edit. A future TTS provider is a separate integration choice.

Provider results may have expiring access URLs. Recovery reuses known provider operation IDs where supported; an ambiguous paid submission is not blindly resubmitted. Cancellation prevents current-result publication but cannot guarantee cancellation/refund of an already submitted GPU operation.

Timeline preview is a browser approximation. Final text layout and audio normalization are applied by FFmpeg and require visual/audio acceptance later. Generated media and earlier exports are retained when a newer revision invalidates readiness.

## Deferred automated checks

Backend test sources include revision/conflict/media rules, upload signature checks and an opt-in API acceptance suite. The API suite requires `GUIDED_TEST_ALLOW_WRITES=1`, an isolated migrated test database behind an already running test backend, and an isolated user's access token. It must not point at production or at an environment with a paid worker. The suite creates test records and intentionally retains them for inspection.

Pipeline test sources cover snapshot/timeline validation, filter-graph compilation and resuming a known RunPod operation with mocked responses. Writing and typechecking these files does not execute the tests.

## Static verification performed

- Backend TypeScript, pipeline TypeScript (including fixture sources), and frontend TypeScript: `--noEmit` passed.
- Backend deferred test sources: separate TypeScript compilation passed without executing a test runner.
- Prisma schema: validation passed; the client was generated from the new schema. No migration was applied.
- Git whitespace checks passed using each repository's configured line-ending handling.

No Docker, application server, worker loop, browser session, runtime test, FFmpeg/ffprobe process, or paid generation request was started for verification. Live secret configuration was not changed. The optional image endpoint variables were documented in the pipeline's example configuration only.
