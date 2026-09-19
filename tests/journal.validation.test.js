import assert from "node:assert/strict";
import { test } from "node:test";
import { validateTradeInput, validateCloseTradeInput, validateCompleteJournalInput } from "../validations/journal.validation.js";

const trade = { symbol: "EURUSD", instrument: "forex", direction: "long", entryPrice: 1.1, stopLoss: 1.09, takeProfit: 1.12, lotSize: 1, riskPercentage: 1, plannedRR: 20 };

test("manual opening keeps the user's planned RR", () => {
  const result = validateTradeInput(trade);
  assert.equal(result.isValid, true);
  assert.equal(result.data.plannedRR, 20);
});

test("invalid numbers, dates and account identifiers are rejected before persistence", () => {
  for (const key of ["entryPrice", "stopLoss", "takeProfit", "lotSize", "riskPercentage", "plannedRR"]) {
    for (const value of [Infinity, "Infinity", NaN, true, [], {}, -1, 0]) {
      assert.equal(validateTradeInput({ ...trade, [key]: value }).isValid, false, `${key}: ${value}`);
    }
  }
  assert.equal(validateTradeInput({ ...trade, openedAt: "not a date" }).isValid, false);
  assert.equal(validateTradeInput({ ...trade, tradingAccount: "invalid" }).isValid, false);
  assert.equal(validateTradeInput({ ...trade, riskPercentage: 101 }).isValid, false);
});

test("long and short protective levels are checked against entry", () => {
  assert.equal(validateTradeInput({ ...trade, stopLoss: trade.entryPrice }).isValid, false);
  assert.equal(validateTradeInput({ ...trade, direction: "short" }).isValid, false);
  assert.equal(validateTradeInput({ ...trade, direction: "short", stopLoss: 1.12, takeProfit: 1.09 }).isValid, true);
});

test("opening cannot bypass the close-trade balance workflow", () => {
  assert.equal(validateTradeInput({ ...trade, status: "Closed", profitLoss: 100 }).isValid, false);
  assert.equal(validateTradeInput({ ...trade, profitLoss: 100 }).isValid, false);
});

test("closing accepts zero RR but rejects nonfinite outcomes and inconsistent breakeven results", () => {
  assert.equal(validateCloseTradeInput({ exitPrice: 1.1, achievedRR: 0, profitLoss: 0 }).isValid, true);
  for (const key of ["profitLoss", "achievedRR", "pips"]) {
    assert.equal(validateCloseTradeInput({ exitPrice: 1.1, [key]: "NaN" }).isValid, false);
  }
  assert.equal(validateCloseTradeInput({ exitPrice: 1.1, closedAt: "invalid" }).isValid, false);
  assert.equal(validateCloseTradeInput({ exitPrice: 1.1, status: "Breakeven", profitLoss: 5 }).isValid, false);
});

test("discipline scores count answered questions rather than treating missing answers as failures", () => {
  assert.equal(validateCompleteJournalInput({ followedTradingPlan: true }).data.discipline.score, 100);
  assert.equal(validateCompleteJournalInput({ followedTradingPlan: true, revengeTraded: true }).data.discipline.score, 50);
  assert.equal(validateCompleteJournalInput({}).data.discipline.score, undefined);
});
