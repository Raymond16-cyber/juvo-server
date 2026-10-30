import cron from "node-cron";
import Journal from "../models/Journal.js";
import User from "../models/User.js";
import { localDateKey } from "../services/journalStreak.service.js";
import { getUserTimeZone, getLocalDayBounds } from "../utils/timezone.js";

let scheduledTask = null;
let isRunning = false;

/**
 * Close open journals whose journalDate is before the user's current local day.
 * Runs after local midnight (checked hourly in UTC).
 */
async function autoCloseOpenJournals() {
  if (isRunning) {
    console.log("Journal auto-close already running. Skipping.");
    return;
  }

  isRunning = true;

  try {
    const openJournals = await Journal.find({ status: "Started" })
      .select("_id user journalDate status autoClosedAt")
      .lean();

    if (!openJournals.length) {
      return;
    }

    const userIds = [
      ...new Set(openJournals.map((journal) => String(journal.user))),
    ];
    const users = await User.find({ _id: { $in: userIds } })
      .select("_id profile.timezone")
      .lean();
    const userById = new Map(users.map((user) => [String(user._id), user]));

    let closedCount = 0;
    const now = new Date();

    for (const journal of openJournals) {
      try {
        const user = userById.get(String(journal.user));
        if (!user) continue;

        const timeZone = getUserTimeZone(user);
        const todayKey = localDateKey(now, timeZone);
        const journalDayKey = localDateKey(
          new Date(journal.journalDate),
          timeZone,
        );

        // Keep today's open journal open until the next local midnight.
        if (!journalDayKey || journalDayKey >= todayKey) continue;

        const { startOfDay } = getLocalDayBounds(timeZone, 0, now);
        if (new Date(journal.journalDate) >= startOfDay) continue;

        const result = await Journal.updateOne(
          {
            _id: journal._id,
            user: journal.user,
            status: "Started",
          },
          {
            $set: {
              status: "Completed",
              autoClosedAt: now,
              autoCloseReason: "local_midnight",
            },
          },
        );

        if (result.modifiedCount === 1) {
          closedCount += 1;
        }
      } catch (error) {
        console.error(
          `Failed to auto-close journal ${journal._id}:`,
          error?.message || error,
        );
      }
    }

    if (closedCount > 0) {
      console.log(`Journal auto-close complete. Closed ${closedCount} journal(s).`);
    }
  } catch (error) {
    console.error("Journal auto-close job failed:", error);
  } finally {
    isRunning = false;
  }
}

export function startJournalAutoCloseJob() {
  if (scheduledTask) return;

  scheduledTask = cron.schedule(
    "5 * * * *",
    () => {
      void autoCloseOpenJournals();
    },
    { timezone: "UTC" },
  );

  console.log("Journal auto-close scheduled hourly (local midnight).");
  void autoCloseOpenJournals();
}

export function stopJournalAutoCloseJob() {
  if (!scheduledTask) return;
  scheduledTask.stop();
  scheduledTask = null;
  console.log("Journal auto-close stopped.");
}

export { autoCloseOpenJournals };
