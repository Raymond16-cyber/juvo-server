import { currencyService } from "../currency/currency.service.js";
import { roundMoney } from "../currency/currency.utils.js";
import { resolveInstrumentSpec } from "./instrumentSpecs.js";

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundDownToStep(value, step) {
  const amount = Number(value);
  const increment = Number(step);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isFinite(increment) || increment <= 0) {
    return Number(amount.toFixed(8));
  }
  const scaled = Math.floor(amount / increment + 1e-12) * increment;
  const decimals = String(increment).includes(".")
    ? String(increment).split(".")[1].length
    : 0;
  return Number(scaled.toFixed(Math.min(8, decimals)));
}

function calculateRiskAmount({ riskPercentage, equity, balance }) {
  const riskPct = toFiniteNumber(riskPercentage);
  const equityValue = toFiniteNumber(equity);
  const balanceValue = toFiniteNumber(balance);

  if (riskPct == null || riskPct <= 0) {
    return {
      riskAmount: null,
      riskBasis: null,
      riskBasisValue: null,
      error: "Risk percentage is required.",
    };
  }

  if (equityValue != null && equityValue > 0) {
    return {
      riskAmount: roundMoney((equityValue * riskPct) / 100),
      riskBasis: "equity",
      riskBasisValue: equityValue,
      error: null,
    };
  }

  if (balanceValue != null && balanceValue > 0) {
    return {
      riskAmount: roundMoney((balanceValue * riskPct) / 100),
      riskBasis: "balance",
      riskBasisValue: balanceValue,
      error: null,
    };
  }

  return {
    riskAmount: null,
    riskBasis: null,
    riskBasisValue: null,
    error: "Account equity/balance is unavailable for risk sizing.",
  };
}

