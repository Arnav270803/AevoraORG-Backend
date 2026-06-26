# Aevora Video Ad Generation Pipeline Research

Last researched: 2026-06-26

## Purpose

This document proposes an end-to-end Aevora pipeline that turns user reference images plus a prompt into a production-grade cinematic product ad video.

It is written for the current Aevora codebase:

- Frontend: `Aevora-looks-core`, React/Vite, protected `/app` workspace.
- Backend: `Aevora_Backend`, Express + TypeScript + Prisma + PostgreSQL, Google login + JWT already implemented.
- Current product UI workflow:
  1. Prompt + Reference Image
  2. Cinematic Shot Images
  3. Script Writing
  4. Scene Generation
  5. Final Video

The recommended backend pipeline should preserve those same five product steps, but make each step backed by persisted jobs, artifacts, provider calls, and reviewable outputs.

## Research Summary

### Video Generation

Primary candidate: Google Veo 3.1 through the Gemini API.

Relevant official details:

- Veo 3.1 generates high-fidelity short videos with native audio and supports 720p, 1080p, and 4K outputs depending on mode.
- Veo 3.1 supports both `16:9` and `9:16`, which maps directly to YouTube/web and Shorts/Reels/TikTok.
- It supports image-based direction, including up to three reference images for content/style guidance.
- Video generation is asynchronous: create an operation, poll until completion, then download the generated video.
- Current model identifiers include `veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`, and `veo-3.1-lite-generate-preview`.

Sources:

- Google Veo 3.1 video generation: https://ai.google.dev/gemini-api/docs/video
- Google Veo model features and parameters: https://ai.google.dev/gemini-api/docs/video#veo-api-parameters-and-specifications
- Google Veo prompt guidance section: https://ai.google.dev/gemini-api/docs/video#prompt-guide

Important design implication:

Veo is best treated as a per-shot generator, not as a whole-ad generator. Aevora should generate multiple shot clips, then assemble the final ad with FFmpeg. This gives us more control over pacing, captions, brand overlays, retries, and platform formats.

### Image Generation And Editing

Primary candidate: Gemini image models, nicknamed Nano Banana.

Relevant official details:

- Nano Banana in Gemini supports text-to-image, image editing, and multi-turn image editing.
- Gemini 3.1 Flash Image, also described as Nano Banana 2, is optimized for high-volume developer use.
- Gemini 3 Pro Image, also described as Nano Banana Pro, is positioned for professional asset production.
- The models support high-resolution image outputs, advanced text rendering, and mixing multiple reference images.
- Google states generated images include SynthID watermarking.

Sources:

- Gemini image generation: https://ai.google.dev/gemini-api/docs/image-generation
- Gemini image editing and multi-turn editing: https://ai.google.dev/gemini-api/docs/image-generation#image-editing

Secondary candidate: OpenAI GPT Image models.

Relevant official details:

- The OpenAI API supports image generation and editing with GPT Image models.
- The Image API is suitable for one-shot generate/edit calls.
- The Responses API is suitable for conversational or multi-step image workflows.
- OpenAI documents moderation behavior and recommends branching on stable error codes for blocked generations.

Sources:

- OpenAI image generation: https://developers.openai.com/api/docs/guides/image-generation

Recommended use in Aevora:

- Use Nano Banana 2 / Gemini 3.1 Flash Image for fast product keyframe exploration.
- Use Nano Banana Pro / Gemini 3 Pro Image for final hero frames, packaging cleanup, typography, and premium stills.
- Use GPT Image as a fallback or alternate provider if we need a second visual style or provider redundancy.

### Text, Script, And Structured Planning

Primary candidates:

- OpenAI Responses API with a smaller/fast model for product analysis, ad script, storyboard, shot list, caption plan, and prompt generation.
- Gemini text generation or structured outputs as an alternate provider.

Relevant official details:

