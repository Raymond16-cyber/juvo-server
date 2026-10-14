import BrokerConnection from "../../models/Broker.model.js";
import BrokerPosition from "../../models/BrokerPosition.model.js";
import BrokerHistoryEvent from "../../models/BrokerHistoryEvent.model.js";
import TradingAccount from "../../models/tradingAccounts.js";
import Trade from "../../models/Trades.js";
import Journal from "../../models/Journal.js";
import User from "../../models/User.js";
import { emitToUser } from "../../realtime/realtime.hub.js";
import { getZonedDateParts, zonedTimeToUtc } from "../../utils/timezone.js";
import { mapMetaAccount, mapMetaPosition, normalizeMetaDeals, liveMetaPosition } from "./metatrader.mapper.js";
import { connectorError as metaError, connectorLog as metaLog } from "./metatrader.security.js";

export async function syncMetaAccount(connection, info) {
  const mapped = mapMetaAccount(info, connection);
  if (connection.tradingAccount) {
    const bound = await TradingAccount.findOne({ _id: connection.tradingAccount, userId: connection.userId });
    if (!bound || bound.accountNumber !== mapped.accountNumber || bound.server !== mapped.server) {
      throw metaError("ACCOUNT_CHANGED", "This setup now points to a different trading account. Disconnect and add it as a new account.", 409);
    }
  }
  const filter = { userId: connection.userId, accountNumber: mapped.accountNumber, broker: mapped.broker, platform: mapped.platform };
  let account = await TradingAccount.findOne(filter);
  if (account?.server && account.server !== mapped.server) throw metaError("ACCOUNT_CONFLICT", "This account number is already linked to another broker server.", 409);
  if (account) {
    const other = await BrokerConnection.exists({ provider: "metatrader", tradingAccount: account._id, desiredConnected: true, _id: { $ne: connection._id } });
    if (other) throw metaError("ACCOUNT_CONFLICT", "This MetaTrader account is already connected to JUVO. Disconnect the duplicate setup.", 409);
  }
  const create = {
    $setOnInsert: { ...mapped, userId: connection.userId, initialBalance: Math.max(0, mapped.currentBalance), maxDrawnDown: 0, profitTarget: 0, isActive: false, status: "Active" },
  };
  if (!account) {
    try { account = await TradingAccount.findOneAndUpdate(filter, create, { new: true, upsert: true }); }
    catch (error) { if (error.code !== 11000) throw error; account = await TradingAccount.findOne(filter); }
  }
  // Do not resume synchronization after the owner has revoked the connection.
  try {
    const claimed = await BrokerConnection.updateOne({ _id: connection._id, desiredConnected: true }, { $set: { tradingAccount: account._id } });
    if (!claimed.matchedCount) throw metaError("DISCONNECTED", "This account was disconnected during synchronization.", 409);
  } catch (error) {
    if (error.code === 11000) throw metaError("ACCOUNT_CONFLICT", "This MetaTrader account already has an active JUVO connection.", 409);
    throw error;
  }
  account = await TradingAccount.findOneAndUpdate({ _id: account._id, userId: connection.userId }, {
    $set: { ...mapped, brokerConnection: connection._id },
  }, { new: true });
  connection.tradingAccount = account._id;
  await BrokerConnection.updateOne({ _id: connection._id }, { $set: { tradingAccount: account._id, accountNumber: mapped.accountNumber,
    brokerName: mapped.broker, accountCurrency: mapped.accountCurrency,
    ...(mapped.accountType === "demo" || mapped.accountType === "live" ? { accountType: mapped.accountType } : {}) } });
  return account;
}

export async function syncMetaPositions(connection, account, positions, cache) {
  const seen = [];
  const previous = await BrokerPosition.find({ userId: connection.userId, brokerConnection: connection._id, provider: "metatrader", status: { $in: ["open", "unknown"] } });
  const previousById = new Map(previous.map((position) => [position.externalPositionId, position]));
  for (const native of positions) {
    const mapped = mapMetaPosition(native, connection);
    if (!mapped) throw metaError("POSITION_INCOMPLETE", "A broker position could not be synchronized safely.", 409);
    seen.push(mapped.externalPositionId);
    const old = previousById.get(mapped.externalPositionId);
    const position = await BrokerPosition.findOneAndUpdate({ userId: connection.userId, provider: "metatrader", externalPositionId: mapped.externalPositionId }, {
      $set: { ...mapped, userId: connection.userId, brokerConnection: connection._id, tradingAccount: account._id, moneyCurrency: account.accountCurrency },
      $unset: { closedAt: 1, ...(!Object.hasOwn(mapped, "stopLoss") ? { stopLoss: 1 } : {}), ...(!Object.hasOwn(mapped, "takeProfit") ? { takeProfit: 1 } : {}) },
    }, { new: true, upsert: true });
    cache.set(String(native.id), { _id: String(position._id), userId: String(connection.userId), tradingAccount: String(account._id), native });
    if (!old) metaLog("position opened", { id: String(native.id) });
    else if (old.lotSize !== mapped.lotSize || old.stopLoss !== mapped.stopLoss || old.takeProfit !== mapped.takeProfit) metaLog("position updated", { id: String(native.id) });
  }
  await BrokerPosition.updateMany({ userId: connection.userId, brokerConnection: connection._id, provider: "metatrader", status: { $in: ["open", "unknown"] }, externalPositionId: { $nin: seen } },
    { $set: { status: "closed", closedAt: new Date(), syncedAt: new Date() } });
  for (const old of previous) if (!seen.includes(old.externalPositionId)) {
    cache.delete(old.externalTicket);
    metaLog("position closed", { id: old.externalTicket || old.externalPositionId });
  }
  emitToUser(connection.userId, "position:updated", { provider: "metatrader" });
}

