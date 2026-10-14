import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import Trade from "../models/Trades.js";
import BrokerPosition from "../models/BrokerPosition.model.js";
import { mapCTraderDealToTrade, mapCTraderPosition, normalizeUnrealizedPnl, projectLivePosition } from "../brokers/ctrader/ctrader.mapper.js";
import { CTRADER_DEAL_STATUS, CTRADER_POSITION_STATUS, CTRADER_TRADE_SIDE } from "../brokers/ctrader/ctrader.constants.js";

test("cTrader still maps native money, direction, position identity and live P/L", () => {
  const symbolLookup = new Map([["1", "EURUSD"]]);
  const position = mapCTraderPosition({ ctidTraderAccountId: "123", symbolLookup, moneyDigits: 2, position: {
    positionId: 55, price: 1.1, positionStatus: CTRADER_POSITION_STATUS.OPEN, commission: -150,
    tradeData: { symbolId: 1, tradeSide: CTRADER_TRADE_SIDE.BUY, volume: 10000000 },
  } });
  assert.equal(position.provider, "ctrader"); assert.equal(position.externalPositionId, "55"); assert.equal(position.ctidTraderAccountId, "123");
  assert.equal(position.lotSize, 1); assert.equal(position.commission, -1.5);
  const unrealizedPnl = normalizeUnrealizedPnl({ positionId: 55, grossUnrealizedPnL: 1200, netUnrealizedPnL: 1050 }, 2);
  const live = projectLivePosition({ position, quote: { bid: 1.2, ask: 1.21 }, unrealizedPnl });
  assert.equal(live.currentPrice, 1.2); assert.equal(live.netUnrealizedPnl, 10.5);
  const trade = mapCTraderDealToTrade({ ctidTraderAccountId: "123", symbolLookup, moneyDigits: 2, deal: {
    dealId: 99, positionId: 55, symbolId: 1, executionPrice: 1.2, executionTimestamp: 1700000000000,
    tradeSide: CTRADER_TRADE_SIDE.SELL, dealStatus: CTRADER_DEAL_STATUS.FILLED,
    closePositionDetail: { entryPrice: 1.1, closedVolume: 10000000, grossProfit: 1200, commission: -150, swap: -10, pnlConversionFee: -5 },
  } });
  assert.equal(trade.source, "ctrader"); assert.equal(trade.externalId, "123:99"); assert.equal(trade.direction, "long"); assert.equal(trade.profitLoss, 10.35);
});

test("MetaTrader optional fields do not weaken manual trade or cTrader account validation", () => {
  const id = new mongoose.Types.ObjectId();
  const base = { user: id, journal: id, tradingAccount: id, symbol: "EURUSD", instrument: "forex", direction: "long", entryPrice: 1.1, lotSize: 1 };
  assert.equal(new Trade({ ...base, source: "metatrader" }).validateSync(), undefined);
  assert.ok(new Trade({ ...base, source: "manual" }).validateSync().errors.plannedRR);
  const pos = { userId: id, tradingAccount: id, externalPositionId: "account:position", symbol: "EURUSD", direction: "long" };
  assert.equal(new BrokerPosition({ ...pos, provider: "metatrader" }).validateSync(), undefined);
  assert.ok(new BrokerPosition({ ...pos, provider: "ctrader" }).validateSync().errors.ctidTraderAccountId);
  const indexes = Trade.schema.indexes().filter(([keys]) => keys.externalId && keys.user);
  assert.equal(indexes.length, 2);
  assert.equal(indexes.find(([, options]) => options.partialFilterExpression.source === "ctrader")[1].name, undefined);
});
