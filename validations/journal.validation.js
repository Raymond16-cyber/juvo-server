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

function validateCompleteJournalInput(payload = {}) {
  const errors = [];
  const afterTrading = String(payload.afterTrading || "").trim();
  const confidenceAfter = toOptionalNumber(payload.confidenceAfter);
  const biggestMistake = String(payload.biggestMistake || "").trim();
  const biggestWin = String(payload.biggestWin || "").trim();
  const lessonLearned = String(payload.lessonLearned || "").trim();
  const improvementsTomorrow = String(payload.improvementsTomorrow || "").trim();
  const overallThoughts = String(payload.overallThoughts || "").trim();
  const followedTradingPlan = payload.followedTradingPlan;
  const followedRiskManagement = payload.followedRiskManagement;
  const revengeTraded = payload.revengeTraded;
  const overTraded = payload.overTraded;
  const respectedStopLoss = payload.respectedStopLoss;

  if (
    confidenceAfter !== undefined &&
    (!Number.isFinite(confidenceAfter) || confidenceAfter < 1 || confidenceAfter > 10)
  ) {
    errors.push("Confidence after trading must be between 1 and 10.");
  }

  const booleanFields = {
    followedTradingPlan,
    followedRiskManagement,
    revengeTraded,
    overTraded,
    respectedStopLoss,
  };

  Object.entries(booleanFields).forEach(([key, value]) => {
    if (value !== undefined && typeof value !== "boolean") {
      errors.push(`${key} must be true or false.`);
    }
  });

  const disciplineFlags = [
    followedTradingPlan === true,
    followedRiskManagement === true,
    revengeTraded === false,
    overTraded === false,
    respectedStopLoss === true,
  ];
  const answeredFlags = [
    followedTradingPlan,
    followedRiskManagement,
    revengeTraded,
    overTraded,
    respectedStopLoss,
  ].filter((value) => typeof value === "boolean").length;
  const score =
    answeredFlags === 0
      ? undefined
      : Math.round((disciplineFlags.filter(Boolean).length / 5) * 100);

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      psychology: {
        ...(afterTrading ? { afterTrading } : {}),
        ...(confidenceAfter !== undefined ? { confidenceAfter } : {}),
      },
      review: {
        ...(biggestMistake ? { biggestMistake } : {}),
        ...(biggestWin ? { biggestWin } : {}),
        ...(lessonLearned ? { lessonLearned } : {}),
        ...(improvementsTomorrow ? { improvementsTomorrow } : {}),
        ...(overallThoughts ? { overallThoughts } : {}),
      },
      discipline: {
        ...(typeof followedTradingPlan === "boolean" ? { followedTradingPlan } : {}),
        ...(typeof followedRiskManagement === "boolean"
          ? { followedRiskManagement }
          : {}),
        ...(typeof revengeTraded === "boolean" ? { revengeTraded } : {}),
        ...(typeof overTraded === "boolean" ? { overTraded } : {}),
        ...(typeof respectedStopLoss === "boolean" ? { respectedStopLoss } : {}),
        ...(score !== undefined ? { score } : {}),
      },
    },
  };
}

function validateCloseTradeInput(payload = {}) {
  const errors = [];
  const exitPrice = Number(payload.exitPrice);
  const profitLoss = toOptionalNumber(payload.profitLoss);
  const pips = toOptionalNumber(payload.pips);
  const achievedRR = toOptionalNumber(payload.achievedRR);
  const status = String(payload.status || "Closed").trim();
  const notes = String(payload.notes || "").trim();

  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    errors.push("Exit price must be greater than zero.");
  }
  if (!["Closed", "Breakeven", "Cancelled"].includes(status)) {
    errors.push("Close status is invalid.");
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      exitPrice,
      status,
      closedAt: payload.closedAt ? new Date(payload.closedAt) : new Date(),
      ...(profitLoss !== undefined ? { profitLoss } : {}),
      ...(pips !== undefined ? { pips } : {}),
      ...(achievedRR !== undefined ? { achievedRR } : {}),
      ...(notes ? { notes } : {}),
    },
  };
}

export {
  validateCloseTradeInput,
  validateCompleteJournalInput,
  validateJournalInput,
  validateTradeInput,
};
