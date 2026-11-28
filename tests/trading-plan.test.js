import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPlanComplianceChecks,
  computeComplianceScore,
} from "../services/aiFeatures.service.js";
import {
  normalizeSuggestionPayload,
  suggestionFingerprint,
} from "../services/tradingPlan.service.js";
import { validateTradingPlanInput } from "../validations/tradingPlan.validation.js";

describe("trading plan validation", () => {
  it("accepts a partial plan with core risk fields", () => {
    const result = validateTradingPlanInput({
      name: "London Plan",
      tradingAccount: "64b7f1a2c3d4e5f678901234",
      maxRiskPerTrade: 1,
      maxDailyTrades: 3,
      allowedSessions: ["London", "New York"],
    });
    assert.equal(result.isValid, true);
    assert.equal(result.data.name, "London Plan");
    assert.equal(result.data.maxRiskPerTrade, 1);
    assert.deepEqual(result.data.allowedSessions, ["London", "New York"]);
  });

  it("accepts custom rules and commitments", () => {
    const result = validateTradingPlanInput({
      name: "Behaviour Plan",
      tradingAccount: "64b7f1a2c3d4e5f678901234",
      rules: [
        {
          title: "No revenge trading",
          category: "Behaviour",
          kind: "rule",
        },
        {
          title: "Review journal every evening",
          category: "Commitment",
        },
      ],
    });
    assert.equal(result.isValid, true);
    assert.equal(result.data.rules.length, 2);
    assert.equal(result.data.rules[1].kind, "commitment");
  });

  it("rejects invalid sessions", () => {
    const result = validateTradingPlanInput({
      name: "Bad session",
      tradingAccount: "64b7f1a2c3d4e5f678901234",
      allowedSessions: ["Mars"],
    });
    assert.equal(result.isValid, false);
  });
});

describe("plan suggestion normalization", () => {
  it("normalizes AI suggestion payloads", () => {
    const normalized = normalizeSuggestionPayload({
      type: "new_rule",
      category: "Behaviour",
      title: "Cooldown after two losses",
      proposedRule: {
        description: "Take a 30-minute break after two consecutive losses.",
        kind: "rule",
      },
      reason: "User described impatience after losses.",
    });
    assert.equal(normalized.type, "new_rule");
    assert.equal(normalized.proposedRule.title, "Cooldown after two losses");
    assert.ok(suggestionFingerprint(normalized).includes("cooldown"));
  });
});

describe("plan compliance scoring", () => {
  it("scores only followed and violated checks", () => {
    assert.equal(
      computeComplianceScore({ followed: 4, violated: 1 }),
      80,
    );
    assert.equal(computeComplianceScore({ followed: 0, violated: 0 }), null);
  });

  it("keeps behavioural custom rules as needs confirmation", () => {
    const result = buildPlanComplianceChecks({
      plan: {
        maxRiskPerTrade: 1,
        rules: [
          {
            _id: "64b7f1a2c3d4e5f678901234",
            title: "No FOMO entries",
            category: "Behaviour",
            kind: "rule",
            enabled: true,
          },
        ],
      },
      trades: [
        {
          status: "Closed",
          riskPercentage: 0.5,
        },
      ],
      journal: {
        discipline: {
          followedTradingPlan: true,
        },
      },
    });

    assert.ok(
      result.followed.some((item) => item.label === "max_risk_per_trade"),
    );
    assert.ok(
      result.needsConfirmation.some((item) => item.title === "No FOMO entries"),
    );
    assert.equal(result.violated.length === 0, true);
  });

  it("does not treat missing data as a violation", () => {
    const result = buildPlanComplianceChecks({
      plan: { maxRiskPerTrade: 1, minimumRR: 2 },
      trades: [{ status: "Closed" }],
      journal: { discipline: {} },
    });
    assert.ok(result.unknown.some((item) => item.label === "max_risk_per_trade"));
    assert.ok(result.unknown.some((item) => item.label === "minimum_rr"));
    assert.equal(result.violated.length, 0);
  });
});
