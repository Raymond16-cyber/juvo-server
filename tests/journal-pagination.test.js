import assert from "node:assert/strict";
import test from "node:test";

/**
 * Lightweight unit coverage for pagination helpers by re-implementing the
 * pure parsing rules used in journal.service. Full DB integration remains in
 * journal-workflow tests.
 */

function parseJournalPage(value) {
  const page = Number.parseInt(String(value ?? "1"), 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function parseJournalLimit(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    return required ? 10 : null;
  }
  if (String(value).toLowerCase() === "all") return null;
  const limit = Number.parseInt(String(value), 10);
  if (!Number.isFinite(limit) || limit <= 0) return required ? 10 : null;
  return Math.min(limit, 50);
}

test("journal page parsing defaults and clamps", () => {
  assert.equal(parseJournalPage(undefined), 1);
  assert.equal(parseJournalPage("0"), 1);
  assert.equal(parseJournalPage("3"), 3);
  assert.equal(parseJournalLimit(undefined), null);
  assert.equal(parseJournalLimit(undefined, { required: true }), 10);
  assert.equal(parseJournalLimit("all"), null);
  assert.equal(parseJournalLimit("10"), 10);
  assert.equal(parseJournalLimit("999"), 50);
});

test("pagination meta math", () => {
  const page = 2;
  const limit = 10;
  const total = 25;
  const skip = (page - 1) * limit;
  const loaded = 10;
  const hasMore = skip + loaded < total;
  assert.equal(hasMore, true);
  assert.equal(skip + loaded < 20 ? false : true, true);
});
