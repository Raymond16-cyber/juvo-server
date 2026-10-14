import mongoose from "mongoose";
import BrokerConnection from "../../models/Broker.model.js";
import BrokerPosition from "../../models/BrokerPosition.model.js";
import TradingAccount from "../../models/tradingAccounts.js";
import ConnectorPairing from "../../models/ConnectorPairing.js";
import { accountKey, hash, newPairingCode, tokenForPair, connectorError, connectorConfig, connectorLog } from "./metatrader.security.js";
import { fields, text, validateAccount } from "./metatrader.validation.js";
import { syncMetaAccount } from "./metatrader.sync.js";
import { emitToUser } from "../../realtime/realtime.hub.js";

export async function createPairingCode(userId) {
  if (!connectorConfig().enabled) throw connectorError("CONFIG", "The JUVO administrator must configure the connector URL and authentication first.", 503);
  const code = newPairingCode();
  await ConnectorPairing.updateMany({ userId, consumedAt: null }, { $set: { expiresAt: new Date() } });
  const expiresAt = new Date(Date.now() + 10 * 60000);
  await ConnectorPairing.create({ userId, codeHash: hash(code), expiresAt });
  connectorLog("pairing code created");
  return { code, expiresAt, apiUrl: connectorConfig().url };
}

export async function pairConnector(input) {
  fields(input, ["protocolVersion", "connectorVersion", "code", "attemptId", "account"]);
  if (input.protocolVersion !== 1) throw connectorError("PROTOCOL", "Update JUVO Connector to protocol version 1.", 426);
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(input.connectorVersion || "") || !/^JUV-([A-HJ-NP-Z2-9]{4}-){2}[A-HJ-NP-Z2-9]{4}$/.test(input.code || "")) throw connectorError("PAIRING", "Pairing code is invalid or expired.");
  text(input.attemptId, 128);
  const info = validateAccount(input.account);
  const key = accountKey(info), attemptHash = hash(input.attemptId), codeHash = hash(input.code);
  const pair = await ConnectorPairing.findOneAndUpdate({ codeHash, expiresAt: { $gt: new Date() }, $or: [
    { consumedAt: null }, { attemptHash, accountKey: key },
  ] }, { $set: { consumedAt: new Date(), attemptHash, accountKey: key } }, { new: true }).select("+codeHash +attemptHash +accountKey");
  if (!pair) throw connectorError("PAIRING", "Pairing code is expired or has already been used.");
  const filter = { userId: pair.userId, provider: "metatrader", externalAccountKey: key };
  let connection = await BrokerConnection.findOne(filter).select("+pairingId");
  if (connection && ((connection.pairedAt > pair.createdAt) || (String(connection.pairingId) === String(pair._id) && !connection.desiredConnected))) {
    throw connectorError("PAIRING", "Generate a new pairing code in JUVO.");
  }
  const token = tokenForPair(pair);
  // A consumed code can recover a lost HTTP response only for the identical attempt and account.
  const update = { $set: { platform: "mt5", externalAccountId: key, server: info.server, accountNumber: info.login,
    brokerName: info.broker, connectorTokenHash: hash(token), pairingId: pair._id, pairedAt: pair.createdAt,
    desiredConnected: true, revokedAt: null, status: "synchronizing", terminalConnected: true,
    connectorVersion: input.connectorVersion, protocolVersion: 1, lastHeartbeatAt: new Date(), legacy: false },
    $setOnInsert: { userId: pair.userId, provider: "metatrader", externalAccountKey: key } };
  try {
    connection = await BrokerConnection.findOneAndUpdate({ ...filter, $and: [
      { $or: [{ pairedAt: { $lte: pair.createdAt } }, { pairedAt: null }] },
      { $or: [{ pairingId: { $ne: pair._id } }, { desiredConnected: true }] },
    ] }, update, { new: true, upsert: true });
  } catch (error) {
    if (error.code === 11000) throw connectorError("PAIRING", "Another pairing is already active. Generate a new code.", 409);
    throw error;
  }
  await syncMetaAccount(connection, info);
  emitToUser(connection.userId, "broker:sync-status", { provider: "metatrader", status: "synchronizing" });
  connectorLog("connector paired");
  return { token, connectionId: String(connection._id), accountKey: key, historyCursor: connection.historyCursor || 0 };
}

export async function ownedConnector(userId, id) {
  if (!mongoose.isValidObjectId(id)) throw connectorError("NOT_FOUND", "Connector not found.", 404);
  const connection = await BrokerConnection.findOne({ _id: id, userId, provider: "metatrader" });
  if (!connection) throw connectorError("NOT_FOUND", "Connector not found.", 404);
  return connection;
}
export async function revokeConnector(connection) {
  await BrokerConnection.updateOne({ _id: connection._id, userId: connection.userId }, { $set: { desiredConnected: false, status: "disconnected", revokedAt: new Date(), terminalConnected: false }, $unset: { connectorTokenHash: 1 } });
  await BrokerPosition.updateMany({ brokerConnection: connection._id, status: "open" }, { $set: { status: "unknown" } });
  await TradingAccount.updateOne({ _id: connection.tradingAccount, userId: connection.userId }, { $set: { isConnected: false } });
  emitToUser(connection.userId, "broker:sync-status", { provider: "metatrader", status: "disconnected" });
}
