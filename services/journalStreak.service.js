import Journal from "../models/Journal.js";
import NoTradeDay from "../models/NoTradeDay.js";
import User from "../models/User.js";
import {
  getLocalDayBounds,
  getUserTimeZone,
  getZonedDateParts,
  zonedTimeToUtc,
} from "../utils/timezone.js";

const MIN_NOTE_CHARS = 20;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function localDateKey(date, timeZone) {
  const parts = getZonedDateParts(date, timeZone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function shiftLocalDateKey(dayKey, dayOffset, timeZone) {
  const [year, month, day] = String(dayKey)
    .split("-")
    .map((part) => Number(part));
  if (![year, month, day].every(Number.isFinite)) return null;

  const anchor = zonedTimeToUtc(
    {
      year,
      month,
      day,
      hour: 12,
      minute: 0,
      second: 0,
      millisecond: 0,
    },
    timeZone,
  );
  const shifted = getLocalDayBounds(timeZone, dayOffset, anchor);
  return localDateKey(shifted.startOfDay, timeZone);
}

function textLength(...values) {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ").length;
}

function isMeaningfulJournal(journal) {
  if (!journal) return false;

  const tradeCount = Array.isArray(journal.trades)
    ? journal.trades.length
    : Number(journal.tradesCount || 0);
  if (tradeCount > 0) return true;

  if (journal.status === "Completed") return true;

  const psychology = journal.psychology || {};
  const review = journal.review || {};
  return (
    textLength(
      psychology.beforeTrading,
      psychology.afterTrading,
      review.lessonLearned,
      review.overallThoughts,
      review.biggestMistake,
      review.biggestWin,
      review.improvementsTomorrow,
    ) >= MIN_NOTE_CHARS
  );
}

function presentStreak(user, week = [], timeZone = "UTC") {
  const currentStreak = Number(user?.stats?.currentJournalStreak || 0);
  const longestStreak = Number(user?.stats?.longestJournalStreak || 0);
  const todayKey = localDateKey(new Date(), timeZone);
  const todayCompleted = Boolean(
    user?.stats?.lastQualifyingJournalDayKey === todayKey ||
      week.find((day) => day.date === todayKey)?.completed,
  );

  let headline = "Start your streak";
  let message = "One meaningful journal entry is all it takes.";

  if (currentStreak > 0 && todayCompleted) {
    headline = `${currentStreak}-day streak`;
    message = "Today's journaling is complete.";
  } else if (currentStreak > 0) {
    headline = `${currentStreak}-day streak`;
    message = "Log a trade or record a no-trade day to keep the habit going.";
  }

  return {
    currentStreak,
    longestStreak,
    todayCompleted,
    todayKey,
    lastQualifyingJournalDayKey: user?.stats?.lastQualifyingJournalDayKey || null,
    lastQualifyingJournalAt: user?.stats?.lastQualifyingJournalAt || null,
    week,
    headline,
    message,
  };
}

async function buildWeekActivity(userId, timeZone) {
  const todayKey = localDateKey(new Date(), timeZone);
  const weekStartBounds = getLocalDayBounds(timeZone, -6);
  const weekKeys = [];
  for (let offset = -6; offset <= 0; offset += 1) {
    const bounds = getLocalDayBounds(timeZone, offset);
    weekKeys.push(localDateKey(bounds.startOfDay, timeZone));
  }

  const [journals, noTradeDays] = await Promise.all([
    Journal.find({
      user: userId,
      $or: [
        { createdAt: { $gte: weekStartBounds.startOfDay } },
        { updatedAt: { $gte: weekStartBounds.startOfDay } },
        { journalDate: { $gte: weekStartBounds.startOfDay } },
      ],
    })
      .select("status psychology review trades createdAt updatedAt journalDate")
      .lean(),
    NoTradeDay.find({
      user: userId,
      localDayKey: { $in: weekKeys },
    })
      .select("localDayKey recordedAt")
      .lean(),
  ]);

  const completedKeys = new Set();
  for (const journal of journals) {
    if (!isMeaningfulJournal(journal)) continue;
    // Prefer the real activity timestamp so backdated journalDate cannot invent days.
    const activityAt =
      journal.updatedAt || journal.createdAt || journal.journalDate || new Date();
    completedKeys.add(localDateKey(new Date(activityAt), timeZone));
  }
  for (const entry of noTradeDays) {
    if (entry?.localDayKey) completedKeys.add(entry.localDayKey);
  }

  return weekKeys.map((date) => ({
    date,
    completed: completedKeys.has(date),
    isToday: date === todayKey,
  }));
}

async function getJournalStreakService(userId) {
  const user = await User.findById(userId)
    .select(
      "profile.timezone stats.currentJournalStreak stats.longestJournalStreak stats.lastQualifyingJournalDayKey stats.lastQualifyingJournalAt",
    )
    .lean();

  if (!user) {
    return {
      success: false,
      statusCode: 404,
      message: "User not found.",
    };
  }

  const timeZone = getUserTimeZone(user);
  const week = await buildWeekActivity(userId, timeZone);
  return {
    success: true,
    data: presentStreak(user, week, timeZone),
  };
}

async function recordQualifyingJournalActivity(
  userId,
  activityAt = new Date(),
) {
  try {
    const user = await User.findById(userId)
      .select(
        "profile.timezone stats.currentJournalStreak stats.longestJournalStreak stats.lastQualifyingJournalDayKey",
      )
      .lean();

    if (!user) {
      return { awarded: false, reason: "missing_user" };
    }

    const timeZone = getUserTimeZone(user);
    const dayKey = localDateKey(activityAt, timeZone);
    const lastKey = user.stats?.lastQualifyingJournalDayKey || null;

    if (lastKey === dayKey) {
      return {
        awarded: false,
        reason: "already_credited",
        data: presentStreak(user, [], timeZone),
      };
    }

    const yesterdayKey = shiftLocalDateKey(dayKey, -1, timeZone);
    const nextStreak =
      lastKey && yesterdayKey && lastKey === yesterdayKey
        ? Number(user.stats?.currentJournalStreak || 0) + 1
        : 1;

    const updated = await User.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { "stats.lastQualifyingJournalDayKey": { $exists: false } },
          { "stats.lastQualifyingJournalDayKey": null },
          { "stats.lastQualifyingJournalDayKey": { $ne: dayKey } },
        ],
      },
      {
        $set: {
          "stats.currentJournalStreak": nextStreak,
          "stats.lastQualifyingJournalDayKey": dayKey,
          "stats.lastQualifyingJournalAt": activityAt,
        },
        $max: {
          "stats.longestJournalStreak": nextStreak,
        },
      },
      {
        new: true,
        select:
          "profile.timezone stats.currentJournalStreak stats.longestJournalStreak stats.lastQualifyingJournalDayKey stats.lastQualifyingJournalAt",
      },
    );

    if (!updated) {
      const latest = await User.findById(userId)
        .select(
          "profile.timezone stats.currentJournalStreak stats.longestJournalStreak stats.lastQualifyingJournalDayKey stats.lastQualifyingJournalAt",
        )
        .lean();
      return {
        awarded: false,
        reason: "race_lost",
        data: presentStreak(latest, [], getUserTimeZone(latest)),
      };
    }

    return {
      awarded: true,
      data: presentStreak(updated, [], getUserTimeZone(updated)),
    };
  } catch (error) {
    console.error("Journal streak award failed:", error?.message || error);
    return { awarded: false, reason: "error" };
  }
}

export {
  MIN_NOTE_CHARS,
  getJournalStreakService,
  isMeaningfulJournal,
  localDateKey,
  presentStreak,
  recordQualifyingJournalActivity,
  shiftLocalDateKey,
};
