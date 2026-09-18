# Guided workflow rollout and deferred acceptance

The implementation is additive. Do not treat static compilation as runtime acceptance. Docker, application servers, workers, database migrations, provider requests, browser checks, and media rendering have intentionally not been run for this change.

## Deployment sequence (for a later testing session)

1. Back up the database and existing uploaded/generated media. Preserve legacy ad, asset, shot, job, and render IDs.
2. Review the additive Prisma migration and the `guided-workflow-contract.md` document. Generate the Prisma client from the same schema version used by the backend.
3. Apply migrations only to the chosen test database, then deploy the backend before the new worker/frontend. Never run `migrate reset` for this rollout.
4. Check existing automatic-generation API callers and completed-video downloads before enabling guided generation.
5. Configure the worker's existing video provider. A separate image endpoint is optional; uploaded keyframes are supported. Do not paste provider or AWS secrets into the frontend or persisted job snapshots.
6. Start the applications only when runtime testing is authorized. Verify the guided workspace with provider substitutes before using a paid provider.
7. Run the acceptance scenarios below. Use isolated test ads and bounded requests. Keep original projects untouched.
8. Test one real selected-shot operation, inspect its returned media, and measure input/output duration before testing a complete ad. Record actual costs and provider-specific constraints separately from static acceptance.

## Acceptance matrix

| Scenario | Required evidence |
| --- | --- |
| Existing completed ad | Original MP4 remains downloadable; no fabricated approval on imported output |
| Legacy import | Repeated import creates no duplicate creative history; inconsistent old sources produce warnings |
| Script draft | Timed lines/captions save, refresh and reopen with unchanged text |
| Two-tab editing | One concurrent save succeeds; the stale save returns 409 and preserves its local draft |
| Exact approval | Approving revision A never authorizes draft B |
| Stage boundary | Script generation finishes without an image/video request or whole-ad COMPLETED status |
| Script dependency | Shot planning receives the exact approved script revision, including manual changes |
| Stable shot identity | Reordering moves positions while IDs, media, references and history remain associated |
| Removed shots | Removal changes current storyboard only; historic exports still resolve old assets |
| Manual keyframe | Valid uploaded image can be selected for one shot and passed to its clip generation |
| Real keyframe | If configured, returned bytes are a decodable image; each candidate belongs to a source revision |
| Individual clip | Regenerating one shot submits one request and preserves other selections |
| Double click | Identical idempotency key/payload returns one logical job; changed payload conflicts |
| Worker recovery | Known provider operation resumes polling; no second paid submission |
| Ambiguous submission | Lost response is shown as uncertain; no blind automatic resubmission |
| Download recovery | Failed media ingestion retries collection without repeating a known GPU operation |
| Late result | Output for an old/canceled revision is not promoted over the current selection |
| Cancellation | Cancellation blocks new stages and current-result promotion; refunds are not assumed |
| Caption edit | Footage remains usable; only timeline/export changes |
| Motion edit | Only affected clip readiness changes; keyframe remains compatible when composition is unchanged |
| Source image edit | Dependent keyframe/clip require new selection/review; old candidates remain available |
| Timeline trim | Integer-frame trims preserve selected source and reject insufficient source duration |
| Timeline reorder | Preview/export order changes without AI generation |
| Captions and CTA | Exact saved text/timing/placement appear in rendered output, including quotes and punctuation |
| Audio | Optional source audio/uploaded track levels and fades are audible as configured |
| Final export | Measured duration, dimensions, FPS and audio presence match the frozen timeline recipe |
| Export while editing | Finished render belongs to the earlier timeline revision and cannot pretend to be current |
| Access control | Cross-user/ad revisions and assets cannot be edited, approved, selected or rendered |
| Expired media access | Failure is actionable and never silently creates a replacement paid generation |

## Manual full-path scenario

Create a guided ad from a product image. Generate a script, change one line and its caption, save and refresh, approve the saved revision, generate the storyboard, edit the second shot's camera direction, reorder two shots and approve. Upload/select each keyframe (or generate candidates on a configured image endpoint). Generate and preview the selected clips. Regenerate only the second shot and compare its candidates before selecting one. Save a timeline with a source trim, changed order, caption and optional uploaded audio. Approve/export it and inspect measured media. Reload the workspace and check revision history and both the previous and current exports.

## Operational limits

The existing local storage route can serve development previews. RunPod S3 results are ingested through returned HTTPS access URLs; local AWS credentials are not inherently required for that path. Native application S3 storage is a separate configuration/implementation concern and must not be advertised as active solely because RunPod writes to S3.

The image-generation endpoint and any future text-to-speech provider need an explicit deployment choice and credentials. Uploading an image or audio file is distinct from generating one. A script's voiceover text must not be presented as synthesized speech.
