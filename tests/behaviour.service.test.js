import assert from "node:assert/strict";
import mongoose from "mongoose";
import { after, describe, it } from "node:test";
import {
  buildBehaviourReports,
  detectBehaviourFlags,
  seedChallengeProgress,
} from "../services/behaviour.service.js";

after(async () => {
  await mongoose.disconnect().catch(() => undefined);
});

function buildUser(challenges = ["revenge_trading", "overtrading", "poor_risk_management"]) {
  return {
    profile: {
      biggestChallenges: challenges,
      tradingStyle: "day_trading",
      challengeProgress: challenges.map((challenge) => ({
        challenge,
        status: "active",
        flagCount: 0,
        confirmedCount: 0,
        lastFlaggedAt: null,
        streakWithoutFlag: 0,
      })),
    },
  };
}

describe("seedChallengeProgress", () => {
  it("adds active entries for newly selected challenges and pauses removed ones", () => {
    const user = buildUser(["revenge_trading"]);
    const next = seedChallengeProgress(user, [
      "revenge_trading",
      "overtrading",
    ]);

    assert.equal(next.length, 2);
    assert.equal(
      next.find((item) => item.challenge === "overtrading")?.status,
      "active",
    );

    const paused = seedChallengeProgress(
      { profile: { biggestChallenges: ["revenge_trading"], challengeProgress: next } },
      ["overtrading"],
    );
    assert.equal(
      paused.find((item) => item.challenge === "revenge_trading")?.status,
      "paused",
    );
    assert.equal(
      paused.find((item) => item.challenge === "overtrading")?.status,
      "active",
    );
  });
});

describe("detectBehaviourFlags", () => {
  it("flags revenge trading soon after a loss", () => {
    const now = Date.now();
    const flags = detectBehaviourFlags({
      user: buildUser(["revenge_trading"]),
      journal: { _id: "j1", trades: ["t1", "t2"] },
      trade: {
        _id: "t2",
        lotSize: 1,
        openedAt: new Date(now),
        createdAt: new Date(now),
      },
      recentTrades: [
        {
          _id: "t1",
          journal: "j1",
          status: "Closed",
          profitLoss: -40,
          lotSize: 0.5,
          closedAt: new Date(now - 5 * 60 * 1000),
        },
        {
          _id: "t2",
          journal: "j1",
          status: "Open",
          lotSize: 1,
          openedAt: new Date(now),
          createdAt: new Date(now),
        },
      ],
      event: "trade_open",
    });

    assert.equal(flags.some((flag) => flag.challenge === "revenge_trading"), true);
    assert.ok(flags[0].confidence >= 0.7);
  });

  it("flags overtrading above style threshold", () => {
    const trades = Array.from({ length: 6 }, (_, index) => ({
      _id: `t${index}`,
      journal: "j1",
      status: "Closed",
      openedAt: new Date(),
      createdAt: new Date(),
    }));

    const flags = detectBehaviourFlags({
      user: buildUser(["overtrading"]),
      journal: { _id: "j1", trades: trades.map((trade) => trade._id) },
      trade: trades[5],
      recentTrades: trades,
      event: "trade_open",
    });

    assert.equal(flags.some((flag) => flag.challenge === "overtrading"), true);
  });

  it("flags poor risk management above hard cap", () => {
    const flags = detectBehaviourFlags({
      user: buildUser(["poor_risk_management"]),
      journal: { _id: "j1", trades: ["t1"] },
      trade: {
        _id: "t1",
        riskPercentage: 4,
        openedAt: new Date(),
        createdAt: new Date(),
      },
      recentTrades: [],
      event: "trade_open",
    });

    it("does not interpret missing broker risk data as poor risk management", () => {
      const flags = detectBehaviourFlags({
        user: buildUser(["poor_risk_management"]),
        journal: { _id: "j1", trades: ["t1"] },
        trade: { _id: "t1", openedAt: new Date(), createdAt: new Date() },
        recentTrades: [],
        event: "trade_open",
      });

      assert.equal(flags.length, 0);
    });

    assert.equal(
      flags.some((flag) => flag.challenge === "poor_risk_management"),
      true,
    );
    assert.ok(flags[0].confidence >= 0.9);
  });

  it("only flags challenges selected in onboarding", () => {
    const flags = detectBehaviourFlags({
      user: buildUser(["fomo"]),
      journal: { _id: "j1", trades: ["t1"] },
      trade: {
        _id: "t1",
        riskPercentage: 5,
        openedAt: new Date(),
        createdAt: new Date(),
      },
      recentTrades: [],
      event: "trade_open",
    });

    assert.equal(flags.length, 0);
  });

  it("maps journal discipline answers into challenge suggestions", () => {
    const flags = detectBehaviourFlags({
      user: buildUser([
        "revenge_trading",
        "lack_of_discipline",
        "emotional_trading",
      ]),
      journal: {
        _id: "j1",
        discipline: {
          revengeTraded: true,
          followedTradingPlan: false,
          respectedStopLoss: false,
        },
        psychology: { confidenceAfter: 3 },
      },
      event: "journal_complete",
    });

    const challenges = flags.map((flag) => flag.challenge);
    assert.ok(challenges.includes("revenge_trading"));
    assert.ok(challenges.includes("lack_of_discipline"));
    assert.ok(challenges.includes("emotional_trading"));
  });

  it("uses lower confidence for inferred impatience without treating trade bursts as FOMO", () => {
    const now = Date.now();
    const recentTrades = [
      {
        _id: "t1",
        journal: "j1",
        status: "Closed",
        openedAt: new Date(now - 4 * 60 * 1000),
        closedAt: new Date(now - 3 * 60 * 1000),
        createdAt: new Date(now - 4 * 60 * 1000),
      },
      {
        _id: "t2",
        journal: "j1",
        status: "Closed",
        openedAt: new Date(now - 2 * 60 * 1000),
        closedAt: new Date(now - 90 * 1000),
        createdAt: new Date(now - 2 * 60 * 1000),
      },
      {
        _id: "t3",
        journal: "j1",
        status: "Open",
        openedAt: new Date(now),
        createdAt: new Date(now),
      },
    ];

    const flags = detectBehaviourFlags({
      user: buildUser(["fomo", "impatience"]),
      journal: { _id: "j1", trades: ["t1", "t2", "t3"] },
      trade: recentTrades[2],
      recentTrades,
      event: "trade_open",
    });

    const impatience = flags.find((flag) => flag.challenge === "impatience");
    assert.equal(flags.some((flag) => flag.challenge === "fomo"), false);
    assert.ok(impatience);
    assert.ok(impatience.confidence <= 0.5);
  });

  it("only identifies FOMO from an explicit journal reflection", () => {
    const flags = detectBehaviourFlags({
      user: buildUser(["fomo"]),
      journal: {
        _id: "j1",
        journalDate: new Date(),
        psychology: { afterTrading: "I entered because I feared missing the move." },
      },
      event: "journal_complete",
    });

    assert.equal(flags.length, 1);
    assert.equal(flags[0].challenge, "fomo");
    assert.equal(flags[0].source, "manual");
    assert.equal(flags[0].evidence.kind, "journal_self_report");
  });

  it("identifies post-win risk escalation only with a recorded baseline", () => {
    const now = Date.now();
    const flags = detectBehaviourFlags({
      user: buildUser(["overconfidence"]),
      journal: { _id: "j1", trades: ["t1", "t2", "t3"] },
      trade: {
        _id: "t3",
        riskPercentage: 2,
        openedAt: new Date(now),
        createdAt: new Date(now),
      },
      recentTrades: [
        {
          _id: "t1",
          status: "Closed",
          profitLoss: 10,
          riskPercentage: 1,
          closedAt: new Date(now - 30 * 60 * 1000),
        },
        {
          _id: "t2",
          status: "Closed",
          profitLoss: 12,
          riskPercentage: 1,
          closedAt: new Date(now - 15 * 60 * 1000),
        },
        {
          _id: "t3",
          status: "Open",
          riskPercentage: 2,
          openedAt: new Date(now),
          createdAt: new Date(now),
        },
      ],
      event: "trade_open",
    });

    const observation = flags.find((flag) => flag.challenge === "overconfidence");
    assert.ok(observation);
    assert.equal(observation.evidence.metrics.consecutiveWins, 2);
    assert.equal(observation.evidence.metrics.recentMedianRiskPercentage, 1);
  });
});

