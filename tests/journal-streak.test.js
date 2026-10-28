import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMeaningfulJournal,
  localDateKey,
  presentStreak,
  shiftLocalDateKey,
} from "../services/journalStreak.service.js";

describe("journal streak helpers", () => {
  it("treats empty journals as non-qualifying", () => {
    assert.equal(isMeaningfulJournal({ status: "Started", trades: [] }), false);
    assert.equal(
      isMeaningfulJournal({
        status: "Started",
        psychology: { beforeTrading: "hi" },
      }),
      false,
    );
  });

  it("treats trades, completed reviews, and meaningful notes as qualifying", () => {
    assert.equal(
      isMeaningfulJournal({ status: "Started", trades: [{ _id: "1" }] }),
      true,
    );
    assert.equal(
      isMeaningfulJournal({ status: "Completed", trades: [] }),
      true,
    );
    assert.equal(
      isMeaningfulJournal({
        status: "Started",
        psychology: {
          beforeTrading: "I am calm, focused, and waiting for A+ setups only.",
        },
      }),
      true,
    );
  });

  it("builds local date keys and consecutive day shifts", () => {
    const key = localDateKey(new Date("2026-10-27T15:00:00.000Z"), "UTC");
    assert.equal(key, "2026-10-27");
    assert.equal(shiftLocalDateKey(key, -1, "UTC"), "2026-10-26");
    assert.equal(shiftLocalDateKey(key, 1, "UTC"), "2026-10-28");
  });

  it("presents copy for zero, active, and completed-today states", () => {
    const zero = presentStreak(
      { stats: { currentJournalStreak: 0, longestJournalStreak: 0 } },
      [],
      "UTC",
    );
    assert.equal(zero.headline, "Start your streak");
    assert.match(zero.message, /One meaningful journal entry/i);

    const todayKey = localDateKey(new Date(), "UTC");
    const active = presentStreak(
      {
        stats: {
          currentJournalStreak: 7,
          longestJournalStreak: 12,
          lastQualifyingJournalDayKey: "1999-01-01",
        },
      },
      [{ date: todayKey, completed: false, isToday: true }],
      "UTC",
    );
    assert.equal(active.headline, "7-day streak");
    assert.match(active.message, /no-trade day|habit going/i);

    const done = presentStreak(
      {
        stats: {
          currentJournalStreak: 8,
          longestJournalStreak: 12,
          lastQualifyingJournalDayKey: todayKey,
        },
      },
      [{ date: todayKey, completed: true, isToday: true }],
      "UTC",
    );
    assert.equal(done.todayCompleted, true);
    assert.match(done.message, /complete/i);
  });
});