- OpenAI recommends the Responses API for new text generation apps.
- OpenAI Structured Outputs can force outputs to match a JSON schema.
- Gemini structured outputs can also enforce JSON schema and are useful for agentic workflows and tool inputs.

Sources:

- OpenAI text generation: https://developers.openai.com/api/docs/guides/text
- OpenAI structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Gemini structured outputs: https://ai.google.dev/gemini-api/docs/structured-output

Recommended use in Aevora:

Every planning stage should produce schema-validated JSON. Do not let the model return free-form text for core pipeline decisions.

Examples of structured outputs:

- `ProductAnalysis`
- `CreativeBrief`
- `AdScript`
- `ShotList`
- `ImagePromptSet`
- `VideoPromptSet`
- `CaptionPlan`
- `RenderManifest`
- `QCReport`

### Voiceover And Audio

Options:

1. Use Veo native audio where it is good enough.
2. Generate controlled voiceover separately with TTS and mix it during final render.
3. Use both: let Veo generate environmental audio/SFX, but overlay an approved voiceover track.

Relevant official details:

- Veo 3.1 generates video with audio.
- OpenAI speech generation accepts model, input text, and voice. `gpt-4o-mini-tts` supports controllable speech characteristics such as tone, speed, emotional range, accent, and intonation.
- OpenAI requires clear disclosure to users that TTS voices are AI-generated and not human.

Sources:

- Google Veo 3.1 video generation: https://ai.google.dev/gemini-api/docs/video
- OpenAI text-to-speech: https://developers.openai.com/api/docs/guides/text-to-speech

Recommended MVP approach:

- For first MVP, use Veo native audio when it works.
- For reliable ad narration, generate a separate voiceover with TTS, then mix with music/SFX in FFmpeg.
- Store captions/subtitles as structured text and burn them into the final ad for social platforms.

### Editing And Assembly

Primary candidate: FFmpeg.

Relevant official details:

- `concat` can combine segments, but audio/video durations need care to avoid desync.
- `scale` and `pad` can normalize video dimensions and aspect ratio.
- `overlay` can place logos or visual elements over video.
- `drawtext` and `subtitles` can render captions/text onto video.
- `xfade` can create transitions between clips.
- `loudnorm` supports EBU R128 loudness normalization.

Sources:

- FFmpeg filters: https://ffmpeg.org/ffmpeg-filters.html
- FFmpeg concat examples: https://ffmpeg.org/ffmpeg-filters.html#concat
- FFmpeg overlay examples: https://ffmpeg.org/ffmpeg-filters.html#overlay
- FFmpeg drawtext examples: https://ffmpeg.org/ffmpeg-filters.html#drawtext
- FFmpeg subtitles filter: https://ffmpeg.org/ffmpeg-filters.html#subtitles
- FFmpeg xfade: https://ffmpeg.org/ffmpeg-filters.html#xfade
- FFmpeg loudnorm: https://ffmpeg.org/ffmpeg-filters.html#loudnorm

Recommended use in Aevora:

FFmpeg should be a backend render worker stage, not something run inside request handlers. It should take a render manifest and produce final MP4 outputs for each requested platform.

## Recommended Pipeline

### Phase 0: Authenticated User And Workspace Context

Current state:

- Google login exists.
- Backend creates local `users`.
- Frontend protects `/app`.

Next pipeline work should always attach generation data to `userId`.

Future workspace/team support can be added later, but the first pipeline can use personal user-owned projects.

### Phase 1: Intake

Frontend step:

- Prompt + Reference Image

Inputs:

- User prompt.
- Product name.
- Brand/category.
- Reference notes.
- One or more product/reference images.
- Target platform: `instagram_reels`, `tiktok`, `youtube_shorts`, `youtube_landscape`, `meta_feed`, etc.
- Target aspect ratio: `9:16`, `16:9`, `1:1`.
- Target duration: start with 15s and 30s.
- Optional brand kit: logo, colors, fonts, tone, CTA.

