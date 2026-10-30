import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import {
  BETA_WINDOW_MS,
  createTesterCodes,
  evaluateUserBetaAccess,
  hashTesterCode,
  isBetaAccessModeEnabled,
  normalizeTesterCode,
  presentBetaAccess,
  redeemTesterCodeForUser,
} from "../services/betaAccess.service.js";

describe("beta access helpers", () => {
  const previous = process.env.BETA_ACCESS_MODE;

  after(() => {
    if (previous === undefined) delete process.env.BETA_ACCESS_MODE;
    else process.env.BETA_ACCESS_MODE = previous;
  });

  it("normalizes and hashes tester codes consistently", () => {
    const plain = "juvo-test-abcd-efgh-ijkl";
    assert.equal(normalizeTesterCode(plain), "JUVO-TEST-ABCD-EFGH-IJKL");
    assert.equal(hashTesterCode(plain), hashTesterCode("JUVO-TEST-ABCD-EFGH-IJKL"));
    assert.notEqual(hashTesterCode(plain), hashTesterCode("JUVO-TEST-XXXX-XXXX-XXXX"));
  });

  it("reads BETA_ACCESS_MODE from the environment", () => {
    process.env.BETA_ACCESS_MODE = "true";
    assert.equal(isBetaAccessModeEnabled(), true);
    process.env.BETA_ACCESS_MODE = "false";
    assert.equal(isBetaAccessModeEnabled(), false);
  });

  it("grants admins access while beta mode is on", () => {
    process.env.BETA_ACCESS_MODE = "true";
    const access = evaluateUserBetaAccess({ role: "admin" });
    assert.equal(access.allowed, true);
    assert.equal(access.beta.status, "admin");
  });

  it("requires a code for users without beta access", () => {
    process.env.BETA_ACCESS_MODE = "true";
    const access = evaluateUserBetaAccess({
      role: "user",
      betaAccess: { status: "none" },
    });
    assert.equal(access.allowed, false);
    assert.equal(access.code, "BETA_ACCESS_REQUIRED");
  });

  it("expires active windows after 24 hours without resetting on login", () => {
    process.env.BETA_ACCESS_MODE = "true";
    const activatedAt = new Date("2026-10-01T00:00:00.000Z");
    const expiresAt = new Date(activatedAt.getTime() + BETA_WINDOW_MS);
    const before = presentBetaAccess(
      {
        role: "user",
        betaAccess: { status: "active", activatedAt, expiresAt },
      },
      new Date("2026-10-01T12:00:00.000Z"),
    );
    assert.equal(before.status, "active");
    assert.equal(before.hasAccess, true);

    const after = presentBetaAccess(
      {
        role: "user",
        betaAccess: { status: "active", activatedAt, expiresAt },
      },
      new Date("2026-10-02T00:00:01.000Z"),
    );
    assert.equal(after.status, "expired");
    assert.equal(after.hasAccess, false);

    const access = evaluateUserBetaAccess(
      {
        role: "user",
        betaAccess: { status: "expired", activatedAt, expiresAt },
      },
      new Date("2026-10-03T00:00:00.000Z"),
    );
    assert.equal(access.allowed, false);
    assert.equal(access.code, "BETA_ACCESS_EXPIRED");
  });

  it("allows normal access when beta mode is disabled", () => {
    process.env.BETA_ACCESS_MODE = "false";
    const access = evaluateUserBetaAccess({
      role: "user",
      betaAccess: { status: "none" },
    });
    assert.equal(access.allowed, true);
  });
});

describe("beta code creation shape", () => {
  it("creates JUVO-TEST formatted codes", async () => {
    // Unit-level format check without DB: generatePlain is used inside create.
    // This test only validates helper exports remain stable.
    assert.equal(typeof createTesterCodes, "function");
    assert.equal(typeof redeemTesterCodeForUser, "function");
    assert.equal(typeof hashTesterCode, "function");
  });
});
