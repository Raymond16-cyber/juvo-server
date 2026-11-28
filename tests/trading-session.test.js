import assert from "node:assert/strict";
import { test } from "node:test";
import { inferTradingSession } from "../utils/tradingSession.js";

test("infers the primary market session using timezone-aware local hours", () => {
  assert.equal(
    inferTradingSession(new Date("2026-01-15T14:00:00Z")),
    "New York",
  );
  assert.equal(
    inferTradingSession(new Date("2026-07-15T12:30:00Z")),
    "New York",
  );
  assert.equal(
    inferTradingSession(new Date("2026-01-15T02:00:00Z")),
    "Tokyo",
  );
  assert.equal(
    inferTradingSession(new Date("2026-01-15T23:30:00Z")),
    "Asian",
  );
});

test("does not invent a session for invalid timestamps", () => {
  assert.equal(inferTradingSession("not-a-date"), undefined);
  assert.equal(inferTradingSession(null), undefined);
});
