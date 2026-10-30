import {
  closeJournalTradeService,
  completeJournalService,
  createJournalService,
  createJournalTradeService,
  getJournalByIdService,
  getTodayJournalStatusService,
  getUserJournalsService,
} from "../services/journal.service.js";
import { getJournalStreakService } from "../services/journalStreak.service.js";
import { getTodayBounds, getUserTimeZone } from "../utils/timezone.js";
import { resolveReportingCurrency } from "../services/currency/currency.utils.js";

async function exportJournalsController(req, res, next) {
  try {
    const result = await getUserJournalsService(req.user.id, {
      includeExportFields: true,
    });
    if (!result.success) throw new Error("Unable to load journal export.");
    res.set("Cache-Control", "no-store");
    return res.json({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      timeZone: getUserTimeZone(req.user),
      reportingCurrency: resolveReportingCurrency(req.user),
      journals: result.data,
    });
  } catch (error) {
    return next(error);
  }
}

async function getTodayJournalStatusController(req, res, next) {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(400).json({
        message: "User is not signed in.",
      });
    }
    const timeZone = getUserTimeZone(req.user);
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

async function getJournalByIdController(req, res, next) {
  try {
    const result = await getJournalByIdService(
      req.params.journalId,
      req.user.id,
    );

    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json({ message: result.message });
    }

    return res.status(200).json({
      message: "Journal retrieved successfully.",
      data: result.data,
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

    const timeZone = getUserTimeZone(req.user);
    const { startOfDay } = getTodayBounds(timeZone);
    const createJournalResult = await createJournalService(
      data,
      userId,
      startOfDay,
    );

    if (createJournalResult.success) {
      return res.status(201).json({
        message: "Journal created successfully.",
        data: {
          hasJournalToday: true,
          journal: createJournalResult.data,
          date: startOfDay.toISOString(),
          timeZone,
        },
        newlyEarned: createJournalResult.newlyEarned || [],
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

    const createTradeResult = await createJournalTradeService(
      journalId,
      data,
      userId,
    );

    if (createTradeResult.success) {
      return res.status(201).json({
        message: createTradeResult.attachedToAccount
          ? "Trade created and added to the active trading account."
          : "Trade created successfully.",
        data: createTradeResult.data,
        attachedToAccount: Boolean(createTradeResult.attachedToAccount),
        newlyEarned: createTradeResult.newlyEarned || [],
      });
    }

    return res.status(createTradeResult.statusCode || 400).json({
      success: false,
      code: createTradeResult.code,
      message: createTradeResult.message || "Unable to create trade.",
    });
  } catch (err) {
    next(err);
  }
}

async function closeJournalTradeController(req, res, next) {
  try {
    const { journalId, tradeId } = req.params;
    const { data } = req.body;
    const result = await closeJournalTradeService(
      journalId,
      tradeId,
      data || req.body,
      req.user.id,
    );

    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json({ message: result.message });
    }

    const accountStatus = result.tradingAccount?.status;
    const accountMessage =
      accountStatus === "Passed"
        ? "Trade closed. This trading account has passed its profit target."
        : accountStatus === "Breached"
          ? "Trade closed. This trading account has been breached."
          : "Trade closed successfully.";

    return res.status(200).json({
      message: accountMessage,
      data: result.data,
      tradingAccount: result.tradingAccount,
    });
  } catch (err) {
    next(err);
  }
}

async function completeJournalController(req, res, next) {
  try {
    const { journalId } = req.params;
    const { data } = req.body;
    const result = await completeJournalService(
      journalId,
      data || req.body,
      req.user.id,
    );

    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json({ message: result.message });
    }

    return res.status(200).json({
      message: "Journal completed successfully.",
      data: result.data,
      newlyEarned: result.newlyEarned || [],
    });
  } catch (err) {
    next(err);
  }
}

async function getJournalStreakController(req, res, next) {
  try {
    const result = await getJournalStreakService(req.user.id);
    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json({ message: result.message });
    }

    return res.status(200).json({
      message: "Journal streak retrieved successfully.",
      data: result.data,
    });
  } catch (err) {
    next(err);
  }
}

export {
  exportJournalsController,
  closeJournalTradeController,
  completeJournalController,
  createJournalController,
  createJournalTradeController,
  getJournalByIdController,
  getJournalStreakController,
  getTodayJournalStatusController,
  getUserJournalsController,
};
