import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accountAgeDays,
  collectQualifyingDayKeys,
  evaluateDefinition,
} from "../services/achievements/achievement.service.js";
import {
  ACHIEVEMENTS,
  getAchievementDefinition,
  listAchievementDefinitions,
} from "../services/achievements/achievementCatalog.js";

describe("achievement catalog", () => {
  it("exposes a focused set of meaningful achievements", () => {
    const definitions = listAchievementDefinitions();
    assert.ok(definitions.length >= 14);
    assert.ok(definitions.length <= 20);
    assert.equal(definitions.length, ACHIEVEMENTS.length);

    const ids = new Set(definitions.map((item) => item.id));
    assert.equal(ids.size, definitions.length);

    for (const required of [
      "journey_7_days",
      "journey_30_days",
      "journey_100_days",
      "journey_365_days",
      "first_journal",
      "consistent_recorder",
      "journal_builder",
      "journal_archivist",
      "reflective_trader",
      "long_term_learner",
      "no_trade_wisdom",
      "streak_7",
      "streak_30",
      "plan_reviewer",
      "risk_guardian",
      "plan_adherent_90",
    ]) {
      assert.ok(getAchievementDefinition(required), `missing ${required}`);
    }
  });
});

describe("account age milestones", () => {
  it("measures elapsed account age, not activity streaks", () => {
    const created = new Date("2026-01-01T00:00:00.000Z");
    assert.equal(accountAgeDays(created, new Date("2026-01-01T12:00:00.000Z")), 0);
    assert.equal(accountAgeDays(created, new Date("2026-01-08T00:00:00.000Z")), 7);
    assert.equal(accountAgeDays(created, new Date("2026-01-31T00:00:00.000Z")), 30);
    assert.equal(accountAgeDays(created, new Date("2026-04-11T00:00:00.000Z")), 100);
    assert.equal(accountAgeDays(created, new Date("2027-01-01T00:00:00.000Z")), 365);
  });

  it("unlocks the 100-day journey badge without a 100-day streak", () => {
    const definition = getAchievementDefinition("journey_100_days");
    const evaluation = evaluateDefinition(definition, {
      account_age_days: 100,
      longest_streak: 3,
      qualifying_days: 12,
    });
    assert.equal(evaluation.unlocked, true);
    assert.equal(evaluation.current, 100);

    const streak30 = evaluateDefinition(getAchievementDefinition("streak_30"), {
      longest_streak: 3,
    });
    assert.equal(streak30.unlocked, false);
  });
});

describe("journaling qualification helpers", () => {
  it("counts distinct qualifying days and ignores empty shells", () => {
    const journals = [
      {
        status: "Started",
        trades: [],
        psychology: { beforeTrading: "hi" },
        createdAt: new Date("2026-10-01T10:00:00.000Z"),
      },
      {
        status: "Started",
        trades: [{ _id: "1" }],
        createdAt: new Date("2026-10-01T18:00:00.000Z"),
        updatedAt: new Date("2026-10-01T18:00:00.000Z"),
      },
      {
        status: "Completed",
        trades: [],
        createdAt: new Date("2026-10-02T12:00:00.000Z"),
        updatedAt: new Date("2026-10-02T12:00:00.000Z"),
      },
    ];
    const noTradeDays = [
      { localDayKey: "2026-10-03" },
      { localDayKey: "2026-10-01", supersededByTrade: true },
    ];

    const keys = collectQualifyingDayKeys(journals, noTradeDays, "UTC");
    assert.equal(keys.has("2026-10-01"), true);
    assert.equal(keys.has("2026-10-02"), true);
    assert.equal(keys.has("2026-10-03"), true);
    assert.equal(keys.size, 3);
  });

  it("keeps cumulative days separate from consecutive streaks", () => {
    const cumulative = evaluateDefinition(
      getAchievementDefinition("consistent_recorder"),
      { qualifying_days: 7, longest_streak: 2 },
    );
    const streak = evaluateDefinition(getAchievementDefinition("streak_7"), {
      qualifying_days: 7,
      longest_streak: 2,
    });
    assert.equal(cumulative.unlocked, true);
    assert.equal(streak.unlocked, false);
  });

  it("requires a minimum sample for plan adherence percentage", () => {
    const definition = getAchievementDefinition("plan_adherent_90");
    const early = evaluateDefinition(definition, {
      plan_adherence_pct: 100,
      plan_adherence_sample: 1,
    });
    assert.equal(early.unlocked, false);

    const ready = evaluateDefinition(definition, {
      plan_adherence_pct: 90,
      plan_adherence_sample: 20,
    });
    assert.equal(ready.unlocked, true);

    const almost = evaluateDefinition(definition, {
      plan_adherence_pct: 89,
      plan_adherence_sample: 20,
    });
    assert.equal(almost.unlocked, false);
  });
});
