import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import express from "express";
import connectorRoutes from "../brokers/metatrader/metatrader.routes.js";
import BrokerConnection from "../models/Broker.model.js";
import BrokerPosition from "../models/BrokerPosition.model.js";
import TradingAccount from "../models/tradingAccounts.js";
import ConnectorPairing from "../models/ConnectorPairing.js";
import ConnectorHistorySync from "../models/ConnectorHistorySync.js";
import BrokerHistoryEvent from "../models/BrokerHistoryEvent.model.js";
import Trade from "../models/Trades.js";
import User from "../models/User.js";
import { hash, accountKey, newPairingCode, tokenForPair, connectorConfig, authenticateMetaTraderConnector } from "../brokers/metatrader/metatrader.security.js";
import { createPairingCode, pairConnector, revokeConnector, ownedConnector } from "../brokers/metatrader/metatrader.pairing.js";
import { MetaTraderRuntime, durableSignature, heartbeatStatus } from "../brokers/metatrader/metatrader.runtime.js";
import { validatePosition, validateHistoryRecord } from "../brokers/metatrader/metatrader.validation.js";
import { migrateLegacyMetaApi } from "../brokers/metatrader/metatrader.migration.js";

const account = { login: "18446744073709551615", server: "Broker-Demo", broker: "Broker", currency: "EUR", type: "ACCOUNT_TRADE_MODE_DEMO", leverage: 100, balance: 1000, equity: 1002, margin: 20, freeMargin: 982 };
const connection = { _id: "connection", userId: "owner", platform: "mt5", externalAccountId: accountKey(account), desiredConnected: true, tradingAccount: "account", historyCursor: 0 };
const envelope = (extra = {}) => ({ protocolVersion: 1, connectorVersion: "1.0.0", accountKey: connection.externalAccountId, timestamp: Date.now(), ...extra });
const position = { id: "18446744073709551615", ticket: "7", symbol: "EURUSD", type: "POSITION_TYPE_BUY", reason: "POSITION_REASON_EXPERT", magic: "18446744073709551615", comment: "", volume: 1, openPrice: 1.1, currentPrice: 1.2, profit: 2, swap: -0.1, time: 1700000000000, updateTime: 1700000000000 };

test("connector configuration accepts HTTPS and explicit development loopback, not public HTTP", () => {
  assert.equal(connectorConfig({ NODE_ENV: "production", JWT_SECRET: "test" }).enabled, false);
  assert.equal(connectorConfig({ NODE_ENV: "production", JWT_SECRET: "test", MT5_CONNECTOR_URL: "https://api.example.com" }).enabled, true);
  assert.throws(() => connectorConfig({ NODE_ENV: "production", MT5_CONNECTOR_URL: "http://localhost:5000" }));
  assert.throws(() => connectorConfig({ MT5_CONNECTOR_URL: "http://api.example.com" }));
  assert.throws(() => connectorConfig({ MT5_CONNECTOR_URL: "https://user:password@example.com" }));
});