export function emitMetaLive(connection, positions, cache) {
  for (const native of positions) {
    const position = cache.get(String(native.id));
    if (!position) continue;
    position.native = native;
    emitToUser(connection.userId, "position:update", { provider: "metatrader", positionId: position._id,
      tradingAccountId: position.tradingAccount, symbol: native.symbol, side: native.type === "POSITION_TYPE_BUY" ? "long" : "short",
      entryPrice: native.openPrice, ...liveMetaPosition(native) });
  }
}

export async function importMetaHistory(connection, account, { notifySince } = {}) {
  metaLog("historical import started", { id: String(connection._id) });
  const user = await User.findById(connection.userId).select("profile.timezone").lean();
  const timezone = user?.profile?.timezone || "UTC";
  let imported = 0;
  let incomplete = 0;
  // One position at a time bounds memory, while its complete ledger preserves entry costs across partial closes.
  const groups = BrokerHistoryEvent.aggregate([
    { $match: { brokerConnection: connection._id, kind: "deal" } },
    { $group: { _id: "$positionId" } },
  ]).cursor();
  for await (const group of groups) {
    if (!group._id) continue;
    const events = await BrokerHistoryEvent.find({ brokerConnection: connection._id, kind: "deal", positionId: group._id }).select("+data").lean();
    const normalized = normalizeMetaDeals(events.map((event) => event.data), connection);
    incomplete += normalized.incomplete;
    for (const mapped of normalized.trades) {
      const parts = getZonedDateParts(mapped.closedAt, timezone);
      const journalDate = zonedTimeToUtc({ ...parts, hour: 0, minute: 0, second: 0, millisecond: 0 }, timezone);
      const journalFilter = { user: connection.userId, journalDate };
      let journal;
      try {
        journal = await Journal.findOneAndUpdate(journalFilter, { $setOnInsert: { ...journalFilter, tradingAccount: account._id, status: "Started" } }, { new: true, upsert: true });
      } catch (error) { if (error.code !== 11000) throw error; journal = await Journal.findOne(journalFilter); }
      const filter = { user: connection.userId, source: "metatrader", externalId: mapped.externalId };
      const update = { $set: { ...mapped, brokerConnection: connection._id, tradingAccount: account._id, profitLossCurrency: account.accountCurrency },
        $setOnInsert: { user: connection.userId, journal: journal._id, notes: "Imported from MetaTrader." } };
      let result;
      try { result = await Trade.findOneAndUpdate(filter, update, { upsert: true, new: true, includeResultMetadata: true }); }
      catch (error) { if (error.code !== 11000) throw error; result = await Trade.findOneAndUpdate(filter, update, { new: true, includeResultMetadata: true }); }
      const trade = result.value;
      await Journal.updateOne({ _id: trade.journal, user: connection.userId }, { $addToSet: { trades: trade._id } });
      await TradingAccount.updateOne({ _id: account._id, userId: connection.userId }, { $addToSet: { trades: trade._id } });
      if (result.lastErrorObject?.upserted) {
        imported++;
        await User.updateOne({ _id: connection.userId }, { $inc: { "stats.totalTrades": 1 } });
        metaLog("JUVO trade upserted", { id: String(trade._id) });
        if (notifySince && mapped.closedAt >= notifySince) emitToUser(connection.userId, "trade:closed", {
          trade: { _id: String(trade._id), journal: String(trade.journal), symbol: trade.symbol, direction: trade.direction,
            profitLoss: trade.profitLoss, profitLossCurrency: trade.profitLossCurrency }, journalId: String(trade.journal),
        });
      }
    }
  }
  metaLog("historical import complete", { count: imported });
  return { imported, incomplete };
}