Backend responsibilities:

- Authenticate user.
- Create `Project`.
- Create `AdGeneration`.
- Upload images to storage.
- Store asset metadata in DB.
- Validate MIME type, file size, dimensions, and basic image safety.
- Create first pipeline job.

Suggested API:

```http
POST /api/projects
POST /api/projects/:projectId/assets
POST /api/ads
POST /api/ads/:adId/start
GET  /api/ads/:adId
GET  /api/ads/:adId/events
```

`GET /api/ads/:adId/events` can start as polling. Later it can become SSE or WebSocket.

### Phase 2: Product And Brand Understanding

Model:

- OpenAI smaller text/vision-capable model or Gemini equivalent.

Inputs:

- Prompt.
- Reference images.
- Product fields.
- Brand/category.

Outputs:

```ts
type ProductAnalysis = {
  product: {
    name: string;
    category: string;
    visibleAttributes: string[];
    likelySellingPoints: string[];
    constraints: string[];
  };
  audience: {
    likelyCustomer: string;
    painPoints: string[];
    desiredOutcome: string;
  };
  visualIdentity: {
    colors: string[];
    materials: string[];
    lightingMood: string;
    styleKeywords: string[];
  };
  missingInputs: string[];
};
```

Why this matters:

The video models should not receive raw user text only. Aevora needs an internal understanding layer that turns messy input into consistent production language.

### Phase 3: Creative Brief And Script

Frontend step:

- Script Writing

Model:

- OpenAI Responses API with Structured Outputs, or Gemini structured output.

Outputs:

```ts
type CreativeBrief = {
  angle: string;
  promise: string;
  hook: string;
  proofPoints: string[];
  callToAction: string;
  tone: "premium" | "playful" | "educational" | "urgent" | "luxury" | "minimal";
  platform: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  durationSeconds: 15 | 30;
};

type AdScript = {
  voiceover: Array<{
    startSecond: number;
    endSecond: number;
    text: string;
    delivery: string;
  }>;
  captions: Array<{
    startSecond: number;
    endSecond: number;
    text: string;
    emphasis?: string;
  }>;
};
```

Important rule:

Do not generate final video from a single script blob. Generate a scene plan.

### Phase 4: Shot List And Storyboard

Frontend step:

- Cinematic Shot Images
- Scene Generation

Model:

- Text model for structured shot plan.
- Image model for keyframes.

Recommended shot structure:

```ts
type Shot = {
  shotNumber: number;
  durationSeconds: 4 | 6 | 8;
  role: "hook" | "problem" | "product_hero" | "benefit" | "proof" | "cta";
  visualDescription: string;
  camera: {
    framing: string;
    lensFeel: string;
    movement: string;
    composition: string;
  };
  lighting: string;
  environment: string;
  productContinuityNotes: string[];
  imagePrompt: string;
  videoPrompt: string;
  negativePrompt?: string;
  referenceAssetIds: string[];
  captionText?: string;
};
```

Recommended MVP shot pattern for a 15s ad:

1. 3s hook: striking product macro or problem scene.
2. 4s product reveal: product enters or transforms environment.
3. 4s benefit/proof: show result, texture, use case, or social proof.
4. 4s CTA: product packshot + offer/caption.

Because Veo reference-image and high-resolution modes commonly require 8s clips, the backend should generate 8s source clips and trim them during final assembly when needed.

### Phase 5: Keyframe Generation And Editing

Frontend step:

- Cinematic Shot Images

Models:

- Gemini 3.1 Flash Image / Nano Banana 2 for fast iterations.
- Gemini 3 Pro Image / Nano Banana Pro for premium hero frames.
- GPT Image as fallback/alternate.

Keyframe tasks:

- Product packshot cleanup.
- Scene stills for each planned shot.
- First frame for Veo image-to-video.
- Optional last frame for precise interpolation.
- Brand CTA end card.
- Caption/title-safe layouts.

