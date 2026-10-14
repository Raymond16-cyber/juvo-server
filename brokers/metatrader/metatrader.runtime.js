import BrokerConnection from "../../models/Broker.model.js";
import BrokerPosition from "../../models/BrokerPosition.model.js";
import BrokerHistoryEvent from "../../models/BrokerHistoryEvent.model.js";
import ConnectorHistorySync from "../../models/ConnectorHistorySync.js";
import TradingAccount from "../../models/tradingAccounts.js";
import { syncMetaAccount, syncMetaPositions, emitMetaLive, importMetaHistory } from "./metatrader.sync.js";
import { liveMetaPosition, pickHistoryEvent } from "./metatrader.mapper.js";
import { connectorError, connectorLog, accountKey } from "./metatrader.security.js";
import { validateEnvelope, validateAccount, validatePosition, validateHistoryRecord, array, integer, text } from "./metatrader.validation.js";
import { emitToUser } from "../../realtime/realtime.hub.js";

export function heartbeatStatus(at, connected, now = Date.now()) {
  const age = now - new Date(at || 0).getTime();
  return !connected || age > 45000 ? "offline" : age > 15000 ? "stale" : "connected";
}
export function durableSignature(positions) {
  return JSON.stringify(positions.map(({ currentPrice, profit, updateTime, ...durable }) => durable).sort((a, b) => a.id.localeCompare(b.id)));
}
export class MetaTraderRuntime {
  constructor() { this.sessions = new Map(); }
  session(connection) {
    const id = String(connection._id);
    if (!this.sessions.has(id)) this.sessions.set(id, { positions: new Map(), sequence: -1, ready: false, touched: Date.now() });
    return this.sessions.get(id);
  }
  async work(connection, action) {
    const state = this.session(connection);
    if (state.busy) throw connectorError("BUSY", "A connector upload is already being processed. Retry shortly.", 429);
    state.busy = true; state.touched = Date.now();
    try {
      if (connection.connectorTokenHash && !await BrokerConnection.exists({ _id: connection._id, desiredConnected: true, connectorTokenHash: connection.connectorTokenHash })) {
        throw connectorError("UNAUTHORIZED", "Connector credential is missing or revoked.", 401);
      }
      return await action(state);
    } finally { state.busy = false; }
  }
  envelope(connection, payload, extra) {
    validateEnvelope(payload, extra);
    if (payload.accountKey !== connection.externalAccountId) throw connectorError("ACCOUNT", "This credential belongs to a different trading account.", 403);
  }
  async heartbeat(connection, payload) {
    this.envelope(connection, payload, ["terminalConnected"]);
    if (typeof payload.terminalConnected !== "boolean") throw connectorError("PAYLOAD", "terminalConnected must be a boolean.");
    const state = this.session(connection);
    const status = payload.terminalConnected ? (connection.historySyncedAt ? "connected" : "synchronizing") : "offline";
    await BrokerConnection.updateOne({ _id: connection._id, desiredConnected: true }, { $set: {
      lastHeartbeatAt: new Date(), terminalConnected: payload.terminalConnected, connectorVersion: payload.connectorVersion, protocolVersion: 1, status,
    } });
    if (!payload.terminalConnected) state.ready = false;
    state.touched = Date.now();
    if (connection.status !== status) emitToUser(connection.userId, "broker:sync-status", { provider: "metatrader", status });
    connectorLog("heartbeat received");
    return { historyCursor: connection.historyCursor || 0, syncRequestedAt: connection.syncRequestedAt?.getTime() || 0, needsReconciliation: !state.ready };
  }
  async account(connection, payload) {
    this.envelope(connection, payload, ["account"]);
    const info = validateAccount(payload.account);
    if (accountKey(info) !== connection.externalAccountId) throw connectorError("ACCOUNT", "Account login or server changed. Pair this account separately.", 403);
    await syncMetaAccount(connection, info);
    emitToUser(connection.userId, "account:update", { accountId: String(connection.tradingAccount), currentBalance: info.balance, currentEquity: info.equity, margin: info.margin, freeMargin: info.freeMargin });
    connectorLog("account snapshot received");
    return {};
  }
  async positions(connection, payload) {
    this.envelope(connection, payload, ["sequence", "positions"]);
    integer(payload.sequence, 1);
    const positions = array(payload.positions, 500).map(validatePosition);
    if (new Set(positions.map((position) => position.id)).size !== positions.length) throw connectorError("PAYLOAD", "Duplicate position identifiers.");
    return this.work(connection, async (state) => {
      if (payload.sequence <= state.sequence) return {};
      const account = await TradingAccount.findOne({ _id: connection.tradingAccount, userId: connection.userId });
      if (!account) throw connectorError("ACCOUNT", "Send an account snapshot before positions.", 409);
      const signature = durableSignature(positions);
      if (signature !== state.signature) await syncMetaPositions(connection, account, positions, state.positions);
      state.signature = signature; state.sequence = payload.sequence; state.ready = true;
      emitMetaLive(connection, positions, state.positions);
      return {};
    });
  }
  async history(connection, payload) {
    this.envelope(connection, payload, ["syncId", "start", "end", "page", "pageCount", "deals", "orders"]);
    text(payload.syncId, 128); integer(payload.start, 0); integer(payload.end, payload.start, Math.floor(Date.now() / 1000) + 86400);
    integer(payload.pageCount, 1, 20000); integer(payload.page, 0, payload.pageCount - 1);
    if (payload.start > Math.max(0, (connection.historyCursor || 0) - 86400)) throw connectorError("HISTORY_GAP", "Replay history from the last acknowledged checkpoint.", 409);
    const deals = array(payload.deals, 100).map((value) => validateHistoryRecord(value, "deal"));
    const orders = array(payload.orders, 100).map((value) => validateHistoryRecord(value, "order"));
    return this.work(connection, async (state) => {
      const filter = { brokerConnection: connection._id, syncId: payload.syncId };
      let batch;
      try { batch = await ConnectorHistorySync.findOneAndUpdate(filter, { $setOnInsert: { ...filter, start: payload.start, end: payload.end, pageCount: payload.pageCount, expiresAt: new Date(Date.now() + 7 * 86400000) } }, { upsert: true, new: true }); }
      catch (error) { if (error.code !== 11000) throw error; batch = await ConnectorHistorySync.findOne(filter); }
      if (batch.start !== payload.start || batch.end !== payload.end || batch.pageCount !== payload.pageCount) throw connectorError("BATCH", "History batch metadata changed.", 409);
      for (const [kind, records] of [["deal", deals], ["order", orders]]) {
        for (const value of records) {
          const eventFilter = { brokerConnection: connection._id, kind, ticket: value.id };
          const update = { $set: { positionId: value.positionId, time: new Date(value.time), data: pickHistoryEvent(value) } };
          try { await BrokerHistoryEvent.updateOne(eventFilter, update, { upsert: true }); }
          catch (error) { if (error.code !== 11000) throw error; await BrokerHistoryEvent.updateOne(eventFilter, update); }
        }
      }
      batch = await ConnectorHistorySync.findOneAndUpdate(filter, { $addToSet: { pages: payload.page } }, { new: true });
      connectorLog("history batch received", { count: deals.length });
      if (batch.pages.length === batch.pageCount && !batch.completedAt) {
        const account = await TradingAccount.findOne({ _id: connection.tradingAccount, userId: connection.userId });
        if (!account) throw connectorError("ACCOUNT", "Account not available.", 409);
        const result = await importMetaHistory(connection, account, { notifySince: connection.historySyncedAt });
        if (result.incomplete) {
          await BrokerConnection.updateOne({ _id: connection._id }, { $set: { lastError: { code: "INCOMPLETE_HISTORY", message: "Some closing deals need missing entry history. Imported history is preserved; JUVO will retry." } } });
        } else {
          await BrokerConnection.updateOne({ _id: connection._id, desiredConnected: true }, { $max: { historyCursor: payload.end }, $set: { historySyncedAt: new Date(), lastSyncedAt: new Date(), lastError: null, status: "connected" } });
          await ConnectorHistorySync.updateOne(filter, { $set: { completedAt: new Date() } });
        }
        emitToUser(connection.userId, "trade:imported", { provider: "metatrader", count: result.imported });
        state.historyReady = !result.incomplete;
      }
      const fresh = await BrokerConnection.findById(connection._id);
      return { historyCursor: fresh.historyCursor || 0 };
    });
  }
  enrichPositionForClient(position) {
    const state = this.sessions.get(String(position.brokerConnection));
    const native = state?.positions.get(position.externalTicket)?.native;
    const { externalAccountId, ...safe } = position;
    return { ...safe, live: state?.ready && Date.now() - state.touched < 15000 && native ? liveMetaPosition(native) : undefined };
  }
  forget(id) { this.sessions.delete(String(id)); }
  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const connections = await BrokerConnection.find({ provider: "metatrader", desiredConnected: true });
      for (const connection of connections) {
        const status = heartbeatStatus(connection.lastHeartbeatAt, connection.terminalConnected);
        if (status !== "connected" && connection.status !== status) {
          await BrokerConnection.updateOne({ _id: connection._id, desiredConnected: true, lastHeartbeatAt: connection.lastHeartbeatAt }, { $set: { status } });
          await TradingAccount.updateOne({ _id: connection.tradingAccount }, { $set: { isConnected: false } });
          if (this.sessions.has(String(connection._id))) this.sessions.get(String(connection._id)).ready = false;
          emitToUser(connection.userId, "broker:sync-status", { provider: "metatrader", status });
        }
      }
      for (const [id, state] of this.sessions) if (!state.busy && Date.now() - state.touched > 60000) this.sessions.delete(id);
    } catch { connectorLog("heartbeat sweep unavailable"); }
    finally { this.sweeping = false; }
  }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.sweep(); }, 5000); this.timer.unref(); void this.sweep(); } }
  stop() { clearInterval(this.timer); this.timer = null; this.sessions.clear(); }
}
export const metatraderRuntime = new MetaTraderRuntime();
