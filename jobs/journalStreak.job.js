import cron from "node-cron";
import User from "../models/User.js";
import {
  localDateKey,
  shiftLocalDateKey,
} from "../services/journalStreak.service.js";
import { getUserTimeZone } from "../utils/timezone.js";

let scheduledTask = null;
let isRunning = false;

async function checkExpiredJournalStreaks() {
  if (isRunning) {
    console.log("Journal streak check already running. Skipping.");
    return;
  }

  isRunning = true;

  try {
    const users = await User.find({
      "stats.currentJournalStreak": { $gt: 0 },
    })
      .select(
        "_id profile.timezone stats.currentJournalStreak stats.lastQualifyingJournalDayKey",
      )
      .lean();

    let resetCount = 0;
    const now = new Date();

    for (const user of users) {
      try {
        const timeZone = getUserTimeZone(user);
        const todayKey = localDateKey(now, timeZone);
        const yesterdayKey = shiftLocalDateKey(todayKey, -1, timeZone);
        const lastKey = user.stats?.lastQualifyingJournalDayKey || null;

        // Still active if they journaled today or yesterday.
        if (lastKey && (lastKey === todayKey || lastKey === yesterdayKey)) {
          continue;
        }

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
          resetCount += 1;
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
  if (scheduledTask) return;

  scheduledTask = cron.schedule(
    "0 * * * *",
    () => {
      void checkExpiredJournalStreaks();
    },
    { timezone: "UTC" },
  );

  console.log("Journal streak checker scheduled hourly.");
  void checkExpiredJournalStreaks();
}

export function stopJournalStreakJob() {
  if (!scheduledTask) return;

  scheduledTask.stop();
  scheduledTask = null;
  console.log("Journal streak checker stopped.");
}

export { checkExpiredJournalStreaks };