Quality rules:

- Preserve product shape, label, packaging, color, and visible claims.
- Avoid generating misleading product features.
- Avoid tiny unreadable text inside generated video when possible; add final text overlays in FFmpeg.
- Store prompts, model versions, seed/config if available, and full provider response metadata.

### Phase 6: Video Clip Generation

Frontend step:

- Scene Generation

Model:

- `veo-3.1-generate-preview` for final/high-quality.
- `veo-3.1-fast-generate-preview` for previews.
- `veo-3.1-lite-generate-preview` for cheaper drafts if quality is acceptable.

Input patterns:

1. Text-to-video for abstract/environment shots.
2. Image-to-video using the generated keyframe as the first frame.
3. Reference images for product preservation, up to three images.
4. First + last frames for precise beginning/end composition.
5. Extension for continuous motion when one shot must continue into another.

Recommended per-shot generation config:

```ts
type VideoGenerationConfig = {
  provider: "google";
  model: "veo-3.1-generate-preview" | "veo-3.1-fast-generate-preview";
  aspectRatio: "9:16" | "16:9";
  resolution: "720p" | "1080p" | "4k";
  durationSeconds: 8;
  prompt: string;
  imageAssetId?: string;
  lastFrameAssetId?: string;
  referenceAssetIds?: string[];
};
```

Operational notes:

- Treat provider calls as long-running jobs.
- Persist the provider operation ID.
- Poll from a worker, not from the request/response lifecycle.
- On failure, store provider error details and expose a user-safe message.
- Generate alternative takes for important shots when budget allows.

### Phase 7: Voiceover, Music, Captions, And Audio

Recommended MVP:

- Use script output to generate voiceover with TTS.
- Keep environmental SFX from Veo if useful.
- Mix voiceover above SFX/music in final render.
- Generate `.srt` or `.ass` captions from the same structured script.

Assets:

- `voiceover.mp3` or `voiceover.wav`
- `music.wav` or licensed background track
- `captions.ass`
- `audio_mix_manifest.json`

Important:

- Add user-facing disclosure in product terms/UI if using AI-generated voice.
- For India-focused ads later, support Hindi and Hinglish script variants.
- For ad safety, keep claims factual and avoid prohibited/medical/financial claims without user proof.

### Phase 8: FFmpeg Final Assembly

Frontend step:

- Final Video

Inputs:

- Approved video clips.
- Voiceover track.
- Music/SFX tracks.
- Captions.
- Logo/brand overlays.
- End card.
- Render manifest.

Render manifest:

```ts
type RenderManifest = {
  output: {
    aspectRatio: "9:16" | "16:9" | "1:1";
    width: number;
    height: number;
    fps: 24 | 30;
    durationSeconds: number;
    format: "mp4";
  };
  clips: Array<{
    assetId: string;
    startSecond: number;
    trimStart?: number;
    trimEnd?: number;
    transition?: "cut" | "fade" | "crossfade";
  }>;
  overlays: Array<{
    type: "logo" | "caption" | "cta" | "safe_zone";
    assetId?: string;
    text?: string;
    startSecond: number;
    endSecond: number;
    position: string;
  }>;
  audio: {
    voiceoverAssetId?: string;
    musicAssetId?: string;
    normalize: boolean;
  };
};
```

FFmpeg responsibilities:

- Normalize clip resolution, pixel format, SAR/DAR, FPS, and duration.
- Trim the generated clips to exact ad timing.
- Concatenate clips.
- Add transitions where useful.
- Burn captions using `subtitles` or `drawtext`.
- Overlay logo/end card.
- Mix and normalize audio.
- Export platform variants.

Example output profiles:

```ts
const OUTPUT_PROFILES = {
  instagram_reels: { width: 1080, height: 1920, fps: 30, aspectRatio: "9:16" },
  tiktok: { width: 1080, height: 1920, fps: 30, aspectRatio: "9:16" },
  youtube_shorts: { width: 1080, height: 1920, fps: 30, aspectRatio: "9:16" },
  youtube_landscape: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
  meta_feed_square: { width: 1080, height: 1080, fps: 30, aspectRatio: "1:1" }
};
```

