import BehaviouralInsight from "../models/behaviouralInsights.js";
import Journal from "../models/Journal.js";
import Trade from "../models/Trades.js";
import TradingAccount from "../models/tradingAccounts.js";
import User from "../models/User.js";
import { analyzeJournalWithAi } from "./ai.service.js";
import {
  validateCloseTradeInput,
  validateCompleteJournalInput,
  validateJournalInput,
  validateTradeInput,
} from "../validations/journal.validation.js";

const JOURNAL_LIST_SELECT =
  "_id journalDate status tradingAccount trades psychology review discipline ai createdAt updatedAt";

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

async function populateJournal(journalId) {
  return Journal.findById(journalId)
    .select(JOURNAL_LIST_SELECT)
    .populate(
      "tradingAccount",
      "accountName accountNumber broker accountType currency currentBalance currentEquity",
    )
    .populate(
      "trades",
      "symbol instrument direction status entryPrice exitPrice stopLoss takeProfit lotSize riskPercentage profitLoss plannedRR achievedRR session notes openedAt closedAt createdAt",
    )
    .lean();
}

async function getTodayJournalStatusService(userId, startOfDay, endOfDay) {
  try {
    const journal = await Journal.findOne({
      user: userId,
      journalDate: { $gte: startOfDay, $lte: endOfDay },
    })
      .select("_id journalDate status tradingAccount trades psychology createdAt updatedAt")
      .populate(
        "tradingAccount",
        "accountName accountNumber broker accountType currency currentBalance currentEquity",
      )
      .lean();

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
    const journals = await Journal.find({ user: userId })
      .select(JOURNAL_LIST_SELECT)
      .populate(
        "tradingAccount",
        "accountName accountNumber broker accountType currency currentBalance currentEquity",
      )
      .populate(
        "trades",
        "symbol instrument direction status profitLoss plannedRR achievedRR session openedAt closedAt createdAt notes entryPrice exitPrice lotSize riskPercentage",
      )
      .sort({ journalDate: -1, createdAt: -1 })
      .lean();

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
  const result = validateJournalInput(data);

  if (!result.isValid) {
    return { success: false, statusCode: 400, message: result.errors.join(" ") };
  }

  const tradingAccount = await TradingAccount.findOne({
    _id: result.data.tradingAccount,
    userId,
    isArchived: false,
  });

  if (!tradingAccount) {
    return {
      success: false,
      statusCode: 404,
      message: "Create or select a trading account before starting your day.",
    };
  }

  try {
    const journal = await Journal.create({
      user: userId,
      ...result.data,
      journalDate,
    });

    await User.findByIdAndUpdate(userId, {
      $inc: { "stats.totalJournals": 1, "stats.currentJournalStreak": 1 },
    });

    const populatedJournal = await Journal.findById(journal._id)
      .select("_id journalDate status tradingAccount trades psychology createdAt updatedAt")
      .populate(
        "tradingAccount",
        "accountName accountNumber broker accountType currency currentBalance currentEquity",
      )
      .lean();

    return {
      success: true,
      data: {
        ...populatedJournal,
        tradesCount: 0,
      },
    };
  } catch (err) {
    if (err.code === 11000) {
      const existingJournal = await Journal.findOne({
        user: userId,
        tradingAccount: result.data.tradingAccount,
        journalDate,
      })
        .select("_id journalDate status tradingAccount trades psychology createdAt updatedAt")
        .populate(
          "tradingAccount",
          "accountName accountNumber broker accountType currency currentBalance currentEquity",
        )
        .lean();

      return {
        success: true,
        data: {
          ...existingJournal,
          tradesCount: existingJournal?.trades?.length || 0,
        },
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

  const trade = await Trade.create({
    ...result.data,
    user: userId,
    journal: journal._id,
    tradingAccount: journal.tradingAccount,
  });

  journal.trades.push(trade._id);
  await journal.save();
  await User.findByIdAndUpdate(userId, {
    $inc: { "stats.totalTrades": 1 },
  });

  return {
    success: true,
    data: trade,
  };
}

function estimateProfitLoss(trade, exitPrice) {
  const risk = Math.abs(Number(trade.entryPrice) - Number(trade.stopLoss));
  const move =
    trade.direction === "short"
      ? Number(trade.entryPrice) - Number(exitPrice)
      : Number(exitPrice) - Number(trade.entryPrice);

  if (!risk) {
    return { profitLoss: 0, achievedRR: 0 };
  }

  const achievedRR = Number((move / risk).toFixed(2));
  const riskAmount =
    Number(trade.lotSize || 0) * (Number(trade.riskPercentage || 0) / 100) ||
    Math.abs(move);
  const profitLoss = Number((achievedRR * (riskAmount || 1) * 100).toFixed(2));

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

  const estimated = estimateProfitLoss(trade, result.data.exitPrice);
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

  if (profitLoss) {
    await TradingAccount.findOneAndUpdate(
      { _id: journal.tradingAccount, userId },
      {
        $inc: {
          currentBalance: profitLoss,
          currentEquity: profitLoss,
        },
      },
    );
  }

  return { success: true, data: trade };
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
