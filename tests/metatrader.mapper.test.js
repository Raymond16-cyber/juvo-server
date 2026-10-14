import assert from "node:assert/strict";
import { test } from "node:test";
import { mapMetaAccount, mapMetaPosition, liveMetaPosition, normalizeMetaDeals, tradeOrigin } from "../brokers/metatrader/metatrader.mapper.js";
const connection = { externalAccountId: "resource", tradingAccount: "juvo-account", platform: "mt5", server: "Broker-Demo" };
const entry = { id: "1", positionId: "7", symbol: "EURUSD", type: "DEAL_TYPE_BUY", entryType: "DEAL_ENTRY_IN", volume: 1, price: 100, time: "2026-01-01T12:00:00Z", commission: -2, reason: "DEAL_REASON_EXPERT", magic: 123 };
const close = { ...entry, id: "2", orderId: "order", type: "DEAL_TYPE_SELL", entryType: "DEAL_ENTRY_OUT", volume: 0.5, price: 110, profit: 5, commission: -1, time: "2026-01-02T12:00:00Z" };
test("terminal currency and native balances do not inherit provisioning USD or reporting currency", () => {
  const account = mapMetaAccount({ currency: "EUR", login: 123, balance: 500, equity: 490, type: "ACCOUNT_TRADE_MODE_DEMO" }, { ...connection, baseCurrency: "USD" });
  assert.equal(account.accountCurrency, "EUR");
  assert.equal(account.currentEquity, 490);
  assert.throws(() => mapMetaAccount({ balance: 1, equity: 1, login: 1 }, connection), /currency/);
});
test("positions preserve provider values without fabricating missing stop loss or P/L", () => {
  const native = { id: "7", symbol: "EURUSD", type: "POSITION_TYPE_BUY", volume: 1, openPrice: 100, profit: 999, unrealizedProfit: 5, unrealizedCommission: -1, unrealizedSwap: -0.5, magic: 1 };
  assert.equal(mapMetaPosition(native, connection).stopLoss, undefined);
  assert.equal(mapMetaPosition(native, connection).externalTicket, "7");
  assert.equal(liveMetaPosition(native).netUnrealizedPnl, undefined);
  assert.equal(liveMetaPosition(native).grossUnrealizedPnl, 999);
  assert.equal(liveMetaPosition({}).grossUnrealizedPnl, undefined);
});
for (const platform of ["mt5"]) test(`${platform} close deals are deduplicated and entry commission is allocated across partial closes`, () => {
  const result = normalizeMetaDeals([close, entry, close, { ...close, id: "3", profit: -5, price: 90, time: "2026-01-03T12:00:00Z" }], { ...connection, platform });
  assert.equal(result.incomplete, 0);
  assert.equal(result.trades.length, 2);
  assert.deepEqual(result.trades.map((trade) => trade.profitLoss), [3, -7]);
  assert.equal(result.trades[0].externalId, "juvo-account:deal:2");
  assert.equal(result.trades[0].brokerMetadata.origin, "ea");
  assert.equal(result.trades[0].plannedRR, undefined);
});
test("netting reversal splits the close from the new exposure", () => {
  const result = normalizeMetaDeals([entry, { ...close, volume: 2, entryType: "DEAL_ENTRY_INOUT", profit: 10, commission: -4 },
    { ...close, id: "3", type: "DEAL_TYPE_BUY", volume: 1, price: 105, profit: 5, commission: -2, time: "2026-01-03T00:00:00Z" }], connection);
  assert.equal(result.trades.length, 2);
  assert.deepEqual(result.trades.map((trade) => trade.direction), ["long", "short"]);
  assert.deepEqual(result.trades.map((trade) => trade.profitLoss), [6, 1]);
});

test("fees and weighted scale-in prices are allocated without inventing stop loss or RR", () => {
  const result = normalizeMetaDeals([{ ...entry, fee: -1, stopLoss: 0 },
    { ...entry, id: "4", price: 110, fee: -1 },
    { ...close, id: "5", volume: 2, profit: 20, commission: -4, fee: -2 }], connection);
  assert.equal(result.trades[0].entryPrice, 105);
  assert.equal(result.trades[0].profitLoss, 8);
  assert.equal(result.trades[0].fee, -4);
  assert.equal(result.trades[0].stopLoss, undefined);
  assert.equal(result.trades[0].achievedRR, undefined);
});
test("deposits are not trades and missing entries are reported, not invented", () => {
  const result = normalizeMetaDeals([close, { id: "deposit", type: "DEAL_TYPE_BALANCE", profit: 100 }], connection);
  assert.equal(result.trades.length, 0);
  assert.equal(result.incomplete, 1);
  assert.equal(tradeOrigin(undefined), "unknown");
  assert.equal(tradeOrigin("DEAL_REASON_CLIENT"), "manual");
});