describe("buildBehaviourReports", () => {
  it("reports no data instead of implying a clean behavioural record", () => {
    const now = new Date("2026-11-25T00:00:00.000Z");
    const report = buildBehaviourReports({
      challenges: ["fomo"],
      tradeRows: [],
      journalRows: [],
      now,
    });

    assert.equal(report.dataAvailability.sufficientForComparison, false);
    assert.match(report.dataAvailability.message, /not enough trading or journal history/);
    assert.equal(report.observations[0].occurrences, 0);
    assert.equal(report.observations[0].trend, "unchanged");
    assert.match(report.observations[0].interpretation, /not a diagnosis/);
  });

  it("compares confirmed observations without treating fewer reports as improvement", () => {
    const now = new Date("2026-11-25T00:00:00.000Z");
    const tradeRows = [
      {
        symbol: "EURUSD",
        direction: "long",
        status: "Closed",
        profitLoss: -12,
        profitLossCurrency: "USD",
        openedAt: new Date("2026-11-05T12:00:00.000Z"),
        behaviourFlags: [
          {
            challenge: "revenge_trading",
            confirmed: true,
            confidence: 0.8,
            createdAt: new Date("2026-11-05T12:00:00.000Z"),
            evidence: {
              description: "Opened shortly after a recorded loss.",
            },
          },
        ],
      },
      {
        symbol: "GBPUSD",
        direction: "short",
        status: "Closed",
        openedAt: new Date("2026-10-10T12:00:00.000Z"),
        behaviourFlags: [
          {
            challenge: "revenge_trading",
            confirmed: true,
            confidence: 0.6,
            createdAt: new Date("2026-10-10T12:00:00.000Z"),
          },
        ],
      },
    ];
    const report = buildBehaviourReports({
      challenges: ["revenge_trading"],
      tradeRows,
      journalRows: [],
      now,
    });

    assert.equal(report.observations[0].occurrences, 1);
    assert.equal(report.observations[0].comparisonOccurrences, 1);
    assert.equal(report.observations[0].trend, "unchanged");
    assert.equal(report.observations[0].evidence[0].associatedOutcome.amount, -12);
    assert.match(report.observations[0].interpretation, /Fewer reports can also mean less data/);
  });
});
