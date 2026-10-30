import Journal from "../models/Journal.js";
import NoTradeDay, { NO_TRADE_REASONS } from "../models/NoTradeDay.js";
import User from "../models/User.js";
import { syncAchievementsAfterActivity } from "./achievements/achievement.service.js";
import {
  getJournalStreakService,
  localDateKey,
  recordQualifyingJournalActivity,
} from "./journalStreak.service.js";
import { getLocalDayBounds, getUserTimeZone } from "../utils/timezone.js";

function isActiveNoTradeLock(entry) {
  if (!entry) return false;
  if (!entry.confirmed) return false;
  if (entry.liftedAt) return false;
  if (entry.supersededByTrade) return false;
  return true;
}

function presentNoTradeDay(doc) {
  if (!doc) return null;
  const plain = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  const presented = {
    _id: String(plain._id),
    localDayKey: plain.localDayKey,
    timezone: plain.timezone,
    confirmed: Boolean(plain.confirmed),
    reason: plain.reason || null,
    reflection: plain.reflection || "",
    recordedAt: plain.recordedAt,
    supersededByTrade: Boolean(plain.supersededByTrade),
    supersededAt: plain.supersededAt || null,
    liftedAt: plain.liftedAt || null,
    liftNote: plain.liftNote || "",
    journal: plain.journal ? String(plain.journal) : null,
    tradingAccount: plain.tradingAccount ? String(plain.tradingAccount) : null,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
  presented.isActive = isActiveNoTradeLock(presented);
  return presented;
}

function validateNoTradePayload(payload = {}, { requireConfirmation = true } = {}) {
  const errors = [];
  const confirmed =
    payload.confirmed === undefined ? undefined : Boolean(payload.confirmed);
  const reasonRaw =
    payload.reason === undefined || payload.reason === null || payload.reason === ""
      ? null
      : String(payload.reason).trim();
  const reflection = String(payload.reflection || "").trim().slice(0, 4000);
  const tradingAccount = String(payload.tradingAccount || "").trim() || null;

  if (requireConfirmation && confirmed !== true) {
    errors.push('Confirm that you did not place any trades today.');
  }
  if (reasonRaw && !NO_TRADE_REASONS.includes(reasonRaw)) {
    errors.push("Choose a valid no-trade reason.");
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      confirmed: confirmed === true,
      reason: reasonRaw,
      reflection,
      tradingAccount,
    },
  };
}

async function getTodayNoTradeDayService(userId) {
  const user = await User.findById(userId).select("profile.timezone").lean();
  if (!user) {
    return { success: false, statusCode: 404, message: "User not found." };
  }

  const timeZone = getUserTimeZone(user);
  const dayKey = localDateKey(new Date(), timeZone);
  const entry = await NoTradeDay.findOne({ user: userId, localDayKey: dayKey }).lean();

  return {
    success: true,
    data: {
      localDayKey: dayKey,
      timezone: timeZone,
      entry: presentNoTradeDay(entry),
    },
  };
}

