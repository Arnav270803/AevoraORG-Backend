import { describe, expect, it } from "vitest";
import { assertUploadSignature } from "../src/modules/assets/asset-content";

describe("uploaded media signatures (deferred)", () => {
  it("rejects HTML disguised as image or audio", () => {
    const data = Buffer.from("<!DOCTYPE html><script>alert('fixture')</script>");
    for (const mime of ["image/png", "image/jpeg", "image/webp", "audio/mpeg", "audio/wav", "audio/ogg"])
      expect(() => assertUploadSignature(data, mime)).toThrow();
  });
  it("distinguishes WAV and WebP RIFF containers", () => {
    const wave = Buffer.alloc(44); wave.write("RIFF", 0); wave.write("WAVE", 8);
    const webp = Buffer.alloc(20); webp.write("RIFF", 0); webp.write("WEBP", 8);
    expect(() => assertUploadSignature(wave, "audio/wav")).not.toThrow();
    expect(() => assertUploadSignature(wave, "image/webp")).toThrow();
    expect(() => assertUploadSignature(webp, "image/webp")).not.toThrow();
    expect(() => assertUploadSignature(webp, "audio/wav")).toThrow();
  });
  it("accepts a MPEG frame header and refuses truncated ID3 metadata", () => {
    expect(() => assertUploadSignature(Buffer.from([0xff, 0xfb, 0x90, 0, 0]), "audio/mpeg")).not.toThrow();
    expect(() => assertUploadSignature(Buffer.from("ID3metadata-only"), "audio/mpeg")).toThrow();
  });
  it("requires an audio identification packet for OGG", () => {
    const data = Buffer.alloc(80); data.write("OggS");
    expect(() => assertUploadSignature(data, "audio/ogg")).toThrow();
    data.write("OpusHead", 28);
    expect(() => assertUploadSignature(data, "audio/ogg")).not.toThrow();
  });
});
