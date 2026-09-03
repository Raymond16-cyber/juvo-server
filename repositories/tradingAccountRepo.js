import TradingAccount from "../models/tradingAccounts.js";

export async function createTradingAccount(payload, userId) {
  const lastSyncedAt = new Date();
  const collectedAccount = {
    accountName: payload.accountName,
    accountNumber: payload.accountNumber,
    accountType: payload.accountType,
    broker: payload.broker,
    initialBalance: payload.initialBalance,
    currentBalance: payload.currentBalance,
    userId: userId,
    platform: payload.platform,
    server: payload.server,
    leverage: payload.leverage,
    currency: payload.currency,
    currentEquity: payload.currentEquity,
    maxDrawnDown: payload.maxDrawnDown,
    profitTarget: payload.profitTarget,
    isActive: Boolean(payload.isActive),
    status: payload.status || "Active",
    trades: [],
    lastSyncedAt,
  };

  const newTradingAccount = await TradingAccount.create(collectedAccount);
  return newTradingAccount;
}


export async function getUserTradingAccounts(userId) {
  const tradingAccounts = await TradingAccount.find({ userId, isArchived: false }).sort({
    createdAt: -1,
  });
  return tradingAccounts;
}
