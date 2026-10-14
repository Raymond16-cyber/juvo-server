import mongoose from "mongoose";

// Ingestion ledger for reconstructing partial closes/reversals across reconnects, not a second Trade model.
const schema = new mongoose.Schema({
  brokerConnection: { type: mongoose.Schema.Types.ObjectId, ref: "BrokerConnection", required: true },
  kind: { type: String, enum: ["deal", "order"], required: true },
  ticket: { type: String, required: true },
  positionId: String,
  time: Date,
  data: { type: mongoose.Schema.Types.Mixed, select: false, required: true },
}, { timestamps: true });
schema.index({ brokerConnection: 1, kind: 1, ticket: 1 }, { unique: true });
schema.index({ brokerConnection: 1, kind: 1, positionId: 1, time: 1 });
export default mongoose.model("BrokerHistoryEvent", schema);
