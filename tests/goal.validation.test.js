import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateGoalInput } from "../validations/goal.validation.js";

describe("validateGoalInput", () => {
  it("does not add default dates to partial goal updates", () => {
    const result = validateGoalInput({ status: "Archived" }, { partial: true });

    assert.equal(result.isValid, true);
    assert.deepEqual(result.data, { status: "Archived" });
  });

  it("rejects an end date that is not after an explicitly supplied start date", () => {
    const result = validateGoalInput(
      { startsAt: "2026-01-02", endsAt: "2026-01-01" },
      { partial: true },
    );

    assert.equal(result.isValid, false);
    assert.ok(
      result.errors.includes("Goal end date must be after the start date."),
    );
  });
});
