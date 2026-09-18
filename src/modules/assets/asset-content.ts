import { BadRequestError } from "../../utils/errors";

/** Bounded signature check before storage; the renderer still verifies real streams with ffprobe. */
export function assertUploadSignature(data: Buffer, mimeType: string) {
  const ascii = (offset: number, text: string) => data.subarray(offset, offset + text.length).toString("latin1") === text;
  const riff = ascii(0, "RIFF");
  let valid = false;
  switch (mimeType) {
    case "image/png":
      valid = data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && ascii(12, "IHDR");
      break;
    case "image/jpeg":
      valid = data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
      break;
    case "image/webp":
      valid = data.length >= 20 && riff && ascii(8, "WEBP");
      break;
    case "audio/wav":
      valid = data.length >= 44 && riff && ascii(8, "WAVE");
      break;
    case "audio/ogg": {
      const header = data.subarray(0, Math.min(data.length, 4096));
      valid = data.length >= 28 && ascii(0, "OggS") && data[4] === 0 &&
        (header.includes(Buffer.from("OpusHead")) || header.includes(Buffer.from([1, ...Buffer.from("vorbis")])));
      break;
    }
    case "audio/mpeg": {
      let offset = 0;
      if (ascii(0, "ID3") && data.length >= 10) {
        const size = [data[6], data[7], data[8], data[9]];
        if (size.some((byte) => byte >= 128)) break;
        offset = 10 + size.reduce((sum, byte) => sum * 128 + byte, 0) + ((data[5] & 0x10) ? 10 : 0);
      }
      // A short scan permits padding after ID3 while excluding non-MPEG uploads.
      for (let index = offset; index < Math.min(data.length - 3, offset + 4096); index++) {
        const second = data[index + 1];
        const third = data[index + 2];
        if (data[index] === 0xff && (second & 0xe0) === 0xe0 && (second & 0x18) !== 0x08 &&
          (second & 0x06) !== 0 && (third & 0xf0) !== 0xf0 && (third & 0x0c) !== 0x0c) { valid = true; break; }
      }
      break;
    }
  }
  if (!valid) throw new BadRequestError("The uploaded file does not match its declared image/audio type. Choose a valid PNG, JPEG, WebP, MP3, WAV, or OGG file.");
}
