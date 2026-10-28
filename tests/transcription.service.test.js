import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanTranscript,
  validateAudioFile,
} from "../services/transcription.service.js";

describe("transcription helpers", () => {
  it("cleans fenced and noisy transcript text", () => {
    assert.equal(cleanTranscript("  hello   world  "), "hello world");
    assert.equal(cleanTranscript("```text\nBias is bullish\n```"), "Bias is bullish");
  });

  it("rejects empty or unsupported audio uploads", () => {
    assert.equal(validateAudioFile(null).ok, false);
    assert.equal(
      validateAudioFile({
        buffer: Buffer.from("abc"),
        mimetype: "application/pdf",
      }).ok,
      false,
    );
    assert.equal(
      validateAudioFile({
        buffer: Buffer.from("abc"),
        mimetype: "audio/webm",
      }).ok,
      true,
    );
  });
});