### Phase 9: Automated QC

QC should run before the user sees the final video.

Technical checks:

- File exists and can be probed.
- Duration within expected range.
- Correct resolution/aspect ratio.
- Audio stream exists when required.
- No accidental silence if voiceover requested.
- No black frames at start/end.
- Captions fit safe zones.
- Final file size within limits.

Creative checks:

- Product remains recognizable.
- Product color/package does not drift too far.
- Brand name and CTA are correct.
- Script/captions match the selected offer.
- No forbidden claims.
- No obvious visual artifacts in key frames.

Potential implementation:

- Use `ffprobe` for technical metadata.
- Extract still frames every 1-2 seconds.
- Use a vision model to score product fidelity and artifacts.
- Store a `QCReport`.
- If QC fails, retry the exact failed stage only.

### Phase 10: Delivery

Frontend:

- Show final preview.
- Show platform-specific exports.
- Allow download.
- Later: direct publish integrations.

Backend:

- Store final render artifact.
- Mark job as `completed`.
- Persist render metrics and provider costs.
- Return signed download URL or local static URL.

## Backend Architecture Proposal

Current backend modules:

- `auth`
- `users`
- `health`

Recommended modules to add:

```text
src/modules/
  projects/
  assets/
  ads/
  pipeline/
  providers/
    google/
    openai/
  render/
  qc/
  storage/
```

### Suggested Prisma Models

Keep current auth models. Add:

```prisma
model Project {
  id        String   @id @default(uuid())
  userId    String
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model AdGeneration {
  id              String   @id @default(uuid())
  userId          String
  projectId       String
  status          String
  prompt          String
  productName     String?
  brandCategory   String?
  targetPlatform  String
  aspectRatio     String
  durationSeconds Int
  currentStep     String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model GenerationAsset {
  id             String   @id @default(uuid())
  adGenerationId String
  userId         String
  kind           String
  mimeType       String
  storageKey     String
  publicUrl      String?
  width          Int?
  height         Int?
  durationMs     Int?
  provider       String?
  providerModel  String?
  metadataJson   Json?
  createdAt      DateTime @default(now())
}

model PipelineStepRun {
  id             String   @id @default(uuid())
  adGenerationId String
  step           String
  status         String
  attempt        Int      @default(1)
  inputJson      Json?
  outputJson     Json?
  errorJson      Json?
  startedAt      DateTime?
  completedAt    DateTime?
  createdAt      DateTime @default(now())
}

model Shot {
  id             String   @id @default(uuid())
  adGenerationId String
  shotNumber     Int
  role           String
  durationSeconds Int
  promptJson     Json
  status         String
  keyframeAssetId String?
  videoAssetId    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model ProviderJob {
  id             String   @id @default(uuid())
  adGenerationId String
  stepRunId      String?
  provider       String
  model          String
  operationId    String?
  status         String
  requestJson    Json
  responseJson   Json?
  errorJson      Json?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model RenderOutput {
  id             String   @id @default(uuid())
  adGenerationId String
  profile        String
  storageKey     String
  mimeType       String
  width          Int
  height         Int
  durationMs     Int
  metadataJson   Json?
  createdAt      DateTime @default(now())
}
```

Names can change, but the important principle is this:

Every external artifact and provider call must be persisted and traceable.

### Suggested Backend APIs

```http
GET    /api/projects
POST   /api/projects

POST   /api/assets/upload-url
POST   /api/assets/complete

POST   /api/ads
GET    /api/ads/:adId
POST   /api/ads/:adId/start
POST   /api/ads/:adId/cancel

GET    /api/ads/:adId/steps
POST   /api/ads/:adId/steps/:step/approve
POST   /api/ads/:adId/steps/:step/regenerate

GET    /api/ads/:adId/shots
POST   /api/ads/:adId/shots/:shotId/regenerate

GET    /api/ads/:adId/renders
GET    /api/ads/:adId/download/:renderId
```

