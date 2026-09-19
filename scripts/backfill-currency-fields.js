import "../config/loadEnv.js";
import mongoose from "mongoose";
import BrokerPosition from "../models/BrokerPosition.model.js";
import Trade from "../models/Trades.js";
import TradingAccount from "../models/tradingAccounts.js";
import User from "../models/User.js";
import { normalizeCurrencyCode } from "../services/currency/currency.utils.js";

const mongoUri =
  process.env.NODE_ENV === "production"
    ? process.env.MONGO_URL
    : process.env.MONGO_URI || "mongodb://localhost:27017/juvo";

if (!mongoUri) {
  throw new Error("MongoDB connection string is missing.");
}

function pickCurrency(...values) {
  for (const value of values) {
    const normalized = normalizeCurrencyCode(value);
    if (normalized) return normalized;
  }
  return "USD";
}

async function backfillUsers() {
  const users = await User.find({
    $or: [
      { "preferences.reportingCurrency": { $exists: false } },
      { "preferences.reportingCurrency": null },
      { "preferences.reportingCurrency": "" },
    ],
  }).select("preferences");

  let updated = 0;
  for (const user of users) {
    user.preferences = user.preferences || {};
    user.preferences.reportingCurrency = pickCurrency(
      user.preferences.reportingCurrency,
      user.preferences.preferredCurrency,
    );
    await user.save();
    updated += 1;
  }

  return updated;
}

async function backfillAccounts() {
  const accounts = await TradingAccount.find({
    $or: [
      { accountCurrency: { $exists: false } },
      { accountCurrency: null },
      { accountCurrency: "" },
    ],
  }).select("currency accountCurrency");

  let updated = 0;
  for (const account of accounts) {
    account.accountCurrency = pickCurrency(account.accountCurrency, account.currency);
    account.currency = account.accountCurrency;
    await account.save();
    updated += 1;
  }

  return updated;
}

async function backfillTrades() {
  const trades = await Trade.find({
    $or: [
      { profitLossCurrency: { $exists: false } },
      { profitLossCurrency: null },
      { profitLossCurrency: "" },
    ],
  })
    .select("tradingAccount profitLossCurrency")
    .populate("tradingAccount", "currency accountCurrency");

  let updated = 0;
  let unresolved = 0;
  for (const trade of trades) {
    const currency = pickCurrency(
      trade.profitLossCurrency,
      trade.tradingAccount?.accountCurrency,
      trade.tradingAccount?.currency,
    );
    if (!currency) {
      unresolved += 1;
      continue;
    }
    trade.profitLossCurrency = currency;
    await trade.save();
    updated += 1;
  }

  return { updated, unresolved };
}

async function backfillBrokerPositions() {
  const positions = await BrokerPosition.find({
    $or: [
      { moneyCurrency: { $exists: false } },
      { moneyCurrency: null },
      { moneyCurrency: "" },
    ],
  })
    .select("tradingAccount moneyCurrency")
    .populate("tradingAccount", "currency accountCurrency");

  let updated = 0;
  let unresolved = 0;
  for (const position of positions) {
    const currency = pickCurrency(
      position.moneyCurrency,
      position.tradingAccount?.accountCurrency,
      position.tradingAccount?.currency,
    );
    if (!currency) {
      unresolved += 1;
      continue;
    }
    position.moneyCurrency = currency;
    await position.save();
    updated += 1;
  }

  return { updated, unresolved };
}

async function main() {
  await mongoose.connect(mongoUri);

  const result = {
    users: await backfillUsers(),
    accounts: await backfillAccounts(),
    trades: await backfillTrades(),
    brokerPositions: await backfillBrokerPositions(),
  };

  console.info("[currency:backfill:done]", result);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("[currency:backfill:error]", error.message);
  await mongoose.disconnect();
  process.exitCode = 1;
});
