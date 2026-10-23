import cron from "node-cron";
import Journal from "../models/Journal.js";
import User from "../models/User.js";
import { getLocalDayBounds, getUserTimeZone } from "../utils/timezone.js";

let scheduledTask = null;
let isRunning = false;

async function checkExpiredJournalStreaks() {
  // Prevent two checks from running simultaneously.
  if (isRunning) {
    console.log("Journal streak check already running. Skipping.");
    return;
  }

  isRunning = true;

  try {
    // Only inspect users who currently have a streak.
    const users = await User.find({
      "stats.currentJournalStreak": { $gt: 0 },
    })
      .select("_id profile.timezone stats.currentJournalStreak")
      .lean();

    let resetCount = 0;

    for (const user of users) {
      try {
        const timeZone = getUserTimeZone(user);

        // Get the beginning of yesterday in this user's timezone.
        const { startOfDay: yesterdayStart } = getLocalDayBounds(timeZone, -1);

        // Find this user's most recent journal.
        const latestJournal = await Journal.findOne({
          user: user._id,
        })
          .select("journalDate")
          .sort({ journalDate: -1 })
          .lean();

        const latestJournalDate = latestJournal?.journalDate
          ? new Date(latestJournal.journalDate)
          : null;

        // A journal yesterday or today means the streak
        // has not expired yet.
        if (latestJournalDate && latestJournalDate >= yesterdayStart) {
          continue;
        }

        // Recheck before resetting, in case a journal was
        // created while this user's check was running.
        const latestJournalBeforeReset = await Journal.findOne({
          user: user._id,
        })
          .select("journalDate")
          .sort({ journalDate: -1 })
          .lean();

        const latestDateBeforeReset = latestJournalBeforeReset?.journalDate
          ? new Date(latestJournalBeforeReset.journalDate)
          : null;

        if (latestDateBeforeReset && latestDateBeforeReset >= yesterdayStart) {
          continue;
        }

        // Reset only the current streak.
        // Preserve the user's longest streak.
        const result = await User.updateOne(
          {
            _id: user._id,
            "stats.currentJournalStreak": user.stats.currentJournalStreak,
          },
          {
            $set: {
              "stats.currentJournalStreak": 0,
            },
          },
        );

        if (result.modifiedCount === 1) {
          resetCount++;
        }
      } catch (error) {
        console.error(
          `Failed to check journal streak for user ${user._id}:`,
          error,
        );
      }
    }

    console.log(
      `Journal streak check complete. Reset ${resetCount} streak(s).`,
    );
  } catch (error) {
    console.error("Journal streak checker failed:", error);
  } finally {
    isRunning = false;
  }
}

export function startJournalStreakJob() {
  // Prevent accidental duplicate scheduling.
  if (scheduledTask) return;

  // Run at the start of every hour.
  scheduledTask = cron.schedule(
    "0 * * * *",
    () => {
      void checkExpiredJournalStreaks();
    },
    { timezone: "UTC" },
  );

  console.log("Journal streak checker scheduled hourly.");

  // Also check immediately when the backend starts.
  void checkExpiredJournalStreaks();
}

export function stopJournalStreakJob() {
  if (!scheduledTask) return;

  scheduledTask.stop();
  scheduledTask = null;

  console.log("Journal streak checker stopped.");
}