For MVP, uploads can go through the backend directly. Later, use presigned upload URLs.

### Job Processing

The pipeline is too slow for normal request handlers.

Recommended job approach:

- API creates DB rows and enqueues jobs.
- Worker processes stages one by one.
- Frontend polls or subscribes to status.
- Each job is idempotent enough to retry.

Local MVP options:

1. Simple in-process worker loop.
2. BullMQ + Redis.
3. Database-backed job table with a worker process.

Recommended first implementation:

- Start with database-backed jobs to avoid adding Redis immediately.
- Move to BullMQ/Redis once we need higher concurrency or distributed workers.

## Frontend Mapping

Current UI already has the right five sections. We should progressively replace mock content with real API-backed state.

### Step 1: Prompt + Reference Image

Replace static upload placeholder with:

- Drag/drop upload.
- Product name and category inputs.
- Reference notes.
- Platform/duration selector.
- Start generation button.

State source:

- `AdGeneration`
- `GenerationAsset[]`

### Step 2: Cinematic Shot Images

Show:

- Generated shot list.
- Keyframe stills.
- Product fidelity status.
- Approve/regenerate buttons.

State source:

- `Shot[]`
- keyframe `GenerationAsset[]`

### Step 3: Script Writing

Show editable structured script:

- Hook.
- Voiceover lines.
- Captions.
- CTA.
- Tone.

State source:

- `CreativeBrief`
- `AdScript`

### Step 4: Scene Generation

Show:

- Per-shot video generation progress.
- Provider status.
- Preview per generated clip.
- Retry failed shot.

State source:

- `Shot.status`
- `ProviderJob`
- video `GenerationAsset[]`

### Step 5: Final Video

Show:

- Final rendered video.
- QC result.
- Download buttons per platform.
- Regenerate final render.

State source:

- `RenderOutput[]`
- `QCReport`

## Recommended MVP Build Sequence

### Milestone 1: Data And API Skeleton

- Add Prisma models for projects, ad generations, assets, step runs, shots, provider jobs, render outputs.
- Add protected backend routes.
- Add frontend API client for ads/projects/assets.
- Replace local React-only workflow state with backend state.

### Milestone 2: Script And Storyboard Only

- User uploads images and prompt.
- Backend stores them.
- Text model creates `ProductAnalysis`, `CreativeBrief`, `AdScript`, and `ShotList`.
- Frontend displays editable script and shot list.
- No image/video generation yet.

### Milestone 3: Keyframes

- Add image provider service.
- Generate still keyframes per shot.
- Frontend displays keyframes and lets user approve/regenerate.

### Milestone 4: Video Clips

- Add Veo provider service.
- Generate 8s clips per approved shot.
- Persist provider operation IDs.
- Poll long-running operations from worker.
- Frontend displays per-shot progress and previews.

### Milestone 5: FFmpeg Render

- Add render worker.
- Create final MP4 from generated clips.
- Add captions and logo overlay.
- Export `9:16` first.
- Add `16:9` and `1:1` later.

### Milestone 6: QC And Retry

- Add technical QC with `ffprobe`.
- Extract frames and run AI visual QC.
- Retry only failed stages.
- Store final QC report.

### Milestone 7: Credits And Production Hardening

- Track provider cost and credits.
- Add rate limits per user.
- Add storage lifecycle cleanup.
- Add admin logs and error dashboards.
- Move refresh tokens to HttpOnly cookie if domain/deployment is stable.

## Recommended Environment Variables

Backend:

