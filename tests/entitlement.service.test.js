import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ENTITLEMENTS,
  getFeatureAccess,
} from "../services/entitlement.service.js";

const now = new Date("2026-09-07T12:00:00.000Z");

describe("entitlement service", () => {
  it("denies Juvo AI to free users before they start a trial", () => {
    const access = getFeatureAccess(
      { subscription: { plan: "free" }, entitlements: {} },
      ENTITLEMENTS.JUVO_AI,
      now,
    );

    assert.equal(access.hasAccess, false);
    assert.equal(access.trial.status, "available");
  });

  it("allows Juvo AI during an active trial", () => {
    const access = getFeatureAccess(
      {
        subscription: { plan: "free" },
        entitlements: {
          aiTrial: {
            used: true,
            startedAt: "2026-09-06T12:00:00.000Z",
            expiresAt: "2026-09-08T12:00:00.000Z",
          },
        },
      },
      ENTITLEMENTS.JUVO_AI,
      now,
    );

    assert.equal(access.hasAccess, true);
    assert.equal(access.source, "trial");
    assert.equal(access.trial.status, "active");
  });

  it("denies Juvo AI when the one-time trial has expired", () => {
    const access = getFeatureAccess(
      {
        subscription: { plan: "free" },
        entitlements: {
          aiTrial: {
            used: true,
            startedAt: "2026-09-01T12:00:00.000Z",
            expiresAt: "2026-09-04T12:00:00.000Z",
          },
        },
      },
      ENTITLEMENTS.JUVO_AI,
      now,
    );

    assert.equal(access.hasAccess, false);
    assert.equal(access.trial.status, "expired");
  });

  it("allows Juvo AI for paid plans", () => {
    const access = getFeatureAccess(
      { subscription: { plan: "pro" }, entitlements: {} },
      ENTITLEMENTS.JUVO_AI,
      now,
    );

    assert.equal(access.hasAccess, true);
    assert.equal(access.source, "subscription");
  });

  it("keeps paid access during a non-renewing paid period and removes it after expiry", () => {
    const current = {
      subscription: { plan: "pro", status: "non-renewing", expiresAt: "2026-09-08T12:00:00.000Z" },
      entitlements: {},
    };
    assert.equal(getFeatureAccess(current, ENTITLEMENTS.JUVO_AI, now).hasAccess, true);
    assert.equal(getFeatureAccess({ ...current, subscription: { ...current.subscription, expiresAt: "2026-09-06T12:00:00.000Z" } }, ENTITLEMENTS.JUVO_AI, now).hasAccess, false);
  });

  it("allows data export only for active paid Pro and Super subscriptions", () => {
    for (const plan of ["pro", "super"]) {
      const access = getFeatureAccess(
        { subscription: { plan, status: "active", expiresAt: "2026-09-08T12:00:00.000Z" } },
        ENTITLEMENTS.DATA_EXPORT,
        now,
      );
      assert.equal(access.hasAccess, true);
      assert.equal(access.source, "subscription");
    }
  });

  it("denies data export to free, trial, and expired subscriptions", () => {
    for (const subscription of [
      { plan: "free", status: "free" },
      { plan: "pro", status: "trial" },
      { plan: "super", status: "trial" },
      { plan: "pro", status: "expired", expiresAt: "2026-09-06T12:00:00.000Z" },
    ]) {
      assert.equal(
        getFeatureAccess({ subscription, entitlements: { aiTrial: { status: "active" } } }, ENTITLEMENTS.DATA_EXPORT, now).hasAccess,
        false,
      );
    }
  });
});
