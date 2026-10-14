import BrokerConnection from "../../models/Broker.model.js";
import BrokerHistoryEvent from "../../models/BrokerHistoryEvent.model.js";
import ConnectorPairing from "../../models/ConnectorPairing.js";
import ConnectorHistorySync from "../../models/ConnectorHistorySync.js";

export async function initializeMetaTraderIndexes() {
  // Pairing and replay protection must exist before accepting connector requests.
  for (const model of [BrokerConnection, BrokerHistoryEvent, ConnectorPairing, ConnectorHistorySync]) {
    await model.createIndexes();
  }
}