```env
GEMINI_API_KEY=
OPENAI_API_KEY=

PIPELINE_STORAGE_DRIVER=local
PIPELINE_LOCAL_STORAGE_DIR=./storage

PIPELINE_MAX_REFERENCE_IMAGES=10
PIPELINE_DEFAULT_VIDEO_MODEL=veo-3.1-fast-generate-preview
PIPELINE_FINAL_VIDEO_MODEL=veo-3.1-generate-preview
PIPELINE_DEFAULT_IMAGE_MODEL=gemini-3.1-flash-image
PIPELINE_PREMIUM_IMAGE_MODEL=gemini-3-pro-image

PIPELINE_WORKER_CONCURRENCY=1
PIPELINE_POLL_INTERVAL_SECONDS=10
```

Later:

```env
S3_BUCKET=
S3_REGION=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
REDIS_URL=
```

## Provider Abstraction

Avoid hard-coding model providers into business logic.

Recommended interfaces:

```ts
type ImageProvider = {
  generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult>;
  editImage(input: ImageEditInput): Promise<ImageGenerationResult>;
};

type VideoProvider = {
  startVideoGeneration(input: VideoGenerationInput): Promise<ProviderOperation>;
  pollVideoGeneration(operationId: string): Promise<VideoGenerationStatus>;
  downloadVideo(operationId: string): Promise<DownloadedAsset>;
};

type TextProvider = {
  createStructuredOutput<T>(input: StructuredTextInput<T>): Promise<T>;
};

type SpeechProvider = {
  synthesize(input: SpeechInput): Promise<AudioAsset>;
};
```

This lets us switch between:

- Google for Veo and Gemini image.
- OpenAI for text, structured script, GPT Image, and TTS.
- Future providers for cheaper or faster generation.

## Safety, Rights, And Policy Checks

Minimum checks before generation:

- User must confirm they own or have rights to uploaded product/reference images.
- Reject unsupported file types.
- Moderate prompts and image descriptions.
- Avoid celebrity/real-person impersonation without consent.
- Avoid misleading product claims.
- Store provider safety blocks distinctly from system failures.

Minimum checks before final delivery:

- Caption and voiceover do not add unverified claims.
- AI-generated voice disclosure is represented in product terms/help text.
- Generated video should not hide required ad disclosures.

## Open Product Decisions

1. Do we want Aevora to generate 15s, 30s, or both at launch?
2. Do we start with only `9:16` vertical ads?
3. Should users approve the script before image/video generation, or should MVP run fully automatic?
4. Should the first MVP use Veo native audio only, or separate TTS voiceover?
5. Should we generate one final video or 3 variations for A/B testing?
6. Should local storage be enough for development, or should we add S3/R2 immediately?
7. What counts as a credit: one full ad, one provider call, or one rendered output?

## Recommended First Implementation Choice

For the next coding phase, build this slice:

1. Add DB models for `Project`, `AdGeneration`, `GenerationAsset`, `PipelineStepRun`, and `Shot`.
2. Add protected APIs for creating an ad generation and uploading reference images.
3. Add a text-planning worker that creates `ProductAnalysis`, `CreativeBrief`, `AdScript`, and `ShotList` as JSON.
4. Update the frontend first step to call the backend and show persisted step status.

Do not start with Veo first. Veo is expensive and asynchronous. The script/storyboard layer gives us the control plane that every later generation stage depends on.

## Source Index

- Google Gemini API - Veo video generation: https://ai.google.dev/gemini-api/docs/video
- Google Gemini API - Nano Banana image generation: https://ai.google.dev/gemini-api/docs/image-generation
- Google Gemini API - Structured outputs: https://ai.google.dev/gemini-api/docs/structured-output
- OpenAI API - Text generation: https://developers.openai.com/api/docs/guides/text
- OpenAI API - Structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI API - Image generation: https://developers.openai.com/api/docs/guides/image-generation
- OpenAI API - Text to speech: https://developers.openai.com/api/docs/guides/text-to-speech
- FFmpeg filters: https://ffmpeg.org/ffmpeg-filters.html
