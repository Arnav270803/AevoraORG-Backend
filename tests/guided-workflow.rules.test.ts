import { describe, expect, it } from "vitest";
import { assertExpectedRevision, classifyShotChange, redactAttemptMetadata, safeMetadata, stableFingerprint, validateTimelineMedia } from "../src/modules/workspace/workspace.rules";
import { scriptContentSchema, timelineContentSchema, type ShotContent, type TimelineContent } from "../src/modules/workspace/workspace.schemas";

// Written for the later testing session; no test runner is launched by this file.
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const shot: ShotContent = {
  shotId: id(1), shotNumber: 1, role: "product_hero", durationSeconds: 3,
  visualDescription: "Product on a stone plinth", camera: { framing: "medium", movement: "slow push", lensFeel: "natural" },
  lighting: "soft side light", environment: "studio", objects: ["bottle"], productContinuityNotes: ["Preserve label"],
  captionText: "Discover it", imagePrompt: "Product on a stone plinth", videoPrompt: "Slow camera push",
  negativePrompt: "distorted label", referenceAssetIds: [id(2)],
};
const timeline: TimelineContent = {
  fps: 24, width: 720, height: 1280,
  clips: [{ id: id(3), shotId: id(1), assetId: id(4), sourceInFrame: 12, durationFrames: 60, fit: "contain", muted: true, volume: 1 }],
  overlays: [{ id: id(5), text: "An exact caption", startFrame: 0, endFrame: 60, position: "bottom", fontSize: 36, color: "#ffffff" }],
  audioTracks: [], normalizeAudio: false,
};

describe("guided revision rules", () => {
  it("rejects stale revisions and permits an exact base revision", () => {
    expect(() => assertExpectedRevision(id(1), id(1))).not.toThrow();
    expect(() => assertExpectedRevision(id(1), id(2))).toThrow();
    expect(() => assertExpectedRevision(id(1), null)).toThrow();
  });
  it("fingerprints object keys canonically but preserves ordered array meaning", () => {
    expect(stableFingerprint({ a: 1, b: { x: 2 } })).toBe(stableFingerprint({ b: { x: 2 }, a: 1 }));
    expect(stableFingerprint([id(1), id(2)])).not.toBe(stableFingerprint([id(2), id(1)]));
  });
  it("classifies a caption-only edit as editorial", () => {
    expect(classifyShotChange(shot, { ...shot, captionText: "Corrected caption" })).toBe("editorial");
  });
  it("classifies a motion-only edit without invalidating composition", () => {
    expect(classifyShotChange(shot, { ...shot, camera: { ...shot.camera, movement: "orbit" } })).toBe("motion");
    expect(classifyShotChange(shot, { ...shot, videoPrompt: "Slow orbit" })).toBe("motion");
  });
  it("classifies new references and changed lighting as composition changes", () => {
    expect(classifyShotChange(shot, { ...shot, referenceAssetIds: [id(9)] })).toBe("composition");
    expect(classifyShotChange(shot, { ...shot, lighting: "hard back light" })).toBe("composition");
  });
  it("keeps stable shot identity independent of presentation order", () => {
    expect(classifyShotChange(shot, { ...shot, shotNumber: 4 })).toBe("editorial");
  });
});

describe("timeline and script validation", () => {
  it("accepts a frame-accurate trim with measured source duration", () => {
    const parsed = timelineContentSchema.parse(timeline);
    expect(() => validateTimelineMedia(parsed, [{ id: id(4), status: "READY", mimeType: "video/mp4", metadata: { durationSeconds: 3 } }], [id(1)])).not.toThrow();
  });
  it("rejects unavailable/foreign media instead of inventing a preview", () => {
    expect(() => validateTimelineMedia(timeline, [], [id(1)])).toThrow();
    expect(() => validateTimelineMedia(timeline, [{ id: id(4), status: "READY", mimeType: "video/mp4", metadata: { durationSeconds: 3 } }], [])).toThrow();
  });
  it("rejects a trim beyond the measured source and unknown duration", () => {
    expect(() => validateTimelineMedia(timeline, [{ id: id(4), status: "READY", mimeType: "video/mp4", metadata: { durationSeconds: 1 } }], [id(1)])).toThrow();
    expect(() => validateTimelineMedia(timeline, [{ id: id(4), status: "READY", mimeType: "video/mp4", metadata: {} }], [id(1)])).toThrow();
  });
  it("rejects fractional frame edits, duplicate items, and out-of-range captions", () => {
    expect(timelineContentSchema.safeParse({ ...timeline, clips: [{ ...timeline.clips[0], sourceInFrame: 0.5 }] }).success).toBe(false);
    expect(timelineContentSchema.safeParse({ ...timeline, clips: [...timeline.clips, ...timeline.clips] }).success).toBe(false);
    expect(timelineContentSchema.safeParse({ ...timeline, overlays: [{ ...timeline.overlays[0], endFrame: 61 }] }).success).toBe(false);
  });
  it("rejects fades longer than the selected audio interval", () => {
    const audio = { id: id(6), assetId: id(7), startFrame: 0, sourceInFrame: 0, durationFrames: 24, volume: 1, fadeInFrames: 20, fadeOutFrames: 20 };
    expect(timelineContentSchema.safeParse({ ...timeline, audioTracks: [audio] }).success).toBe(false);
  });
  it("rejects duplicate script beat IDs and reversed timing", () => {
    const beat = { id: id(8), startSecond: 0, endSecond: 3, text: "Hello", delivery: "warm" };
    expect(scriptContentSchema.safeParse({ voiceover: [beat, beat], captions: [] }).success).toBe(false);
    expect(scriptContentSchema.safeParse({ voiceover: [{ ...beat, endSecond: 0 }], captions: [] }).success).toBe(false);
  });
});

describe("workspace metadata", () => {
  it("keeps useful candidate metadata without returning worker internals", () => {
    expect(safeMetadata({ shotId: id(1), width: 720, durationSeconds: 3, apiKey: "fixture-not-a-key", requestBody: { image: "large" } })).toEqual({ shotId: id(1), width: 720, durationSeconds: 3 });
  });
  it("removes access credentials and signed query parameters from attempt metadata", () => {
    const result = redactAttemptMetadata({ authorization: "fixture", nested: { url: "https://user:password@example.com/video.mp4?signature=fixture", base64: "fixture" } });
    expect(result).toEqual({ nested: { url: "https://example.com/video.mp4" } });
  });
});
