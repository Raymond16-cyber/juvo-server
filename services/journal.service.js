import BehaviouralInsight from "../models/behaviouralInsights.js";
import Journal from "../models/Journal.js";
import Trade from "../models/Trades.js";
import TradingAccount from "../models/tradingAccounts.js";
import User from "../models/User.js";
import { analyzeJournalWithAi } from "./ai.service.js";
import {
  applyClosedTradeToAccount,
  attachTradeToActiveAccount,
  isTradingAccountInPlay,
  setActiveTradingAccount,
} from "./tradingAccountService.js";
import {
  validateCloseTradeInput,
  validateCompleteJournalInput,
  validateJournalInput,
  validateTradeInput,
} from "../validations/journal.validation.js";

const JOURNAL_LIST_SELECT =
  "_id journalDate status tradingAccount trades psychology review discipline ai createdAt updatedAt";

const TRADE_LIST_SELECT =
  "symbol instrument direction status entryPrice exitPrice stopLoss takeProfit lotSize riskPercentage profitLoss plannedRR achievedRR session notes openedAt closedAt createdAt tradingAccount";

const ACCOUNT_LIST_SELECT =
  "accountName accountNumber broker accountType currency currentBalance currentEquity isActive status profitTarget maxDrawnDown initialBalance";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function populateTrades(query) {
  return query.populate({
    path: "trades",
    select: TRADE_LIST_SELECT,
    populate: {
      path: "tradingAccount",
      select: "accountName broker currency status isActive",
    },
  });
}

async function findDailyJournal(userId, journalDate) {
  return Journal.findOne({ user: userId, journalDate });
}

async function resolveInPlayTradingAccount(userId, preferredAccountId) {
  if (preferredAccountId) {
    const preferred = await TradingAccount.findOne({
      _id: preferredAccountId,
      userId,
      isArchived: false,
    });
    if (preferred && isTradingAccountInPlay(preferred)) {
      return preferred;
    }
  }

  const activeAccount = await TradingAccount.findOne({
    userId,
    isActive: true,
    isArchived: false,
  });
  if (activeAccount && isTradingAccountInPlay(activeAccount)) {
    return activeAccount;
  }

  return TradingAccount.findOne({
    userId,
    isArchived: false,
    $or: [{ status: "Active" }, { status: { $exists: false } }],
  }).sort({ createdAt: -1 });
}

function summarizeTrades(trades = []) {
  const totalProfitLoss = trades.reduce(
    (total, trade) => total + Number(trade.profitLoss || 0),
    0,
  );

  return {
    tradesCount: trades.length,
    totalProfitLoss,
    openTrades: trades.filter((trade) => trade.status === "Open").length,
    closedTrades: trades.filter((trade) => trade.status === "Closed").length,
    winningTrades: trades.filter((trade) => Number(trade.profitLoss || 0) > 0)
      .length,
    losingTrades: trades.filter((trade) => Number(trade.profitLoss || 0) < 0)
      .length,
  };
}

function withJournalStats(journal) {
  const trades = journal.trades || [];
  return {
    ...journal,
    ...summarizeTrades(trades),
  };
}

async function buildNextJournalStreak(userId, journalDate) {
  const [user, previousJournal] = await Promise.all([
    User.findById(userId).select("stats.currentJournalStreak").lean(),
    Journal.findOne({
      user: userId,
      journalDate: { $lt: journalDate },
    })
      .select("journalDate")
      .sort({ journalDate: -1 })
      .lean(),
  ]);

  const previousDate = previousJournal?.journalDate
    ? new Date(previousJournal.journalDate)
    : null;
  const diffDays = previousDate
    ? Math.round((journalDate.getTime() - previousDate.getTime()) / MS_PER_DAY)
    : null;

  return diffDays === 1
    ? Number(user?.stats?.currentJournalStreak || 0) + 1
    : 1;
}

async function populateJournal(journalId) {
  return populateTrades(
    Journal.findById(journalId)
      .select(JOURNAL_LIST_SELECT)
      .populate("tradingAccount", ACCOUNT_LIST_SELECT),
  ).lean();
}

