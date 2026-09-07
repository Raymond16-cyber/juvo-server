import {
  CTRADER_DEAL_STATUS,
  CTRADER_POSITION_STATUS,
  CTRADER_TRADE_SIDE,
} from "./ctrader.constants.js";

function startOfUtcDay(timestamp) {
  const date = new Date(Number(timestamp || Date.now()));
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function moneyToNumber(value, moneyDigits = 2) {
  const numericValue = Number(value || 0);
  const digits = Number.isFinite(Number(moneyDigits)) ? Number(moneyDigits) : 2;
  return Number((numericValue / 10 ** digits).toFixed(2));
}

function volumeToLots(value) {
  return Number((Number(value || 0) / 10000000).toFixed(2));
}

function buildSymbolLookup(symbols = [], archivedSymbols = []) {
  const lookup = new Map();
  [...symbols, ...archivedSymbols].forEach((symbol) => {
    if (symbol?.symbolId == null) return;
    lookup.set(String(symbol.symbolId), symbol.symbolName || symbol.name);
  });
  return lookup;
}

function buildSymbolMetadataMap(symbols = []) {
  const lookup = new Map();
  symbols.forEach((symbol) => {
    if (symbol?.symbolId == null) return;
    lookup.set(String(symbol.symbolId), symbol);
  });
  return lookup;
}

function inferInstrument(symbol = "") {
  const normalized = symbol.toUpperCase();
  if (normalized.includes("/") || /^[A-Z]{6}$/.test(normalized)) return "forex";
  if (
    normalized.includes("BTC") ||
    normalized.includes("ETH") ||
    normalized.includes("USDT")
  ) {
    return "crypto";
  }
  if (["XAU", "XAG", "OIL", "WTI", "BRENT"].some((key) => normalized.includes(key))) {
    return "commodities";
  }
  if (["US30", "NAS", "SPX", "DAX", "UK100"].some((key) => normalized.includes(key))) {
    return "indices";
  }
  return "others";
}

function getSymbolName(symbolLookup, symbolId) {
  return symbolLookup.get(String(symbolId)) || `SYMBOL-${String(symbolId)}`;
}

function convertSpotPrice(value, symbol = {}) {
  if (value == null) return undefined;
  const digits = Number.isFinite(Number(symbol.digits)) ? Number(symbol.digits) : 5;
  return Number((Number(value) / 100000).toFixed(digits));
}

function getRelevantClosePrice({ direction, bid, ask }) {
  if (direction === "long") return bid;
  if (direction === "short") return ask;
  return undefined;
}

function normalizeUnrealizedPnl(value, moneyDigits = 2) {
  if (!value || value.positionId == null) return null;
  return {
    positionId: String(value.positionId),
    grossUnrealizedPnl: moneyToNumber(value.grossUnrealizedPnL, moneyDigits),
    netUnrealizedPnl: moneyToNumber(value.netUnrealizedPnL, moneyDigits),
    moneyDigits,
  };
}

function projectLivePosition({ position, quote, symbol, unrealizedPnl }) {
  const currentPrice = getRelevantClosePrice({
    direction: position.direction,
    bid: quote?.bid,
    ask: quote?.ask,
  });
  const openedAt = position.openedAt ? new Date(position.openedAt).getTime() : null;

  return {
    currentBid: quote?.bid,
    currentAsk: quote?.ask,
    currentPrice,
    grossUnrealizedPnl: unrealizedPnl?.grossUnrealizedPnl,
    netUnrealizedPnl: unrealizedPnl?.netUnrealizedPnl,
    quoteTimestamp: quote?.timestamp,
    pnlTimestamp: unrealizedPnl?.timestamp,
    symbolDigits: symbol?.digits,
    pipPosition: symbol?.pipPosition,
    durationMs: openedAt ? Math.max(0, Date.now() - openedAt) : undefined,
    floatingPnlIsIndicative: false,
  };
}

function mapCTraderDealToTrade({
  deal,
  ctidTraderAccountId,
  symbolLookup,
  moneyDigits,
}) {
  const closeDetail = deal?.closePositionDetail;
  if (!closeDetail || deal.dealStatus !== CTRADER_DEAL_STATUS.FILLED) return null;

  const symbol = getSymbolName(symbolLookup, deal.symbolId);
  const entryPrice = Number(closeDetail.entryPrice || 0);
  const exitPrice = Number(deal.executionPrice || 0);
  if (!entryPrice || !exitPrice) return null;

  const direction =
    deal.tradeSide === CTRADER_TRADE_SIDE.SELL ? "long" : "short";
  const dealMoneyDigits = closeDetail.moneyDigits ?? deal.moneyDigits ?? moneyDigits;
  const grossProfit = moneyToNumber(closeDetail.grossProfit, dealMoneyDigits);
  const swap = moneyToNumber(closeDetail.swap, dealMoneyDigits);
  const commission = moneyToNumber(closeDetail.commission, dealMoneyDigits);
  const pnlConversionFee = moneyToNumber(
    closeDetail.pnlConversionFee,
    dealMoneyDigits,
  );
  const profitLoss = Number(
    (grossProfit + swap + commission + pnlConversionFee).toFixed(2),
  );

  return {
    symbol,
    instrument: inferInstrument(symbol),
    direction,
    entryPrice,
    exitPrice,
    stopLoss: entryPrice,
    takeProfit: exitPrice,
    lotSize: volumeToLots(closeDetail.closedVolume || deal.filledVolume || deal.volume),
    riskPercentage: 0,
    plannedRR: 0,
    achievedRR: 0,
    profitLoss,
    status: "Closed",
    openedAt: new Date(deal.createTimestamp || deal.executionTimestamp),
    closedAt: new Date(deal.executionTimestamp || deal.createTimestamp),
    notes: "Imported from cTrader.",
    source: "ctrader",
    externalId: `${ctidTraderAccountId}:${deal.dealId}`,
    externalPositionId: deal.positionId != null ? String(deal.positionId) : undefined,
    externalOrderId: deal.orderId != null ? String(deal.orderId) : undefined,
    rawSource: {
      provider: "ctrader",
      ctidTraderAccountId: String(ctidTraderAccountId),
      dealId: deal.dealId,
      orderId: deal.orderId,
      positionId: deal.positionId,
      symbolId: deal.symbolId,
    },
  };
}

function mapCTraderPosition({
  position,
  ctidTraderAccountId,
  symbolLookup,
  moneyDigits,
}) {
  const tradeData = position?.tradeData || {};
  if (!position?.positionId || !tradeData.symbolId) return null;

  const symbol = getSymbolName(symbolLookup, tradeData.symbolId);
  const positionMoneyDigits = position.moneyDigits ?? moneyDigits;

  return {
    provider: "ctrader",
    ctidTraderAccountId: String(ctidTraderAccountId),
    externalPositionId: String(position.positionId),
    symbol,
    symbolId: String(tradeData.symbolId),
    direction:
      tradeData.tradeSide === CTRADER_TRADE_SIDE.SELL ? "short" : "long",
    volume: Number(tradeData.volume || 0),
    lotSize: volumeToLots(tradeData.volume),
    entryPrice: Number(position.price || 0),
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    swap: moneyToNumber(position.swap, positionMoneyDigits),
    commission: moneyToNumber(position.commission, positionMoneyDigits),
    usedMargin: moneyToNumber(position.usedMargin, positionMoneyDigits),
    status:
      position.positionStatus === CTRADER_POSITION_STATUS.CLOSED
        ? "closed"
        : position.positionStatus === CTRADER_POSITION_STATUS.OPEN
          ? "open"
          : "unknown",
    openedAt: tradeData.openTimestamp ? new Date(tradeData.openTimestamp) : undefined,
    closedAt: tradeData.closeTimestamp ? new Date(tradeData.closeTimestamp) : undefined,
    brokerUpdatedAt: position.utcLastUpdateTimestamp
      ? new Date(position.utcLastUpdateTimestamp)
      : undefined,
    syncedAt: new Date(),
    label: tradeData.label,
    comment: tradeData.comment,
    rawSource: {
      provider: "ctrader",
      ctidTraderAccountId: String(ctidTraderAccountId),
      positionId: position.positionId,
      symbolId: tradeData.symbolId,
      positionStatus: position.positionStatus,
    },
  };
}

export {
  buildSymbolLookup,
  buildSymbolMetadataMap,
  convertSpotPrice,
  getRelevantClosePrice,
  inferInstrument,
  mapCTraderDealToTrade,
  mapCTraderPosition,
  moneyToNumber,
  normalizeUnrealizedPnl,
  projectLivePosition,
  startOfUtcDay,
  volumeToLots,
};
