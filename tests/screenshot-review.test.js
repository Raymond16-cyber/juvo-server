import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectImageMime,
  normalizeScreenshotReview,
  validateScreenshotFile,
} from "../utils/screenshotImage.js";
import {
  buildTradeContextPayload,
  resolveExistingScreenshotAnalysis,
} from "../services/screenshotReview.service.js";

describe("screenshot image validation", () => {
  it("detects jpeg png and webp magic bytes", () => {
    const jpeg = Buffer.alloc(12, 0);
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    jpeg[2] = 0xff;
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
    ]);
    const webp = Buffer.alloc(12, 0);
    Buffer.from("RIFF").copy(webp, 0);
    Buffer.from("WEBP").copy(webp, 8);

    assert.equal(detectImageMime(jpeg), "image/jpeg");
    assert.equal(detectImageMime(png), "image/png");
    assert.equal(detectImageMime(webp), "image/webp");
  });

  it("rejects mismatched mime declarations and oversized files", () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
    ]);

    assert.equal(
      validateScreenshotFile({
        buffer: png,
        mimetype: "image/jpeg",
      }).ok,
      false,
    );

    assert.equal(
      validateScreenshotFile({
        buffer: Buffer.alloc(0),
        mimetype: "image/png",
      }).ok,
      false,
    );
  });

  it("accepts a valid png screenshot", () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
    ]);
    const result = validateScreenshotFile({
      buffer: png,
      mimetype: "image/png",
    });
    assert.equal(result.ok, true);
    assert.equal(result.mimeType, "image/png");
  });
});

describe("screenshot review helpers", () => {
  it("normalizes a complete review and rejects incomplete ones", () => {
    const review = {
      chartObservations: "Clear London open structure.",
      marketStructure: "Higher highs visible.",
      setupAnalysis: "Demand zone held.",
      entryExitReview: "Entry aligned with the zone.",
      riskManagement: "Stop sits below the swing.",
      whatWentWell: "Waited for confirmation.",
      whatCouldBeImproved: "Took profit earlier than planned.",
      keyLesson: "Hold to the invalidation only.",
      confidenceAndLimitations: "Timeframe label is cropped.",
    };

    assert.deepEqual(normalizeScreenshotReview(review), review);
    assert.equal(
      normalizeScreenshotReview({ ...review, keyLesson: "" }),
      null,
    );
  });

  it("returns cached analysis and conflicts while processing", () => {
    const now = Date.parse("2026-09-07T12:00:00.000Z");
    const completeReview = {
      chartObservations: "Clear London open structure.",
      marketStructure: "Higher highs visible.",
      setupAnalysis: "Demand zone held.",
      entryExitReview: "Entry aligned with the zone.",
      riskManagement: "Stop sits below the swing.",
      whatWentWell: "Waited for confirmation.",
      whatCouldBeImproved: "Took profit earlier than planned.",
      keyLesson: "Hold to the invalidation only.",
      confidenceAndLimitations: "Timeframe label is cropped.",
    };
    const ready = {
      status: "ready",
      review: completeReview,
    };
    const incompleteReady = {
      status: "ready",
      review: { chartObservations: "ok" },
    };
    const processing = {
      status: "processing",
      startedAt: "2026-09-07T11:59:30.000Z",
    };
    const stale = {
      status: "processing",
      startedAt: "2026-09-07T11:50:00.000Z",
    };

    assert.equal(resolveExistingScreenshotAnalysis(ready, now).action, "return_cached");
    assert.equal(resolveExistingScreenshotAnalysis(incompleteReady, now).action, "reclaim");
    assert.equal(resolveExistingScreenshotAnalysis(processing, now).action, "conflict");
    assert.equal(resolveExistingScreenshotAnalysis(stale, now).action, "reclaim");
    assert.equal(resolveExistingScreenshotAnalysis(null, now).action, "create");
  });

  it("builds trade context without empty fields", () => {
    const payload = buildTradeContextPayload({
      trade: {
        symbol: "EURUSD",
        instrument: "forex",
        direction: "long",
        entryPrice: 1.1,
        exitPrice: undefined,
        notes: "",
        stopLoss: 1.09,
      },
      journal: {
        psychology: {
          beforeTrading: "Calm",
          afterTrading: "",
          confidenceBefore: 7,
        },
      },
      strategy: {
        name: "Sweep and reverse",
        prerequisites: [],
        notes: "Wait for displacement",
      },
      plan: null,
    });

    assert.equal(payload.symbol, "EURUSD");
    assert.equal(payload.stopLoss, 1.09);
    assert.equal(payload.psychology.beforeTrading, "Calm");
    assert.equal(payload.psychology.confidenceBefore, 7);
    assert.equal(payload.strategy.name, "Sweep and reverse");
    assert.equal(payload.strategy.notes, "Wait for displacement");
    assert.equal("exitPrice" in payload, false);
    assert.equal("notes" in payload, false);
    assert.equal("afterTrading" in payload.psychology, false);
    assert.equal("prerequisites" in payload.strategy, false);
    assert.equal("plan" in payload, false);
  });
});