test("pairing codes have bounded entropy and tokens are scoped opaque credentials, not JWTs", (t) => {
  t.mock.method(process, "emitWarning", () => {});
  const old = process.env.JWT_SECRET; process.env.JWT_SECRET = "test-secret";
  t.after(() => { if (old === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = old; });
  const codes = new Set(Array.from({ length: 1000 }, newPairingCode));
  assert.equal(codes.size, 1000);
  for (const code of codes) assert.match(code, /^JUV-([A-HJ-NP-Z2-9]{4}-){2}[A-HJ-NP-Z2-9]{4}$/);
  const pair = { _id: "pair", codeHash: hash("code"), attemptHash: hash("attempt"), accountKey: accountKey(account) };
  assert.match(tokenForPair(pair), /^jmt_[\w-]{43}$/);
  assert.equal(tokenForPair(pair), tokenForPair(pair));
  assert.notEqual(tokenForPair(pair), tokenForPair({ ...pair, accountKey: "another-account" }));
  assert.equal(accountKey(account), accountKey({ ...account, server: " broker-demo " }));
  assert.notEqual(accountKey(account), accountKey({ ...account, server: "Broker-Live" }));
});

test("pairing creation persists only the hash and expires after ten minutes", async (t) => {
  const old = process.env.JWT_SECRET; process.env.JWT_SECRET = "test-secret";
  t.after(() => { if (old === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = old; });
  t.mock.method(ConnectorPairing, "updateMany", async () => ({}));
  let saved;
  t.mock.method(ConnectorPairing, "create", async (value) => { saved = value; return value; });
  const result = await createPairingCode("owner");
  assert.equal(saved.userId, "owner"); assert.equal(saved.codeHash, hash(result.code)); assert.equal(saved.code, undefined);
  assert.ok(saved.expiresAt - Date.now() > 599000 && saved.expiresAt - Date.now() <= 600000);
});

test("expired or consumed pairing codes fail before account creation", async (t) => {
  let filter;
  t.mock.method(ConnectorPairing, "findOneAndUpdate", (value) => { filter = value; return { select: async () => null }; });
  await assert.rejects(pairConnector({ protocolVersion: 1, connectorVersion: "1.0.0", code: "JUV-ABCD-EFGH-JKLM", attemptId: "retry-attempt", account }), /expired|already/);
  assert.ok(filter.expiresAt.$gt instanceof Date);
  assert.deepEqual(filter.$or[1], { attemptHash: hash("retry-attempt"), accountKey: accountKey(account) });
});

test("an identical pairing retry returns the same token and account, while a different attempt is refused", async (t) => {
  const old = process.env.JWT_SECRET; process.env.JWT_SECRET = "test-secret";
  t.after(() => { if (old === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = old; });
  let stored = null, consumed = null;
  const pair = { _id: "pair", userId: "owner", createdAt: new Date() };
  t.mock.method(ConnectorPairing, "findOneAndUpdate", (filter, update) => ({ select: async () => {
    if (consumed && consumed !== update.$set.attemptHash) return null;
    consumed = update.$set.attemptHash;
    return { ...pair, codeHash: filter.codeHash, ...update.$set };
  } }));
  t.mock.method(BrokerConnection, "findOne", () => ({ select: async () => stored }));
  t.mock.method(BrokerConnection, "findOneAndUpdate", async (filter, update) => {
    assert.equal(filter.$and[1].$or[1].desiredConnected, true);
    stored = { ...connection, ...update.$set }; return stored;
  });
  t.mock.method(BrokerConnection, "updateOne", async () => ({ matchedCount: 1 }));
  t.mock.method(BrokerConnection, "exists", async () => null);
  const trading = { _id: "account", accountNumber: account.login, server: account.server, accountCurrency: "EUR" };
  t.mock.method(TradingAccount, "findOne", async () => trading);
  t.mock.method(TradingAccount, "findOneAndUpdate", async () => trading);
  const input = { protocolVersion: 1, connectorVersion: "1.0.0", code: "JUV-ABCD-EFGH-JKLM", attemptId: "same-attempt", account };
  const first = await pairConnector(input), second = await pairConnector(input);
  assert.equal(first.token, second.token); assert.equal(first.connectionId, second.connectionId);
  assert.equal(stored.connectorTokenHash, hash(first.token));
  await assert.rejects(pairConnector({ ...input, attemptId: "different-attempt" }), /already been used/);
  stored.desiredConnected = false;
  await assert.rejects(pairConnector(input), /new pairing code/);
});

test("connector auth rejects browser JWTs, revoked tokens and deleted owners", async (t) => {
  let result, forwarded = 0;
  const res = { status(code) { result = code; return this; }, json() {} };
  let found = null;
  t.mock.method(BrokerConnection, "findOne", (filter) => {
    assert.equal(filter.desiredConnected, true); assert.equal(filter.revokedAt, null);
    assert.equal(filter.connectorTokenHash, hash(`jmt_${"a".repeat(43)}`));
    return { select: async () => found };
  });
  t.mock.method(User, "exists", async () => false);
  await authenticateMetaTraderConnector({ headers: { authorization: "Bearer browser-token" } }, res, () => forwarded++);
  assert.equal(result, 401);
  await authenticateMetaTraderConnector({ headers: { authorization: `Connector jmt_${"a".repeat(43)}` } }, res, () => forwarded++);
  assert.equal(result, 401);
  found = connection;
  await authenticateMetaTraderConnector({ headers: { authorization: `Connector jmt_${"a".repeat(43)}` } }, res, () => forwarded++);
  assert.equal(result, 401); assert.equal(forwarded, 0);
});

test("browser connector lookup scopes ownership and revocation preserves history", async (t) => {
  t.mock.method(BrokerConnection, "findOne", async (filter) => { assert.equal(filter.userId, "owner"); return null; });
  await assert.rejects(ownedConnector("owner", "a".repeat(24)), /not found/);
  const writes = [];
  t.mock.method(BrokerConnection, "updateOne", async (filter, value) => writes.push(value));
  t.mock.method(BrokerPosition, "updateMany", async (filter, value) => { assert.equal(value.$set.status, "unknown"); });
  t.mock.method(TradingAccount, "updateOne", async () => ({}));
  t.mock.method(Trade, "deleteMany", () => { throw new Error("History must not be deleted"); });
  await revokeConnector(connection);
  assert.equal(writes[0].$set.desiredConnected, false); assert.equal(writes[0].$unset.connectorTokenHash, 1);
});

test("payload validation preserves 64-bit ticket strings and rejects unknown or nonfinite data", () => {
  assert.equal(validatePosition(position).id, "18446744073709551615");
  assert.throws(() => validatePosition({ ...position, id: 18446744073709551615 }));
  assert.throws(() => validatePosition({ ...position, profit: Infinity }));
  assert.throws(() => validatePosition({ ...position, accessToken: "not-allowed" }));
  assert.throws(() => validateHistoryRecord({ id: "1" }, "deal"));
  const runtime = new MetaTraderRuntime();
  assert.throws(() => runtime.envelope(connection, envelope({ accountKey: "b".repeat(64) }), []), /different/);
});

test("heartbeat status moves through fresh, stale and offline and restart requests reconciliation", async (t) => {
  assert.equal(heartbeatStatus(100000, true, 110000), "connected");
  assert.equal(heartbeatStatus(100000, true, 120000), "stale");
  assert.equal(heartbeatStatus(100000, true, 146000), "offline");
  assert.equal(heartbeatStatus(100000, false, 100001), "offline");
  t.mock.method(BrokerConnection, "updateOne", async () => ({}));
  const runtime = new MetaTraderRuntime();
  assert.equal((await runtime.heartbeat(connection, envelope({ terminalConnected: true }))).needsReconciliation, true);
  runtime.session(connection).ready = true;
  assert.equal((await runtime.heartbeat(connection, envelope({ terminalConnected: true }))).needsReconciliation, false);
  await runtime.heartbeat(connection, envelope({ terminalConnected: false }));
  assert.equal(runtime.session(connection).ready, false);
});

test("price-only snapshots update memory without durable writes; old sequence is ignored", async (t) => {
  const runtime = new MetaTraderRuntime();
  const state = runtime.session(connection);
  state.signature = durableSignature([position]); state.sequence = 1;
  state.positions.set(position.id, { _id: "position", tradingAccount: "account", native: position });
  t.mock.method(TradingAccount, "findOne", async () => ({ _id: "account" }));
  t.mock.method(BrokerPosition, "findOneAndUpdate", () => { throw new Error("Price changes must not write positions"); });
  await runtime.positions(connection, envelope({ sequence: 2, positions: [{ ...position, profit: 5, currentPrice: 1.3 }] }));
  assert.equal(state.positions.get(position.id).native.profit, 5);
  await runtime.positions(connection, envelope({ sequence: 1, positions: [position] }));
  assert.equal(state.positions.get(position.id).native.profit, 5);
  assert.notEqual(durableSignature([position]), durableSignature([{ ...position, volume: 0.5 }]));
});

test("history receipt deduplicates replayed pages and never advances a partial batch checkpoint", async (t) => {
  const runtime = new MetaTraderRuntime();
  const batch = { start: 0, end: 100, pageCount: 2, pages: [] };
  t.mock.method(ConnectorHistorySync, "findOneAndUpdate", async (_filter, update) => {
    if (update.$addToSet && !batch.pages.includes(update.$addToSet.pages)) batch.pages.push(update.$addToSet.pages);
    return batch;
  });
  t.mock.method(BrokerConnection, "findById", async () => connection);
  t.mock.method(BrokerConnection, "updateOne", () => { throw new Error("Incomplete batch cannot advance checkpoint"); });
  const payload = envelope({ syncId: "batch", start: 0, end: 100, page: 0, pageCount: 2, deals: [], orders: [] });
  assert.equal((await runtime.history(connection, payload)).historyCursor, 0);
  await runtime.history(connection, payload); assert.deepEqual(batch.pages, [0]);
  await assert.rejects(runtime.history(connection, { ...payload, start: 10 }), /checkpoint/);
  await assert.rejects(runtime.history(connection, { ...payload, page: 2 }), /payload/);
});

test("a complete history batch advances its checkpoint only after normalization", async (t) => {
  const runtime = new MetaTraderRuntime();
  const batch = { start: 0, end: 100, pageCount: 1, pages: [0] };
  let normalized = false, advanced = false;
  t.mock.method(ConnectorHistorySync, "findOneAndUpdate", async () => batch);
  t.mock.method(ConnectorHistorySync, "updateOne", async () => ({}));
  t.mock.method(TradingAccount, "findOne", async () => ({ _id: "account" }));
  t.mock.method(User, "findById", () => ({ select: () => ({ lean: async () => ({}) }) }));
  t.mock.method(BrokerHistoryEvent, "aggregate", () => ({ cursor: async function* () { normalized = true; } }));
  t.mock.method(BrokerConnection, "updateOne", async (_filter, update) => {
    assert.equal(normalized, true); assert.equal(update.$max.historyCursor, 100); advanced = true;
  });
  t.mock.method(BrokerConnection, "findById", async () => ({ historyCursor: advanced ? 100 : 0 }));
  const result = await runtime.history(connection, envelope({ syncId: "batch", start: 0, end: 100, page: 0, pageCount: 1, deals: [], orders: [] }));
  assert.equal(result.historyCursor, 100);
});

test("connector HTTP rejects unauthenticated uploads and accepts a scoped heartbeat", async (t) => {
  t.mock.method(BrokerConnection, "findOne", () => ({ select: async () => connection }));
  t.mock.method(User, "exists", async () => ({ _id: "owner" }));
  t.mock.method(BrokerConnection, "updateOne", async () => ({ matchedCount: 1 }));
  const app = express(); app.use(express.json()); app.use("/connector", connectorRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/connector`;
  let response = await fetch(`${url}/heartbeat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(envelope({ terminalConnected: true })) });
  assert.equal(response.status, 401);
  response = await fetch(`${url}/heartbeat`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/plain", Authorization: `Connector jmt_${"a".repeat(43)}` }, body: JSON.stringify(envelope({ terminalConnected: true })) });
  assert.equal(response.status, 200);
  const lines = (await response.text()).split("\n"); assert.equal(lines.length, 7); assert.equal(lines[0], "JUVO1");
  assert.equal((await fetch(`${url}/status`)).status, 401);
  response = await fetch(`${url}/download`); assert.equal(response.status, 200); assert.match(await response.text(), /OnTradeTransaction/);
});

test("migration preserves trade documents, disconnects legacy connections and has a read-only dry run", async (t) => {
  const writes = [];
  t.mock.method(BrokerConnection.collection, "find", () => ({ toArray: async () => [{ _id: "legacy", userId: "owner", externalAccountId: "old-resource", tradingAccount: "account" }] }));
  t.mock.method(Trade.collection, "countDocuments", async () => 5);
  t.mock.method(BrokerPosition.collection, "countDocuments", async () => 2);
  t.mock.method(BrokerConnection.collection, "updateOne", async (filter, value) => writes.push(value));
  t.mock.method(Trade.collection, "updateMany", async (filter, value) => { assert.deepEqual(value, { $set: { source: "metatrader" } }); });
  t.mock.method(BrokerPosition.collection, "updateMany", async () => ({}));
  t.mock.method(TradingAccount, "updateOne", async () => ({}));
  assert.deepEqual(await migrateLegacyMetaApi({ dryRun: true }), { connections: 1, trades: 5, positions: 2 });
  assert.equal(writes.length, 0);
  await migrateLegacyMetaApi();
  assert.equal(writes[0].$set.desiredConnected, false); assert.equal(writes[0].$set.legacyResourceId, "old-resource");
});

test("EA is read-only and transaction handler only sets reconciliation flags", async () => {
  const source = await readFile(new URL("../connectors/mt5/JUVOConnector.mq5", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(OrderSend|OrderSendAsync|PositionClose|PositionModify|CTrade)\s*\(/);
  const handler = source.match(/void OnTradeTransaction\([\s\S]*?\n\}/)?.[0];
  assert.ok(handler); assert.doesNotMatch(handler, /WebRequest|HistorySelect|SendPending/);
  assert.match(source, /TERMINAL_CONNECTED/); assert.match(source, /HistorySelect/);
});