async function getTodayJournalStatusService(userId, startOfDay, endOfDay) {
  try {
    const journal = await populateTrades(
      Journal.findOne({
        user: userId,
        journalDate: { $gte: startOfDay, $lte: endOfDay },
      })
        .select("_id journalDate status tradingAccount trades psychology createdAt updatedAt")
        .populate("tradingAccount", ACCOUNT_LIST_SELECT),
    ).lean();

    return {
      success: true,
      data: {
        hasJournalToday: Boolean(journal),
        journal: journal
          ? {
              ...journal,
              tradesCount: journal.trades?.length || 0,
            }
          : null,
      },
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getUserJournalsService(userId) {
  try {
    const journals = await populateTrades(
      Journal.find({ user: userId })
        .select(JOURNAL_LIST_SELECT)
        .populate("tradingAccount", ACCOUNT_LIST_SELECT)
        .sort({ journalDate: -1, createdAt: -1 }),
    ).lean();

    return {
      success: true,
      data: journals.map(withJournalStats),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getJournalByIdService(journalId, userId) {
  const ownedJournal = await Journal.findOne({ _id: journalId, user: userId });
  if (!ownedJournal) {
    return { success: false, statusCode: 404, message: "Journal not found." };
  }

  const populated = await populateJournal(journalId);
  return { success: true, data: withJournalStats(populated) };
}

async function createJournalService(data, userId, journalDate) {
  const existingJournal = await findDailyJournal(userId, journalDate);
  if (existingJournal) {
    const populated = await populateJournal(existingJournal._id);
    return {
      success: true,
      data: withJournalStats(populated),
    };
  }

  const result = validateJournalInput(data);

  if (!result.isValid) {
    return { success: false, statusCode: 400, message: result.errors.join(" ") };
  }

  const tradingAccount = await resolveInPlayTradingAccount(
    userId,
    result.data.tradingAccount,
  );

  if (!tradingAccount) {
    return {
      success: false,
      statusCode: 404,
      message: "Create a trading account before starting your day.",
    };
  }

  if (!isTradingAccountInPlay(tradingAccount)) {
    return {
      success: false,
      statusCode: 400,
      message:
        "This trading account has passed or been breached. Create a new account before starting your day.",
    };
  }

  await setActiveTradingAccount(userId, tradingAccount._id);

  try {
    const journal = await Journal.create({
      user: userId,
      ...result.data,
      tradingAccount: tradingAccount._id,
      journalDate,
    });

    const currentJournalStreak = await buildNextJournalStreak(
      userId,
      journalDate,
    );
    await User.findByIdAndUpdate(userId, {
      $inc: { "stats.totalJournals": 1 },
      $set: { "stats.currentJournalStreak": currentJournalStreak },
      $max: { "stats.longestJournalStreak": currentJournalStreak },
    });

    const populatedJournal = await populateJournal(journal._id);

    return {
      success: true,
      data: {
        ...populatedJournal,
        tradesCount: 0,
      },
    };
  } catch (err) {
    if (err.code === 11000) {
      const duplicate = await findDailyJournal(userId, journalDate);
      const populated = duplicate ? await populateJournal(duplicate._id) : null;
      return {
        success: true,
        data: populated
          ? withJournalStats(populated)
          : { tradesCount: 0 },
      };
    }

    return { success: false, statusCode: 500, message: err.message };
  }
}

async function createJournalTradeService(journalId, data, userId) {
  const result = validateTradeInput(data);

  if (!result.isValid) {
    return { success: false, statusCode: 400, message: result.errors.join(" ") };
  }

  const journal = await Journal.findOne({ _id: journalId, user: userId });

  if (!journal) {
    return {
      success: false,
      statusCode: 404,
      message: "Start today's journal before creating a trade.",
    };
  }

  const tradingAccount = await resolveInPlayTradingAccount(
    userId,
    data.tradingAccount || journal.tradingAccount,
  );

  if (!tradingAccount) {
    return {
      success: false,
      statusCode: 400,
      message: "Create a trading account before logging a trade.",
    };
  }

  if (!isTradingAccountInPlay(tradingAccount)) {
    return {
      success: false,
      statusCode: 400,
      message:
        "This trading account has passed or been breached. Create a new account before taking another trade. Today's journal stays open.",
    };
  }

  if (tradingAccount.isActive !== true) {
    await setActiveTradingAccount(userId, tradingAccount._id);
    tradingAccount.isActive = true;
  }

  const trade = await Trade.create({
    ...result.data,
    user: userId,
    journal: journal._id,
    tradingAccount: tradingAccount._id,
  });

  journal.trades.push(trade._id);
  await journal.save();
  await attachTradeToActiveAccount(tradingAccount, trade._id);
  await User.findByIdAndUpdate(userId, {
    $inc: { "stats.totalTrades": 1 },
  });

  return {
    success: true,
    data: trade,
    attachedToAccount: Boolean(tradingAccount.isActive),
  };
}

function estimateProfitLoss(trade, exitPrice, account) {
  const risk = Math.abs(Number(trade.entryPrice) - Number(trade.stopLoss));
  const move =
    trade.direction === "short"
      ? Number(trade.entryPrice) - Number(exitPrice)
      : Number(exitPrice) - Number(trade.entryPrice);

  if (!risk) {
    return { profitLoss: 0, achievedRR: 0 };
  }

  const achievedRR = Number((move / risk).toFixed(2));
  const accountBalance = Number(account?.currentBalance || 0);
  const riskAmount = accountBalance
    ? accountBalance * (Number(trade.riskPercentage || 0) / 100)
    : 0;
  const profitLoss = Number(
    (achievedRR * (riskAmount || Math.abs(move))).toFixed(2),
  );

  return { profitLoss, achievedRR };
}

async function closeJournalTradeService(journalId, tradeId, data, userId) {
  const result = validateCloseTradeInput(data);

  if (!result.isValid) {
    return { success: false, statusCode: 400, message: result.errors.join(" ") };
  }

  const journal = await Journal.findOne({ _id: journalId, user: userId });
  if (!journal) {
    return { success: false, statusCode: 404, message: "Journal not found." };
  }

  const trade = await Trade.findOne({
    _id: tradeId,
    journal: journalId,
    user: userId,
  });

  if (!trade) {
    return { success: false, statusCode: 404, message: "Trade not found." };
  }

  if (trade.status !== "Open") {
    return {
      success: false,
      statusCode: 400,
      message: "This trade is already closed.",
    };
  }

  const account = await TradingAccount.findOne({
    _id: trade.tradingAccount || journal.tradingAccount,
    userId,
  }).select("currentBalance");
  const estimated = estimateProfitLoss(trade, result.data.exitPrice, account);
  const profitLoss =
    result.data.profitLoss !== undefined
      ? result.data.profitLoss
      : result.data.status === "Cancelled"
        ? 0
        : result.data.status === "Breakeven"
          ? 0
          : estimated.profitLoss;
  const achievedRR =
    result.data.achievedRR !== undefined
      ? result.data.achievedRR
      : result.data.status === "Cancelled" || result.data.status === "Breakeven"
        ? 0
        : estimated.achievedRR;

  trade.exitPrice = result.data.exitPrice;
  trade.status = result.data.status;
  trade.closedAt = result.data.closedAt;
  trade.profitLoss = profitLoss;
  trade.achievedRR = achievedRR;
  if (result.data.pips !== undefined) trade.pips = result.data.pips;
  if (result.data.notes) {
    trade.notes = [trade.notes, result.data.notes].filter(Boolean).join("\n");
  }
  await trade.save();

  const tradingAccount = await applyClosedTradeToAccount({
    accountId: trade.tradingAccount || journal.tradingAccount,
    userId,
    profitLoss,
  });

  return {
    success: true,
    data: trade,
    tradingAccount,
  };
}

async function completeJournalService(journalId, data, userId) {
  const result = validateCompleteJournalInput(data);

  if (!result.isValid) {
    return { success: false, statusCode: 400, message: result.errors.join(" ") };
  }

  const journal = await Journal.findOne({ _id: journalId, user: userId });
  if (!journal) {
    return { success: false, statusCode: 404, message: "Journal not found." };
  }

  journal.psychology = {
    ...(journal.psychology?.toObject?.() || journal.psychology || {}),
    ...result.data.psychology,
  };
  journal.review = {
    ...(journal.review?.toObject?.() || journal.review || {}),
    ...result.data.review,
  };
  journal.discipline = {
    ...(journal.discipline?.toObject?.() || journal.discipline || {}),
    ...result.data.discipline,
  };
  journal.status = "Completed";
  await journal.save();

  const populated = await populateJournal(journalId);
  let analysis = null;

  try {
    const aiResult = await analyzeJournalWithAi(populated);
    if (aiResult.summary || aiResult.feedback) {
      journal.ai = {
        summary: aiResult.summary,
        feedback: aiResult.feedback,
      };
      if (aiResult.analysis?.disciplineScore && !journal.discipline.score) {
        journal.discipline.score = aiResult.analysis.disciplineScore;
      }
      await journal.save();
      analysis = aiResult.analysis;

      const insights = Array.isArray(aiResult.analysis?.insights)
        ? aiResult.analysis.insights.slice(0, 4)
        : [];
      if (insights.length) {
        await BehaviouralInsight.insertMany(
          insights.map((insight) => ({
            user: userId,
            journal: journal._id,
            title: insight.title,
            body: insight.body,
            category: insight.category || "discipline",
            score: insight.score,
            source: "ai",
          })),
        );
      }
    }
  } catch {
    // Journal completion should succeed even if AI is unavailable.
  }

  const refreshed = await populateJournal(journalId);
  return {
    success: true,
    data: {
      ...withJournalStats(refreshed),
      analysis,
    },
  };
}

export {
  closeJournalTradeService,
  completeJournalService,
  createJournalService,
  createJournalTradeService,
  getJournalByIdService,
  getTodayJournalStatusService,
  getUserJournalsService,
};
