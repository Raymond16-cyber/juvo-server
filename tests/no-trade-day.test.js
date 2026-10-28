import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateNoTradePayload,
} from "../services/noTradeDay.service.js";
import {
  isMeaningfulJournal,
  localDateKey,
  shiftLocalDateKey,
} from "../services/journalStreak.service.js";

describe("no-trade day validation", () => {
  it("requires confirmation for a new submission", () => {
    const result = validateNoTradePayload({ confirmed: false });
    assert.equal(result.isValid, false);
    assert.match(result.errors.join(" "), /did not place any trades/i);
  });

  it("allows optional reflection and reason", () => {
    const withReflection = validateNoTradePayload({
      confirmed: true,
      reason: "rest_day",
      reflection: "I waited for A+ setups and none appeared.",
    });
    assert.equal(withReflection.isValid, true);
    assert.equal(withReflection.data.reason, "rest_day");

    const withoutReflection = validateNoTradePayload({
      confirmed: true,
    });
    assert.equal(withoutReflection.isValid, true);
    assert.equal(withoutReflection.data.reflection, "");
  });

  it("rejects invalid reasons", () => {
    const result = validateNoTradePayload({
      confirmed: true,
      reason: "impulse",
    });
    assert.equal(result.isValid, false);
  });

  it("allows edits without re-sending confirmation", () => {
    const result = validateNoTradePayload(
      { reason: "followed_plan", reflection: "Updated note" },
      { requireConfirmation: false },
    );
    assert.equal(result.isValid, true);
  });
});

describe("streak qualification with no-trade semantics", () => {
  it("keeps empty shells non-qualifying while completed reviews qualify", () => {
    assert.equal(isMeaningfulJournal({ status: "Started", trades: [] }), false);
    assert.equal(isMeaningfulJournal({ status: "Completed", trades: [] }), true);
  });

  it("handles consecutive local date keys across month boundaries", () => {
    assert.equal(shiftLocalDateKey("2026-03-01", -1, "UTC"), "2026-02-28");
    assert.equal(shiftLocalDateKey("2026-01-01", -1, "UTC"), "2025-12-31");
    assert.equal(localDateKey(new Date("2026-10-27T01:00:00.000Z"), "UTC"), "2026-10-27");
  });
});
