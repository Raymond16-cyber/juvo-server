import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPlanComplianceChecks,
  interviewerSourcePayload,
  stableHash,
} from "../services/aiFeatures.service.js";
import {
  evaluateUsageGate,
  getMonthlyLimit,
  remainingFromCount,
} from "../services/aiUsage.service.js";
import {
  ENTITLEMENTS,
  getFeatureAccess,
} from "../services/entitlement.service.js";
import { sanitizeModelIdentity } from "../utils/sanitizeModelIdentity.js";

const now = new Date("2026-09-07T12:00:00.000Z");

describe("AI feature entitlements", () => {
  it("grants smart journal interviewer to free users", () => {
    const access = getFeatureAccess(
      { subscription: { plan: "free" }, entitlements: {} },
      ENTITLEMENTS.SMART_JOURNAL_INTERVIEWER,
      now,
    );
    assert.equal(access.hasAccess, true);
    assert.equal(access.source, "subscription");
  });

  it("denies plan compliance and explain metrics on free", () => {
    const user = { subscription: { plan: "free" }, entitlements: {} };
    assert.equal(
      getFeatureAccess(user, ENTITLEMENTS.PLAN_COMPLIANCE_CHECK, now).hasAccess,
      false,
    );
    assert.equal(
      getFeatureAccess(user, ENTITLEMENTS.EXPLAIN_METRICS, now).hasAccess,
      false,
    );
  });

  it("allows ask-your-journal during an active trial", () => {
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
      ENTITLEMENTS.ASK_YOUR_JOURNAL,
      now,
    );
    assert.equal(access.hasAccess, true);
    assert.equal(access.source, "trial");
  });

  it("allows goal coach and check-ins only on super", () => {
    const pro = getFeatureAccess(
      { subscription: { plan: "pro" }, entitlements: {} },
      ENTITLEMENTS.GOAL_COACH,
      now,
    );
    const superAccess = getFeatureAccess(
      { subscription: { plan: "super" }, entitlements: {} },
      ENTITLEMENTS.CONTEXTUAL_AI_CHECKINS,
      now,
    );
    assert.equal(pro.hasAccess, false);
    assert.equal(superAccess.hasAccess, true);
  });

  it("keeps juvo_ai trial behavior intact", () => {
    const active = getFeatureAccess(
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
    assert.equal(active.hasAccess, true);
    assert.equal(active.source, "trial");
  });
});

describe("AI usage limits", () => {
  it("uses free interviewer quota of 3 after trial", () => {
    assert.equal(
      getMonthlyLimit("free", ENTITLEMENTS.SMART_JOURNAL_INTERVIEWER),
      3,
    );
    assert.equal(
      getMonthlyLimit("free", ENTITLEMENTS.SMART_JOURNAL_INTERVIEWER, {
        trialActive: true,
      }),
      30,
    );
  });

  it("uses higher pro/super interviewer limits", () => {
    assert.equal(
      getMonthlyLimit("pro", ENTITLEMENTS.SMART_JOURNAL_INTERVIEWER),
      50,
    );
    assert.equal(
      getMonthlyLimit("super", ENTITLEMENTS.SMART_JOURNAL_INTERVIEWER),
      100,
    );
    assert.equal(getMonthlyLimit("pro", ENTITLEMENTS.AI_PERIOD_REVIEW), 8);
    assert.equal(getMonthlyLimit("super", ENTITLEMENTS.AI_PERIOD_REVIEW), 20);
  });

  it("evaluates remaining quota and blocks at zero", () => {
    assert.equal(remainingFromCount(3, 1), 2);
    const open = evaluateUsageGate({ limit: 3, count: 2 });
    assert.equal(open.allowed, true);
    assert.equal(open.remaining, 1);
    const closed = evaluateUsageGate({ limit: 3, count: 3 });
    assert.equal(closed.allowed, false);
    assert.equal(closed.reason, "quota_exceeded");
    const unlimited = evaluateUsageGate({ limit: null, count: 99 });
    assert.equal(unlimited.allowed, true);
    assert.equal(unlimited.remaining, null);
  });
});

describe("sanitizeModelIdentity", () => {
  it("strips common provider and model name leaks", () => {
    assert.match(
      sanitizeModelIdentity("Powered by Gemini 2.5 Flash"),
      /Juvo AI/i,
    );
    assert.doesNotMatch(
      sanitizeModelIdentity("Ask ChatGPT or OpenAI next"),
      /ChatGPT|OpenAI/i,
    );
    assert.equal(
      sanitizeModelIdentity("Keep process focus."),
      "Keep process focus.",
    );
  });
});

describe("plan compliance helpers", () => {
  it("marks followed vs unknown vs violated from evidence", () => {
    const result = buildPlanComplianceChecks({
      plan: {
        maxRiskPerTrade: 1,
        minimumRR: 2,
        maxDailyTrades: 3,
        allowedSessions: ["London"],
      },
      trades: [
        {
          status: "Closed",
          riskPercentage: 0.5,
          plannedRR: 2.5,
          session: "London",
        },
        {
          status: "Closed",
          riskPercentage: 2,
          plannedRR: 1,
          session: "New York",
        },
      ],
      journal: {
        discipline: {
          followedTradingPlan: true,
          followedRiskManagement: false,
        },
      },
    });

    assert.equal(result.counts.total > 0, true);
    assert.ok(result.violated.some((item) => item.label === "max_risk_per_trade"));
    assert.ok(result.followed.some((item) => item.label === "followed_trading_plan"));
    assert.ok(
      result.violated.some((item) => item.label === "followed_risk_management"),
    );
  });

  it("returns unknown when risk data is missing", () => {
    const result = buildPlanComplianceChecks({
      plan: { maxRiskPerTrade: 1 },
      trades: [{ status: "Closed" }],
      journal: { discipline: {} },
    });
    assert.ok(
      result.unknown.some((item) => item.label === "max_risk_per_trade"),
    );
  });
});

describe("interviewer cache hash stability", () => {
  it("keeps the same hash for identical journal payloads", () => {
    const first = interviewerSourcePayload({
      journal: {
        journalDate: "2026-09-01T00:00:00.000Z",
        status: "Completed",
        psychology: { beforeTrading: "Calm" },
        review: { lessonLearned: "Wait" },
        discipline: { followedTradingPlan: true },
        trades: [1, 2],
      },
      trade: null,
      noTradeDay: null,
      entrySnapshot: null,
    });
    const second = interviewerSourcePayload({
      journal: {
        journalDate: "2026-09-01T00:00:00.000Z",
        status: "Completed",
        psychology: { beforeTrading: "Calm" },
        review: { lessonLearned: "Wait" },
        discipline: { followedTradingPlan: true },
        trades: [1, 2],
      },
      trade: null,
      noTradeDay: null,
      entrySnapshot: null,
    });

    assert.equal(stableHash(first), stableHash(second));
  });

  it("changes hash when reflection content changes", () => {
    const a = stableHash(
      interviewerSourcePayload({
        noTradeDay: {
          localDayKey: "2026-09-01",
          reason: "rest_day",
          reflection: "Rest",
        },
      }),
    );
    const b = stableHash(
      interviewerSourcePayload({
        noTradeDay: {
          localDayKey: "2026-09-01",
          reason: "rest_day",
          reflection: "Rest and review",
        },
      }),
    );
    assert.notEqual(a, b);
  });
});
