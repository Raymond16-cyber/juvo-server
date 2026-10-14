// Intentional legacy-provider references: preserve MetaApi history without running its SDK.
import BrokerConnection from "../../models/Broker.model.js";
import BrokerPosition from "../../models/BrokerPosition.model.js";
import Trade from "../../models/Trades.js";
import TradingAccount from "../../models/tradingAccounts.js";

export async function migrateLegacyMetaApi({ dryRun = false } = {}) {
  const connections = await BrokerConnection.collection.find({ provider: "metaapi" }).toArray();
  const report = { connections: connections.length, trades: await Trade.collection.countDocuments({ source: "metaapi" }), positions: await BrokerPosition.collection.countDocuments({ provider: "metaapi" }) };
  if (dryRun) return report;
  for (const connection of connections) {
    await BrokerConnection.collection.updateOne({ _id: connection._id, provider: "metaapi" }, {
      $set: { provider: "metatrader", status: "disconnected", desiredConnected: false, legacy: true, legacyResourceId: connection.externalAccountId || "" },
      $unset: { externalAccountId: "", providerState: "", connectionStatus: "", requestKey: "", pendingKey: "", creationTransactionId: "", creationLeaseUntil: "", streamLeaseOwner: "", streamLeaseUntil: "", retryAt: "", investorMode: "" },
    });
    if (connection.tradingAccount) await TradingAccount.updateOne({ _id: connection.tradingAccount, userId: connection.userId }, { $set: { isConnected: false } });
  }
  await Trade.collection.updateMany({ source: "metaapi" }, { $set: { source: "metatrader" } });
  await BrokerPosition.collection.updateMany({ provider: "metaapi" }, { $set: { provider: "metatrader", status: "unknown" } });
  return report;
}