async function upsertNoTradeDayService(userId, payload = {}) {
  const user = await User.findById(userId).select("profile.timezone").lean();
  if (!user) {
    return { success: false, statusCode: 404, message: "User not found." };
  }

  const existingLookup = await getTodayNoTradeDayService(userId);
  const existing = existingLookup.data?.entry || null;
  const isEdit = Boolean(existing);

  const validation = validateNoTradePayload(payload, {
    requireConfirmation: !isEdit,
  });
  if (!validation.isValid) {
    return {
      success: false,
      statusCode: 400,
      message: validation.errors.join(" "),
    };
  }

  const timeZone = getUserTimeZone(user);
  const now = new Date();
  const dayKey = localDateKey(now, timeZone);

  // Optional link to today's journal if one already exists.
  const { startOfDay, endOfDay } = getLocalDayBounds(timeZone, 0, now);
  const journal = await Journal.findOne({
    user: userId,
    journalDate: { $gte: startOfDay, $lte: endOfDay },
  })
    .select("_id tradingAccount trades")
    .lean();

  const tradeCount = Array.isArray(journal?.trades) ? journal.trades.length : 0;
  if (tradeCount > 0 && !isActiveNoTradeLock(existing)) {
    return {
      success: false,
      statusCode: 400,
      message:
        "Trades are already logged for today. A no-trade day can only be recorded on a day without trades.",
    };
  }

  let entry;
  let created = false;

  if (existing) {
    // Re-confirming an active or previously lifted day re-locks trades.
    entry = await NoTradeDay.findOneAndUpdate(
      { _id: existing._id, user: userId },
      {
        $set: {
          reason: validation.data.reason,
          reflection: validation.data.reflection,
          confirmed: true,
          liftedAt: null,
          liftNote: "",
          supersededByTrade: false,
          supersededAt: null,
          ...(validation.data.tradingAccount
            ? { tradingAccount: validation.data.tradingAccount }
            : {}),
          ...(journal?._id ? { journal: journal._id } : {}),
        },
      },
      { new: true },
    );
  } else {
    try {
      entry = await NoTradeDay.create({
        user: userId,
        localDayKey: dayKey,
        timezone: timeZone,
        confirmed: true,
        ...(validation.data.reason ? { reason: validation.data.reason } : {}),
        reflection: validation.data.reflection,
        recordedAt: now,
        tradingAccount:
          validation.data.tradingAccount || journal?.tradingAccount || null,
        journal: journal?._id || null,
      });
      created = true;
    } catch (error) {
      if (error?.code === 11000) {
        const duplicate = await NoTradeDay.findOne({
          user: userId,
          localDayKey: dayKey,
        });
        entry = await NoTradeDay.findOneAndUpdate(
          { _id: duplicate._id, user: userId },
          {
            $set: {
              reason: validation.data.reason,
              reflection: validation.data.reflection,
              confirmed: true,
            },
          },
          { new: true },
        );
        created = false;
      } else {
        throw error;
      }
    }
  }

  // Award streak only once per day; edits reuse existing credit.
  let newlyEarned = [];
  if (created) {
    await recordQualifyingJournalActivity(userId, now);
    newlyEarned = (await syncAchievementsAfterActivity(userId)).newlyEarned;
  }

  const streak = await getJournalStreakService(userId);

  return {
    success: true,
    created,
    newlyEarned,
    data: {
      entry: presentNoTradeDay(entry),
      streak: streak.success ? streak.data : null,
      message: created
        ? "No-trade day recorded. Your journaling streak is up to date."
        : "No-trade day updated.",
    },
  };
}

async function markNoTradeDaySupersededByTrade(userId, activityAt = new Date()) {
  try {
    const user = await User.findById(userId).select("profile.timezone").lean();
    if (!user) return null;
    const timeZone = getUserTimeZone(user);
    const dayKey = localDateKey(activityAt, timeZone);

    // Only mark superseded when the lock was already lifted (or never active).
    return NoTradeDay.findOneAndUpdate(
      {
        user: userId,
        localDayKey: dayKey,
        supersededByTrade: { $ne: true },
        liftedAt: { $ne: null },
      },
      {
        $set: {
          supersededByTrade: true,
          supersededAt: activityAt,
        },
      },
      { new: true },
    );
  } catch (error) {
    console.error(
      "Failed to mark no-trade day superseded:",
      error?.message || error,
    );
    return null;
  }
}

async function getActiveNoTradeLockForDay(userId, activityAt = new Date()) {
  const user = await User.findById(userId).select("profile.timezone").lean();
  if (!user) return null;
  const timeZone = getUserTimeZone(user);
  const dayKey = localDateKey(activityAt, timeZone);
  const entry = await NoTradeDay.findOne({ user: userId, localDayKey: dayKey }).lean();
  const presented = presentNoTradeDay(entry);
  return presented && isActiveNoTradeLock(presented) ? presented : null;
}

async function liftNoTradeDayService(userId, payload = {}) {
  const user = await User.findById(userId).select("profile.timezone").lean();
  if (!user) {
    return { success: false, statusCode: 404, message: "User not found." };
  }

  const timeZone = getUserTimeZone(user);
  const now = new Date();
  const dayKey = localDateKey(now, timeZone);
  const liftNote = String(payload.liftNote || payload.note || "")
    .trim()
    .slice(0, 500);

  const entry = await NoTradeDay.findOne({ user: userId, localDayKey: dayKey });
  if (!entry) {
    return {
      success: false,
      statusCode: 404,
      message: "No no-trade day is recorded for today.",
    };
  }

  if (!isActiveNoTradeLock(entry)) {
    return {
      success: true,
      data: {
        entry: presentNoTradeDay(entry),
        message: "No-trade lock is already inactive.",
      },
    };
  }

  entry.liftedAt = now;
  entry.liftNote = liftNote;
  await entry.save();

  return {
    success: true,
    data: {
      entry: presentNoTradeDay(entry),
      message:
        "No-trade day lifted. You can log trades for today. Reflection stays in your record.",
    },
  };
}

export {
  NO_TRADE_REASONS,
  getActiveNoTradeLockForDay,
  getTodayNoTradeDayService,
  isActiveNoTradeLock,
  liftNoTradeDayService,
  markNoTradeDaySupersededByTrade,
  presentNoTradeDay,
  upsertNoTradeDayService,
  validateNoTradePayload,
};
