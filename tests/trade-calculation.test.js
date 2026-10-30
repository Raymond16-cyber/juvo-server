import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateRiskAmount,
  calculateRiskReward,
  calculateTakeProfitFromRr,
  roundDownToStep,
  validatePriceSide,
} from "../services/tradeCalculation/tradeCalculation.service.js";
import { resolveInstrumentSpec } from "../services/tradeCalculation/instrumentSpecs.js";

describe("trade risk helpers", () => {
  it("calculates risk amount from equity first", () => {
    const result = calculateRiskAmount({
      riskPercentage: 1,
      equity: 10000,
      balance: 9000,
    });
    assert.equal(result.riskAmount, 100);
    assert.equal(result.riskBasis, "equity");
  });

  it("falls back to balance when equity is missing", () => {
    const result = calculateRiskAmount({
      riskPercentage: 2,
      equity: 0,
      balance: 5000,
    });
    assert.equal(result.riskAmount, 100);
    assert.equal(result.riskBasis, "balance");
  });
});

describe("price geometry", () => {
  it("validates long and short stop/target sides", () => {
    const longOk = validatePriceSide({
      direction: "long",
      entryPrice: 1.1,
      stopLoss: 1.09,
      takeProfit: 1.12,
    });
    assert.equal(longOk.isValid, true);

    const longBad = validatePriceSide({
      direction: "long",
      entryPrice: 1.1,
      stopLoss: 1.11,
      takeProfit: 1.12,
    });
    assert.equal(longBad.isValid, false);
  });

  it("derives take-profit from RR and RR from take-profit", () => {
    const tp = calculateTakeProfitFromRr({
      direction: "long",
      entryPrice: 100,
      stopLoss: 90,
      plannedRR: 2,
    });
    assert.equal(tp, 120);

    const rr = calculateRiskReward({
      direction: "long",
      entryPrice: 100,
      stopLoss: 90,
      takeProfit: 120,
    });
    assert.equal(rr, 2);
  });

  it("rounds volume down to the step", () => {
    assert.equal(roundDownToStep(0.237, 0.01), 0.23);
    assert.equal(roundDownToStep(1.99, 1), 1);
  });
});

describe("instrument specs", () => {
  it("resolves standard forex pairs", () => {
    const eurUsd = resolveInstrumentSpec({
      symbol: "EURUSD",
      instrument: "forex",
    });
    assert.equal(eurUsd.known, true);
    assert.equal(eurUsd.contractSize, 100000);
    assert.equal(eurUsd.quoteCurrency, "USD");
  });

  it("marks unsupported instruments unavailable instead of inventing specs", () => {
    const unknown = resolveInstrumentSpec({
      symbol: "SYNTH99",
      instrument: "others",
    });
    assert.equal(unknown.known, false);
    assert.equal(unknown.confidence, "unavailable");
  });
});
