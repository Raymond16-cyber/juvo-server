import mongoose from "mongoose";

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" && typeof value !== "string") return NaN;
  return String(value).trim() ? Number(value) : NaN;
}

function validateJournalInput(payload = {}) {
  payload = payload || {};
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
  payload = payload || {};
  const errors = [];
  const symbol = String(payload.symbol || "").trim().toUpperCase();
  const instrument = String(payload.instrument || "").trim().toLowerCase();
  const direction = String(payload.direction || "").trim().toLowerCase();
  const session = String(payload.session || "").trim();
  const targetMode =
    String(payload.targetMode || "").trim().toLowerCase() === "price"
      ? "price"
      : "rr";
  const sizingMode =
    String(payload.sizingMode || "").trim().toLowerCase() === "manual"
      ? "manual"
      : "auto";

  const entryPrice = toOptionalNumber(payload.entryPrice);
  const exitPrice = toOptionalNumber(payload.exitPrice);
  const stopLoss = toOptionalNumber(payload.stopLoss);
  const takeProfit = toOptionalNumber(payload.takeProfit);
  const lotSize = toOptionalNumber(payload.lotSize);
  const riskPercentage = toOptionalNumber(payload.riskPercentage);
  const plannedRR = toOptionalNumber(payload.plannedRR);
  const achievedRR = toOptionalNumber(payload.achievedRR);
  const profitLoss = toOptionalNumber(payload.profitLoss);
  const pips = toOptionalNumber(payload.pips);
  const status = String(payload.status || "Open").trim();
  const openedAt = payload.openedAt ? new Date(payload.openedAt) : new Date();
  const tradingAccount = String(payload.tradingAccount || "").trim();

  if (!symbol) errors.push("Symbol is required.");
  if (!["forex", "stocks", "crypto", "commodities", "indices", "others"].includes(instrument)) {
    errors.push("Instrument is required.");
  }
  if (!["long", "short"].includes(direction)) errors.push("Direction is required.");

  for (const [label, value] of Object.entries({
    "Entry price": entryPrice,
    "Stop loss": stopLoss,
    "Risk percentage": riskPercentage,
  })) {
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`${label} must be a finite number greater than zero.`);
    }
  }

  if (Number.isFinite(riskPercentage) && riskPercentage > 100) {
    errors.push("Risk percentage cannot exceed 100.");
  }

  if (targetMode === "rr") {
    if (!Number.isFinite(plannedRR) || plannedRR <= 0) {
      errors.push("Planned RR must be a finite number greater than zero.");
    }
  } else if (!Number.isFinite(takeProfit) || takeProfit <= 0) {
    errors.push("Take profit must be a finite number greater than zero.");
  }

  if (sizingMode === "manual" && (!Number.isFinite(lotSize) || lotSize <= 0)) {
    errors.push("Lot size must be a finite number greater than zero.");
  }

  if (
    Number.isFinite(entryPrice) &&
    Number.isFinite(stopLoss) &&
    direction === "long" &&
    stopLoss >= entryPrice
  ) {
    errors.push("For a long trade, stop loss must be below entry.");
  }
  if (
    Number.isFinite(entryPrice) &&
    Number.isFinite(stopLoss) &&
    direction === "short" &&
    stopLoss <= entryPrice
  ) {
    errors.push("For a short trade, stop loss must be above entry.");
  }
  if (
    Number.isFinite(takeProfit) &&
    Number.isFinite(entryPrice) &&
    direction === "long" &&
    takeProfit <= entryPrice
  ) {
    errors.push("For a long trade, take profit must be above entry.");
  }
  if (
    Number.isFinite(takeProfit) &&
    Number.isFinite(entryPrice) &&
    direction === "short" &&
    takeProfit >= entryPrice
  ) {
    errors.push("For a short trade, take profit must be below entry.");
  }

  if (status !== "Open" || exitPrice !== undefined || profitLoss !== undefined || achievedRR !== undefined || pips !== undefined || payload.closedAt) {
    errors.push("Create an open trade first, then use the close-trade action to record its result.");
  }
  if (!Number.isFinite(openedAt.getTime())) errors.push("Opened date is invalid.");
  if (tradingAccount && !isValidObjectId(tradingAccount)) errors.push("Trading account is invalid.");
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
      ...(Number.isFinite(takeProfit) ? { takeProfit } : {}),
      ...(Number.isFinite(lotSize) ? { lotSize } : {}),
      riskPercentage,
      ...(Number.isFinite(plannedRR) ? { plannedRR } : {}),
      targetMode,
      sizingMode,
      ...(achievedRR !== undefined ? { achievedRR } : {}),
      ...(profitLoss !== undefined ? { profitLoss } : {}),
      ...(pips !== undefined ? { pips } : {}),
      status,
      ...(session ? { session } : {}),
      openedAt,
      ...(tradingAccount ? { tradingAccount } : {}),
      ...(payload.closedAt ? { closedAt: new Date(payload.closedAt) } : {}),
      screenshots: Array.isArray(payload.screenshots) ? payload.screenshots : [],
      notes: String(payload.notes || "").trim(),
    },
  };
}

function validateCompleteJournalInput(payload = {}) {
  payload = payload || {};
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
      : Math.round((disciplineFlags.filter(Boolean).length / answeredFlags) * 100);

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
  payload = payload || {};
  const errors = [];
  const exitPrice = toOptionalNumber(payload.exitPrice);
  const profitLoss = toOptionalNumber(payload.profitLoss);
  const pips = toOptionalNumber(payload.pips);
  const achievedRR = toOptionalNumber(payload.achievedRR);
  const status = String(payload.status || "Closed").trim();
  const notes = String(payload.notes || "").trim();
  const closedAt = payload.closedAt ? new Date(payload.closedAt) : new Date();

  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    errors.push("Exit price must be greater than zero.");
  }
  if (!["Closed", "Breakeven", "Cancelled"].includes(status)) {
    errors.push("Close status is invalid.");
  }
  for (const [label, value] of Object.entries({ "Profit/loss": profitLoss, Pips: pips, "Achieved RR": achievedRR })) {
    if (value !== undefined && !Number.isFinite(value)) errors.push(`${label} must be a finite number.`);
  }
  if (!Number.isFinite(closedAt.getTime())) errors.push("Closed date is invalid.");
  if (["Cancelled", "Breakeven"].includes(status) &&
      ((profitLoss !== undefined && profitLoss !== 0) || (achievedRR !== undefined && achievedRR !== 0))) {
    errors.push("Cancelled and breakeven trades must have zero profit/loss and achieved RR.");
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      exitPrice,
      status,
      closedAt,
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
