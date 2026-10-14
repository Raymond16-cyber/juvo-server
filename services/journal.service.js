import BehaviouralInsight from "../models/behaviouralInsights.js";
import Journal from "../models/Journal.js";
import Trade from "../models/Trades.js";
import TradingAccount from "../models/tradingAccounts.js";
import User from "../models/User.js";
import { analyzeJournalWithAi } from "./ai.service.js";
import { currencyService } from "./currency/currency.service.js";
import {
  resolveAccountCurrency,
  resolveReportingCurrency,
  resolveTradeCurrency,
} from "./currency/currency.utils.js";
import { userCanUseJuvoAi } from "./entitlement.service.js";
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
  "symbol instrument direction status entryPrice exitPrice stopLoss takeProfit lotSize riskPercentage profitLoss profitLossCurrency normalizedProfitLoss plannedRR achievedRR session notes openedAt closedAt createdAt tradingAccount source platform brokerMetadata commission swap externalId externalPositionId externalOrderId externalDealId";

const ACCOUNT_LIST_SELECT =
  "accountName accountNumber broker accountType currency accountCurrency currentBalance currentEquity isActive status profitTarget maxDrawnDown initialBalance";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function populateTrades(query, includeExportFields = false) {
  return query.populate({
    path: "trades",
    select: includeExportFields ? `${TRADE_LIST_SELECT} pips screenshots` : TRADE_LIST_SELECT,
    populate: {
      path: "tradingAccount",
      select: "accountName broker currency accountCurrency status isActive",
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
    return preferred;
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
    closedTrades: trades.filter((trade) => ["Closed", "Breakeven"].includes(trade.status)).length,
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

async function summarizeTradesForReporting(journal, user) {
  const trades = journal.trades || [];
  const reportingCurrency = resolveReportingCurrency(user);
  let totalProfitLossReporting = 0;
  let conversionUnavailableCount = 0;

  await Promise.all(
    trades.map(async (trade) => {
      const account =
        trade.tradingAccount && typeof trade.tradingAccount !== "string"
          ? trade.tradingAccount
          : journal.tradingAccount;
      const nativeCurrency = resolveTradeCurrency(
        trade,
        account,
        resolveAccountCurrency(journal.tradingAccount, reportingCurrency),
      );
      const amount = Number(trade.profitLoss || 0);

      trade.profitLossReporting = null;
      if (amount === 0) {
        trade.profitLossReporting = 0;
        return;
      }

      try {
        const converted = await currencyService.convertClosedTrade({
          amount,
          from: nativeCurrency,
          to: reportingCurrency,
          closedAt: trade.closedAt || journal.journalDate,
        });
        totalProfitLossReporting += converted.amount;
        trade.profitLossReporting = converted.amount;
      } catch {
        conversionUnavailableCount += 1;
      }
    }),
  );

  return {
    ...withJournalStats(journal),
    reportingCurrency,
    totalProfitLossReporting: Number(totalProfitLossReporting.toFixed(2)),
    conversionUnavailableCount,
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
  const [user, journal] = await Promise.all([
    User.findById(userId).select("preferences reportingCurrency").lean(),
    populateTrades(
      Journal.findOne({
        user: userId,
        journalDate: { $gte: startOfDay, $lte: endOfDay },
      })
        .select("_id journalDate status tradingAccount trades psychology createdAt updatedAt")
        .populate("tradingAccount", ACCOUNT_LIST_SELECT),
    ).lean(),
  ]);

  return {
    success: true,
    data: {
      hasJournalToday: Boolean(journal),
      journal: journal ? await summarizeTradesForReporting(journal, user) : null,
    },
  };
}

async function getUserJournalsService(userId, { includeExportFields = false } = {}) {
  const [user, journals] = await Promise.all([
    User.findById(userId).select("preferences reportingCurrency").lean(),
    populateTrades(
      Journal.find({ user: userId })
        .select(includeExportFields ? `${JOURNAL_LIST_SELECT} tradingPlan tradingStrategy` : JOURNAL_LIST_SELECT)
        .populate("tradingAccount", ACCOUNT_LIST_SELECT)
        .sort({ journalDate: -1, createdAt: -1 }),
      includeExportFields,
    ).lean(),
  ]);

  return {
    success: true,
    data: await Promise.all(
      journals.map((journal) => summarizeTradesForReporting(journal, user)),
    ),
  };
}

async function getJournalByIdService(journalId, userId) {
  const ownedJournal = await Journal.findOne({ _id: journalId, user: userId });
  if (!ownedJournal) {
    return { success: false, statusCode: 404, message: "Journal not found." };
  }

  const [user, populated] = await Promise.all([
    User.findById(userId).select("preferences reportingCurrency").lean(),
    populateJournal(journalId),
  ]);
  return { success: true, data: await summarizeTradesForReporting(populated, user) };
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

    throw err;
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
    result.data.tradingAccount || journal.tradingAccount,
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
    profitLossCurrency: tradingAccount.accountCurrency || tradingAccount.currency,
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

  if (["ctrader", "metatrader"].includes(trade.source)) {
    return { success: false, statusCode: 409, message: "Broker trades are updated through broker sync." };
  }
  if (trade.openedAt && result.data.closedAt < new Date(trade.openedAt)) {
    return { success: false, statusCode: 400, message: "Closed date cannot be before the trade opened." };
  }

  const account = await TradingAccount.findOne({
    _id: trade.tradingAccount || journal.tradingAccount,
    userId,
  }).select("currentBalance currency accountCurrency");
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
  trade.profitLossCurrency =
    trade.profitLossCurrency || account?.accountCurrency || account?.currency;
  trade.achievedRR = achievedRR;
  if (result.data.pips !== undefined) trade.pips = result.data.pips;
  if (result.data.notes) {
    trade.notes = [trade.notes, result.data.notes].filter(Boolean).join("\n");
  }
  // Claim the open trade atomically so a repeated request cannot apply P/L twice.
  const closedTrade = await Trade.findOneAndUpdate(
    { _id: tradeId, journal: journalId, user: userId, status: "Open" },
    { $set: {
      exitPrice: trade.exitPrice, status: trade.status, closedAt: trade.closedAt,
      profitLoss: trade.profitLoss, profitLossCurrency: trade.profitLossCurrency,
      achievedRR: trade.achievedRR,
      ...(trade.pips !== undefined ? { pips: trade.pips } : {}),
      ...(trade.notes ? { notes: trade.notes } : {}),
    } },
    { new: true, runValidators: true },
  );
  if (!closedTrade) {
    return { success: false, statusCode: 409, message: "This trade is already closed." };
  }

  const tradingAccount = await applyClosedTradeToAccount({
    accountId: trade.tradingAccount || journal.tradingAccount,
    userId,
    profitLoss,
  });

  return {
    success: true,
    data: closedTrade,
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
  const mergedDiscipline = validateCompleteJournalInput(
    journal.discipline?.toObject?.() || journal.discipline || {},
  ).data.discipline;
  if (mergedDiscipline.score !== undefined) journal.discipline.score = mergedDiscipline.score;
  journal.status = "Completed";
  await journal.save();

  const populated = await populateJournal(journalId);
  let analysis = null;

  try {
    const canUseAi = await userCanUseJuvoAi(userId);
    if (!canUseAi) {
      const refreshed = await populateJournal(journalId);
      return {
        success: true,
        data: {
          ...withJournalStats(refreshed),
          analysis,
        },
      };
    }

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
