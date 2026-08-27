import mongoose from "mongoose";

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return Number(value);
}

function validateJournalInput(payload = {}) {
  const errors = [];
  const tradingAccount = String(payload.tradingAccount || "").trim();
  const tradingPlan = String(payload.tradingPlan || "").trim();
  const tradingStrategy = String(payload.tradingStrategy || "").trim();
  const confidenceBefore = toOptionalNumber(payload.confidenceBefore);
  const beforeTrading = String(payload.beforeTrading || "").trim();

  if (!tradingAccount) errors.push("Trading account is required.");
  if (tradingAccount && !isValidObjectId(tradingAccount)) {
    errors.push("Trading account is invalid.");
  }
  if (tradingPlan && !isValidObjectId(tradingPlan)) {
    errors.push("Trading plan is invalid.");
  }
  if (tradingStrategy && !isValidObjectId(tradingStrategy)) {
    errors.push("Trading strategy is invalid.");
  }
  if (
    confidenceBefore !== undefined &&
    (!Number.isFinite(confidenceBefore) || confidenceBefore < 1 || confidenceBefore > 10)
  ) {
    errors.push("Confidence before trading must be between 1 and 10.");
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      tradingAccount,
      ...(tradingPlan ? { tradingPlan } : {}),
      ...(tradingStrategy ? { tradingStrategy } : {}),
      psychology: {
        ...(beforeTrading ? { beforeTrading } : {}),
        ...(confidenceBefore !== undefined ? { confidenceBefore } : {}),
      },
    },
  };
}

function validateTradeInput(payload = {}) {
  const errors = [];
  const symbol = String(payload.symbol || "").trim().toUpperCase();
  const instrument = String(payload.instrument || "").trim().toLowerCase();
  const direction = String(payload.direction || "").trim().toLowerCase();
  const session = String(payload.session || "").trim();

  const entryPrice = Number(payload.entryPrice || 0);
  const exitPrice = toOptionalNumber(payload.exitPrice);
  const stopLoss = Number(payload.stopLoss || 0);
  const takeProfit = Number(payload.takeProfit || 0);
  const lotSize = Number(payload.lotSize || 0);
  const riskPercentage = Number(payload.riskPercentage || 0);
  const plannedRR = Number(payload.plannedRR || 0);
  const achievedRR = toOptionalNumber(payload.achievedRR);
  const profitLoss = toOptionalNumber(payload.profitLoss);
  const pips = toOptionalNumber(payload.pips);
  const status = String(payload.status || "Open").trim();

  if (!symbol) errors.push("Symbol is required.");
  if (!["forex", "stocks", "crypto", "commodities", "indices", "others"].includes(instrument)) {
    errors.push("Instrument is required.");
  }
  if (!["long", "short"].includes(direction)) errors.push("Direction is required.");
  if (!entryPrice || entryPrice <= 0) errors.push("Entry price must be greater than zero.");
  if (!stopLoss || stopLoss <= 0) errors.push("Stop loss must be greater than zero.");
  if (!takeProfit || takeProfit <= 0) errors.push("Take profit must be greater than zero.");
  if (!lotSize || lotSize <= 0) errors.push("Lot size must be greater than zero.");
  if (!riskPercentage || riskPercentage <= 0) errors.push("Risk percentage must be greater than zero.");
  if (!plannedRR || plannedRR <= 0) errors.push("Planned RR must be greater than zero.");
  if (!["Open", "Closed", "Breakeven", "Cancelled"].includes(status)) {
    errors.push("Trade status is invalid.");
  }
  if (session && !["Asian", "Tokyo", "London", "New York"].includes(session)) {
    errors.push("Trading session is invalid.");
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      symbol,
      instrument,
      direction,
      entryPrice,
      ...(exitPrice !== undefined ? { exitPrice } : {}),
      stopLoss,
      takeProfit,
      lotSize,
      riskPercentage,
      plannedRR,
      ...(achievedRR !== undefined ? { achievedRR } : {}),
      ...(profitLoss !== undefined ? { profitLoss } : {}),
      ...(pips !== undefined ? { pips } : {}),
      status,
      ...(session ? { session } : {}),
      openedAt: payload.openedAt ? new Date(payload.openedAt) : new Date(),
      ...(payload.closedAt ? { closedAt: new Date(payload.closedAt) } : {}),
      screenshots: Array.isArray(payload.screenshots) ? payload.screenshots : [],
      notes: String(payload.notes || "").trim(),
    },
  };
}

export { validateJournalInput, validateTradeInput };
