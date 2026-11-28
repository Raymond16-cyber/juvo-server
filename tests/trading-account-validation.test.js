import assert from "node:assert/strict";
import { test } from "node:test";
import { validateTradingAccountUpdateInput } from "../validations/tradingAccountValidation.js";

test("connected account settings allow name and non-negative limits only", () => {
  const result = validateTradingAccountUpdateInput({
    accountName: "  Main account  ",
    maxDrawnDown: 8,
    profitTarget: 12,
  });

  assert.equal(result.isValid, true);
  assert.deepEqual(result.data, {
    accountName: "Main account",
    maxDrawnDown: 8,
    profitTarget: 12,
  });
});

test("connected account number cannot be changed and limits must be valid", () => {
  const result = validateTradingAccountUpdateInput({
    accountNumber: "different-platform-login",
    maxDrawnDown: -1,
  });

  assert.equal(result.isValid, false);
  assert.equal(
    result.errors.includes("accountNumber cannot be changed for a trading account."),
    true,
  );
  assert.equal(
    result.errors.includes("Maximum drawdown must be a non-negative number."),
    true,
  );
});
