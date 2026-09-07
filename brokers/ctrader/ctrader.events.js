import BrokerConnection from "../../models/Broker.model.js";
import BrokerPosition from "../../models/BrokerPosition.model.js";
import Journal from "../../models/Journal.js";
import Trade from "../../models/Trades.js";
import TradingAccount from "../../models/tradingAccounts.js";
import User from "../../models/User.js";
import { emitToUser } from "../../realtime/realtime.hub.js";
import { brokerLog, brokerWarn } from "../../utils/brokerDebug.js";
import {
  CTRADER_DEAL_STATUS,
  CTRADER_EXECUTION_TYPE,
  CTRADER_POSITION_STATUS,
} from "./ctrader.constants.js";
import {
  buildSymbolLookup,
  mapCTraderDealToTrade,
  mapCTraderPosition,
  startOfUtcDay,
} from "./ctrader.mapper.js";

function safeTradeForRealtime(trade) {
  const plain = trade?.toObject?.() || trade;
  return {
    _id: String(plain._id),
    journal: String(plain.journal),
    tradingAccount: String(plain.tradingAccount),
    symbol: plain.symbol,
    instrument: plain.instrument,
    direction: plain.direction,
    entryPrice: plain.entryPrice,
    exitPrice: plain.exitPrice,
    stopLoss: plain.stopLoss,
    takeProfit: plain.takeProfit,
    lotSize: plain.lotSize,
    riskPercentage: plain.riskPercentage,
    plannedRR: plain.plannedRR,
    achievedRR: plain.achievedRR,
    profitLoss: plain.profitLoss,
    status: plain.status,
    source: plain.source,
    externalId: plain.externalId,
    externalPositionId: plain.externalPositionId,
    externalOrderId: plain.externalOrderId,
    openedAt: plain.openedAt,
    closedAt: plain.closedAt,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

function safePositionForRealtime(position) {
  const plain = position?.toObject?.() || position;
  return {
    _id: String(plain._id),
    tradingAccount: String(plain.tradingAccount),
    brokerConnection: plain.brokerConnection
      ? String(plain.brokerConnection)
      : undefined,
    provider: plain.provider,
    ctidTraderAccountId: plain.ctidTraderAccountId,
    externalPositionId: plain.externalPositionId,
    symbol: plain.symbol,
    symbolId: plain.symbolId,
    direction: plain.direction,
    volume: plain.volume,
    lotSize: plain.lotSize,
    entryPrice: plain.entryPrice,
    stopLoss: plain.stopLoss,
    takeProfit: plain.takeProfit,
    swap: plain.swap,
    commission: plain.commission,
    usedMargin: plain.usedMargin,
    status: plain.status,
    openedAt: plain.openedAt,
    brokerUpdatedAt: plain.brokerUpdatedAt,
    syncedAt: plain.syncedAt,
    closedAt: plain.closedAt,
    label: plain.label,
    comment: plain.comment,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

async function resolveCTraderOwner(ctidTraderAccountId) {
  const connection = await BrokerConnection.findOne({
    provider: "ctrader",
    externalAccountId: String(ctidTraderAccountId),
    status: "connected",
  }).sort({ updatedAt: -1 });

  if (!connection) return null;

  const tradingAccount = await TradingAccount.findOne({
    userId: connection.userId,
    accountNumber: String(ctidTraderAccountId),
    platform: "ctrader",
    isArchived: false,
  }).sort({ updatedAt: -1 });

  if (!tradingAccount) return null;

  return {
    userId: connection.userId,
    brokerConnectionId: connection._id,
    tradingAccount,
    connection,
  };
}

async function findOrCreateImportedJournal({ userId, tradingAccountId, timestamp }) {
  const journalDate = startOfUtcDay(timestamp);
  return Journal.findOneAndUpdate(
    {
      user: userId,
      journalDate,
    },
    {
      $setOnInsert: {
        user: userId,
        tradingAccount: tradingAccountId,
        journalDate,
        status: "Started",
        psychology: {},
        review: {},
        discipline: {},
      },
    },
    { new: true, upsert: true },
  );
}

async function upsertOpenPosition({ owner, payload, symbolLookup, moneyDigits }) {
  const mapped = mapCTraderPosition({
    position: payload.position,
    ctidTraderAccountId: payload.ctidTraderAccountId,
    symbolLookup,
    moneyDigits,
  });

  if (!mapped) return null;

  const position = await BrokerPosition.findOneAndUpdate(
    {
      userId: owner.userId,
      provider: "ctrader",
      ctidTraderAccountId: mapped.ctidTraderAccountId,
      externalPositionId: mapped.externalPositionId,
    },
    {
      $set: {
        ...mapped,
        userId: owner.userId,
        tradingAccount: owner.tradingAccount._id,
        brokerConnection: owner.brokerConnectionId,
      },
    },
    { new: true, upsert: true },
  );

  emitToUser(owner.userId, "position:updated", {
    provider: "ctrader",
    position: safePositionForRealtime(position),
  });

  return position;
}

async function upsertClosedTrade({ owner, payload, symbolLookup, moneyDigits }) {
  const deal = payload.deal;
  if (!deal || deal.dealStatus !== CTRADER_DEAL_STATUS.FILLED) return null;

  const mapped = mapCTraderDealToTrade({
    deal,
    ctidTraderAccountId: payload.ctidTraderAccountId,
    symbolLookup,
    moneyDigits,
  });

  if (!mapped) return null;

  const existing = await Trade.findOne({
    user: owner.userId,
    source: "ctrader",
    externalId: mapped.externalId,
  }).select("_id notes screenshots session");

  const journal = await findOrCreateImportedJournal({
    userId: owner.userId,
    tradingAccountId: owner.tradingAccount._id,
    timestamp: mapped.closedAt,
  });

  const trade = await Trade.findOneAndUpdate(
    {
      user: owner.userId,
      source: "ctrader",
      externalId: mapped.externalId,
    },
    {
      $set: {
        ...mapped,
        notes: existing?.notes || mapped.notes,
        screenshots: existing?.screenshots || mapped.screenshots,
        session: existing?.session || mapped.session,
        user: owner.userId,
        journal: journal._id,
        tradingAccount: owner.tradingAccount._id,
      },
    },
    { new: true, upsert: true },
  );

  await Promise.all([
    Journal.updateOne({ _id: journal._id }, { $addToSet: { trades: trade._id } }),
    TradingAccount.updateOne(
      { _id: owner.tradingAccount._id },
      { $addToSet: { trades: trade._id }, $set: { lastSyncedAt: new Date() } },
    ),
    BrokerPosition.updateOne(
      {
        userId: owner.userId,
        provider: "ctrader",
        ctidTraderAccountId: String(payload.ctidTraderAccountId),
        externalPositionId: String(deal.positionId),
      },
      {
        $set: {
          status: "closed",
          closedAt: mapped.closedAt,
          syncedAt: new Date(),
        },
      },
    ),
    BrokerConnection.updateOne(
      { _id: owner.brokerConnectionId },
      { $set: { lastSyncedAt: new Date() } },
    ),
    existing
      ? Promise.resolve()
      : User.findByIdAndUpdate(owner.userId, { $inc: { "stats.totalTrades": 1 } }),
  ]);

  brokerLog("juvo:trade:saved", {
    userId: String(owner.userId),
    tradeId: String(trade._id),
    symbol: trade.symbol,
    externalId: trade.externalId,
  });

  emitToUser(owner.userId, "trade:closed", {
    trade: safeTradeForRealtime(trade),
    journalId: String(journal._id),
  });

  brokerLog("realtime:trade:closed:emitted", {
    userId: String(owner.userId),
    tradeId: String(trade._id),
  });

  return trade;
}

async function handleCTraderExecutionEvent({ payload, context }) {
  const ctidTraderAccountId = payload?.ctidTraderAccountId;

  brokerLog("ctrader:execution:event", {
    ctidTraderAccountId: ctidTraderAccountId ? String(ctidTraderAccountId) : null,
    executionType: payload?.executionType,
    positionStatus: payload?.position?.positionStatus,
    positionId: payload?.position?.positionId || payload?.deal?.positionId,
    dealId: payload?.deal?.dealId,
  });

  if (!ctidTraderAccountId) return null;

  const owner =
    context?.accounts?.get(String(ctidTraderAccountId)) ||
    (await resolveCTraderOwner(ctidTraderAccountId));

  if (!owner) {
    brokerWarn("ctrader:execution:owner-not-found", {
      ctidTraderAccountId: String(ctidTraderAccountId),
    });
    return null;
  }

  const symbolLookup =
    context?.symbolLookups?.get(String(ctidTraderAccountId)) || buildSymbolLookup();
  const moneyDigits =
    context?.moneyDigitsByAccount?.get(String(ctidTraderAccountId)) ?? 2;
  const symbolId = payload.position?.tradeData?.symbolId || payload.deal?.symbolId;
  const positionId = payload.position?.positionId || payload.deal?.positionId;

  if (
    payload.position?.positionStatus === CTRADER_POSITION_STATUS.OPEN ||
    payload.executionType === CTRADER_EXECUTION_TYPE.ORDER_FILLED ||
    payload.executionType === CTRADER_EXECUTION_TYPE.ORDER_PARTIAL_FILL
  ) {
    await upsertOpenPosition({ owner, payload, symbolLookup, moneyDigits });
    await context?.ensureSpotSubscription?.({
      ctidTraderAccountId,
      symbolId,
      positionId,
    });
  }

  if (payload.position?.positionStatus === CTRADER_POSITION_STATUS.CLOSED) {
    brokerLog("ctrader:position:closed", {
      ctidTraderAccountId: String(ctidTraderAccountId),
      positionId: String(payload.position.positionId),
    });

    const trade = await upsertClosedTrade({ owner, payload, symbolLookup, moneyDigits });
    await context?.releaseSpotSubscription?.({
      ctidTraderAccountId,
      symbolId,
      positionId,
    });
    context?.releasePositionPnl?.({
      ctidTraderAccountId,
      positionId,
    });
    return trade;
  }

  return null;
}

export {
  handleCTraderExecutionEvent,
  resolveCTraderOwner,
  safePositionForRealtime,
  safeTradeForRealtime,
};
