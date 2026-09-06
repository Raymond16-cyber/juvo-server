import TradingAccount from "../models/tradingAccounts.js";
import { createTradingAccount } from "../repositories/tradingAccountRepo.js";
import { findUserById } from "../repositories/userRepository.js";
import { validateTradingAccountInput } from "../validations/tradingAccountValidation.js";

const ACCOUNT_TRADE_SELECT =
  "symbol instrument direction status entryPrice exitPrice stopLoss takeProfit lotSize riskPercentage profitLoss plannedRR achievedRR session notes openedAt closedAt createdAt source externalId externalPositionId externalOrderId";

function round(value, digits = 2) {
  return Number(Number(value || 0).toFixed(digits));
}

function summarizeTrades(trades = []) {
  const totalProfitLoss = trades.reduce(
    (total, trade) => total + Number(trade.profitLoss || 0),
    0,
  );

  return {
    tradesCount: trades.length,
    totalProfitLoss: round(totalProfitLoss),
    openTrades: trades.filter((trade) => trade.status === "Open").length,
    closedTrades: trades.filter((trade) => trade.status === "Closed").length,
    winningTrades: trades.filter((trade) => Number(trade.profitLoss || 0) > 0)
      .length,
    losingTrades: trades.filter((trade) => Number(trade.profitLoss || 0) < 0)
      .length,
  };
}

function getAccountStatus(account) {
  return account?.status || "Active";
}

function isTradingAccountInPlay(account) {
  if (!account || account.isArchived) return false;
  return getAccountStatus(account) === "Active";
}

function evaluateTradingAccountStatus(account) {
  const initial = Number(account?.initialBalance || 0);
  const current = Number(account?.currentBalance || 0);
  const profitTarget = Number(account?.profitTarget || 0);
  const maxDrawnDown = Number(account?.maxDrawnDown || 0);
  const profitPercent = initial ? round(((current - initial) / initial) * 100) : 0;
  const drawdownPercent = initial
    ? round(Math.max(0, ((initial - current) / initial) * 100))
    : 0;

  let status = "Active";
  if (maxDrawnDown > 0 && drawdownPercent >= maxDrawnDown) {
    status = "Breached";
  } else if (profitTarget > 0 && profitPercent >= profitTarget) {
    status = "Passed";
  }

  return {
    status,
    profitPercent,
    drawdownPercent,
  };
}

function withAccountStats(account) {
  const evaluation = evaluateTradingAccountStatus(account);
  return {
    ...account,
    status: getAccountStatus(account),
    isActive: Boolean(account.isActive),
    ...summarizeTrades(account.trades || []),
    profitPercent: evaluation.profitPercent,
    drawdownPercent: evaluation.drawdownPercent,
  };
}

async function populateTradingAccount(accountId) {
  return TradingAccount.findById(accountId)
    .populate("trades", ACCOUNT_TRADE_SELECT)
    .lean();
}

async function setActiveTradingAccount(userId, accountId) {
  await TradingAccount.updateMany(
    { userId, _id: { $ne: accountId } },
    { $set: { isActive: false } },
  );

  return TradingAccount.findOneAndUpdate(
    { _id: accountId, userId },
    { $set: { isActive: true, status: "Active" } },
    { new: true },
  );
}

async function createTradingAccountService(data, res, userId) {
  const result = validateTradingAccountInput(data);

  if (!result.isValid) {
    return {
      success: false,
      message: result.errors.join(" "),
    };
  }

  const user = await findUserById(userId);
  if (!user) {
    return {
      success: false,
      message: "User not found.",
    };
  }

  const hasActiveAccount = await TradingAccount.exists({
    userId,
    isArchived: false,
    isActive: true,
    $or: [{ status: "Active" }, { status: { $exists: false } }],
  });

  const tradingAccount = await createTradingAccount(
    {
      ...result.data,
      isActive: !hasActiveAccount,
      status: "Active",
    },
    userId,
  );

  return {
    success: true,
    data: withAccountStats(tradingAccount.toObject()),
  };
}

async function getUserTradingAccountsService(userId) {
  const tradingAccounts = await TradingAccount.find({
    userId,
    isArchived: false,
  })
    .populate("trades", ACCOUNT_TRADE_SELECT)
    .sort({ isActive: -1, createdAt: -1 })
    .lean();

  const hasActiveAccount = tradingAccounts.some(
    (account) => account.isActive && (account.status || "Active") === "Active",
  );
  if (!hasActiveAccount) {
    const firstInPlay = tradingAccounts.find(
      (account) => (account.status || "Active") === "Active",
    );
    if (firstInPlay) {
      await setActiveTradingAccount(userId, firstInPlay._id);
      firstInPlay.isActive = true;
      if (!firstInPlay.status) firstInPlay.status = "Active";
    }
  }

  return tradingAccounts.map(withAccountStats);
}

async function getArchivedTradingAccountsService(userId) {
  const tradingAccounts = await TradingAccount.find({
    userId,
    isArchived: true,
  })
    .populate("trades", ACCOUNT_TRADE_SELECT)
    .sort({ updatedAt: -1 })
    .lean();

  return tradingAccounts.map(withAccountStats);
}

async function getTradingAccountByIdService(accountId, userId) {
  const account = await TradingAccount.findOne({
    _id: accountId,
    userId,
    isArchived: false,
  });

  if (!account) {
    return {
      success: false,
      statusCode: 404,
      message: "Trading account not found.",
    };
  }

  const populated = await populateTradingAccount(accountId);
  return {
    success: true,
    data: withAccountStats(populated),
  };
}

