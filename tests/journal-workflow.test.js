import assert from "node:assert/strict";
import { test } from "node:test";
import Journal from "../models/Journal.js";
import Trade from "../models/Trades.js";
import TradingAccount from "../models/tradingAccounts.js";
import User from "../models/User.js";
import BehaviouralInsight from "../models/behaviouralInsights.js";
import { closeJournalTradeService, createJournalTradeService, getUserJournalsService } from "../services/journal.service.js";
import { getAnalyticsService } from "../services/analytics.service.js";

const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const journalId = "bbbbbbbbbbbbbbbbbbbbbbbb";
const accountId = "cccccccccccccccccccccccc";
const tradeId = "dddddddddddddddddddddddd";
const account = { _id: accountId, currentBalance: 10000, currentEquity: 10000, initialBalance: 10000, currency: "USD", accountCurrency: "USD", status: "Active" };
const trade = { _id: tradeId, tradingAccount: accountId, entryPrice: 100, stopLoss: 90, direction: "long", riskPercentage: 1, status: "Open", source: "manual", plannedRR: 20, openedAt: new Date("2026-09-01") };
const query = (result) => ({ select() { return this; }, populate() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => result });

test("journal export scopes the query to the owner and includes extra trade fields with reporting P/L", async (t) => {
  t.mock.method(User, "findById", () => query({ preferences: { reportingCurrency: "USD" } }));
  const populations = [];
  t.mock.method(Journal, "find", (filter) => {
    assert.deepEqual(filter, { user: userId });
    return { ...query([{ _id: journalId, journalDate: new Date("2026-09-01"), tradingAccount: account, trades: [{ ...trade, profitLoss: 100, profitLossCurrency: "USD", pips: 10, screenshots: ["screenshot-reference"] }] }]),
      populate(...args) { populations.push(args); return this; },
    };
  });
  const result = await getUserJournalsService(userId, { includeExportFields: true });
  const tradeSelection = populations.find(([value]) => value.path === "trades")[0].select;
  assert.match(tradeSelection, /screenshots/);
  assert.match(tradeSelection, /pips/);
  assert.doesNotMatch(tradeSelection, /rawSource|accessToken|refreshToken/);
  assert.equal(result.data[0].trades[0].profitLossReporting, 100);
  assert.equal(result.data[0].totalProfitLossReporting, 100);
});

test("two simultaneous close requests apply the result once and preserve planned RR", async (t) => {
  t.mock.method(Journal, "findOne", async () => ({ _id: journalId, tradingAccount: accountId }));
  t.mock.method(Trade, "findOne", async () => ({ ...trade }));
  t.mock.method(TradingAccount, "findOne", () => ({ select: async () => account }));
  let claimed = false;
  t.mock.method(Trade, "findOneAndUpdate", async (filter, update) => {
    assert.equal(filter.status, "Open");
    assert.equal(filter.user, userId);
    if (claimed) return null;
    claimed = true;
    return { ...trade, ...update.$set };
  });
  let balanceUpdates = 0;
  t.mock.method(TradingAccount, "findOneAndUpdate", async (filter, update) => {
    assert.equal(filter.userId, userId);
    balanceUpdates += 1;
    assert.deepEqual(update.$inc, { currentBalance: 100, currentEquity: 100 });
    return { ...account, currentBalance: 10100, currentEquity: 10100, save: async () => {} };
  });
  const results = await Promise.all([1, 2].map(() => closeJournalTradeService(journalId, tradeId, { exitPrice: 110, profitLoss: 100, achievedRR: 0 }, userId)));
  assert.equal(results.filter((result) => result.success).length, 1);
  assert.equal(results.find((result) => !result.success).statusCode, 409);
  assert.equal(balanceUpdates, 1);
  assert.equal(results.find((result) => result.success).data.plannedRR, 20);
  assert.equal(results.find((result) => result.success).data.achievedRR, 0);
});

test("broker trades cannot be manually closed and closed dates cannot precede opening", async (t) => {
  t.mock.method(Journal, "findOne", async () => ({ _id: journalId }));
  const findTrade = t.mock.method(Trade, "findOne", async () => ({ ...trade, source: "ctrader" }));
  assert.equal((await closeJournalTradeService(journalId, tradeId, { exitPrice: 110 }, userId)).statusCode, 409);
  findTrade.mock.mockImplementation(async () => ({ ...trade }));
  assert.equal((await closeJournalTradeService(journalId, tradeId, { exitPrice: 110, closedAt: "2026-08-01" }, userId)).statusCode, 400);
});

test("an unavailable explicit trading account never falls back to a different account", async (t) => {
  t.mock.method(Journal, "findOne", async () => ({ _id: journalId, tradingAccount: accountId }));
  const findAccount = t.mock.method(TradingAccount, "findOne", async () => null);
  const result = await createJournalTradeService(journalId, {
    symbol: "EURUSD", instrument: "forex", direction: "long", entryPrice: 1.1, stopLoss: 1.09, takeProfit: 1.12, lotSize: 1, riskPercentage: 1, plannedRR: 2, tradingAccount: accountId,
  }, userId);
  assert.equal(result.success, false);
  assert.equal(findAccount.mock.callCount(), 1);
});

test("analytics preserves achieved RR zero and rejects unknown account scopes", async (t) => {
  t.mock.method(User, "findById", () => query({ preferences: { reportingCurrency: "USD" } }));
  t.mock.method(TradingAccount, "find", () => query([account]));
  t.mock.method(Journal, "find", () => query([{ _id: journalId, journalDate: new Date("2026-09-01"), tradingAccount: account, trades: [{ ...trade, status: "Breakeven", profitLoss: 0, achievedRR: 0, profitLossCurrency: "USD" }] }]));
  t.mock.method(BehaviouralInsight, "find", () => query([]));
  const result = await getAnalyticsService(userId);
  assert.equal(result.data.summary.avgRr, 0);
  assert.equal(result.data.summary.closedTrades, 1);
  await assert.rejects(() => getAnalyticsService(userId, "unknown-account"), { status: 404 });
});

test("open and cancelled trades do not distort realized P/L or session win rates", async (t) => {
  t.mock.method(User, "findById", () => query({ preferences: { reportingCurrency: "USD" } }));
  t.mock.method(TradingAccount, "find", () => query([account]));
  t.mock.method(Journal, "find", () => query([{ _id: journalId, journalDate: new Date("2026-09-01"), tradingAccount: account, trades: [
    { ...trade, status: "Closed", profitLoss: 100, profitLossCurrency: "USD", symbol: "EURUSD", session: "London" },
    { ...trade, status: "Open", profitLoss: 500, profitLossCurrency: "USD", symbol: "EURUSD", session: "London" },
    { ...trade, status: "Cancelled", profitLoss: -50, profitLossCurrency: "USD", symbol: "EURUSD", session: "London" },
  ] }]));
  t.mock.method(BehaviouralInsight, "find", () => query([]));
  const { data } = await getAnalyticsService(userId);
  assert.equal(data.summary.netPnl, 100);
  assert.equal(data.bySession[0].winRate, 100);
  assert.equal(data.bySymbol[0].winRate, 100);
  assert.equal(data.equityCurve[0].pnl, 100);
});