function validatePriceSide({ direction, entryPrice, stopLoss, takeProfit }) {
  const errors = [];
  const entry = toFiniteNumber(entryPrice);
  const stop = toFiniteNumber(stopLoss);
  const target = toFiniteNumber(takeProfit);

  if (entry == null || entry <= 0) errors.push("Entry price must be greater than zero.");
  if (stop == null || stop <= 0) errors.push("Stop loss must be greater than zero.");

  if (entry != null && stop != null) {
    if (direction === "long" && stop >= entry) {
      errors.push("For a long trade, stop loss must be below entry.");
    }
    if (direction === "short" && stop <= entry) {
      errors.push("For a short trade, stop loss must be above entry.");
    }
  }

  if (target != null && target > 0 && entry != null) {
    if (direction === "long" && target <= entry) {
      errors.push("For a long trade, take profit must be above entry.");
    }
    if (direction === "short" && target >= entry) {
      errors.push("For a short trade, take profit must be below entry.");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    entry,
    stop,
    target,
  };
}

function calculateStopDistance({ direction, entryPrice, stopLoss }) {
  const entry = toFiniteNumber(entryPrice);
  const stop = toFiniteNumber(stopLoss);
  if (entry == null || stop == null) return null;
  const distance =
    direction === "short" ? entry - stop : stop < entry ? entry - stop : stop - entry;
  return Math.abs(distance);
}

function calculateTakeProfitFromRr({ direction, entryPrice, stopLoss, plannedRR }) {
  const entry = toFiniteNumber(entryPrice);
  const stop = toFiniteNumber(stopLoss);
  const rr = toFiniteNumber(plannedRR);
  if (entry == null || stop == null || rr == null || rr <= 0) return null;
  const riskDistance = Math.abs(entry - stop);
  if (!riskDistance) return null;
  const rewardDistance = riskDistance * rr;
  return direction === "short"
    ? Number((entry - rewardDistance).toFixed(8))
    : Number((entry + rewardDistance).toFixed(8));
}

function calculateRiskReward({ direction, entryPrice, stopLoss, takeProfit }) {
  const entry = toFiniteNumber(entryPrice);
  const stop = toFiniteNumber(stopLoss);
  const target = toFiniteNumber(takeProfit);
  if (entry == null || stop == null || target == null) return null;
  const riskDistance = Math.abs(entry - stop);
  const rewardDistance = Math.abs(target - entry);
  if (!riskDistance) return null;
  if (direction === "long" && !(stop < entry && target > entry)) return null;
  if (direction === "short" && !(stop > entry && target < entry)) return null;
  return Number((rewardDistance / riskDistance).toFixed(4));
}

/**
 * Loss in quote currency for 1 lot/unit at the stop distance.
 * Forex: stopDistance * contractSize
 * Stocks/crypto (contractSize 1): stopDistance * quantity unit = stopDistance
 */
function lossPerLotInQuoteCurrency({ spec, stopDistance }) {
  if (!spec?.known || !Number.isFinite(stopDistance) || stopDistance <= 0) {
    return null;
  }
  const contractSize = Number(spec.contractSize);
  if (!Number.isFinite(contractSize) || contractSize <= 0) return null;
  return stopDistance * contractSize;
}

async function convertQuoteRiskToAccount({
  lossPerLotQuote,
  quoteCurrency,
  accountCurrency,
}) {
  if (lossPerLotQuote == null) {
    return { lossPerLotAccount: null, fx: null, error: "Loss per lot unavailable." };
  }

  const quote = String(quoteCurrency || "").toUpperCase() || null;
  const account = String(accountCurrency || "").toUpperCase() || null;

  if (!quote || !account) {
    // Assume same currency when unknown — mark approximate.
    return {
      lossPerLotAccount: lossPerLotQuote,
      fx: {
        from: quote,
        to: account,
        rate: 1,
        source: "assumed-same-currency",
        kind: "reference",
      },
      error: null,
      assumedSameCurrency: true,
    };
  }

  if (quote === account) {
    return {
      lossPerLotAccount: lossPerLotQuote,
      fx: {
        from: quote,
        to: account,
        rate: 1,
        source: "same-currency",
        kind: "reference",
      },
      error: null,
      assumedSameCurrency: false,
    };
  }

  try {
    const conversion = await currencyService.convert({
      amount: lossPerLotQuote,
      from: quote,
      to: account,
      kind: "current",
    });
    return {
      lossPerLotAccount: conversion.amount,
      fx: {
        from: conversion.from,
        to: conversion.to,
        rate: conversion.rate,
        rateAt: conversion.rateAt,
        source: conversion.source,
        kind: "reference",
      },
      error: null,
      assumedSameCurrency: false,
    };
  } catch (error) {
    return {
      lossPerLotAccount: null,
      fx: null,
      error:
        error?.message ||
        "Reference FX rate unavailable for quote-to-account conversion.",
      assumedSameCurrency: false,
    };
  }
}

function calculatePositionSize({
  riskAmount,
  lossPerLotAccount,
  volumeStep,
  minVolume,
}) {
  if (
    riskAmount == null ||
    riskAmount <= 0 ||
    lossPerLotAccount == null ||
    lossPerLotAccount <= 0
  ) {
    return {
      lotSize: null,
      sizingMode: "manual",
      confidence: "unavailable",
      note: "Unable to size position automatically.",
    };
  }

  const raw = riskAmount / lossPerLotAccount;
  const stepped = roundDownToStep(raw, volumeStep || 0.01);
  const min = Number(minVolume) > 0 ? Number(minVolume) : 0;
  if (stepped < min) {
    return {
      lotSize: null,
      sizingMode: "manual",
      confidence: "unavailable",
      note: `Calculated size ${raw.toFixed(4)} is below the minimum tradable volume (${min}). Reduce stop distance or increase risk, or enter size manually.`,
      rawSize: raw,
    };
  }

  return {
    lotSize: stepped,
    sizingMode: "auto",
    confidence: "high",
    note: "Position size rounded down to the volume step so planned risk is not exceeded.",
    rawSize: raw,
  };
}

/**
 * Full planned trade setup calculation (not realized P/L).
 */
async function calculateTradeSetup(input = {}) {
  const direction = String(input.direction || "").toLowerCase();
  const targetMode =
    String(input.targetMode || "").toLowerCase() === "price" ? "price" : "rr";
  const warnings = [];
  const errors = [];

  const priceCheck = validatePriceSide({
    direction,
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
    takeProfit: targetMode === "price" ? input.takeProfit : undefined,
  });
  errors.push(...priceCheck.errors);

  const risk = calculateRiskAmount({
    riskPercentage: input.riskPercentage,
    equity: input.equity,
    balance: input.balance,
  });
  if (risk.error) warnings.push(risk.error);

  const stopDistance = calculateStopDistance({
    direction,
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
  });

  let takeProfit = toFiniteNumber(input.takeProfit);
  let plannedRR = toFiniteNumber(input.plannedRR);

  if (targetMode === "rr") {
    if (plannedRR == null || plannedRR <= 0) {
      errors.push("Planned risk-to-reward must be greater than zero.");
    } else {
      takeProfit = calculateTakeProfitFromRr({
        direction,
        entryPrice: input.entryPrice,
        stopLoss: input.stopLoss,
        plannedRR,
      });
      if (takeProfit == null) {
        errors.push("Unable to derive take-profit from the supplied RR.");
      }
    }
  } else {
    if (takeProfit == null || takeProfit <= 0) {
      errors.push("Take-profit price must be greater than zero.");
    } else {
      plannedRR = calculateRiskReward({
        direction,
        entryPrice: input.entryPrice,
        stopLoss: input.stopLoss,
        takeProfit,
      });
      if (plannedRR == null) {
        errors.push("Unable to derive risk-to-reward from the supplied prices.");
      }
    }
  }

  const spec = resolveInstrumentSpec({
    symbol: input.symbol,
    instrument: input.instrument,
  });

  if (!spec.known || spec.confidence === "unavailable") {
    warnings.push(spec.note || "Instrument specification unavailable.");
  } else if (spec.confidence === "approximate") {
    warnings.push(spec.note || "Instrument specification is approximate.");
  }

  const lossPerLotQuote = lossPerLotInQuoteCurrency({
    spec,
    stopDistance,
  });

  const quoteCurrency =
    spec.quoteCurrency ||
    String(input.quoteCurrency || "").toUpperCase() ||
    null;
  const accountCurrency = String(input.accountCurrency || "").toUpperCase() || null;

  const fxConversion = await convertQuoteRiskToAccount({
    lossPerLotQuote,
    quoteCurrency,
    accountCurrency,
  });
  if (fxConversion.error) warnings.push(fxConversion.error);
  if (fxConversion.assumedSameCurrency && quoteCurrency == null) {
    warnings.push(
      "Quote currency unknown; sizing assumes quote currency matches the account.",
    );
  }

  let lotSize = toFiniteNumber(input.lotSize);
  let sizing = {
    lotSize: null,
    sizingMode: input.sizingMode === "manual" ? "manual" : "auto",
    confidence: "unavailable",
    note: null,
  };

  if (input.sizingMode === "manual" && lotSize != null && lotSize > 0) {
    sizing = {
      lotSize,
      sizingMode: "manual",
      confidence: "manual",
      note: "Using manually entered position size.",
    };
  } else if (spec.known && risk.riskAmount != null && fxConversion.lossPerLotAccount) {
    sizing = calculatePositionSize({
      riskAmount: risk.riskAmount,
      lossPerLotAccount: fxConversion.lossPerLotAccount,
      volumeStep: spec.volumeStep,
      minVolume: spec.minVolume,
    });
    sizing.confidence =
      spec.confidence === "high" && !fxConversion.assumedSameCurrency
        ? sizing.lotSize
          ? "high"
          : "unavailable"
        : sizing.lotSize
          ? "approximate"
          : "unavailable";
    if (sizing.note && sizing.confidence !== "unavailable") {
      // keep note
    }
    if (spec.note && sizing.confidence === "approximate") {
      warnings.push(spec.note);
    }
    lotSize = sizing.lotSize;
  } else if (lotSize != null && lotSize > 0) {
    sizing = {
      lotSize,
      sizingMode: "manual",
      confidence: "manual",
      note: "Automatic sizing unavailable; using provided size.",
    };
  } else {
    sizing.note =
      sizing.note ||
      "Automatic sizing unavailable. Enter position size manually.";
    warnings.push(sizing.note);
  }

  const estimatedReward =
    risk.riskAmount != null && plannedRR != null
      ? roundMoney(risk.riskAmount * plannedRR)
      : null;

  const estimatedRiskAtStop =
    lotSize != null && fxConversion.lossPerLotAccount != null
      ? roundMoney(lotSize * fxConversion.lossPerLotAccount)
      : risk.riskAmount;

  return {
    success: errors.length === 0 && (lotSize != null && lotSize > 0),
    errors,
    warnings,
    values: {
      symbol: spec.symbol || String(input.symbol || "").toUpperCase(),
      instrument: spec.assetClass || input.instrument,
      direction,
      entryPrice: priceCheck.entry,
      stopLoss: priceCheck.stop,
      takeProfit,
      plannedRR,
      riskPercentage: toFiniteNumber(input.riskPercentage),
      lotSize,
      targetMode,
      stopDistance,
      riskAmount: risk.riskAmount,
      riskBasis: risk.riskBasis,
      riskBasisValue: risk.riskBasisValue,
      estimatedReward,
      estimatedRiskAtStop,
      sizingMode: sizing.sizingMode,
      sizingConfidence: sizing.confidence,
      sizingNote: sizing.note,
      fx: fxConversion.fx,
      instrumentSpec: {
        known: Boolean(spec.known),
        confidence: spec.confidence,
        contractSize: spec.contractSize ?? null,
        quoteCurrency: quoteCurrency,
        volumeStep: spec.volumeStep ?? null,
        minVolume: spec.minVolume ?? null,
        note: spec.note || null,
      },
    },
  };
}

export {
  calculateRiskAmount,
  calculateRiskReward,
  calculateStopDistance,
  calculateTakeProfitFromRr,
  calculateTradeSetup,
  roundDownToStep,
  validatePriceSide,
};