async function activateTradingAccountService(accountId, userId) {
  const user = await findUserById(userId);
  if (!user) {
    return {
      success: false,
      statusCode: 404,
      message: "User not found.",
    };
  }

  const account = await TradingAccount.findOne({
    _id: accountId,
    userId,
    isArchived: false,
  });

  if (!account) {
    return {
      success: false,
      statusCode: 404,
      message: "Trading account not found.",
    };
  }

  if (!isTradingAccountInPlay(account)) {
    const status = getAccountStatus(account);
    return {
      success: false,
      statusCode: 400,
      message:
        status === "Passed"
          ? "This trading account has already passed and cannot be activated."
          : "This trading account has been breached and cannot be activated.",
    };
  }

  await setActiveTradingAccount(userId, account._id);
  const populated = await populateTradingAccount(account._id);

  return {
    success: true,
    data: withAccountStats(populated),
  };
}

async function restoreTradingAccountService(accountId, userId) {
  const user = await findUserById(userId);
  if (!user) {
    return {
      success: false,
      statusCode: 404,
      message: "User not found.",
    };
  }

  const account = await TradingAccount.findOneAndUpdate(
    {
      _id: accountId,
      userId,
      isArchived: true,
    },
    {
      $set: {
        isArchived: false,
        isActive: false,
      },
    },
    { new: true },
  );

  if (!account) {
    return {
      success: false,
      statusCode: 404,
      message: "Archived trading account not found.",
    };
  }

  const populated = await populateTradingAccount(account._id);

  return {
    success: true,
    data: withAccountStats(populated),
  };
}

async function attachTradeToActiveAccount(account, tradeId) {
  if (!account || !tradeId) return false;
  if (!isTradingAccountInPlay(account) || account.isActive !== true) {
    return false;
  }

  const alreadyAttached = (account.trades || []).some(
    (id) => String(id) === String(tradeId),
  );
  if (alreadyAttached) return true;

  account.trades = account.trades || [];
  account.trades.push(tradeId);
  if (!account.status) account.status = "Active";
  await account.save();
  return true;
}

async function applyClosedTradeToAccount({ accountId, userId, profitLoss }) {
  const account = await TradingAccount.findOne({ _id: accountId, userId });
  if (!account) return null;

  const previousStatus = getAccountStatus(account);
  const nextBalance =
    Number(account.currentBalance || 0) + Number(profitLoss || 0);
  const nextEquity =
    Number(account.currentEquity || 0) + Number(profitLoss || 0);

  account.currentBalance = round(nextBalance);
  account.currentEquity = round(nextEquity);

  const evaluation = evaluateTradingAccountStatus(account);
  const statusChanged = evaluation.status !== previousStatus;

  if (statusChanged) {
    account.status = evaluation.status;
    account.statusUpdatedAt = new Date();
    if (evaluation.status !== "Active") {
      account.isActive = false;
    }
  } else if (!account.status) {
    account.status = "Active";
  }

  await account.save();

  if (statusChanged && evaluation.status !== "Active") {
    const fallback = await TradingAccount.findOne({
      userId,
      _id: { $ne: account._id },
      isArchived: false,
      $or: [{ status: "Active" }, { status: { $exists: false } }],
    }).sort({ createdAt: -1 });

    if (fallback) {
      fallback.isActive = true;
      if (!fallback.status) fallback.status = "Active";
      await fallback.save();
    }
  }

  return {
    _id: account._id,
    accountName: account.accountName,
    broker: account.broker,
    currency: account.currency,
    currentBalance: account.currentBalance,
    currentEquity: account.currentEquity,
    initialBalance: account.initialBalance,
    profitTarget: account.profitTarget,
    maxDrawnDown: account.maxDrawnDown,
    status: account.status,
    isActive: Boolean(account.isActive),
    profitPercent: evaluation.profitPercent,
    drawdownPercent: evaluation.drawdownPercent,
    statusChanged,
  };
}

async function deleteTradingAccountService(accountId, userId) {
  const user = await findUserById(userId);

  if (!user) {
    return {
      success: false,
      message: "User not found.",
    };
  }

  const existingAccount = await TradingAccount.findOne({
    _id: accountId,
    userId,
    isArchived: false,
  });

  if (!existingAccount) {
    return {
      success: false,
      message: "Trading account not found.",
    };
  }

  const wasActive = existingAccount.isActive;

  await TradingAccount.findOneAndUpdate(
    {
      _id: accountId,
      userId,
      isArchived: false,
    },
    {
      $set: {
        isArchived: true,
        isActive: false,
      },
    },
    { new: true },
  );

  if (wasActive) {
    const fallback = await TradingAccount.findOne({
      userId,
      isArchived: false,
      $or: [{ status: "Active" }, { status: { $exists: false } }],
    }).sort({ createdAt: -1 });

    if (fallback) {
      fallback.isActive = true;
      if (!fallback.status) fallback.status = "Active";
      await fallback.save();
    }
  }

  return {
    success: true,
    message: "Trading account archived successfully.",
  };
}

export {
  activateTradingAccountService,
  applyClosedTradeToAccount,
  attachTradeToActiveAccount,
  createTradingAccountService,
  deleteTradingAccountService,
  evaluateTradingAccountStatus,
  getArchivedTradingAccountsService,
  getAccountStatus,
  getTradingAccountByIdService,
  getUserTradingAccountsService,
  isTradingAccountInPlay,
  restoreTradingAccountService,
  setActiveTradingAccount,
};
