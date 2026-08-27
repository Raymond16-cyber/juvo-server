import Journal from "../models/Journal.js";
import Trade from "../models/Trades.js";
import TradingAccount from "../models/tradingAccounts.js";
import { validateJournalInput, validateTradeInput } from "../validations/journal.validation.js";

async function getTodayJournalStatusService(userId, startOfDay, endOfDay) {
  try {
    const journal = await Journal.findOne({
      user: userId,
      journalDate: { $gte: startOfDay, $lte: endOfDay },
    })
      .select("_id journalDate status tradingAccount trades psychology createdAt updatedAt")
      .populate("tradingAccount", "accountName accountNumber broker accountType currency currentBalance currentEquity")
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
      .select("_id journalDate status tradingAccount trades psychology discipline ai createdAt updatedAt")
      .populate("tradingAccount", "accountName accountNumber broker accountType currency currentBalance currentEquity")
      .populate("trades", "symbol instrument direction status profitLoss plannedRR achievedRR session openedAt closedAt createdAt")
      .sort({ journalDate: -1, createdAt: -1 })
      .lean();

    return {
      success: true,
      data: journals.map((journal) => {
        const trades = journal.trades || [];
        const totalProfitLoss = trades.reduce(
          (total, trade) => total + Number(trade.profitLoss || 0),
          0,
        );

        return {
          ...journal,
          tradesCount: trades.length,
          totalProfitLoss,
          openTrades: trades.filter((trade) => trade.status === "Open").length,
          closedTrades: trades.filter((trade) => trade.status === "Closed").length,
          winningTrades: trades.filter((trade) => Number(trade.profitLoss || 0) > 0).length,
          losingTrades: trades.filter((trade) => Number(trade.profitLoss || 0) < 0).length,
        };
      }),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
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

    const populatedJournal = await Journal.findById(journal._id)
      .select("_id journalDate status tradingAccount trades psychology createdAt updatedAt")
      .populate("tradingAccount", "accountName accountNumber broker accountType currency currentBalance currentEquity")
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
        .populate("tradingAccount", "accountName accountNumber broker accountType currency currentBalance currentEquity")
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

  return {
    success: true,
    data: trade,
  };
}

export {
  createJournalService,
  createJournalTradeService,
  getTodayJournalStatusService,
  getUserJournalsService,
};
