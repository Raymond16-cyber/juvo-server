import {
  createJournalService,
  createJournalTradeService,
  getTodayJournalStatusService,
  getUserJournalsService,
} from "../services/journal.service.js";

function getZonedDateParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function zonedTimeToUtc({ year, month, day, hour, minute, second, millisecond }, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(utcGuess))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    millisecond,
  );

  return new Date(utcGuess - (zonedAsUtc - utcGuess));
}

function getTodayBounds(timeZone = "UTC") {
  const today = getZonedDateParts(new Date(), timeZone);

  return {
    startOfDay: zonedTimeToUtc({ ...today, hour: 0, minute: 0, second: 0, millisecond: 0 }, timeZone),
    endOfDay: zonedTimeToUtc({ ...today, hour: 23, minute: 59, second: 59, millisecond: 999 }, timeZone),
  };
}

async function getTodayJournalStatusController(req, res, next) {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(400).json({
        message: "User is not signed in.",
      });
    }
    const timeZone = req.user.profile?.timezone || "UTC";
    const { startOfDay, endOfDay } = getTodayBounds(timeZone);

    const journalStatus = await getTodayJournalStatusService(
      userId,
      startOfDay,
      endOfDay,
    );

    if (journalStatus.success) {
      return res.status(200).json({
        message: "Journal status retrieved successfully.",
        data: {
          ...journalStatus.data,
          date: startOfDay.toISOString(),
          timeZone,
        },
      });
    }

    return res.status(500).json({
      message: journalStatus.error || "Unable to retrieve journal status.",
    });
  } catch (err) {
    next(err);
  }
}

async function getUserJournalsController(req, res, next) {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(400).json({
        message: "User is not signed in.",
      });
    }

    const journalsResult = await getUserJournalsService(userId);

    if (journalsResult.success) {
      return res.status(200).json({
        message: "Journals retrieved successfully.",
        data: journalsResult.data,
      });
    }

    return res.status(500).json({
      message: journalsResult.error || "Unable to retrieve journals.",
    });
  } catch (err) {
    next(err);
  }
}

async function createJournalController(req, res, next) {
  try {
    const userId = req.user.id;
    const { data } = req.body;
    if (!userId) {
      return res.status(400).json({
        message: "User is not signed in.",
      });
    }

    const timeZone = req.user.profile?.timezone || "UTC";
    const { startOfDay } = getTodayBounds(timeZone);
    const createJournalResult = await createJournalService(data, userId, startOfDay);

    if (createJournalResult.success) {
      return res.status(201).json({
        message: "Journal created successfully.",
        data: {
          hasJournalToday: true,
          journal: createJournalResult.data,
          date: startOfDay.toISOString(),
          timeZone,
        },
      });
    }

    return res.status(createJournalResult.statusCode || 400).json({
      message: createJournalResult.message || "Unable to create journal.",
    });
  } catch (err) {
    next(err);
  }
}

async function createJournalTradeController(req, res, next) {
  try {
    const userId = req.user.id;
    const { journalId } = req.params;
    const { data } = req.body;

    if (!userId) {
      return res.status(400).json({
        message: "User is not signed in.",
      });
    }

    const createTradeResult = await createJournalTradeService(journalId, data, userId);

    if (createTradeResult.success) {
      return res.status(201).json({
        message: "Trade created successfully.",
        data: createTradeResult.data,
      });
    }

    return res.status(createTradeResult.statusCode || 400).json({
      message: createTradeResult.message || "Unable to create trade.",
    });
  } catch (err) {
    next(err);
  }
}

export {
  createJournalController,
  createJournalTradeController,
  getTodayJournalStatusController,
  getUserJournalsController,
};
